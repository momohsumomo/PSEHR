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
    OPEN_TYPE_CODE,
    REPLY_TYPE_CODE,
    build_open_xml,
    _icd_code,
    build_reply_xml,
    query_referrals,
    upload_file,
    _ymd,
)
from src.core.referral_desk import list_slips, mark_uploaded, save_slip

router = APIRouter(prefix="/nhi/v1/referral", tags=["NHI-referral"])


class ReferralQueryBody(BaseModel):
    idNo: str = ""
    encounterId: str = ""
    deskSign: dict[str, Any] | None = None


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
    doctorName: str = ""
    diagnosis: str = ""
    note: str = ""
    drugs: str = ""
    aux: str = ""
    purpose: str = "4"
    dept: str = "11"
    expectReferral: bool = False
    replyDate: str = ""
    slipId: str = ""


class ReferralOpenBody(BaseModel):
    encounterId: str = ""
    idNo: str = ""
    patientName: str = ""
    phone: str = ""
    address: str = ""
    sex: str = ""
    birth: str = ""
    contact: str = ""
    diagnosis: str = ""
    summary: str = ""
    purpose: str = "4"
    purposeNote: str = ""
    doctorId: str = ""
    doctorName: str = ""
    destCode: str = ""
    destDept: str = "11"
    destDoctor: str = ""
    destAddress: str = ""
    destPhone: str = ""
    openedOn: str = ""
    validUntil: str = ""
    allergy: str = ""
    treat: str = ""
    exam: str = ""
    handoff: str = ""
    ourDept: str = "11"
    slipId: str = ""


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


def _looks_like_person_id(value: str) -> bool:
    text = (value or "").strip().upper()
    return len(text) == 10 and text[0].isalpha() and text[1:].isdigit()


def _doctor_id_no(doctor_id: str) -> str:
    """Personnel national id lives in nhi_id. Visits store the staff code, not that id."""
    key = (doctor_id or "").strip()
    rows = list(get_shadow_store().get_staff_list())

    def person_id(row: dict[str, Any]) -> str:
        text = str(row.get("nhiId") or "").strip().upper()
        return text if _looks_like_person_id(text) else ""

    if key:
        for row in rows:
            if str(row.get("id") or "") == key:
                found = person_id(row)
                if found:
                    return found
        folded = key.upper()
        for row in rows:
            if str(row.get("nhiId") or "").strip().upper() == folded:
                found = person_id(row)
                if found:
                    return found
        if _looks_like_person_id(key):
            return key.upper()
    return ""


def _doctor_id_by_name(name: str) -> str:
    needle = (name or "").strip()
    if not needle:
        return ""
    for row in get_shadow_store().get_staff_list():
        if str(row.get("name") or "").strip() == needle:
            return _doctor_id_no(str(row.get("id") or ""))
    return ""


def _clinic_profile() -> dict[str, Any]:
    from src.api.routers.clinic_settings import DEFAULT_PROFILE, PROFILE_KEY

    saved = get_shadow_store().get_json_setting(PROFILE_KEY) or {}
    stored = {}
    if isinstance(saved, dict) and isinstance(saved.get("profile"), dict):
        stored = saved["profile"]
    base = dict(DEFAULT_PROFILE.get("profile") or {})
    for key, value in stored.items():
        if value not in (None, ""):
            base[key] = value
    return base


def _profile_default_doctor() -> str:
    """Clinic default physician, else the director who already has a personnel id."""
    profile = _clinic_profile()
    found = _doctor_id_no(str(profile.get("defaultDoctorId") or ""))
    if found:
        return found
    usable = []
    for row in get_shadow_store().get_staff_list():
        status = str(row.get("status") or "").strip()
        if status and status not in ("\u5728\u8077", "active"):
            continue
        if _doctor_id_no(str(row.get("id") or "")):
            usable.append(row)
    for row in usable:
        if "\u9662\u9577" in str(row.get("role") or ""):
            return _doctor_id_no(str(row.get("id") or ""))
    if len(usable) == 1:
        return _doctor_id_no(str(usable[0].get("id") or ""))
    return ""


