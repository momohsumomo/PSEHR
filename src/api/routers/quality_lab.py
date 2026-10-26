# -*- coding: utf-8 -*-
"""Queue a lab-result zip for the viewing PC. That PC calls the cloud DLL."""

from __future__ import annotations

import base64
import json
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from src.app.bootstrap import get_shadow_store
from src.core.desk_channel import enqueue, fresh_report, viewer_ip
from src.core.encounter_extensions import extract_reg_meta
from src.core.quality_lab import (
    QUALITY_ORDERS,
    QualityLabDraft,
    QualityLabError,
    alloc_serial,
    build_lab_xml,
    pack_zip,
    roc_now,
    zip_name,
)

router = APIRouter(prefix="/nhi/v1/quality-lab", tags=["quality-lab"])

_NO_AGENT = "\u9019\u53f0\u7684\u5de5\u4f5c\u7ad9\u5de5\u5177\u9084\u6c92\u6709\u5728\u56de\u5831\u3002\u8acb\u5148\u5728\u9019\u53f0\u958b\u555f\u9580\u8a3a\u3002"


class QualityLabBody(BaseModel):
    encounterId: str
    orderCode: str
    orderName: str = ""
    result: str = ""
    unit: str = ""
    refLow: str = ""
    refHigh: str = ""
    method: str = ""
    specimen: str = ""
    narrative: str = ""


def _ip(request: Request) -> str:
    peer = request.client.host if request.client else ""
    return viewer_ip(peer, request.headers.get("x-forwarded-for") or "")


def _clinic_code() -> str:
    from src.api.routers.clinic_settings import DEFAULT_PROFILE, PROFILE_KEY, _deep_merge

    saved = get_shadow_store().get_json_setting(PROFILE_KEY) or {}
    if not isinstance(saved, dict):
        saved = {}
    merged = _deep_merge(DEFAULT_PROFILE, saved)
    return str((merged.get("profile") or {}).get("clinicCode") or "")


def _visit(encounter_id: str) -> dict[str, Any]:
    store = get_shadow_store()
    eid = encounter_id.split("/")[-1].strip()
    if not eid:
        raise QualityLabError("\u6c92\u6709\u6307\u5b9a\u770b\u8a3a\u3002")
    with store._connect() as conn:
        enc_row = conn.execute(
            "SELECT payload_json FROM resource_cache WHERE resource_type=? AND resource_id=?",
            ("Encounter", eid),
        ).fetchone()
        who = conn.execute(
            "SELECT patient_id FROM encounter_index WHERE resource_id=?",
            (eid,),
        ).fetchone()
        patient_id = str(who[0] or "").split("/")[-1] if who else ""
        person = None
        if patient_id:
            person = conn.execute(
                "SELECT id_no, birthday_roc, birth_date FROM patient_index WHERE resource_id=?",
                (patient_id,),
            ).fetchone()
    if not enc_row or not enc_row[0]:
        raise QualityLabError("\u627e\u4e0d\u5230\u9019\u7b46\u770b\u8a3a\u3002")
    payload = enc_row[0]
    enc = json.loads(payload) if isinstance(payload, str) else payload
    reg = extract_reg_meta(enc if isinstance(enc, dict) else {})
    id_no = ""
    birthday = ""
    if person:
        id_no = str(person[0] or "")
        birthday = str(person[1] or person[2] or "")
    return {"reg": reg, "idNo": id_no, "birthday": birthday}


@router.get("/orders")
def list_orders() -> dict[str, Any]:
    return {
        "orders": [{"code": code, "category": category} for code, category in sorted(QUALITY_ORDERS.items())],
    }


@router.post("/upload")
def upload(body: QualityLabBody, request: Request) -> dict[str, Any]:
    ip = _ip(request)
    if fresh_report(ip) is None:
        raise HTTPException(status_code=400, detail=_NO_AGENT)
    visit = {}
    try:
        visit = _visit(body.encounterId)
        reg = visit["reg"]
        now = roc_now(datetime.now())
        makeup = str(reg.get("afterCheck") or "") == "2" or str(reg.get("icRemark") or "") == "2"
        xml_bytes = build_lab_xml(
            QualityLabDraft(
                order_code=body.orderCode,
                order_name=body.orderName,
                result=body.result,
                unit=body.unit,
                ref_low=body.refLow,
                ref_high=body.refHigh,
                method=body.method,
                specimen=body.specimen,
                narrative=body.narrative,
            ),
            hosp=_clinic_code(),
            id_no=str(visit.get("idNo") or ""),
            birthday=str(visit.get("birthday") or ""),
            treat_at=str(reg.get("treatDateTime") or ""),
            treat_seq=str(reg.get("treatSeq") or ""),
            uploaded_at=now,
            makeup=makeup,
            visit_kind=str(reg.get("treatmentItem") or "01"),
        )
        store = get_shadow_store()
        folder = store.db_path.parent / "quality-lab"
        serial = alloc_serial(folder, now[:7])
        name = zip_name(_clinic_code(), now, serial)
        path = pack_zip(xml_bytes, name, folder)
    except QualityLabError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    job_id = enqueue(
        ip,
        {
            "kind": "quality-lab",
            "fileName": name,
            "fileB64": base64.b64encode(path.read_bytes()).decode("ascii"),
        },
    )
    return {"ok": True, "id": job_id, "fileName": name}
