# -*- coding: utf-8 -*-
"""Diagnosis certificate text saved with one visit. Rows are updated, never deleted.

Yisheng keeps the text in REGIOTH (DIAGSAY, DOCSAY memo) and the document numbers
in DIAGSERN. Both are keyed by KEYWORD+TIMESNO, the same visit the encounter id
is built from.
"""

from __future__ import annotations

import os
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from src.app.bootstrap import get_shadow_store

SERIAL_WIDTH = 8
YISHENG_MAX_KEY = "certificate.yishengMaxSerial"

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

_SERIAL_LOCK = threading.Lock()
_IMPORT_STARTED = False


def _ensure(conn) -> None:
    conn.execute(_DDL)
    cols = {row[1] for row in conn.execute("PRAGMA table_info(visit_certificate)").fetchall()}
    if "source" not in cols:
        conn.execute("ALTER TABLE visit_certificate ADD COLUMN source TEXT NOT NULL DEFAULT ''")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_visit_certificate_enc ON visit_certificate(encounter_id)")


def _encounter(raw: Any) -> str:
    return str(raw or "").split("/")[-1].strip()


def _public(row: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"id": row.get("id") or "", "encounterId": row.get("encounter_id") or ""}
    for key, column in _FIELDS:
        out[key] = row.get(column) or ""
    out["english"] = bool(row.get("english"))
    out["updatedAt"] = row.get("updated_at") or ""
    out["source"] = row.get("source") or ""
    return out


def _serial_value(text: str) -> int:
    raw = str(text or "").strip()
    return int(raw) if raw.isdigit() else 0


def _format_serial(number: int) -> str:
    return str(number).zfill(SERIAL_WIDTH)


def _max_serial(conn, store) -> int:
    best = 0
    for (doc_no,) in conn.execute("SELECT doc_no FROM visit_certificate WHERE doc_no <> ''").fetchall():
        best = max(best, _serial_value(doc_no))
    try:
        best = max(best, int(store.get_json_setting(YISHENG_MAX_KEY, 0) or 0))
    except (TypeError, ValueError):
        pass
    return best


def next_serial() -> str:
    store = get_shadow_store()
    with store._connect() as conn:
        _ensure(conn)
        return _format_serial(_max_serial(conn, store) + 1)


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
    data = {key: str(body.get(key) or "") for key, _ in _FIELDS}
    english = 1 if body.get("english") else 0
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    store = get_shadow_store()
    with _SERIAL_LOCK, store._connect() as conn:
        _ensure(conn)
        existing = conn.execute(
            "SELECT id, doc_no FROM visit_certificate WHERE encounter_id=? ORDER BY updated_at DESC LIMIT 1",
            (eid,),
        ).fetchone()
        if not data["docNo"].strip():
            kept = str(existing[1] or "").strip() if existing else ""
            data["docNo"] = kept or _format_serial(_max_serial(conn, store) + 1)
        columns = [column for _, column in _FIELDS]
        values = [data[key] for key, _ in _FIELDS]
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


def _read_memo(handle, block: int, token: str | None) -> str:
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
    if length <= 0 or length > 16000:
        return ""
    raw = handle.read(length)
    cleaned = raw.decode("cp950", errors="ignore").replace("\x00", "")
    return cleaned.replace("\r\n", "\n").replace("\r", "\n").strip()


def _visit_ids(register: Path, wanted: set[str]) -> dict[str, list[tuple[str, str]]]:
    """KEYWORD+TIMESNO -> [(encounter id, R_DATE)] for the keys that have a certificate."""
    from scripts.import_yisheng_data import md5_id, parse_dbf_header

    meta = parse_dbf_header(str(register))
    if not meta:
        return {}
    num, hlen, rlen, fields = meta
    idx = {name: (off, length) for name, _typ, length, off in fields}
    k_off, k_len = idx["KEYWORD"]
    t_off, t_len = idx["TIMESNO"]
    o_off, o_len = idx["O_DATE"]
    r_off, r_len = idx["R_DATE"]
    out: dict[str, list[tuple[str, str]]] = {}
    with register.open("rb") as handle:
        handle.seek(hlen)
        for _ in range(num):
            buf = handle.read(rlen)
            if len(buf) < rlen:
                break
            if buf[:1] == b"*":
                continue

            def cell(off: int, length: int) -> str:
                return buf[off : off + length].decode("cp950", errors="ignore").replace("\x00", "").strip()

            keyword = cell(k_off, k_len)
            timesno = cell(t_off, t_len)
            key = keyword + timesno
            if key not in wanted:
                continue
            eid = "local-encounter-" + md5_id(keyword + "-" + cell(o_off, o_len) + "-" + timesno)
            out.setdefault(key, []).append((eid, cell(r_off, r_len)))
    return out


