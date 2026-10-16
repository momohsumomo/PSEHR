# -*- coding: utf-8 -*-
"""Local referral desk lists. Saving a row does not upload to NHI."""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

from src.app.bootstrap import get_shadow_store

_DDL = """
CREATE TABLE IF NOT EXISTS referral_slip (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    encounter_id TEXT NOT NULL DEFAULT '',
    patient_name TEXT NOT NULL DEFAULT '',
    medical_no TEXT NOT NULL DEFAULT '',
    id_no TEXT NOT NULL DEFAULT '',
    dest_hosp TEXT NOT NULL DEFAULT '',
    dest_code TEXT NOT NULL DEFAULT '',
    dept TEXT NOT NULL DEFAULT '',
    purpose TEXT NOT NULL DEFAULT '',
    doctor TEXT NOT NULL DEFAULT '',
    diagnosis TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    serial TEXT NOT NULL DEFAULT '',
    valid_until TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    opened_on TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
)
"""


def _ensure(conn) -> None:
    conn.execute(_DDL)
    cols = {row[1] for row in conn.execute("PRAGMA table_info(referral_slip)")}
    if "opened_on" not in cols:
        conn.execute("ALTER TABLE referral_slip ADD COLUMN opened_on TEXT NOT NULL DEFAULT ''")
    if "history_text" not in cols:
        conn.execute("ALTER TABLE referral_slip ADD COLUMN history_text TEXT NOT NULL DEFAULT ''")
    if "treat_text" not in cols:
        conn.execute("ALTER TABLE referral_slip ADD COLUMN treat_text TEXT NOT NULL DEFAULT ''")
    if "sheet_json" not in cols:
        conn.execute("ALTER TABLE referral_slip ADD COLUMN sheet_json TEXT NOT NULL DEFAULT ''")


