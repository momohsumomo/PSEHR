from __future__ import annotations

import os
import json
from typing import Any
from webauthn import (
    generate_registration_options,
    verify_registration_response,
    generate_authentication_options,
    verify_authentication_response,
    options_to_json,
)
from webauthn.helpers import bytes_to_base64url, base64url_to_bytes
from webauthn.helpers.structs import (
    AttestationConveyancePreference,
    AuthenticatorAttachment,
    AuthenticatorSelectionCriteria,
    COSEAlgorithmIdentifier,
    PublicKeyCredentialDescriptor,
    PublicKeyCredentialParameters,
    PublicKeyCredentialRpEntity,
    PublicKeyCredentialUserEntity,
    UserVerificationRequirement,
    PublicKeyCredentialType,
)
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore

FIDO2_KEY_EXTENSION_URL = "https://wundadi.tw/fhir/StructureDefinition/patient-fido2-key"
DEFAULT_RP_ID = "localhost"
DEFAULT_RP_NAME = "北極星自主電子病歷系統"
DEFAULT_ORIGINS = ["http://localhost:3010", "http://127.0.0.1:3010"]


def get_patient_fido2_keys(patient: dict[str, Any]) -> list[dict[str, Any]]:
    """從 FHIR Patient Resource 中提取所有已註冊的 FIDO2 公鑰。"""
    keys = []
    for ext in patient.get("extension", []):
        if ext.get("url") == FIDO2_KEY_EXTENSION_URL:
            key_id = ""
            pub_key = ""
            counter = 0
            for sub in ext.get("extension", []):
                url = sub.get("url")
                if url == "keyId":
                    key_id = sub.get("valueString")
                elif url == "publicKey":
                    pub_key = sub.get("valueString")
                elif url == "counter":
                    counter = sub.get("valueInteger", 0)
            if key_id and pub_key:
                keys.append({"keyId": key_id, "publicKey": pub_key, "counter": counter})
    return keys


def add_or_update_patient_fido2_key(
    patient: dict[str, Any], key_id: str, public_key_pem: str, counter: int
) -> dict[str, Any]:
    """更新 Patient 資源 payload 內的 FIDO2 密鑰擴充。"""
    new_extensions = []
    found = False
    for ext in patient.get("extension", []):
        if ext.get("url") == FIDO2_KEY_EXTENSION_URL:
            sub_key_id = ""
            for sub in ext.get("extension", []):
                if sub.get("url") == "keyId":
                    sub_key_id = sub.get("valueString")
            if sub_key_id == key_id:
                # 替換成新的值
                new_extensions.append({
                    "url": FIDO2_KEY_EXTENSION_URL,
                    "extension": [
                        {"url": "keyId", "valueString": key_id},
                        {"url": "publicKey", "valueString": public_key_pem},
                        {"url": "counter", "valueInteger": counter}
                    ]
                })
                found = True
            else:
                new_extensions.append(ext)
        else:
            new_extensions.append(ext)

    if not found:
        new_extensions.append({
            "url": FIDO2_KEY_EXTENSION_URL,
            "extension": [
                {"url": "keyId", "valueString": key_id},
                {"url": "publicKey", "valueString": public_key_pem},
                {"url": "counter", "valueInteger": counter}
            ]
        })

    return {**patient, "extension": new_extensions}


