"""Encounter 擴充欄位（診間掛號、病患預診）。"""

from __future__ import annotations

from typing import Any

from src.core import fhir_urls

QUEUE_EXTENSION_URL = fhir_urls.ENCOUNTER_QUEUE
REG_EXTENSION_URL = fhir_urls.ENCOUNTER_REG
PREVISIT_EXTENSION_URL = fhir_urls.ENCOUNTER_PREVISIT
BOOK_EXTENSION_URL = fhir_urls.ENCOUNTER_BOOK

# encounter_index column -> encounter-book key. These were written to the index
# only (imports, cash-book marks, chief complaint); the index is derived from here.
# Kept apart from encounter-reg on purpose: readers of reg keys (claims, IC) must
# not start seeing values they never saw.
BOOK_FIELDS: tuple[tuple[str, str, str], ...] = (
    ("chief_complaint", "chiefComplaint", "string"),
    ("shift", "shift", "string"),
    ("slot_time", "slotTime", "string"),
    ("times_no", "timesNo", "integer"),
    ("owe_card", "oweCard", "integer"),
    ("reg_cc", "regCc", "string"),
    ("reg_remark", "regRemark", "string"),
    ("claim_doctor_id", "claimDoctorId", "string"),
    ("claim_pharmacist_id", "claimPharmacistId", "string"),
    ("treat_seq", "treatSeq", "string"),
)


def _book_ext(payload: dict[str, Any]) -> dict[str, Any] | None:
    for ext in payload.get("extension") or []:
        if isinstance(ext, dict) and ext.get("url") == BOOK_EXTENSION_URL:
            return ext
    return None


def has_book(payload: dict[str, Any]) -> bool:
    return _book_ext(payload) is not None


def extract_book(payload: dict[str, Any]) -> dict[str, Any]:
    """encounter-book as index columns; a missing key is None."""
    out: dict[str, Any] = {col: None for col, _key, _kind in BOOK_FIELDS}
    ext = _book_ext(payload)
    if ext is None:
        return out
    by_key = {key: (col, kind) for col, key, kind in BOOK_FIELDS}
    for sub in ext.get("extension") or []:
        hit = by_key.get(str(sub.get("url") or ""))
        if not hit:
            continue
        col, kind = hit
        out[col] = sub.get("valueInteger") if kind == "integer" else sub.get("valueString")
    return out


def put_book(payload: dict[str, Any], values: dict[str, Any]) -> None:
    """Set encounter-book columns in place. None or "" removes the key."""
    exts = payload.setdefault("extension", [])
    ext = _book_ext(payload)
    if ext is None:
        ext = {"url": BOOK_EXTENSION_URL, "extension": []}
        exts.append(ext)
    keys = {col: (key, kind) for col, key, kind in BOOK_FIELDS}
    subs = list(ext.get("extension") or [])
    for col, value in values.items():
        key, kind = keys[col]
        subs = [s for s in subs if s.get("url") != key]
        if value is None or (kind == "string" and str(value) == ""):
            continue
        if kind == "integer":
            subs.append({"url": key, "valueInteger": int(value)})
        else:
            subs.append({"url": key, "valueString": str(value)})
    order = {key: i for i, (_col, key, _kind) in enumerate(BOOK_FIELDS)}
    subs.sort(key=lambda s: order.get(str(s.get("url")), 99))
    if subs:
        ext["extension"] = subs
    else:
        payload["extension"] = [e for e in exts if e is not ext]


def carry_book(old: dict[str, Any] | None, new: dict[str, Any]) -> None:
    """A writer that rebuilt the Encounter without encounter-book keeps the stored one."""
    if not old or has_book(new):
        return
    ext = _book_ext(old)
    if ext is not None:
        new.setdefault("extension", []).append(ext)


def put_queue_status(payload: dict[str, Any], queue_status: str) -> None:
    for ext in payload.get("extension") or []:
        if not isinstance(ext, dict) or ext.get("url") != QUEUE_EXTENSION_URL:
            continue
        for sub in ext.get("extension") or []:
            if sub.get("url") == "queueStatus":
                sub["valueCode"] = queue_status
                return
        ext.setdefault("extension", []).append({"url": "queueStatus", "valueCode": queue_status})
        return
    payload.setdefault("extension", []).append(
        {"url": QUEUE_EXTENSION_URL, "extension": [{"url": "queueStatus", "valueCode": queue_status}]}
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
    "depositPaid",
    "consultFee",
    "drugFee",
    "materialFee",
    "burdenFee",
    "drugCopay",
    "cardIdentity",
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
    "orderSigns",
    "icUploadDate",
    "icCaseNo",
    "icRemark",
    "caseNoE1",
    "actualTreatWhen",
    "actualTreatId",
    "icUploadFee",
    "icCopay",
    "regCc",
    "idCategory",
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


def previsit_visit_kind(payload: dict[str, Any]) -> str:
    for ext in payload.get("extension") or []:
        if ext.get("url") != PREVISIT_EXTENSION_URL:
            continue
        for sub in ext.get("extension") or []:
            if sub.get("url") == "visitKind" and sub.get("valueString") in {"cosmetic", "medical"}:
                return str(sub["valueString"])
    return ""


def previsit_text(payload: dict[str, Any]) -> str:
    """病人在候診區填的那一句。不是主訴，不列印。"""
    for ext in payload.get("extension") or []:
        if ext.get("url") != PREVISIT_EXTENSION_URL:
            continue
        for sub in ext.get("extension") or []:
            if sub.get("url") == "chiefComplaint" and sub.get("valueString"):
                return str(sub["valueString"])
    return ""


def attach_previsit_extension(
    payload: dict[str, Any],
    *,
    chief_complaint: str,
    symptom_tags: list[str],
    submitted_at: str,
    visit_kind: str = "",
) -> dict[str, Any]:
    """病患預診完成後寫入 Encounter.extension。只寫預診欄，不碰主訴。"""
    out = dict(payload)
    earlier = previsit_text(out)
    if earlier:
        kept = [
            rc
            for rc in out.get("reasonCode") or []
            if not (isinstance(rc, dict) and str(rc.get("text") or "") == earlier)
        ]
        if kept:
            out["reasonCode"] = kept
        else:
            out.pop("reasonCode", None)
    extensions: list[dict[str, Any]] = [
        e for e in out.get("extension") or [] if e.get("url") != PREVISIT_EXTENSION_URL
    ]
    nested: list[dict[str, Any]] = [
        {"url": "completed", "valueBoolean": True},
        {"url": "chiefComplaint", "valueString": chief_complaint[:500]},
        {
            "url": "symptomTags",
            "valueString": ",".join(symptom_tags[:20]),
        },
        {"url": "submittedAt", "valueDateTime": submitted_at},
    ]
    if visit_kind in {"cosmetic", "medical"}:
        nested.append({"url": "visitKind", "valueString": visit_kind})
    extensions.append(
        {
            "url": PREVISIT_EXTENSION_URL,
            "extension": nested,
        }
    )
    out["extension"] = extensions
    return out
