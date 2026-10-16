"""Card-in referral lookup, and reply upload on save."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from src.app.bootstrap import get_fhir_repository, get_shadow_store
from src.core.encounter_extensions import attach_reg_extension, extract_reg_meta
from src.core.nhi_fhir_mapper import TW_NATIONAL_ID_SYSTEM
from src.core.nhi_cshis6_client import DEFAULT_HOSPITAL_ID
from src.core.nhi_referral import (
    REPLY_TYPE_CODE,
    build_reply_xml,
    query_referrals,
    upload_file,
)
from src.core.referral_desk import list_slips, save_slip

router = APIRouter(prefix="/nhi/v1/referral", tags=["NHI-referral"])


class ReferralQueryBody(BaseModel):
    idNo: str = ""
    encounterId: str = ""


class ReferralSlipBody(BaseModel):
    id: str = ""
    kind: str
    encounterId: str = ""
    patientName: str = ""
    medicalNo: str = ""
    idNo: str = ""
    destHosp: str = ""
    destCode: str = ""
    dept: str = ""
    purpose: str = ""
    doctor: str = ""
    diagnosis: str = ""
    note: str = ""
    serial: str = ""
    validUntil: str = ""
    status: str = ""


class ReferralReplyBody(BaseModel):
    encounterId: str = ""
    idNo: str = ""
    serial: str = ""
    doctorId: str = ""
    diagnosis: str = ""
    note: str = ""
    expectReferral: bool = False


def _id_no_from_patient(patient: dict[str, Any] | None) -> str:
    if not patient:
        return ""
    for ident in patient.get("identifier") or []:
        if not isinstance(ident, dict):
            continue
        if ident.get("system") == TW_NATIONAL_ID_SYSTEM and ident.get("value"):
            return str(ident["value"]).strip().upper()
    return ""


def _load(encounter_id: str) -> tuple[dict[str, Any], dict[str, Any], str]:
    repo = get_fhir_repository()
    store = get_shadow_store()
    encounter = repo.read_resource("Encounter", encounter_id)
    if encounter is None:
        raise LookupError("\u627e\u4e0d\u5230\u9019\u6b21\u770b\u8a3a")
    reg = extract_reg_meta(encounter)
    ref = str((encounter.get("subject") or {}).get("reference") or "")
    patient_id = ref.split("/")[-1] if ref else ""
    patient = store.get_cached_resource("Patient", patient_id) if patient_id else None
    id_no = str(reg.get("hcIdNo") or "").strip().upper() or _id_no_from_patient(patient)
    if not id_no and patient_id:
        id_no = str(store.get_patient_id_no(patient_id) or "").strip().upper()
    return encounter, reg, id_no


def _save_reg(encounter_id: str, encounter: dict[str, Any], fields: dict[str, Any]) -> None:
    repo = get_fhir_repository()
    updated = attach_reg_extension(dict(encounter), fields)
    repo.update_resource("Encounter", encounter_id, updated)


def _doctor_id_no(doctor_id: str) -> str:
    if not doctor_id:
        return ""
    for row in get_shadow_store().get_staff_list():
        if str(row.get("id") or "") == doctor_id and row.get("nhiId"):
            return str(row["nhiId"]).strip().upper()
    return ""


@router.get("/slips")
def referral_slips(kind: str = "") -> dict[str, Any]:
    return {"items": list_slips(kind)}


@router.post("/slips")
def referral_save_slip(body: ReferralSlipBody) -> dict[str, Any]:
    try:
        item = save_slip(body.model_dump())
    except ValueError as exc:
        return {"ok": False, "reason": str(exc)}
    return {"ok": True, "item": item}


@router.post("/query")
def referral_query(body: ReferralQueryBody) -> dict[str, Any]:
    id_no = body.idNo.strip().upper()
    encounter = None
    if body.encounterId:
        try:
            encounter, _reg, stored = _load(body.encounterId)
        except LookupError as exc:
            return {"ok": False, "reason": str(exc), "serial": ""}
        id_no = id_no or stored
    result = query_referrals(id_no)
    chosen = result.get("chosen")
    serial = chosen.serial if chosen else ""
    if encounter is not None:
        _save_reg(
            body.encounterId,
            encounter,
            {
                "referralSeq": chosen.serial if chosen else "",
                "referralDate": chosen.open_date if chosen else "",
                "referralRetry": "0" if chosen or result.get("ok") else "1",
            },
        )
    return {
        "ok": bool(result.get("ok")),
        "reason": result.get("reason") or "",
        "serial": serial,
        "openDate": chosen.open_date if chosen else "",
        "retry": bool(result.get("retry")),
        "count": len(result.get("slips") or []),
    }


@router.post("/reply")
def referral_reply(body: ReferralReplyBody) -> dict[str, Any]:
    """Reply from a serial already on file. Does not read the patient's health card."""
    encounter = None
    reg: dict[str, Any] = {}
    id_no = (body.idNo or "").strip().upper()
    if (body.encounterId or "").strip():
        try:
            encounter, reg, stored = _load(body.encounterId)
        except LookupError as exc:
            return {"ok": False, "skipped": False, "uploaded": False, "reason": str(exc), "serial": ""}
        id_no = id_no or stored
    serial = (body.serial or "").strip() or str(reg.get("referralSeq") or "")
    if reg.get("referralLocalId") and not (body.serial or "").strip():
        return {
            "ok": True,
            "skipped": True,
            "uploaded": False,
            "reason": "",
            "serial": reg.get("referralSeq") or "",
        }
    if not serial:
        return {
            "ok": True,
            "skipped": True,
            "uploaded": False,
            "reason": (
                "\u8acb\u586b\u8f49\u8a3a\u55ae\u5e8f\u865f\u3002\u5e8f\u865f\u5f9e\u8f49\u8a3a\u5e73\u53f0\u4e0b\u8f09\uff0c"
                "\u4e0d\u5fc5\u518d\u63d2\u75c5\u60a3\u5065\u4fdd\u5361\u3002"
                if body.expectReferral
                else ""
            ),
            "serial": "",
        }
    if not id_no:
        return {
            "ok": False,
            "skipped": False,
            "uploaded": False,
            "reason": "\u7f3a\u8eab\u5206\u8b49\uff0c\u7121\u6cd5\u7d44\u56de\u8986\u3002",
            "serial": serial,
        }
    open_date = str(reg.get("referralDate") or "")
    doctor = _doctor_id_no(body.doctorId or str(reg.get("doctorId") or ""))
    if not doctor:
        return {
            "ok": False,
            "skipped": False,
            "uploaded": False,
            "reason": "\u627e\u4e0d\u5230\u91ab\u5e2b\u8eab\u5206\u8b49\uff0c\u56de\u5fa9\u6c92\u9001\u51fa",
            "serial": serial,
        }
    today = date.today().strftime("%Y%m%d")
    roc = f"{date.today().year - 1911:03d}{date.today().strftime('%m%d')}"
    xml_bytes = build_reply_xml(
        serial=serial,
        patient_id=id_no,
        doctor_id=doctor,
        reply_date=today,
        diagnosis=body.diagnosis.strip(),
        note=body.note.strip(),
    )
    stamp = datetime.now().strftime("%H%M%S")
    name = "ETB%s-%s%s.xml" % (DEFAULT_HOSPITAL_ID, roc, stamp[-3:])
    sent = upload_file(xml_bytes, type_code=REPLY_TYPE_CODE, name=name)
    if not sent.get("ok"):
        return {
            "ok": False,
            "skipped": False,
            "uploaded": False,
            "reason": sent.get("reason") or "\u4e0a\u50b3\u5931\u6557",
            "serial": serial,
            "code": sent.get("code"),
        }
    if encounter is not None and (body.encounterId or "").strip():
        _save_reg(
            body.encounterId,
            encounter,
            {
                "referralSeq": serial,
                "referralDate": open_date,
                "referralLocalId": sent.get("localId") or "0",
                "referralNhiId": sent.get("nhiId") or "",
            },
        )
    return {
        "ok": True,
        "skipped": False,
        "uploaded": True,
        "reason": "",
        "serial": serial,
        "localId": sent.get("localId") or "",
    }