def import_yisheng_certificates(dat_dir: str | Path | None = None) -> dict[str, int]:
    """Add certificates that exist in Yisheng and are missing here. Existing rows stay as they are."""
    from scripts.import_yisheng_data import read_dbf_records
    from scripts.sync_yisheng_since import _read_fpt

    dat = Path(dat_dir or os.environ.get("YISHENG_DAT", r"Z:\SC\dat"))
    oth_path = dat / "REGIOTH.Dat"
    ser_path = dat / "DIAGSERN.Dat"
    register = dat / "REGISTER.Dat"
    if not register.is_file() or not (oth_path.is_file() or ser_path.is_file()):
        return {"added": 0, "skipped": 0}

    texts: dict[str, dict[str, str]] = {}
    if oth_path.is_file():
        handle, block = _read_fpt(oth_path.with_suffix(".FPT"))
        try:
            for row in read_dbf_records(str(oth_path)):
                key = (row.get("KEYWORDS") or "").strip()
                diagnosis = (row.get("DIAGSAY") or "").strip()
                order = _read_memo(handle, block, row.get("DOCSAY"))
                if key and (diagnosis or order):
                    texts[key] = {"diagnosis": diagnosis, "order": order}
        finally:
            if handle is not None:
                handle.close()

    serials: dict[str, dict[str, str]] = {}
    yisheng_max = 0
    if ser_path.is_file():
        for row in read_dbf_records(str(ser_path)):
            key = (row.get("KEYWORDS") or "").strip()
            serno = (row.get("SERNO") or "").strip()
            value = _serial_value(serno)
            yisheng_max = max(yisheng_max, value)
            if not key or not value:
                continue
            seen = serials.get(key)
            if seen is None or value > _serial_value(seen["serno"]):
                serials[key] = {
                    "serno": serno,
                    "printDate": (row.get("PRN_DATE") or "").strip(),
                    "visitDate": (row.get("R_DATE") or "").strip(),
                }

    store = get_shadow_store()
    if yisheng_max:
        try:
            saved_max = int(store.get_json_setting(YISHENG_MAX_KEY, 0) or 0)
        except (TypeError, ValueError):
            saved_max = 0
        if yisheng_max > saved_max:
            store.set_json_setting(YISHENG_MAX_KEY, yisheng_max)

    wanted = set(texts) | set(serials)
    if not wanted:
        return {"added": 0, "skipped": 0}
    visits = _visit_ids(register, wanted)

    added = 0
    skipped = 0
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with store._connect() as conn:
        _ensure(conn)
        have = {row[0] for row in conn.execute("SELECT encounter_id FROM visit_certificate").fetchall()}
        known = {row[0] for row in conn.execute("SELECT resource_id FROM encounter_index").fetchall()}
        rows = []
        for key in sorted(wanted):
            text = texts.get(key, {})
            serial = serials.get(key, {})
            candidates = [item for item in visits.get(key, []) if item[0] in known]
            if not candidates:
                skipped += 1
                continue
            visit_date = serial.get("visitDate", "")
            chosen = next((item for item in candidates if visit_date and item[1] == visit_date), None)
            if chosen is None:
                chosen = max(candidates, key=lambda item: item[1])
            eid = chosen[0]
            if eid in have:
                continue
            have.add(eid)
            rows.append(
                (
                    uuid.uuid4().hex,
                    eid,
                    serial.get("serno", ""),
                    visit_date or chosen[1],
                    serial.get("printDate", ""),
                    text.get("diagnosis", ""),
                    text.get("order", ""),
                    now,
                    "yisheng",
                )
            )
        conn.executemany(
            "INSERT INTO visit_certificate "
            "(id, encounter_id, doc_no, visit_date, print_date, diagnosis, order_text, updated_at, source) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        conn.commit()
        added = len(rows)
    return {"added": added, "skipped": skipped}


def start_certificate_import() -> None:
    global _IMPORT_STARTED
    if _IMPORT_STARTED:
        return
    _IMPORT_STARTED = True

    def run() -> None:
        try:
            import_yisheng_certificates()
        except Exception:
            return

    threading.Thread(target=run, name="certificate-import", daemon=True).start()
