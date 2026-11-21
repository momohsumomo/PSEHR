# -*- coding: utf-8 -*-
"""Waiting-room intake and virtual-card read. Does not upload to NHI by itself."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.app.bootstrap import get_fhir_repository, get_shadow_store
from src.core.cc_complete import phrase_texts
from src.core.chart_presence import held_encounter_ids
from src.core.cc_learn import suggest_suffix, top_phrases
from src.core.encounter_extensions import (
    attach_previsit_extension,
    extract_reg_meta,
    previsit_completed,
)
from src.core.intake_form import (
    DAY_LABEL,
    CONCERN_LABEL,
    COURSE_LABEL,
    PRIOR_LABEL,
    SITE_LABEL,
    SYMPTOM_LABEL,
    compose_cosmetic_note,
    compose_kiosk_note,
)
from src.core.nhi_card_bridge import profile_to_patient_intake
from src.core.nhi_card_init_sop import map_hc_basic
from src.core.nhi_validators import NhiValidationError

router = APIRouter(prefix="/nhi/v1", tags=["Kiosk"])


class IntakeLookupBody(BaseModel):
    rocBirthday: str = Field(..., min_length=6, max_length=7)


class IntakeSubmitBody(BaseModel):
    encounterId: str = Field(..., min_length=1)
    sites: list[str] = Field(default_factory=list, max_length=24)
    visitKind: str = "medical"
    concerns: list[str] = Field(default_factory=list, max_length=4)
    prior: str = ""
    symptoms: list[str] = Field(default_factory=list, max_length=6)
    days: str = ""
    course: str = ""
    severity: str = ""
    seenOtherDoctor: bool = False
    replace: bool = False


class VirtualCardBody(BaseModel):
    token: str = ""
    basic: dict[str, Any] | None = None


def _roc_to_iso(text: str) -> str:
    digits = "".join(ch for ch in text if ch.isdigit())
    if len(digits) == 7:
        year, month, day = int(digits[:3]), digits[3:5], digits[5:7]
    elif len(digits) == 6:
        year, month, day = int(digits[:2]), digits[2:4], digits[4:6]
    else:
        return ""
    if not (1 <= int(month) <= 12 and 1 <= int(day) <= 31):
        return ""
    return f"{year + 1911:04d}-{month}-{day}"


def is_unarrived_appointment(encounter: dict[str, Any], queue_status: str) -> bool:
    reg = extract_reg_meta(encounter)
    booked = bool(reg.get("prebook")) or str(reg.get("forespeak") or "") == "\u9810"
    return booked and queue_status == "waiting"


def doctor_saved_encounters(conn: Any, encounter_ids: list[str]) -> set[str]:
    """Visits the doctor has already saved. Those are seen; the patient does not fill in again."""
    if not encounter_ids:
        return set()
    marks = ",".join("?" for _ in encounter_ids)
    rows = conn.execute(
        f"""
        SELECT encounter_id FROM clinical_note_index WHERE encounter_id IN ({marks})
        UNION
        SELECT encounter_id FROM condition_index
          WHERE encounter_id IN ({marks}) AND IFNULL(clinical_status, 'active') = 'active'
        UNION
        SELECT encounter_id FROM medication_request_index
          WHERE encounter_id IN ({marks}) AND IFNULL(status, 'active') = 'active'
        """,
        (*encounter_ids, *encounter_ids, *encounter_ids),
    ).fetchall()
    return {str(row[0]) for row in rows if row[0]}


def intake_access(encounter: dict[str, Any], queue_status: str, saved: bool, held: bool) -> str:
    if queue_status not in {"waiting", "in_progress"} or saved:
        return "seen"
    if is_unarrived_appointment(encounter, queue_status):
        return "appointment"
    if held:
        return "busy"
    return "open"


def _mask_name(name: str) -> str:
    chars = list((name or "").strip())
    if len(chars) <= 1:
        return "".join(chars)
    if len(chars) == 2:
        return f"{chars[0]} \u25cb"
    middle = " \u25cb " if len(chars) == 3 else (" " + ("\u25cb" * (len(chars) - 2)) + " ")
    return f"{chars[0]}{middle}{chars[-1]}"


@router.get("/cc/phrases")
def list_cc_phrases() -> dict[str, Any]:
    learned = top_phrases(get_shadow_store().db_path)
    return {"items": learned or phrase_texts()}


@router.get("/cc/suggest")
def cc_suggest(frag: str = "", prev: str = "") -> dict[str, str]:
    return {"suffix": suggest_suffix(get_shadow_store().db_path, frag, prev)}


@router.post("/kiosk/intake/lookup")
def intake_lookup(body: IntakeLookupBody) -> dict[str, Any]:
    iso = _roc_to_iso(body.rocBirthday)
    if not iso:
        raise HTTPException(status_code=422, detail="\u751f\u65e5\u683c\u5f0f\u4e0d\u5c0d")
    today = date.today().isoformat()
    store = get_shadow_store()
    cards: list[dict[str, Any]] = []
    with store._connect() as conn:
        rows = conn.execute(
            """
            SELECT ei.resource_id, pi.family_name, pi.given_name, pi.id_no, pi.birth_date, ei.queue_status, pi.sex
            FROM encounter_index ei
            LEFT JOIN patient_index pi ON pi.resource_id = ei.patient_id
            WHERE ei.encounter_date = ?
              AND IFNULL(ei.queue_status, '') IN ('waiting', 'in_progress', 'finished')
            """,
            (today,),
        ).fetchall()
        rows = [row for row in rows if str(row[4] or "")[:10] == iso]
        saved = doctor_saved_encounters(conn, [str(row[0]) for row in rows])
    held = held_encounter_ids([str(row[0]) for row in rows])
    for row in rows:
        encounter_id = str(row[0])
        resource = store.get_cached_resource("Encounter", encounter_id) or {}
        name = f"{row[1] or ''}{row[2] or ''}".strip()
        id_no = str(row[3] or "").strip().upper()
        tail = id_no[-4:] if len(id_no) >= 4 else ""
        sex_raw = str(row[6] or "").strip().upper()
        if sex_raw in {"F", "\u5973", "FEMALE"}:
            sex = "F"
        elif sex_raw in {"M", "\u7537", "MALE"}:
            sex = "M"
        else:
            sex = ""
        cards.append(
            {
                "encounterId": encounter_id,
                "maskedName": _mask_name(name),
                "idTail": tail,
                "filled": previsit_completed(resource),
                "sex": sex,
                "access": intake_access(
                    resource,
                    str(row[5] or ""),
                    encounter_id in saved,
                    encounter_id in held,
                ),
            }
        )
    return {"items": cards}


@router.post("/kiosk/intake/submit")
def intake_submit(body: IntakeSubmitBody) -> dict[str, Any]:
    store = get_shadow_store()
    encounter_id = body.encounterId.strip()
    encounter = store.get_cached_resource("Encounter", encounter_id)
    if not encounter:
        raise HTTPException(status_code=404, detail="\u627e\u4e0d\u5230\u9019\u7b46\u639b\u865f")
    with store._connect() as conn:
        row = conn.execute(
            "SELECT queue_status FROM encounter_index WHERE resource_id = ?",
            (encounter_id,),
        ).fetchone()
        saved = encounter_id in doctor_saved_encounters(conn, [encounter_id])
    access = intake_access(encounter, str((row[0] if row else "") or ""), saved, held=False)
    if access == "seen":
        raise HTTPException(status_code=409, detail="\u91ab\u5e2b\u5df2\u7d93\u770b\u904e\u4e86\uff0c\u4e0d\u7528\u518d\u586b")
    if access == "appointment":
        raise HTTPException(status_code=409, detail="\u9810\u7d04\u9084\u6c92\u5831\u5230\uff0c\u8acb\u5148\u5230\u6ac3\u6aaf\u5831\u5230")
    if previsit_completed(encounter) and not body.replace:
        raise HTTPException(status_code=409, detail="\u4eca\u5929\u5df2\u7d93\u586b\u904e")
    if body.visitKind == "cosmetic":
        known_sites = [item for item in body.sites if item in SITE_LABEL]
        known_concerns = [item for item in body.concerns if item in CONCERN_LABEL]
        course_ok = body.prior == "never" or body.course in COURSE_LABEL
        if not known_sites or not known_concerns or body.prior not in PRIOR_LABEL or not course_ok:
            raise HTTPException(status_code=422, detail="\u8cc7\u6599\u4e0d\u9f4a")
        text = compose_cosmetic_note(
            sites=known_sites,
            concerns=known_concerns,
            prior=body.prior,
            course=body.course,
        )
        tags = [*known_sites, *known_concerns][:20]
    else:
        known_sites = [item for item in body.sites if item in SITE_LABEL]
        known_symptoms = [item for item in body.symptoms if item in SYMPTOM_LABEL]
        if (
            not known_sites
            or not known_symptoms
            or body.days not in DAY_LABEL
            or body.severity not in {str(n) for n in range(1, 11)}
        ):
            raise HTTPException(status_code=422, detail="\u8cc7\u6599\u4e0d\u9f4a")
        text = compose_kiosk_note(
            sites=known_sites,
            symptoms=known_symptoms,
            days=body.days,
            severity=body.severity,
            seen_other_doctor=body.seenOtherDoctor,
        )
        tags = [*known_sites, *known_symptoms][:20]
    patched = attach_previsit_extension(
        encounter,
        chief_complaint=text,
        symptom_tags=tags,
        submitted_at=datetime.now().astimezone().isoformat(timespec="seconds"),
        visit_kind=body.visitKind if body.visitKind in {"cosmetic", "medical"} else "medical",
    )
    updated = get_fhir_repository().update_resource("Encounter", encounter_id, patched)
    return {"ok": True, "encounterId": updated.get("id") or encounter_id}


@router.post("/kiosk/virtual-card")
def virtual_card(body: VirtualCardBody) -> dict[str, Any]:
    from src.api.routers.nhi import _patient_validation, _save_nhi_patient
    from src.core.nhi_fhir_mapper import extract_nhi_stickers_from_patient

    profile = map_hc_basic(body.basic or {})
    if not profile:
        raise HTTPException(status_code=422, detail="NEED_DESK_SIGN")
    try:
        intake = profile_to_patient_intake(profile)
        resource, created = _save_nhi_patient(intake)
    except NhiValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    store = get_shadow_store()
    patient_id = str(resource["id"])
    face = _patient_validation(store, resource, intake)
    return {
        "created": created,
        "patientId": patient_id,
        "cardSource": "virtual",
        "consoleReachable": True,
        "validation": {**face, "cardId": profile.get("cardId") or ""},
        "nhiStickers": extract_nhi_stickers_from_patient(resource),
    }
