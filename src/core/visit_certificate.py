# -*- coding: utf-8 -*-
"""Diagnosis certificate text saved with one visit. Rows are updated, never deleted."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from src.app.bootstrap import get_shadow_store

_DDL = """
CREATE TABLE IF NOT EXISTS visit_certificate (
    id TEXT PRIMARY KEY,
    encounter_id TEXT NOT NULL DEFAULT '',
    medical_no TEXT NOT NULL DEFAULT '',
    patient_name TEXT NOT NULL DEFAULT '',
    doc_no TEXT NOT NULL DEFAULT '',
    visit_date TEXT NOT NULL DEFAULT '',
    print_date TEXT NOT NULL DEFAULT '',
    diagnosis TEXT NOT NULL DEFAULT '',
    order_text TEXT NOT NULL DEFAULT '',
    appointment_text TEXT NOT NULL DEFAULT '',
    english INTEGER NOT NULL DEFAULT 0,
    doctor TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
)
"""

_FIELDS = (
    ("medicalNo", "medical_no"),
    ("patientName", "patient_name"),
    ("docNo", "doc_no"),
    ("visitDate", "visit_date"),
    ("printDate", "print_date"),
    ("diagnosis", "diagnosis"),
    ("order", "order_text"),
    ("appointment", "appointment_text"),
    ("doctor", "doctor"),
)


def _ensure(conn) -> None:
    conn.execute(_DDL)
    conn.execute("CREATE INDEX IF NOT EXISTS ix_visit_certificate_enc ON visit_certificate(encounter_id)")


def _encounter(raw: Any) -> str:
    return str(raw or "").split("/")[-1].strip()


def _public(row: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"id": row.get("id") or "", "encounterId": row.get("encounter_id") or ""}
    for key, column in _FIELDS:
        out[key] = row.get(column) or ""
    out["english"] = bool(row.get("english"))
    out["updatedAt"] = row.get("updated_at") or ""
    return out


def find_for_visit(encounter_id: str) -> dict[str, Any] | None:
    eid = _encounter(encounter_id)
    if not eid:
        return None
    with get_shadow_store()._connect() as conn:
        _ensure(conn)
        row = conn.execute(
            "SELECT * FROM visit_certificate WHERE encounter_id=? ORDER BY updated_at DESC LIMIT 1",
            (eid,),
        ).fetchone()
    return _public(dict(row)) if row else None


def save_for_visit(body: dict[str, Any]) -> dict[str, Any]:
    eid = _encounter(body.get("encounterId"))
    if not eid:
        raise ValueError("\u6c92\u6709\u9078\u5b9a\u770b\u8a3a\uff0c\u4e0d\u80fd\u5b58\u6a94\u3002")
    values = [str(body.get(key) or "") for key, _ in _FIELDS]
    english = 1 if body.get("english") else 0
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_shadow_store()._connect() as conn:
        _ensure(conn)
        existing = conn.execute(
            "SELECT id FROM visit_certificate WHERE encounter_id=? ORDER BY updated_at DESC LIMIT 1",
            (eid,),
        ).fetchone()
        columns = [column for _, column in _FIELDS]
        if existing:
            row_id = str(existing[0])
            sets = ", ".join(f"{column}=?" for column in columns)
            conn.execute(
                f"UPDATE visit_certificate SET {sets}, english=?, updated_at=? WHERE id=?",
                (*values, english, now, row_id),
            )
        else:
            row_id = uuid.uuid4().hex
            names = ", ".join(["id", "encounter_id", *columns, "english", "updated_at"])
            marks = ", ".join("?" for _ in range(len(columns) + 4))
            conn.execute(
                f"INSERT INTO visit_certificate ({names}) VALUES ({marks})",
                (row_id, eid, *values, english, now),
            )
        conn.commit()
    saved = find_for_visit(eid)
    return saved or {"id": row_id, "encounterId": eid, "updatedAt": now}