def generate_webauthn_registration_options(
    patient_id: str,
    patient_name: str,
    attachment: str = "cross-platform"
) -> dict[str, Any]:
    """生成 FIDO2 註冊參數。"""
    challenge = os.urandom(32)
    
    # 使用 patient_id 做為 user.id 進行編碼
    # user_id 傳入 bytes
    user_id = patient_id.encode("utf-8")
    
    att_attachment = AuthenticatorAttachment.CROSS_PLATFORM
    if attachment == "platform":
        att_attachment = AuthenticatorAttachment.PLATFORM

    options = generate_registration_options(
        rp_id=DEFAULT_RP_ID,
        rp_name=DEFAULT_RP_NAME,
        user_id=user_id,
        user_name=patient_name,
        user_display_name=patient_name,
        challenge=challenge,
        supported_pub_key_algs=[
            COSEAlgorithmIdentifier.ECDSA_SHA_256,
            COSEAlgorithmIdentifier.RSASSA_PKCS1_v1_5_SHA_256,
        ],
        authenticator_selection=AuthenticatorSelectionCriteria(
            authenticator_attachment=att_attachment,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
        attestation=AttestationConveyancePreference.NONE,
    )
    
    # 回傳 JSON 前需記錄 bytes challenge 的 base64url，以供驗證
    challenge_b64 = bytes_to_base64url(challenge)
    
    # 轉為 JSON 物件
    options_dict = json.loads(options_to_json(options))
    options_dict["challenge"] = challenge_b64  # webauthn 庫已做，但手動確保為 b64url 字串
    
    return {
        "options": options_dict,
        "challenge_raw": challenge_b64
    }


def verify_webauthn_registration(
    registration_response: dict[str, Any],
    expected_challenge: str
) -> dict[str, Any]:
    """驗證前端傳回的註冊 Assertion，成功後解析出 Credential ID 與公鑰 PEM。"""
    try:
        verification = verify_registration_response(
            credential=registration_response,
            expected_challenge=base64url_to_bytes(expected_challenge),
            expected_origin=DEFAULT_ORIGINS,
            expected_rp_id=DEFAULT_RP_ID,
            require_user_verification=False,
        )
        return {
            "verified": True,
            "credential_id": bytes_to_base64url(verification.credential_id),
            "public_key_pem": verification.credential_public_key.decode("utf-8") if isinstance(verification.credential_public_key, bytes) else str(verification.credential_public_key),
            "sign_count": verification.sign_count
        }
    except Exception as exc:
        return {
            "verified": False,
            "error": str(exc)
        }


def generate_webauthn_login_options(
    patient_id: str,
    registered_keys: list[dict[str, Any]]
) -> dict[str, Any]:
    """生成 FIDO2 登入/認證參數。"""
    challenge = os.urandom(32)
    challenge_b64 = bytes_to_base64url(challenge)

    allow_credentials = []
    for key in registered_keys:
        allow_credentials.append(
            PublicKeyCredentialDescriptor(
                type=PublicKeyCredentialType.PUBLIC_KEY,
                id=base64url_to_bytes(key["keyId"])
            )
        )

    options = generate_authentication_options(
        rp_id=DEFAULT_RP_ID,
        challenge=challenge,
        allow_credentials=allow_credentials,
        user_verification=UserVerificationRequirement.PREFERRED,
    )

    options_dict = json.loads(options_to_json(options))
    options_dict["challenge"] = challenge_b64

    return {
        "options": options_dict,
        "challenge_raw": challenge_b64
    }


def verify_webauthn_login(
    assertion_response: dict[str, Any],
    expected_challenge: str,
    credential_public_key_pem: str,
    stored_counter: int
) -> dict[str, Any]:
    """驗證登入的 Assertion 簽章，並檢查 counter 計數器是否大於庫存以防範重放攻擊。"""
    try:
        # 將 PEM 公鑰轉回 bytes
        public_key_bytes = credential_public_key_pem.encode("utf-8")

        verification = verify_authentication_response(
            credential=assertion_response,
            expected_challenge=base64url_to_bytes(expected_challenge),
            expected_origin=DEFAULT_ORIGINS,
            expected_rp_id=DEFAULT_RP_ID,
            credential_public_key=public_key_bytes,
            credential_current_sign_count=stored_counter,
            require_user_verification=False,
        )
        
        # 驗證 counter 是否有遞增
        if verification.new_sign_count <= stored_counter and verification.new_sign_count != 0:
            return {
                "verified": False,
                "error": "COUNTER_REPLAY_DETECTED"
            }

        return {
            "verified": True,
            "new_counter": verification.new_sign_count
        }
    except Exception as exc:
        return {
            "verified": False,
            "error": str(exc)
        }
