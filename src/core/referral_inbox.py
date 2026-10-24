# -*- coding: utf-8 -*-
"""Keep referral notices downloaded from the bureau.

Reader 6.0 GetRefData is one person at a time and needs that person's card
signature. Each successful read is stored here. A night job cannot sign for
people who are not here, so it does not call the bureau by itself.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any

from src.app.bootstrap import get_shadow_store
from src.core.encounter_extensions import extract_reg_meta
from src.core.nhi_referral import ReferralSlip, bureau_already_accepted, needs_accept_prompt

_DDL = """
CREATE TABLE IF NOT EXISTS referral_download (
    serial TEXT NOT NULL,
    kind TEXT NOT NULL,
    id_no TEXT NOT NULL DEFAULT '',
    patient_name TEXT NOT NULL DEFAULT '',
    medical_no TEXT NOT NULL DEFAULT '',
    hosp_seq TEXT NOT NULL DEFAULT '',
    hosp_id TEXT NOT NULL DEFAULT '',
    hosp_name TEXT NOT NULL DEFAULT '',
    open_date TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    valid_until TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '',
    deleted INTEGER NOT NULL DEFAULT 0,
    fetched_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (serial, kind)
)
"""

_ACCEPT = """
CREATE TABLE IF NOT EXISTS referral_accept (
    serial TEXT PRIMARY KEY,
    accepted_at TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT ''
)
"""

_KIND_LABEL = {
    "1": "\u8f49\u51fa",
    "2": "\u5225\u4eba\u8f49\u4f86",
    "3": "\u8f49\u51fa\u5f8c\u8f49\u56de",
    "4": "\u5225\u4eba\u8f49\u56de",
}


def _ensure(conn) -> None:
    conn.execute(_DDL)
    conn.execute(_ACCEPT)


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _iso_day(ymd: str) -> str:
    text = (ymd or "").strip()
    if re.fullmatch(r"\d{8}", text):
        return "%s-%s-%s" % (text[:4], text[4:6], text[6:8])
    return text[:10]


def mark_accepted(serial: str, source: str = "local") -> None:
    slip = (serial or "").strip()
    if not slip:
        return
    with get_shadow_store()._connect() as conn:
        _ensure(conn)
        conn.execute(
            """
            INSERT INTO referral_accept (serial, accepted_at, source)
            VALUES (?, ?, ?)
            ON CONFLICT(serial) DO NOTHING
            """,
            (slip, _now(), source),
        )


def _person(conn, id_no: str) -> tuple[str, str]:
    row = conn.execute(
        """
        SELECT family_name, given_name, medical_no
        FROM patient_index
        WHERE id_no = ?
        ORDER BY updated_at DESC
        LIMIT 1
        """,
        (id_no,),
    ).fetchone()
    if not row:
        return "", ""
    name = "".join(part for part in (row[0], row[1]) if part).strip()
    return name, str(row[2] or "").strip()


def remember_download(id_no: str, slips: list[ReferralSlip]) -> None:
    """Store every notice from one card read. Accepted ones are recorded too."""
    patient = (id_no or "").strip().upper()
    rows = [row for row in slips if row.serial]
    if not patient or not rows:
        return
    now = _now()
    with get_shadow_store()._connect() as conn:
        _ensure(conn)
        person_name, medical_no = _person(conn, patient)
        for row in rows:
            conn.execute(
                """
                INSERT INTO referral_download (
                    serial, kind, id_no, patient_name, medical_no, hosp_seq,
                    hosp_id, hosp_name, open_date, status, summary, valid_until,
                    contact, deleted, fetched_at
                ) VALUES (
                    :serial, :kind, :id_no, :patient_name, :medical_no, :hosp_seq,
                    :hosp_id, :hosp_name, :open_date, :status, :summary, :valid_until,
                    :contact, :deleted, :fetched_at
                )
                ON CONFLICT(serial, kind) DO UPDATE SET
                    id_no=excluded.id_no,
                    patient_name=CASE WHEN excluded.patient_name <> '' THEN excluded.patient_name ELSE referral_download.patient_name END,
                    medical_no=CASE WHEN excluded.medical_no <> '' THEN excluded.medical_no ELSE referral_download.medical_no END,
                    hosp_seq=excluded.hosp_seq,
                    hosp_id=excluded.hosp_id,
                    hosp_name=excluded.hosp_name,
                    open_date=excluded.open_date,
                    status=excluded.status,
                    summary=excluded.summary,
                    valid_until=excluded.valid_until,
                    contact=excluded.contact,
                    deleted=excluded.deleted,
                    fetched_at=excluded.fetched_at
                """,
                {
                    "serial": row.serial,
                    "kind": row.kind,
                    "id_no": patient,
                    "patient_name": person_name,
                    "medical_no": medical_no,
                    "hosp_seq": row.hosp_seq,
                    "hosp_id": row.hosp_id,
                    "hosp_name": row.hosp_name,
                    "open_date": row.open_date,
                    "status": row.status,
                    "summary": row.summary,
                    "valid_until": row.valid_until,
                    "contact": row.contact,
                    "deleted": 1 if row.deleted else 0,
                    "fetched_at": now,
                },
            )
            if bureau_already_accepted(row):
                conn.execute(
                    """
                    INSERT INTO referral_accept (serial, accepted_at, source)
                    VALUES (?, ?, 'bureau')
                    ON CONFLICT(serial) DO NOTHING
                    """,
                    (row.serial, now),
                )


def _stored_accepted(conn, id_no: str) -> set[str]:
    found: set[str] = set()
    for row in conn.execute("SELECT serial FROM referral_accept"):
        if row[0]:
            found.add(str(row[0]))
    try:
        rows = conn.execute(
            """
            SELECT serial FROM referral_slip
            WHERE kind = 'reply' AND TRIM(IFNULL(serial, '')) <> ''
              AND (id_no = ? OR IFNULL(id_no, '') = '')
            """,
            (id_no,),
        ).fetchall()
    except Exception:
        rows = []
    for row in rows:
        if row[0]:
            found.add(str(row[0]).strip())
    return found


def _encounter_accepted(conn, id_no: str) -> set[str]:
    if not id_no:
        return set()
    rows = conn.execute(
        """
        SELECT rc.payload_json
        FROM patient_index pi
        JOIN encounter_index ei ON ei.patient_id = pi.resource_id
        JOIN resource_cache rc
          ON rc.resource_type = 'Encounter' AND rc.resource_id = ei.resource_id
        WHERE pi.id_no = ?
        """,
        (id_no,),
    ).fetchall()
    found: set[str] = set()
    for row in rows:
        try:
            payload = json.loads(row[0] or "")
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        meta = extract_reg_meta(payload)
        if str(meta.get("acceptReferral") or "").strip() != "1":
            continue
        serial = str(meta.get("referralSeq") or "").strip()
        if serial:
            found.add(serial)
    return found


def prompts_for(id_no: str, slips: list[ReferralSlip]) -> list[ReferralSlip]:
    """Incoming notices this clinic has not accepted. Everything else stays stored."""
    if not any(needs_accept_prompt(row, set()) for row in slips):
        return []
    patient = (id_no or "").strip().upper()
    with get_shadow_store()._connect() as conn:
        _ensure(conn)
        accepted = _stored_accepted(conn, patient)
        pending = [row for row in slips if needs_accept_prompt(row, accepted)]
        if not pending:
            return []
        from_chart = _encounter_accepted(conn, patient)
        if from_chart:
            accepted |= from_chart
            now = _now()
            conn.executemany(
                """
                INSERT INTO referral_accept (serial, accepted_at, source)
                VALUES (?, ?, 'chart')
                ON CONFLICT(serial) DO NOTHING
                """,
                [(serial, now) for serial in from_chart],
            )
    return [row for row in slips if needs_accept_prompt(row, accepted)]


def _lane(kind: str, status: str) -> str:
    if "\u5df2\u56de\u5fa9" in status or "\u5df2\u56de\u590d" in status:
        if kind in {"1", "3"}:
            return "\u5c0d\u65b9\u56de\u8986"
    return _KIND_LABEL.get(kind, kind)


def list_downloads() -> list[dict[str, Any]]:
    with get_shadow_store()._connect() as conn:
        _ensure(conn)
        rows = conn.execute(
            """
            SELECT serial, kind, id_no, patient_name, medical_no, hosp_id, hosp_name,
                   open_date, status, summary, valid_until, deleted, fetched_at
            FROM referral_download
            WHERE deleted = 0
            ORDER BY open_date DESC, fetched_at DESC
            LIMIT 2000
            """
        ).fetchall()
    items: list[dict[str, Any]] = []
    for row in rows:
        serial, kind, id_no, name, medical_no, hosp_id, hosp_name, opened, status, summary, valid, _deleted, fetched = row
        lane = _lane(str(kind or ""), str(status or ""))
        items.append(
            {
                "id": "dl-%s-%s" % (kind, serial),
                "kind": "down",
                "encounterId": "",
                "patientName": name or "",
                "medicalNo": medical_no or "",
                "idNo": id_no or "",
                "destHosp": hosp_name or "",
                "destCode": hosp_id or "",
                "dept": "",
                "purpose": "",
                "doctor": "",
                "diagnosis": "",
                "note": summary or "",
                "serial": serial or "",
                "validUntil": valid or "",
                "status": "%s \u00b7 %s" % (lane, status or "\u2014"),
                "openedOn": _iso_day(str(opened or "")),
                "updatedAt": fetched or "",
            }
        )
    return items
