# -*- coding: utf-8 -*-
"""Store a lab report on the host. The other PC uploads it. This PC does not."""

from __future__ import annotations

import base64
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.app.bootstrap import get_shadow_store
from src.core.encounter_extensions import extract_reg_meta
from src.core.quality_lab import (
    QUALITY_ORDERS,
    QualityLabDraft,
    QualityLabError,
    alloc_serial,
    build_lab_xml,
    order_category,
    pack_zip,
    roc_now,
    zip_name,
)
from src.core.quality_lab_desk import get_report, list_pending, mark_uploaded, save_report

router = APIRouter(prefix="/nhi/v1/quality-lab", tags=["quality-lab"])


class QualityLabBody(BaseModel):
    encounterId: str
    orderCode: str
    orderName: str = ""
    report: str = ""
    patientName: str = ""
    medicalNo: str = ""
    birthday: str = ""
    doctor: str = ""
    slipNo: str = ""
    reportOn: str = ""


class QualityLabId(BaseModel):
    id: str


class QualityLabResult(BaseModel):
    id: str
    localId: str = ""
    nhiId: str = ""


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
    import json

    payload = enc_row[0]
    enc = json.loads(payload) if isinstance(payload, str) else payload
    reg = extract_reg_meta(enc if isinstance(enc, dict) else {})
    id_no = ""
    birthday = ""
    if person:
        id_no = str(person[0] or "")
        birthday = str(person[1] or person[2] or "")
    return {"reg": reg, "idNo": id_no, "birthday": birthday}


def _zip_for(row: dict[str, Any]) -> tuple[str, bytes]:
    visit = _visit(str(row.get("encounterId") or ""))
    reg = visit["reg"]
    now = roc_now(datetime.now())
    code = str(row.get("orderCode") or "")
    category = order_category(code)
    text = str(row.get("report") or "")
    makeup = str(reg.get("afterCheck") or "") == "2" or str(reg.get("icRemark") or "") == "2"
    xml_bytes = build_lab_xml(
        QualityLabDraft(
            order_code=code,
            order_name=str(row.get("orderName") or ""),
            result=text if category == "1" else "",
            narrative="" if category == "1" else text,
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
    return name, path.read_bytes()


@router.get("/orders")
def list_orders() -> dict[str, Any]:
    return {
        "orders": [{"code": code, "category": category} for code, category in sorted(QUALITY_ORDERS.items())],
    }


@router.post("/save")
def save(body: QualityLabBody) -> dict[str, Any]:
    try:
        if not order_category(body.orderCode):
            raise QualityLabError("\u9019\u9805\u8655\u7f6e\u4e0d\u5728\u8ad6\u8cea\u6aa2\u9a57\u4e0a\u50b3\u6e05\u55ae\u88e1\u3002")
        row = save_report(body.model_dump())
    except QualityLabError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "id": row.get("id") or "", "status": "saved"}


@router.get("/pending")
def pending() -> dict[str, Any]:
    return {"rows": list_pending()}


@router.post("/file")
def file_for_upload(body: QualityLabId) -> dict[str, Any]:
    row = get_report(body.id.strip())
    if not row:
        raise HTTPException(status_code=404, detail="\u627e\u4e0d\u5230\u9019\u7b46\u5831\u544a\u3002")
    if row.get("status") == "uploaded":
        raise HTTPException(status_code=400, detail="\u9019\u7b46\u5df2\u7d93\u9001\u51fa\u3002")
    try:
        name, raw = _zip_for(row)
    except QualityLabError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "fileName": name, "fileB64": base64.b64encode(raw).decode("ascii")}


@router.post("/result")
def result(body: QualityLabResult) -> dict[str, Any]:
    if not get_report(body.id.strip()):
        raise HTTPException(status_code=404, detail="\u627e\u4e0d\u5230\u9019\u7b46\u5831\u544a\u3002")
    mark_uploaded(body.id.strip(), body.localId.strip(), body.nhiId.strip())
    return {"ok": True}
