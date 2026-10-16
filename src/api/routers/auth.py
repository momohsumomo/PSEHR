from __future__ import annotations

from typing import Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from src.app.bootstrap import get_fhir_repository, get_shadow_store
from src.core.nhi_auth_validators import (
    RegisterOptionsRequest,
    RegisterCredentialRequest,
    LoginOptionsRequest,
    LoginCredentialRequest,
)
from src.core.nhi_auth_service import (
    generate_webauthn_registration_options,
    verify_webauthn_registration,
    generate_webauthn_login_options,
    verify_webauthn_login,
    get_patient_fido2_keys,
    add_or_update_patient_fido2_key,
)
from src.core.token_service import get_token_service

router = APIRouter(tags=["OAuth2-SMART-FIDO2"])


class OAuthTokenRequest(BaseModel):
    grant_type: str = Field(..., description="Must be 'webauthn'")
    patientId: str
    assertionResponse: dict[str, Any] = Field(..., description="The navigator.credentials.get() response JSON")


@router.get(
    "/nhi/v1/auth/register-options",
    summary="獲取 FIDO2 註冊參數選項 ( navigator.credentials.create() 前置 )",
)
def get_register_options(
    patientId: str = Query(..., description="病人 ID"),
    attachment: str = Query("cross-platform", description="cross-platform 或 platform"),
) -> dict[str, Any]:
    store = get_shadow_store()
    patient = store.get_cached_resource("Patient", patientId)
    if not patient:
        raise HTTPException(status_code=404, detail="PATIENT_NOT_FOUND")

    # 取得病人姓名
    names = patient.get("name") or []
    patient_name = "Wundadi Patient"
    if names:
        patient_name = names[0].get("text") or f"{names[0].get('family', '')}{''.join(names[0].get('given', []))}"

    res = generate_webauthn_registration_options(patientId, patient_name, attachment)
    store.store_fido2_challenge(patientId, res["challenge_raw"])
    return res["options"]


@router.post(
    "/nhi/v1/auth/register-credential",
    status_code=201,
    summary="完成 FIDO2 註冊並寫入 Patient 資源 Extension",
)
def register_credential(body: RegisterCredentialRequest) -> dict[str, Any]:
    store = get_shadow_store()
    patient = store.get_cached_resource("Patient", body.patientId)
    if not patient:
        raise HTTPException(status_code=404, detail="PATIENT_NOT_FOUND")

    expected_challenge = store.get_fido2_challenge(body.patientId)
    if not expected_challenge:
        raise HTTPException(status_code=400, detail="CHALLENGE_EXPIRED_OR_NOT_FOUND")

    verification = verify_webauthn_registration(body.registrationResponse, expected_challenge)
    if not verification["verified"]:
        raise HTTPException(status_code=400, detail=f"WEBAUTHN_VERIFICATION_FAILED: {verification.get('error')}")

    # 更新 Patient 資源 Extension
    repo = get_fhir_repository()
    updated_patient = add_or_update_patient_fido2_key(
        patient,
        verification["credential_id"],
        verification["public_key_pem"],
        verification["sign_count"]
    )
    
    # 寫入庫內 (同時更新 Cache 與 Index)
    repo.update_resource("Patient", body.patientId, updated_patient)
    
    # 刪除已使用的 Challenge
    store.delete_fido2_challenge(body.patientId)

    return {
        "status": "success",
        "credentialId": verification["credential_id"],
        "message": "FIDO2 密鑰註冊成功"
    }


@router.get(
    "/nhi/v1/auth/login-options",
    summary="獲取 FIDO2 登入驗證參數選項 ( navigator.credentials.get() 前置 )",
)
def get_login_options(
    patientId: str = Query(..., description="病人 ID"),
) -> dict[str, Any]:
    store = get_shadow_store()
    patient = store.get_cached_resource("Patient", patientId)
    if not patient:
        raise HTTPException(status_code=404, detail="PATIENT_NOT_FOUND")

    registered_keys = get_patient_fido2_keys(patient)
    if not registered_keys:
        raise HTTPException(status_code=400, detail="NO_FIDO2_KEYS_REGISTERED")

    res = generate_webauthn_login_options(patientId, registered_keys)
    store.store_fido2_challenge(patientId, res["challenge_raw"])
    return res["options"]


@router.post(
    "/oauth/token",
    summary="SMART on FHIR OAuth 授權端點（發行 JWT 憑證）",
)
def get_oauth_token(body: OAuthTokenRequest) -> dict[str, Any]:
    if body.grant_type != "webauthn":
        raise HTTPException(status_code=400, detail="UNSUPPORTED_GRANT_TYPE")

    store = get_shadow_store()
    patient = store.get_cached_resource("Patient", body.patientId)
    if not patient:
        raise HTTPException(status_code=404, detail="PATIENT_NOT_FOUND")

    expected_challenge = store.get_fido2_challenge(body.patientId)
    if not expected_challenge:
        raise HTTPException(status_code=400, detail="CHALLENGE_EXPIRED_OR_NOT_FOUND")

    registered_keys = get_patient_fido2_keys(patient)
    credential_id = body.assertionResponse.get("id")
    
    # 找到對應的公鑰
    target_key = next((k for k in registered_keys if k["keyId"] == credential_id), None)
    if not target_key:
        raise HTTPException(status_code=403, detail="KEY_NOT_REGISTERED")

    verification = verify_webauthn_login(
        body.assertionResponse,
        expected_challenge,
        target_key["publicKey"],
        target_key["counter"]
    )

    if not verification["verified"]:
        error_msg = verification.get("error", "UNKNOWN")
        if error_msg == "COUNTER_REPLAY_DETECTED":
            raise HTTPException(status_code=403, detail="FIDO2_COUNTER_REPLAY_DETECTED")
        raise HTTPException(status_code=403, detail=f"FIDO2_SIGNATURE_INVALID: {error_msg}")

    # 更新計數器 (防重放)
    repo = get_fhir_repository()
    updated_patient = add_or_update_patient_fido2_key(
        patient,
        target_key["keyId"],
        target_key["publicKey"],
        verification["new_counter"]
    )
    repo.update_resource("Patient", body.patientId, updated_patient)

    # 刪除已使用的 Challenge
    store.delete_fido2_challenge(body.patientId)

    # 簽發 RS256 JWT
    token_service = get_token_service()
    access_token = token_service.sign_jwt(body.patientId)

    return {
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": 14400,
        "scope": "patient/*.read patient/*.write user/*.read user/*.write"
    }


@router.get(
    "/.well-known/jwks.json",
    summary="JWKS 公鑰集端點",
)
def get_jwks() -> dict[str, Any]:
    return get_token_service().get_jwks()
