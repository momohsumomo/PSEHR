"""Card-in referral lookup. Saving a slip stays local; upload runs on the other PC."""

from __future__ import annotations

import base64
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from src.app.bootstrap import get_fhir_repository, get_shadow_store
from src.core.encounter_extensions import attach_reg_extension, extract_reg_meta
from src.core.nhi_fhir_mapper import TW_NATIONAL_ID_SYSTEM
from src.core.nhi_cshis6_client import DEFAULT_HOSPITAL_ID
from src.core.nhi_referral import (
    DELETE_TYPE_CODE,
    LIST_TYPE_CODE,
    OPEN_TYPE_CODE,
    REPLY_TYPE_CODE,
    build_delete_xml,
    build_list_request,
    build_open_xml,
    build_reply_xml,
    query_referrals,
    referral_list_name,
    referral_upload_name,
)
from src.core.referral_desk import (
    get_slip,
    list_slips,
    mark_uploaded,
    physician_ids,
    remember_self_seq,
    remove_slip,
    save_slip,
    slips_for_encounter,
)
from src.core.referral_guard import classify, uploaded
from src.core.referral_inbox import (
    apply_list_rows,
    list_downloads,
    mark_accepted,
    prompts_for,
    remember_download,
)

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


@router.get("/downloads")
def referral_downloads() -> dict[str, Any]:
    """Notices already read down from the bureau. This does not call the bureau."""
    return {"items": list_downloads()}


class ReferralAcceptedBody(BaseModel):
    serial: str = ""


@router.post("/accepted")
def referral_accepted(body: ReferralAcceptedBody) -> dict[str, Any]:
    serial = body.serial.strip()
    if not serial:
        return {"ok": False, "reason": "\u6c92\u6709\u8f49\u8a3a\u55ae\u5e8f\u865f"}
    mark_accepted(serial, "accept")
    return {"ok": True}


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
    if body.kind == "reply" and (item.get("serial") or "").strip():
        mark_accepted(str(item.get("serial") or ""), "reply")
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
    stored = list(result.get("slips") or [])
    if result.get("ok"):
        remember_download(id_no, stored)
    chosen_rows = prompts_for(id_no, stored) if result.get("ok") else []
    chosen_rows.sort(key=lambda row: row.open_date, reverse=True)
    chosen = chosen_rows[0] if chosen_rows else None
    serial = chosen.serial if chosen else ""
    slips = []
    for row in chosen_rows:
        slips.append(
            {
                "serial": row.serial,
                "hospId": row.hosp_id or row.hosp_seq,
                "openDate": row.open_date,
                "kind": row.kind,
                "summary": (row.summary or "")[:120],
            }
        )
    reason = str(result.get("reason") or "")
    if result.get("ok") and stored and not slips:
        reason = "\u8f49\u8a3a\u8cc7\u6599\u5df2\u4e0b\u8f09\u3002\u6c92\u6709\u5c1a\u672a\u63a5\u53d7\u7684\u8f49\u8a3a\u3002"
    return {
        "ok": bool(result.get("ok")),
        "reason": reason,
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
        "reason": "\u5b58\u6a94\u4e0d\u6703\u4e0a\u50b3\u3002\u8acb\u5230\u96fb\u5b50\u8f49\u8a3a\u9801\u6309\u4e0a\u50b3\u3002",
        "serial": (body.serial or "").strip(),
    }


@router.post("/open")
def referral_open(body: ReferralOpenBody) -> dict[str, Any]:
    """Saving stays local. The referral page sends the file."""
    return {
        "ok": False,
        "uploaded": False,
        "reason": "\u5b58\u6a94\u4e0d\u6703\u4e0a\u50b3\u3002\u8acb\u5230\u96fb\u5b50\u8f49\u8a3a\u9801\u6309\u4e0a\u50b3\u3002",
        "serial": "",
    }


class ReferralJobBody(BaseModel):
    id: str = ""
    encounterId: str = ""
    sent: bool = False
    localId: str = ""
    nhiId: str = ""


class ReferralPullSentBody(BaseModel):
    kind: str = ""
    name: str = ""
    localId: str = ""
    nhiId: str = ""


class ReferralPullApplyBody(BaseModel):
    localId: str = ""
    kind: str = ""
    rows: list[dict[str, Any]] = []


_PULL_KEY = "referral_pull"


