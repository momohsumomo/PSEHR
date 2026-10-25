"""健保署患者欄位 → 標準 FHIR Patient（不可由前端任意變形）。"""

from __future__ import annotations

from typing import Any

from src.core.nhi_validators import (
    NhiPatientIntake,
    nhi_sex_to_fhir_gender,
    roc7_to_iso_date,
)

NHI_PATIENT_EXTENSION_URL = (
    "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/nhi-card-basic"
)
TW_NATIONAL_ID_SYSTEM = "http://www.moi.gov.tw/id"
NHI_CARD_ID_SYSTEM = "https://nhidcc.nhi.gov.tw/id"


def merge_nhi_patient_update(existing: dict[str, Any], nhi_payload: dict[str, Any]) -> dict[str, Any]:
    """讀卡／健保進場更新時，保留診所主檔擴充與聯絡資料，避免整包蓋掉。"""
    merged = dict(nhi_payload)
    new_exts = [
        e
        for e in (nhi_payload.get("extension") or [])
        if "nhi-card-basic" in str(e.get("url") or "")
    ]
    for ext in existing.get("extension") or []:
        url = str(ext.get("url") or "")
        if "nhi-card-basic" in url:
            continue
        new_exts.append(ext)
    merged["extension"] = new_exts
    if not merged.get("telecom") and existing.get("telecom"):
        merged["telecom"] = existing["telecom"]
    if not merged.get("address") and existing.get("address"):
        merged["address"] = existing["address"]
    return merged


def patient_name_entry(full: str) -> dict[str, Any]:
    """整段姓名。清單把姓和名接回來，所以畫面上看得到健保卡上的全名。"""
    from src.core.plain_text import plain_text

    text = plain_text(full).strip()
    if len(text) >= 2:
        return {"family": text[0], "given": [text[1:]], "text": text}
    return {"text": text}


def nhi_intake_to_fhir_patient(intake: NhiPatientIntake) -> dict[str, Any]:
    """將通過 Pydantic 校驗的健保資料轉為 FHIR Patient。"""
    iso_birth = roc7_to_iso_date(intake.birthday)
    gender = nhi_sex_to_fhir_gender(intake.sex)  # type: ignore[arg-type]

    names: list[dict[str, Any]] = []
    if intake.patientName:
        names.append(patient_name_entry(intake.patientName))

    payload: dict[str, Any] = {
        "resourceType": "Patient",
        "identifier": [
            {
                "use": "official",
                "system": TW_NATIONAL_ID_SYSTEM,
                "value": intake.idNo,
            },
            {
                "use": "official",
                "system": NHI_CARD_ID_SYSTEM,
                "value": intake.idNo,
            },
        ],
        "gender": gender,
        "birthDate": iso_birth,
        "extension": [
            {
                "url": NHI_PATIENT_EXTENSION_URL,
                "extension": [
                    {"url": "idNo", "valueString": intake.idNo},
                    {"url": "birthdayRoc", "valueString": intake.birthday},
                    {"url": "sex", "valueCode": intake.sex},
                ],
            }
        ],
    }
    if names:
        payload["name"] = names
    return payload


def extract_nhi_stickers_from_patient(patient: dict[str, Any]) -> dict[str, str | None]:
    """從 FHIR Patient 還原健保貼紙（dual-layer / sandbox 診斷）。"""
    result: dict[str, str | None] = {
        "idNo": None,
        "birthdayRoc": None,
        "sex": None,
        "birthDateIso": patient.get("birthDate"),
    }
    for ident in patient.get("identifier") or []:
        if ident.get("system") == TW_NATIONAL_ID_SYSTEM and ident.get("value"):
            result["idNo"] = str(ident["value"])
            break
    for ext in patient.get("extension") or []:
        if ext.get("url") != NHI_PATIENT_EXTENSION_URL:
            continue
        for sub in ext.get("extension") or []:
            url = sub.get("url")
            if url == "idNo":
                result["idNo"] = sub.get("valueString")
            elif url == "birthdayRoc":
                result["birthdayRoc"] = sub.get("valueString")
            elif url == "sex":
                result["sex"] = sub.get("valueCode")
    return result