def _reply_doctor(body: ReferralReplyBody, reg: dict[str, Any]) -> str:
    return (
        _doctor_id_no(body.doctorId)
        or _doctor_id_no(str(reg.get("doctorId") or ""))
        or _doctor_id_no(_claim_doctor_id(body.encounterId))
        or _doctor_id_by_name(body.doctorName)
        or _doctor_id_by_name(str(reg.get("doctorName") or ""))
        or _profile_default_doctor()
    )


def _claim_doctor_id(encounter_id: str) -> str:
    if not encounter_id:
        return ""
    with get_shadow_store()._connect() as conn:
        row = conn.execute(
            "SELECT claim_doctor_id FROM encounter_index WHERE resource_id = ?",
            (encounter_id,),
        ).fetchone()
    return str(row[0] or "").strip() if row else ""


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
    if body.encounterId:
        try:
            _encounter, _reg, stored = _load(body.encounterId)
        except LookupError as exc:
            return {"ok": False, "reason": str(exc), "serial": ""}
        id_no = id_no or stored
    result = query_referrals(id_no, desk_sign=body.deskSign)
    chosen = result.get("chosen")
    serial = chosen.serial if chosen else ""
    slips = []
    for row in result.get("slips") or []:
        if getattr(row, "deleted", False) or not getattr(row, "serial", ""):
            continue
        slips.append(
            {
                "serial": row.serial,
                "hospId": row.hosp_seq,
                "openDate": row.open_date,
                "kind": row.kind,
                "summary": (row.summary or "")[:120],
            }
        )
    return {
        "ok": bool(result.get("ok")),
        "reason": result.get("reason") or "",
        "serial": serial,
        "openDate": chosen.open_date if chosen else "",
        "retry": bool(result.get("retry")),
        "count": len(slips),
        "slips": slips,
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
    doctor = _reply_doctor(body, reg)
    if not doctor:
        return {
            "ok": False,
            "skipped": False,
            "uploaded": False,
            "reason": "\u627e\u4e0d\u5230\u91ab\u5e2b\u8eab\u5206\u8b49\uff0c\u56de\u5fa9\u6c92\u9001\u51fa",
            "serial": serial,
        }
    reply_day = _ymd(body.replyDate) if (body.replyDate or "").strip() else date.today().strftime("%Y%m%d")
    roc = f"{date.today().year - 1911:03d}{date.today().strftime('%m%d')}"
    profile = _clinic_profile()
    hosp = str(profile.get("clinicCode") or DEFAULT_HOSPITAL_ID)
    tel = str(profile.get("phone") or "").strip()
    if not tel:
        return {
            "ok": False,
            "skipped": False,
            "uploaded": False,
            "reason": "\u56de\u5fa9\u6a94\u7f3a\u9662\u6240\u96fb\u8a71\u3002\u6c92\u6709\u9001\u51fa\u3002",
            "serial": serial,
        }
    if not _icd_code(body.diagnosis):
        return {
            "ok": False,
            "skipped": False,
            "uploaded": False,
            "reason": "\u56de\u5fa9\u6a94\u7f3a\u4e3b\u8a3a\u65b7\u4ee3\u78bc\u3002\u8acb\u586b ICD-10\uff0c\u4e0d\u542b\u5c0f\u6578\u9ede\u3002\u6c92\u6709\u9001\u51fa\u3002",
            "serial": serial,
        }
    xml_bytes = build_reply_xml(
        serial=serial,
        patient_id=id_no,
        doctor_id=doctor,
        reply_date=reply_day,
        diagnosis=body.diagnosis.strip(),
        purpose=body.purpose or "4",
        dept=(body.dept or "11")[:2],
        tel=tel,
        email=str(profile.get("email") or ""),
        drugs=body.drugs.strip(),
        aux=body.aux.strip(),
        note=body.note.strip(),
        hosp=hosp,
    )
    stamp = datetime.now().strftime("%H%M%S")
    name = "ETB%s-%s%s.xml" % (hosp, roc, stamp[-3:])
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
    mark_uploaded(
        body.slipId,
        local_id=str(sent.get("localId") or ""),
        nhi_id=str(sent.get("nhiId") or ""),
        status="\u5df2\u56de\u8986",
    )
    return {
        "ok": True,
        "skipped": False,
        "uploaded": True,
        "reason": "",
        "serial": serial,
        "localId": sent.get("localId") or "",
        "nhiId": sent.get("nhiId") or "",
    }


@router.post("/open")
def referral_open(body: ReferralOpenBody) -> dict[str, Any]:
    """Save is the caller's job. This hands one open slip to NHI_DownloadB, type 10."""
    profile = _clinic_profile()
    hosp = str(profile.get("clinicCode") or DEFAULT_HOSPITAL_ID)
    id_no = (body.idNo or "").strip().upper()
    if body.encounterId and not id_no:
        try:
            _encounter, _reg, stored = _load(body.encounterId)
        except LookupError as exc:
            return {"ok": False, "uploaded": False, "reason": str(exc), "serial": ""}
        id_no = stored
    doctor = _doctor_id_no(
        body.doctorId or _claim_doctor_id(body.encounterId) or _doctor_id_by_name(body.doctorName)
    )
    missing = []
    if not id_no:
        missing.append("\u8eab\u5206\u8b49")
    if not (body.patientName or "").strip():
        missing.append("\u59d3\u540d")
    if not (body.phone or "").strip():
        missing.append("\u96fb\u8a71")
    if not (body.summary or "").strip():
        missing.append("\u75c5\u60c5\u6458\u8981")
    if not (body.diagnosis or "").strip():
        missing.append("\u4e3b\u8a3a\u65b7")
    if not doctor:
        missing.append("\u91ab\u5e2b\u8eab\u5206\u8b49")
    if not (body.destCode or "").strip():
        missing.append("\u8f49\u5165\u9662\u6240\u4ee3\u78bc")
    if missing:
        return {
            "ok": False,
            "uploaded": False,
            "reason": "\u8f49\u51fa\u4e0a\u50b3\u9084\u7f3a\uff1a" + "\u3001".join(missing),
            "serial": "",
        }
    roc = "%03d%s" % (date.today().year - 1911, date.today().strftime("%m%d"))
    dept = (body.destDept or "11").strip()[:2]
    our = (body.ourDept or "11").strip()[:2]
    xml_bytes = build_open_xml(
        patient_id=id_no,
        patient_name=body.patientName.strip(),
        phone=body.phone.strip(),
        summary=body.summary.strip(),
        diagnosis=body.diagnosis.strip(),
        purpose=body.purpose or "4",
        doctor_id=doctor,
        doctor_phone=str(profile.get("phone") or ""),
        opened_on=body.openedOn,
        dest_code=body.destCode.strip(),
        dest_dept=dept,
        valid_until=body.validUntil,
        hosp=hosp,
        address=str(profile.get("address") or ""),
        sex=body.sex,
        birth=body.birth,
        contact=body.contact,
        patient_address=body.address,
        exam=body.exam,
        allergy=body.allergy,
        treat=body.treat,
        purpose_note=body.purposeNote,
        dest_doctor=body.destDoctor,
        dest_address=body.destAddress,
        dest_phone=body.destPhone,
        handoff=body.handoff,
        our_dept=our,
        fax="",
        email=str(profile.get("email") or ""),
    )
    stamp = datetime.now().strftime("%H%M%S")
    name = "ETA%s-%s%s.xml" % (hosp, roc, stamp[-3:])
    sent = upload_file(xml_bytes, type_code=OPEN_TYPE_CODE, name=name)
    if sent.get("ok"):
        mark_uploaded(
            body.slipId,
            local_id=str(sent.get("localId") or ""),
            nhi_id=str(sent.get("nhiId") or ""),
            status="\u5df2\u4e0a\u50b3",
        )
    return {
        "ok": bool(sent.get("ok")),
        "uploaded": bool(sent.get("ok")),
        "reason": "" if sent.get("ok") else (sent.get("reason") or "\u4e0a\u50b3\u5931\u6557"),
        "serial": sent.get("nhiId") or sent.get("localId") or "",
        "localId": sent.get("localId") or "",
        "nhiId": sent.get("nhiId") or "",
        "code": sent.get("code"),
    }
