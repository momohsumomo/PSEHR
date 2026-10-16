# -*- coding: utf-8 -*-
"""Waiting-room intake and virtual-card read. Does not upload to NHI by itself."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.app.bootstrap import get_fhir_repository, get_shadow_store
from src.core.cc_complete import compose_intake, phrase_texts
from src.core.encounter_extensions import attach_previsit_extension, previsit_completed
from src.core.nhi_card_bridge import profile_to_patient_intake, read_virtual_card_profile
from src.core.nhi_validators import NhiValidationError

router = APIRouter(prefix="/nhi/v1", tags=["Kiosk"])


class IntakeLookupBody(BaseModel):
    rocBirthday: str = Field(..., min_length=6, max_length=7)


class IntakeSubmitBody(BaseModel):
    encounterId: str = Field(..., min_length=1)
    location: str
    symptoms: list[str] = Field(default_factory=list, max_length=2)
    duration: str
    priorTopical: bool


class VirtualCardBody(BaseModel):
    token: str = Field(..., min_length=8)


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
    return {"items": phrase_texts()}


@router.post("/kiosk/intake/lookup")
def intake_lookup(body: IntakeLookupBody) -> dict[str, Any]:
    iso = _roc_to_iso(body.rocBirthday)
    if not iso:
        raise HTTPException(status_code=422, detail="\u751f\u65e5\u683c\u5f0f\u4e0d\u5c0d")
    today = date.today().isoformat()
    store = get_shadow_store()
    cards: list[dict[str, str]] = []
    with store._connect() as conn:
        rows = conn.execute(
            """
            SELECT ei.resource_id, pi.family_name, pi.given_name, pi.id_no, pi.birth_date, ei.queue_status
            FROM encounter_index ei
            LEFT JOIN patient_index pi ON pi.resource_id = ei.patient_id
            WHERE ei.encounter_date = ?
              AND IFNULL(ei.queue_status, '') IN ('waiting', 'in_progress')
            """,
            (today,),
        ).fetchall()
    for row in rows:
        birth = str(row[4] or "")[:10]
        if birth != iso:
            continue
        encounter_id = str(row[0])
        resource = store.get_cached_resource("Encounter", encounter_id) or {}
        if previsit_completed(resource):
            continue
        name = f"{row[1] or ''}{row[2] or ''}".strip()
        id_no = str(row[3] or "").strip().upper()
        tail = id_no[-4:] if len(id_no) >= 4 else ""
        cards.append(
            {
                "encounterId": encounter_id,
                "maskedName": _mask_name(name),
                "idTail": tail,
            }
        )
    return {"items": cards}


@router.post("/kiosk/intake/submit")
def intake_submit(body: IntakeSubmitBody) -> dict[str, Any]:
    store = get_shadow_store()
    encounter = store.get_cached_resource("Encounter", body.encounterId.strip())
    if not encounter:
        raise HTTPException(status_code=404, detail="\u627e\u4e0d\u5230\u9019\u7b46\u639b\u865f")
    if previsit_completed(encounter):
        raise HTTPException(status_code=409, detail="\u4eca\u5929\u5df2\u7d93\u586b\u904e")
    symptoms = [s for s in body.symptoms if s][:2]
    text = compose_intake(body.location, symptoms, body.duration, body.priorTopical)
    patched = attach_previsit_extension(
        encounter,
        chief_complaint=text,
        symptom_tags=symptoms,
        submitted_at=datetime.now().astimezone().isoformat(timespec="seconds"),
    )
    updated = get_fhir_repository().update_resource("Encounter", body.encounterId.strip(), patched)
    return {"ok": True, "encounterId": updated.get("id") or body.encounterId}


@router.post("/kiosk/virtual-card")
def virtual_card(body: VirtualCardBody) -> dict[str, Any]:
    from src.api.routers.nhi import _patient_validation, _save_nhi_patient
    from src.core.nhi_fhir_mapper import extract_nhi_stickers_from_patient

    card = read_virtual_card_profile(body.token)
    if not card.profile:
        raise HTTPException(status_code=422, detail=card.consoleError or "\u865b\u64ec\u5065\u4fdd\u5361\u8b80\u4e0d\u5230")
    try:
        intake = profile_to_patient_intake(card.profile)
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
        "validation": {**face, "cardId": card.profile.get("cardId") or ""},
        "nhiStickers": extract_nhi_stickers_from_patient(resource),
    }