def list_slips(kind: str = "") -> list[dict[str, Any]]:
    ensure_yisheng_archive()
    wanted = kind if kind in {"out", "reply"} else ""
    with get_shadow_store()._connect() as conn:
        _ensure(conn)
        if wanted:
            rows = conn.execute(
                "SELECT * FROM referral_slip WHERE kind=? ORDER BY opened_on DESC, updated_at DESC LIMIT 5000",
                (wanted,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM referral_slip ORDER BY opened_on DESC, updated_at DESC LIMIT 5000"
            ).fetchall()
    return [_public(dict(row)) for row in rows]


def save_slip(body: dict[str, Any]) -> dict[str, Any]:
    kind = str(body.get("kind") or "")
    if kind not in {"out", "reply"}:
        raise ValueError("kind must be out or reply")
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    slip_id = str(body.get("id") or "").strip() or uuid.uuid4().hex
    status = str(body.get("status") or "")
    if not status:
        status = "\u8349\u7a3f" if kind == "out" else "\u5f85\u67e5"
    fields = {
        "id": slip_id,
        "kind": kind,
        "encounter_id": str(body.get("encounterId") or ""),
        "patient_name": str(body.get("patientName") or ""),
        "medical_no": str(body.get("medicalNo") or ""),
        "id_no": str(body.get("idNo") or "").strip().upper(),
        "dest_hosp": str(body.get("destHosp") or ""),
        "dest_code": str(body.get("destCode") or ""),
        "dept": str(body.get("dept") or ""),
        "purpose": str(body.get("purpose") or ""),
        "doctor": str(body.get("doctor") or ""),
        "diagnosis": str(body.get("diagnosis") or ""),
        "note": str(body.get("note") or ""),
        "serial": str(body.get("serial") or ""),
        "valid_until": str(body.get("validUntil") or ""),
        "status": status,
        "opened_on": str(body.get("openedOn") or "")[:10],
        "updated_at": now,
    }
    with get_shadow_store()._connect() as conn:
        _ensure(conn)
        conn.execute(
            """
            INSERT INTO referral_slip (
                id, kind, encounter_id, patient_name, medical_no, id_no,
                dest_hosp, dest_code, dept, purpose, doctor, diagnosis, note,
                serial, valid_until, status, opened_on, updated_at
            ) VALUES (
                :id, :kind, :encounter_id, :patient_name, :medical_no, :id_no,
                :dest_hosp, :dest_code, :dept, :purpose, :doctor, :diagnosis, :note,
                :serial, :valid_until, :status, :opened_on, :updated_at
            )
            ON CONFLICT(id) DO UPDATE SET
                kind=excluded.kind,
                encounter_id=excluded.encounter_id,
                patient_name=excluded.patient_name,
                medical_no=excluded.medical_no,
                id_no=excluded.id_no,
                dest_hosp=excluded.dest_hosp,
                dest_code=excluded.dest_code,
                dept=excluded.dept,
                purpose=excluded.purpose,
                doctor=excluded.doctor,
                diagnosis=excluded.diagnosis,
                note=excluded.note,
                serial=excluded.serial,
                valid_until=excluded.valid_until,
                status=excluded.status,
                opened_on=excluded.opened_on,
                updated_at=excluded.updated_at
            """,
            fields,
        )
    return _public(fields)


def _sheet(fields: dict[str, Any]) -> dict[str, Any]:
    raw = fields.get("sheet_json") or ""
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _public(fields: dict[str, Any]) -> dict[str, Any]:
    extra = _sheet(fields)
    return {
        "id": fields["id"],
        "kind": fields["kind"],
        "encounterId": fields["encounter_id"],
        "patientName": fields["patient_name"],
        "medicalNo": fields["medical_no"],
        "idNo": fields["id_no"],
        "destHosp": fields["dest_hosp"],
        "destCode": fields["dest_code"],
        "dept": fields["dept"],
        "purpose": fields["purpose"],
        "doctor": fields["doctor"],
        "diagnosis": fields["diagnosis"],
        "note": fields["note"],
        "historyText": fields.get("history_text") or "",
        "treatText": fields.get("treat_text") or "",
        "serial": fields["serial"],
        "validUntil": fields["valid_until"],
        "status": fields["status"],
        "openedOn": fields.get("opened_on") or "",
        "updatedAt": fields["updated_at"],
        "sex": extra.get("sex") or "",
        "birth": extra.get("birth") or "",
        "phone": extra.get("phone") or "",
        "address": extra.get("address") or "",
        "contact": extra.get("contact") or "",
        "allergyText": extra.get("allergy") or "",
        "destDept": extra.get("destDept") or "",
        "destDoctor": extra.get("destDoctor") or "",
        "destTel": extra.get("destTel") or "",
        "destAddr": extra.get("destAddr") or "",
        "fax": extra.get("fax") or "",
        "email": extra.get("email") or "",
        "clinicTel": extra.get("clinicTel") or "",
        "examOn": extra.get("examOn") or "",
        "medOn": extra.get("medOn") or "",
        "purposeNote": extra.get("purposeNote") or "",
    }


def ensure_yisheng_archive() -> None:
    """Load REFERRAL and REFERETURN once. Later saves stay in the same list."""
    with get_shadow_store()._connect() as conn:
        _ensure(conn)
        found = conn.execute(
            "SELECT 1 FROM referral_slip WHERE id LIKE 'ys-%' LIMIT 1"
        ).fetchone()
    if not found:
        _import_yisheng_archive()
    _fill_reply_sheets()
    _fill_out_sheets()


def _iso_day(text: str) -> str:
    from scripts.import_yisheng_data import parse_roc_date

    parsed = parse_roc_date(text or "")
    if not parsed:
        return ""
    return parsed[1]


def _import_yisheng_archive() -> None:
    import os

    from scripts.import_yisheng_data import read_dbf_records

    dat = os.environ.get("YISHENG_DAT", r"Z:\SC\dat")
    user_path = os.path.join(dat, "USER.Dat")
    out_path = os.path.join(dat, "REFERRAL.Dat")
    reply_path = os.path.join(dat, "REFERETURN.Dat")
    if not os.path.exists(out_path) and not os.path.exists(reply_path):
        return
    people: dict[str, dict[str, str]] = {}
    if os.path.exists(user_path):
        for row in read_dbf_records(user_path):
            key = (row.get("KEYWORD") or "").strip()
            if key and key not in people:
                people[key] = row
    batch: list[dict[str, str]] = []
    if os.path.exists(out_path):
        for row in read_dbf_records(out_path):
            person = people.get((row.get("KEYWORDS") or "").strip()[:4], {})
            uploaded = (row.get("UL_STATUS") or "").strip() == "1"
            batch.append(
                {
                    "id": "ys-out-%s" % (row.get("_rec_idx") or len(batch)),
                    "kind": "out",
                    "patient_name": (person.get("NAME") or "").strip(),
                    "medical_no": (person.get("MEDICAL_NO") or "").strip(),
                    "id_no": (person.get("ID") or "").strip().upper(),
                    "dest_hosp": (row.get("HOSPITAL") or "").strip(),
                    "dest_code": (row.get("H_ID") or "").strip(),
                    "dept": (row.get("H_SERVICE") or row.get("SERVICE") or "").strip(),
                    "purpose": (row.get("TRANS_WHY") or "").strip(),
                    "doctor": (row.get("DOCTOR") or "").strip(),
                    "diagnosis": "",
                    "note": "",
                    "serial": (row.get("UL_NHIID") or row.get("UL_LOCALID") or "").strip(),
                    "valid_until": (row.get("VALID_DATE") or "").strip(),
                    "status": "\u5df2\u4e0a\u50b3" if uploaded else "\u672a\u4e0a\u50b3",
                    "opened_on": _iso_day(row.get("TRANS_DATE") or ""),
                }
            )
    if os.path.exists(reply_path):
        for row in read_dbf_records(reply_path):
            person = people.get((row.get("KEYWORDS") or "").strip()[:4], {})
            uploaded = (row.get("UL_STATUS") or "").strip() == "1"
            serial = (row.get("TRAN_SERNO") or "").strip()
            if serial in {"", "0"}:
                serial = ""
            batch.append(
                {
                    "id": "ys-reply-%s" % (row.get("_rec_idx") or len(batch)),
                    "kind": "reply",
                    "patient_name": (person.get("NAME") or "").strip(),
                    "medical_no": (person.get("MEDICAL_NO") or "").strip(),
                    "id_no": (person.get("ID") or "").strip().upper(),
                    "dest_hosp": (row.get("HOSPID") or "").strip(),
                    "dest_code": (row.get("HOSPID") or "").strip(),
                    "dept": (row.get("SERVICE") or "").strip(),
                    "purpose": "",
                    "doctor": "",
                    "diagnosis": (row.get("ICD_10CODE") or "").strip(),
                    "note": "",
                    "serial": serial,
                    "valid_until": "",
                    "status": "\u5df2\u56de\u8986" if uploaded else "\u672a\u4e0a\u50b3",
                    "opened_on": _iso_day(row.get("RET_DATE") or row.get("UL_DATE") or ""),
                }
            )
    if not batch:
        return
    with get_shadow_store()._connect() as conn:
        _ensure(conn)
        conn.executemany(
            """
            INSERT INTO referral_slip (
                id, kind, encounter_id, patient_name, medical_no, id_no,
                dest_hosp, dest_code, dept, purpose, doctor, diagnosis, note,
                serial, valid_until, status, opened_on, updated_at
            ) VALUES (
                :id, :kind, '', :patient_name, :medical_no, :id_no,
                :dest_hosp, :dest_code, :dept, :purpose, :doctor, :diagnosis, :note,
                :serial, :valid_until, :status, :opened_on, :opened_on
            )
            ON CONFLICT(id) DO NOTHING
            """,
            batch,
        )


def _memo_text(handle, block: int, token: str | None) -> str:
    text = (token or "").strip()
    if handle is None or not text.isdigit():
        return ""
    number = int(text)
    if number <= 0:
        return ""
    handle.seek(number * block)
    meta = handle.read(8)
    if len(meta) < 8:
        return ""
    length = int.from_bytes(meta[4:8], "big")
    if length <= 0 or length > 8000:
        return ""
    raw = handle.read(length)
    cleaned = raw.decode("cp950", errors="ignore").replace("\x00", "")
    return cleaned.replace("\r\n", "\n").replace("\r", "\n").strip()


def _fill_reply_sheets() -> None:
    """Copy reply narrative from REFERETURN memos onto the stored rows."""
    import os
    from pathlib import Path

    from scripts.import_yisheng_data import read_dbf_records
    from scripts.sync_yisheng_since import _read_fpt

    with get_shadow_store()._connect() as conn:
        _ensure(conn)
        filled = conn.execute(
            "SELECT COUNT(*) FROM referral_slip WHERE id LIKE 'ys-reply-%' AND (IFNULL(note, '') <> '' OR IFNULL(history_text, '') <> '')"
        ).fetchone()[0]
    if filled:
        return
    path = os.path.join(os.environ.get("YISHENG_DAT", r"Z:\SC\dat"), "REFERETURN.Dat")
    if not os.path.exists(path):
        return
    handle, block = _read_fpt(Path(path).with_suffix(".FPT"))
    try:
        updates = []
        for row in read_dbf_records(path):
            updates.append(
                {
                    "id": "ys-reply-%s" % (row.get("_rec_idx") or ""),
                    "note": _memo_text(handle, block, row.get("MAINTELL")),
                    "history_text": _memo_text(handle, block, row.get("HISTORYTXT")),
                    "treat_text": _memo_text(handle, block, row.get("SHIFT_NOTE")),
                    "diagnosis": (row.get("ICD_10CODE") or "").strip(),
                    "purpose": (row.get("PROCOPTION") or "").strip(),
                    "dept": (row.get("SERVICE") or "").strip(),
                }
            )
    finally:
        if handle is not None:
            handle.close()
    with get_shadow_store()._connect() as conn:
        _ensure(conn)
        conn.executemany(
            """
            UPDATE referral_slip
               SET note=:note,
                   history_text=:history_text,
                   treat_text=:treat_text,
                   diagnosis=:diagnosis,
                   purpose=:purpose,
                   dept=:dept
             WHERE id=:id
            """,
            updates,
        )


def _fill_out_sheets() -> None:
    """Copy the outbound slip narrative onto the stored rows."""
    import os
    from pathlib import Path

    from scripts.import_yisheng_data import read_dbf_records
    from scripts.sync_yisheng_since import _read_fpt

    with get_shadow_store()._connect() as conn:
        _ensure(conn)
        filled = conn.execute(
            "SELECT COUNT(*) FROM referral_slip WHERE id LIKE 'ys-out-%' AND IFNULL(note, '') <> ''"
        ).fetchone()[0]
    if filled:
        return
    dat = os.environ.get("YISHENG_DAT", r"Z:\SC\dat")
    path = os.path.join(dat, "REFERRAL.Dat")
    if not os.path.exists(path):
        return
    people: dict[str, dict[str, str]] = {}
    user_path = os.path.join(dat, "USER.Dat")
    if os.path.exists(user_path):
        for row in read_dbf_records(user_path):
            key = (row.get("KEYWORD") or "").strip()
            if key and key not in people:
                people[key] = row
    handle, block = _read_fpt(Path(path).with_suffix(".FPT"))
    try:
        updates = []
        for row in read_dbf_records(path):
            person = people.get((row.get("KEYWORDS") or "").strip()[:4], {})
            phone = (person.get("TEL") or "").strip() or (person.get("TEL1") or "").strip()
            sheet = {
                "sex": (person.get("SEX") or "").strip(),
                "birth": (person.get("BIRTHDAY") or "").strip(),
                "phone": phone,
                "address": (person.get("ADDRESS") or "").strip(),
                "contact": (row.get("CONTACT") or "").strip(),
                "allergy": _memo_text(handle, block, row.get("ALLERGIC")),
                "destDept": (row.get("H_SERVICE") or "").strip(),
                "destDoctor": (row.get("H_DOCTOR") or "").strip(),
                "destTel": (row.get("H_TEL") or "").strip(),
                "destAddr": (row.get("H_ADDRESS") or "").strip(),
                "fax": (row.get("FAX") or "").strip(),
                "email": (row.get("EMAIL") or "").strip(),
                "clinicTel": (row.get("TEL") or "").strip(),
                "examOn": (row.get("LastCkDate") or "").strip(),
                "medOn": (row.get("LastOrDate") or "").strip(),
                "purposeNote": (row.get("TRANS_WHY1") or row.get("Other_Txt") or "").strip(),
            }
            updates.append(
                {
                    "id": "ys-out-%s" % (row.get("_rec_idx") or ""),
                    "note": _memo_text(handle, block, row.get("MAINTELL")),
                    "diagnosis": _memo_text(handle, block, row.get("DIAGNOSE")),
                    "treat_text": _memo_text(handle, block, row.get("CKANDTREAT")),
                    "history_text": _memo_text(handle, block, row.get("LastCkTxt")),
                    "dept": (row.get("SERVICE") or "").strip(),
                    "purpose": (row.get("TRANS_WHY") or "").strip(),
                    "sheet_json": json.dumps(sheet, ensure_ascii=True),
                }
            )
    finally:
        if handle is not None:
            handle.close()
    with get_shadow_store()._connect() as conn:
        _ensure(conn)
        conn.executemany(
            """
            UPDATE referral_slip
               SET note=:note,
                   diagnosis=:diagnosis,
                   treat_text=:treat_text,
                   history_text=:history_text,
                   dept=:dept,
                   purpose=:purpose,
                   sheet_json=:sheet_json
             WHERE id=:id
            """,
            updates,
        )
