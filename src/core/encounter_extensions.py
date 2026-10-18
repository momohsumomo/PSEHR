"""Encounter 擴充欄位（診間掛號、病患預診）。"""

from __future__ import annotations

from typing import Any

QUEUE_EXTENSION_URL = "https://wundadi.tw/fhir/StructureDefinition/encounter-queue"
REG_EXTENSION_URL = "https://wundadi.tw/fhir/StructureDefinition/encounter-reg"
PREVISIT_EXTENSION_URL = (
    "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/patient-previsit"
)

REG_STRING_KEYS = (
    "caseNo",
    "copayCode",
    "dispense",
    "treatSeq",
    "treatmentNumber",
    "treatDateTime",
    "room",
    "shift",
    "afterCheck",
    "treatmentItem",
    "hcId",
    "hcIdNo",
    "icException",
    "noCardReason",
    "pharmacist",
    "doctorId",
    "doctorName",
    "payType",
    "regFee",
    "copayAmt",
    "deposit",
    "consultFee",
    "drugFee",
    "materialFee",
    "burdenFee",
    "totalFee",
    "selfPay",
    "cardDisc",
    "drugDisc",
    "arrears",
    "treatFee",
    "noteMark",
    "forespeak",
    "remarkText",
    "opdDate",
    "referralSeq",
    "referralHospId",
    "referralHospName",
    "acceptReferral",
    "referralDate",
    "referralLocalId",
    "referralNhiId",
    "referralRetry",
    "samId",
    "securitySign",
    "icUploadDate",
    "icCaseNo",
    "icRemark",
    "actualTreatWhen",
    "actualTreatId",
    "icUploadFee",
    "icCopay",
    "regCc",
)
REG_BOOL_KEYS = ("paperCard", "cardWritten", "prebook")


def put_reg_string(payload: dict[str, Any], key: str, value: str) -> None:
    """Write one reg-extension string. An empty value removes that key."""
    exts = payload.setdefault("extension", [])
    if not isinstance(exts, list):
        exts = []
        payload["extension"] = exts
    reg = next((item for item in exts if isinstance(item, dict) and item.get("url") == REG_EXTENSION_URL), None)
    if reg is None:
        reg = {"url": REG_EXTENSION_URL, "extension": []}
        exts.append(reg)
    subs = [item for item in (reg.get("extension") or []) if not (isinstance(item, dict) and item.get("url") == key)]
    text = str(value or "")
    if text:
        subs.append({"url": key, "valueString": text})
    reg["extension"] = subs


def extract_reg_meta(payload: dict[str, Any]) -> dict[str, Any]:
    """掛號編輯／取號結果（案件、就醫序號、退掛用就診時間）。"""
    out: dict[str, Any] = {}
    for ext in payload.get("extension") or []:
        if ext.get("url") != REG_EXTENSION_URL:
            continue
        for sub in ext.get("extension") or []:
            key = str(sub.get("url") or "")
            if key in REG_STRING_KEYS and sub.get("valueString"):
                out[key] = str(sub["valueString"])
            elif key in REG_BOOL_KEYS and "valueBoolean" in sub:
                out[key] = bool(sub["valueBoolean"])
    return out


def attach_reg_extension(payload: dict[str, Any], fields: dict[str, Any]) -> dict[str, Any]:
    """合併寫入掛號擴充：既有欄位保留，新值覆寫（None 略過）。"""
    out = dict(payload)
    merged: dict[str, Any] = dict(extract_reg_meta(out))
    for key, value in fields.items():
        if value is None:
            continue
        if key in REG_BOOL_KEYS:
            merged[key] = bool(value)
            continue
        text = str(value) if key == "regCc" else str(value).strip()
        if not text or text == "—" or (key != "regCc" and not text.strip()):
            continue
        merged[key] = text
    others = [e for e in out.get("extension") or [] if e.get("url") != REG_EXTENSION_URL]
    subs: list[dict[str, Any]] = []
    for key in REG_STRING_KEYS:
        value = merged.get(key)
        if value is None:
            continue
        text = str(value) if key == "regCc" else str(value).strip()
        if not text or text == "—" or (key != "regCc" and not text.strip()):
            continue
        subs.append({"url": key, "valueString": text})
    for key in REG_BOOL_KEYS:
        if key in merged and merged[key] is not None:
            subs.append({"url": key, "valueBoolean": bool(merged[key])})
    if subs:
        others.append({"url": REG_EXTENSION_URL, "extension": subs})
    out["extension"] = others
    return out


def previsit_completed(payload: dict[str, Any]) -> bool:
    for ext in payload.get("extension") or []:
        if ext.get("url") != PREVISIT_EXTENSION_URL:
            continue
        for sub in ext.get("extension") or []:
            if sub.get("url") == "completed" and sub.get("valueBoolean") is True:
                return True
    return False


def attach_previsit_extension(
    payload: dict[str, Any],
    *,
    chief_complaint: str,
    symptom_tags: list[str],
    submitted_at: str,
) -> dict[str, Any]:
    """病患預診完成後寫入 Encounter.extension。"""
    out = dict(payload)
    extensions: list[dict[str, Any]] = [
        e for e in out.get("extension") or [] if e.get("url") != PREVISIT_EXTENSION_URL
    ]
    extensions.append(
        {
            "url": PREVISIT_EXTENSION_URL,
            "extension": [
                {"url": "completed", "valueBoolean": True},
                {"url": "chiefComplaint", "valueString": chief_complaint[:500]},
                {
                    "url": "symptomTags",
                    "valueString": ",".join(symptom_tags[:20]),
                },
                {"url": "submittedAt", "valueDateTime": submitted_at},
            ],
        }
    )
    out["extension"] = extensions
    out["reasonCode"] = [{"text": chief_complaint[:500]}]
    return out
