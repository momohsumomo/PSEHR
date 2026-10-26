# -*- coding: utf-8 -*-
"""Saved lab reports. The visit PC only stores a row. Upload is another PC."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from src.app.bootstrap import get_shadow_store

_DDL = """
CREATE TABLE IF NOT EXISTS quality_lab_report (
    id TEXT PRIMARY KEY,
    encounter_id TEXT NOT NULL DEFAULT '',
    patient_name TEXT NOT NULL DEFAULT '',
    medical_no TEXT NOT NULL DEFAULT '',
    birthday TEXT NOT NULL DEFAULT '',
    order_code TEXT NOT NULL DEFAULT '',
    order_name TEXT NOT NULL DEFAULT '',
    report_text TEXT NOT NULL DEFAULT '',
    doctor TEXT NOT NULL DEFAULT '',
    slip_no TEXT NOT NULL DEFAULT '',
    report_on TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    local_id TEXT NOT NULL DEFAULT '',
    nhi_id TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
)
"""


def _ensure(conn) -> None:
    conn.execute(_DDL)


def _public(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id") or "",
        "encounterId": row.get("encounter_id") or "",
        "patientName": row.get("patient_name") or "",
        "medicalNo": row.get("medical_no") or "",
        "birthday": row.get("birthday") or "",
        "orderCode": row.get("order_code") or "",
        "orderName": row.get("order_name") or "",
        "report": row.get("report_text") or "",
        "doctor": row.get("doctor") or "",
        "slipNo": row.get("slip_no") or "",
        "reportOn": row.get("report_on") or "",
        "status": row.get("status") or "",
        "localId": row.get("local_id") or "",
        "nhiId": row.get("nhi_id") or "",
        "updatedAt": row.get("updated_at") or "",
    }


def list_pending() -> list[dict[str, Any]]:
    with get_shadow_store()._connect() as conn:
        _ensure(conn)
        rows = conn.execute(
            "SELECT * FROM quality_lab_report WHERE status<>? ORDER BY updated_at DESC LIMIT 500",
            ("uploaded",),
        ).fetchall()
    return [_public(dict(row)) for row in rows]


def find_for_visit(encounter_id: str, order_code: str) -> dict[str, Any] | None:
    eid = str(encounter_id or "").split("/")[-1].strip()
    code = str(order_code or "").strip().upper()
    if not eid or not code:
        return None
    with get_shadow_store()._connect() as conn:
        _ensure(conn)
        row = conn.execute(
            "SELECT * FROM quality_lab_report WHERE encounter_id=? AND order_code=? "
            "ORDER BY updated_at DESC LIMIT 1",
            (eid, code),
        ).fetchone()
    if not row:
        return None
    return _public(dict(row))


def get_report(report_id: str) -> dict[str, Any] | None:
    with get_shadow_store()._connect() as conn:
        _ensure(conn)
        row = conn.execute(
            "SELECT * FROM quality_lab_report WHERE id=?",
            (report_id,),
        ).fetchone()
    if not row:
        return None
    return _public(dict(row))


def save_report(body: dict[str, Any]) -> dict[str, Any]:
    encounter_id = str(body.get("encounterId") or "").split("/")[-1].strip()
    order_code = str(body.get("orderCode") or "").strip().upper()
    report = str(body.get("report") or "").strip()
    if not encounter_id:
        raise ValueError("\u6c92\u6709\u6307\u5b9a\u770b\u8a3a\u3002")
    if not order_code:
        raise ValueError("\u6c92\u6709\u9375\u4fdd\u78bc\u3002")
    if not report:
        raise ValueError("\u8acb\u5148\u586b\u5831\u544a\u3002")
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_shadow_store()._connect() as conn:
        _ensure(conn)
        existing = conn.execute(
            "SELECT id FROM quality_lab_report WHERE encounter_id=? AND order_code=? AND status<>? "
            "ORDER BY updated_at DESC LIMIT 1",
            (encounter_id, order_code, "uploaded"),
        ).fetchone()
        report_id = str(existing[0]) if existing else uuid.uuid4().hex
        if existing:
            conn.execute(
                "UPDATE quality_lab_report SET patient_name=?, medical_no=?, birthday=?, order_name=?, "
                "report_text=?, doctor=?, slip_no=?, report_on=?, status=?, updated_at=? WHERE id=?",
                (
                    str(body.get("patientName") or ""),
                    str(body.get("medicalNo") or ""),
                    str(body.get("birthday") or ""),
                    str(body.get("orderName") or ""),
                    report,
                    str(body.get("doctor") or ""),
                    str(body.get("slipNo") or ""),
                    str(body.get("reportOn") or ""),
                    "saved",
                    now,
                    report_id,
                ),
            )
        else:
            conn.execute(
                "INSERT INTO quality_lab_report ("
                "id, encounter_id, patient_name, medical_no, birthday, order_code, order_name, "
                "report_text, doctor, slip_no, report_on, status, local_id, nhi_id, updated_at"
                ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    report_id,
                    encounter_id,
                    str(body.get("patientName") or ""),
                    str(body.get("medicalNo") or ""),
                    str(body.get("birthday") or ""),
                    order_code,
                    str(body.get("orderName") or ""),
                    report,
                    str(body.get("doctor") or ""),
                    str(body.get("slipNo") or ""),
                    str(body.get("reportOn") or ""),
                    "saved",
                    "",
                    "",
                    now,
                ),
            )
        conn.commit()
    saved = get_report(report_id)
    return saved or {"id": report_id, "status": "saved"}


def mark_uploaded(report_id: str, local_id: str, nhi_id: str) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_shadow_store()._connect() as conn:
        _ensure(conn)
        conn.execute(
            "UPDATE quality_lab_report SET status=?, local_id=?, nhi_id=?, updated_at=? WHERE id=?",
            ("uploaded", local_id, nhi_id, now, report_id),
        )
        conn.commit()