def _file_seq() -> str:
    store = get_shadow_store()
    day = date.today().isoformat()
    bag = store.get_json_setting("referral_file_seq") or {}
    if not isinstance(bag, dict) or bag.get("day") != day:
        bag = {"day": day, "n": 0}
    bag["n"] = int(bag.get("n") or 0) + 1
    if bag["n"] > 999:
        bag["n"] = 1
    store.set_json_setting("referral_file_seq", bag)
    return "%03d" % bag["n"]


def _hosp() -> str:
    return str(_clinic_profile().get("clinicCode") or "").strip()


def _doctor_for(slip: dict[str, Any]) -> str:
    found = _doctor_id_by_name(str(slip.get("doctor") or ""))
    if _looks_like_person_id(found):
        return found
    fallback = _profile_default_doctor()
    return fallback if _looks_like_person_id(fallback) else ""


def _self_seq(hosp: str) -> str:
    return "%s%s%s" % (hosp, datetime.now().strftime("%Y%m%d"), _file_seq().zfill(5)[-5:])


def _b64(payload: bytes) -> str:
    return base64.b64encode(payload).decode("ascii")


def _when(text: str) -> datetime | None:
    raw = (text or "").strip()
    if len(raw) < 19:
        return None
    try:
        return datetime.strptime(raw[:19], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def _pack_upload(slip: dict[str, Any]) -> dict[str, Any]:
    if uploaded(slip):
        return {"ok": False, "reason": "\u9019\u4e00\u7b46\u5df2\u7d93\u4e0a\u50b3\u904e\u3002"}
    profile = _clinic_profile()
    hosp = _hosp()
    doctor = _doctor_for(slip)
    missing: list[str] = []
    if len(hosp) != 10:
        missing.append("\u9662\u6240\u4ee3\u78bc")
    if not doctor:
        missing.append("\u91ab\u5e2b\u8eab\u5206\u8b49")
    if not str(slip.get("idNo") or "").strip():
        missing.append("\u8eab\u5206\u8b49")
    kind = str(slip.get("kind") or "")
    if kind == "reply":
        if not str(slip.get("serial") or "").strip():
            missing.append("\u8f49\u8a3a\u55ae\u5e8f\u865f")
        if not str(profile.get("phone") or "").strip():
            missing.append("\u9662\u6240\u96fb\u8a71")
    else:
        if not str(slip.get("patientName") or "").strip():
            missing.append("\u59d3\u540d")
        if not str(slip.get("phone") or "").strip():
            missing.append("\u96fb\u8a71")
        if not str(slip.get("note") or "").strip():
            missing.append("\u75c5\u60c5\u6458\u8981")
        if not str(slip.get("diagnosis") or "").strip():
            missing.append("\u4e3b\u8a3a\u65b7")
        if not str(slip.get("destCode") or "").strip():
            missing.append("\u8f49\u5165\u9662\u6240\u4ee3\u78bc")
    if missing:
        return {"ok": False, "reason": "\u9084\u7f3a\uff1a" + "\u3001".join(missing) + "\u3002\u6c92\u6709\u9001\u51fa\u3002"}
    seq = _file_seq()
    if kind == "reply":
        xml = build_reply_xml(
            serial=str(slip.get("serial") or ""),
            patient_id=str(slip.get("idNo") or ""),
            doctor_id=doctor,
            reply_date=str(slip.get("openedOn") or ""),
            diagnosis=str(slip.get("diagnosis") or ""),
            purpose=str(slip.get("purpose") or "4"),
            dept=str(slip.get("dept") or slip.get("ourDept") or "11"),
            tel=str(profile.get("phone") or ""),
            email=str(profile.get("email") or ""),
            drugs=str(slip.get("drugs") or ""),
            aux=str(slip.get("aux") or ""),
            note=str(slip.get("note") or ""),
            hosp=hosp,
        )
        name = referral_upload_name("ETB", hosp, seq)
        type_code = REPLY_TYPE_CODE
    else:
        self_seq = str(slip.get("selfSeq") or "").strip() or _self_seq(hosp)
        remember_self_seq(str(slip.get("id") or ""), self_seq)
        xml = build_open_xml(
            patient_id=str(slip.get("idNo") or ""),
            patient_name=str(slip.get("patientName") or ""),
            phone=str(slip.get("phone") or ""),
            summary=str(slip.get("note") or ""),
            diagnosis=str(slip.get("diagnosis") or ""),
            purpose=str(slip.get("purpose") or "4"),
            doctor_id=doctor,
            doctor_phone=str(slip.get("clinicTel") or profile.get("phone") or ""),
            opened_on=str(slip.get("openedOn") or ""),
            dest_code=str(slip.get("destCode") or ""),
            dest_dept=str(slip.get("destDept") or "11"),
            valid_until=str(slip.get("validUntil") or ""),
            hosp=hosp,
            address=str(profile.get("address") or ""),
            sex=str(slip.get("sex") or ""),
            birth=str(slip.get("birth") or ""),
            contact=str(slip.get("contact") or ""),
            patient_address=str(slip.get("address") or ""),
            exam=str(slip.get("historyText") or ""),
            allergy=str(slip.get("allergyText") or ""),
            treat=str(slip.get("treatText") or ""),
            purpose_note=str(slip.get("purposeNote") or ""),
            dest_doctor=str(slip.get("destDoctor") or ""),
            dest_address=str(slip.get("destAddr") or ""),
            dest_phone=str(slip.get("destTel") or ""),
            handoff=str(slip.get("handoff") or ""),
            our_dept=str(slip.get("ourDept") or slip.get("dept") or "11"),
            fax=str(slip.get("fax") or ""),
            email=str(profile.get("email") or ""),
            self_seq=self_seq,
        )
        name = referral_upload_name("ETA", hosp, seq)
        type_code = OPEN_TYPE_CODE
    return {"ok": True, "id": slip.get("id") or "", "name": name, "type": type_code, "b64": _b64(xml), "reason": ""}


def _pack_delete(slip: dict[str, Any]) -> dict[str, Any]:
    verdict = classify(slip)
    action = verdict["action"]
    if action == "draft":
        return {"ok": True, "localOnly": True, "id": slip.get("id") or "", "reason": ""}
    if action == "keep":
        return {"ok": False, "reason": verdict["reason"]}
    serial = str(slip.get("serial") or "")
    self_seq = str(slip.get("selfSeq") or "")
    bureau = serial if len(serial) == 16 and serial.isdigit() else ""
    if not bureau and not self_seq:
        return {"ok": False, "reason": "\u6c92\u6709\u8f49\u8a3a\u55ae\u5e8f\u865f\uff0c\u4e0d\u80fd\u9001\u51fa\u522a\u9664\u3002"}
    doctor = _doctor_for(slip)
    hosp = _hosp()
    if not doctor or len(hosp) != 10:
        return {"ok": False, "reason": "\u6c92\u6709\u91ab\u5e2b\u8eab\u5206\u8b49\u6216\u9662\u6240\u4ee3\u78bc\uff0c\u4e0d\u80fd\u9001\u51fa\u522a\u9664\u3002"}
    xml = build_delete_xml(
        kind="reply" if action == "delete-reply" else "out",
        hosp=hosp,
        serial=bureau,
        self_seq=self_seq,
        doctor_id=doctor,
        reason="\u7576\u65e5\u9000\u639b",
    )
    prefix = "ETH" if action == "delete-reply" else "ETG"
    return {
        "ok": True,
        "localOnly": False,
        "id": slip.get("id") or "",
        "name": referral_upload_name(prefix, hosp, _file_seq()),
        "type": DELETE_TYPE_CODE,
        "b64": _b64(xml),
        "reason": "",
    }


@router.post("/pack")
def referral_pack(body: ReferralJobBody) -> dict[str, Any]:
    slip = get_slip(body.id)
    if slip is None:
        return {"ok": False, "reason": "\u627e\u4e0d\u5230\u9019\u4e00\u7b46\u3002"}
    return _pack_upload(slip)


@router.post("/delete-pack")
def referral_delete_pack(body: ReferralJobBody) -> dict[str, Any]:
    slip = get_slip(body.id)
    if slip is None:
        return {"ok": False, "reason": "\u627e\u4e0d\u5230\u9019\u4e00\u7b46\u3002"}
    return _pack_delete(slip)


@router.post("/hold")
def referral_hold(body: ReferralJobBody) -> dict[str, Any]:
    """Tell the desk which uploaded rows must be withdrawn before a registration goes."""
    jobs: list[dict[str, Any]] = []
    for slip in slips_for_encounter(body.encounterId):
        verdict = classify(slip)
        if verdict["action"] == "keep":
            return {"ok": False, "reason": verdict["reason"], "jobs": []}
        if verdict["action"] in {"delete-open", "delete-reply"}:
            packed = _pack_delete(slip)
            if not packed.get("ok") or packed.get("localOnly"):
                return {"ok": False, "reason": str(packed.get("reason") or "\u4e0d\u80fd\u522a\u9664"), "jobs": []}
            jobs.append(packed)
    return {"ok": True, "reason": "", "jobs": jobs}


@router.post("/drop")
def referral_drop(body: ReferralJobBody) -> dict[str, Any]:
    slip = get_slip(body.id)
    if slip is None:
        return {"ok": True, "reason": ""}
    verdict = classify(slip)
    if verdict["action"] == "keep":
        return {"ok": False, "reason": verdict["reason"]}
    if verdict["action"] != "draft" and (not body.sent or len((body.localId or "").strip()) < 4):
        return {"ok": False, "reason": "\u522a\u9664\u6a94\u6c92\u6709\u9001\u51fa\uff0c\u7d00\u9304\u7559\u8457\u3002"}
    remove_slip(body.id)
    return {"ok": True, "reason": ""}


@router.post("/pull")
def referral_pull() -> dict[str, Any]:
    store = get_shadow_store()
    bag = store.get_json_setting(_PULL_KEY) or {}
    jobs = bag.get("jobs") if isinstance(bag, dict) else []
    if not isinstance(jobs, list):
        jobs = []
    now = datetime.now()
    ready = []
    waiting = False
    for job in jobs:
        if not isinstance(job, dict):
            continue
        sent = _when(str(job.get("sentAt") or ""))
        if sent is not None and now - sent >= timedelta(minutes=10):
            ready.append(job)
        elif sent is not None:
            waiting = True
    if ready:
        return {"ok": True, "step": "fetch", "jobs": ready, "reason": ""}
    if waiting:
        return {"ok": True, "step": "wait", "jobs": [], "reason": "\u4e0b\u8f09\u9084\u5728\u8655\u7406\uff0c\u8acb\u7a0d\u5f8c\u518d\u6309\u4e00\u6b21\u3002"}
    hosp = _hosp()
    if len(hosp) != 10:
        return {"ok": False, "step": "", "reason": "\u6c92\u6709\u9662\u6240\u4ee3\u78bc\u3002"}
    end = date.today()
    start = end - timedelta(days=1)
    payload = build_list_request(start.strftime("%Y%m%d"), end.strftime("%Y%m%d"))
    files = []
    for kind in ("1", "2"):
        files.append(
            {
                "kind": kind,
                "name": referral_list_name(hosp, kind, _file_seq()),
                "type": LIST_TYPE_CODE,
                "b64": _b64(payload),
            }
        )
    return {"ok": True, "step": "send", "files": files, "reason": ""}


@router.post("/pull-sent")
def referral_pull_sent(body: ReferralPullSentBody) -> dict[str, Any]:
    if len((body.localId or "").strip()) < 4 or len((body.nhiId or "").strip()) < 4:
        return {"ok": False, "reason": "\u4e0b\u8f09\u8981\u6c42\u6c92\u6709\u88ab\u6536\u4e0b\u3002"}
    store = get_shadow_store()
    bag = store.get_json_setting(_PULL_KEY) or {}
    jobs = list(bag.get("jobs") or []) if isinstance(bag, dict) else []
    jobs.append(
        {
            "kind": body.kind,
            "name": body.name,
            "localId": body.localId.strip(),
            "nhiId": body.nhiId.strip(),
            "sentAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
    )
    store.set_json_setting(_PULL_KEY, {"jobs": jobs})
    return {"ok": True, "reason": ""}


@router.post("/pull-apply")
def referral_pull_apply(body: ReferralPullApplyBody) -> dict[str, Any]:
    count = apply_list_rows(body.rows, body.kind or "1")
    store = get_shadow_store()
    bag = store.get_json_setting(_PULL_KEY) or {}
    jobs = bag.get("jobs") if isinstance(bag, dict) else []
    if not isinstance(jobs, list):
        jobs = []
    token = (body.localId or "").strip()
    kept = [job for job in jobs if not (isinstance(job, dict) and str(job.get("localId") or "") == token)]
    store.set_json_setting(_PULL_KEY, {"jobs": kept})
    return {"ok": True, "count": count, "reason": ""}
