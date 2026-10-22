"""Card-in referral lookup. Saving a slip stays local; upload runs on the other PC."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from src.app.bootstrap import get_fhir_repository, get_shadow_store
from src.core.encounter_extensions import attach_reg_extension, extract_reg_meta
from src.core.nhi_fhir_mapper import TW_NATIONAL_ID_SYSTEM
from src.core.nhi_cshis6_client import DEFAULT_HOSPITAL_ID
from src.core.nhi_referral import query_referrals
from src.core.referral_desk import list_slips, mark_uploaded, physician_ids, save_slip

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
    openedOn: str = ""
    historyText: str | None = None
    treatText: str | None = None
    sex: str | None = None
    birth: str | None = None
    phone: str | None = None
    address: str | None = None
    contact: str | None = None
    allergyText: str | None = None
    destDept: str | None = None
    destDoctor: str | None = None
    destTel: str | None = None
    destAddr: str | None = None
    purposeNote: str | None = None
    examOn: str | None = None
    ourDept: str | None = None
    handoff: str | None = None
    drugs: str | None = None
    aux: str | None = None


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


class ReferralResultBody(BaseModel):
    id: str = ""
    localId: str = ""
    nhiId: str = ""
    status: str = ""


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


@router.get("/physicians")
def referral_physicians() -> dict[str, Any]:
    return {"items": physician_ids(list(get_shadow_store().get_staff_list()))}


@router.post("/result")
def referral_upload_result(body: ReferralResultBody) -> dict[str, Any]:
    """Store the bureau receipt. This does not call the upload dll."""
    slip = body.id.strip()
    if not slip:
        return {"ok": False, "reason": "\u6c92\u6709\u6307\u5b9a\u54ea\u4e00\u7b46"}
    mark_uploaded(
        slip,
        local_id=body.localId.strip(),
        nhi_id=body.nhiId.strip(),
        status=body.status.strip() or "\u5df2\u4e0a\u50b3",
    )
    return {"ok": True}


@router.post("/slips")
def referral_save_slip(body: ReferralSlipBody) -> dict[str, Any]:
    try:
        item = save_slip(body.model_dump(exclude_unset=True))
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
    """The clinic PC only stores the reply. Upload is the other computer's tool."""
    return {
        "ok": False,
        "skipped": False,
        "uploaded": False,
        "reason": "這台主程式只存轉診。上傳請到沒有讀卡軟體 6.0 的電腦，用轉診上傳工具。",
        "serial": (body.serial or "").strip(),
    }


@router.post("/open")
def referral_open(body: ReferralOpenBody) -> dict[str, Any]:
    """The clinic PC only stores the open slip. Upload is the other computer's tool."""
    return {
        "ok": False,
        "uploaded": False,
        "reason": "這台主程式只存轉診。上傳請到沒有讀卡軟體 6.0 的電腦，用轉診上傳工具。",
        "serial": "",
    }
