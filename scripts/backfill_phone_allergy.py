# -*- coding: utf-8 -*-
"""Put USER.TEL / TEL2 onto the patient record, and USER.ALLERGIC onto allergy_index.

Does not delete patients or allergies. Skips a phone that is already stored.
"""
from __future__ import annotations

import json
import sqlite3
import struct
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.import_yisheng_data import md5_id, parse_dbf_header

USER = Path(r"Z:\SC\dat\USER.Dat")
FPT = Path(r"Z:\SC\dat\USER.FPT")
DB = ROOT / "data" / "shadow.db"


def memo_reader(blob: bytes):
    block = struct.unpack(">H", blob[6:8])[0] or 64

    def read(raw: str) -> str:
        raw = (raw or "").strip()
        if not raw or set(raw) <= {"0"}:
            return ""
        try:
            block_no = int(raw)
        except ValueError:
            return ""
        pos = block_no * block
        if pos + 8 > len(blob):
            return ""
        _kind, length = struct.unpack(">II", blob[pos : pos + 8])
        if length <= 0 or length > 20000 or pos + 8 + length > len(blob):
            return ""
        return blob[pos + 8 : pos + 8 + length].decode("cp950", errors="ignore").replace("\x00", "").strip()

    return read


def grab(data: bytes, fields: dict, name: str) -> str:
    _typ, length, offset = fields[name]
    return data[offset : offset + length].decode("cp950", errors="ignore").strip()


def ensure_phone(payload: dict, use: str, value: str) -> bool:
    value = (value or "").strip()
    if not value or value == "0":
        return False
    telecom = payload.setdefault("telecom", [])
    for item in telecom:
        if not isinstance(item, dict):
            continue
        if item.get("system") == "phone" and item.get("use") == use and str(item.get("value") or "").strip():
            return False
    telecom.append({"system": "phone", "value": value, "use": use})
    return True


def main() -> int:
    started = time.time()
    meta = parse_dbf_header(str(USER))
    if not meta:
        print("USER missing")
        return 1
    num, header_len, record_len, field_list = meta
    fields = {name: (typ, length, offset) for name, typ, length, offset in field_list}
    read_memo = memo_reader(FPT.read_bytes()) if FPT.is_file() else (lambda _raw: "")
    conn = sqlite3.connect(str(DB), timeout=180)
    conn.execute("PRAGMA busy_timeout=180000")
    try:
        conn.execute("ALTER TABLE patient_index ADD COLUMN phone2 TEXT")
    except sqlite3.OperationalError:
        pass
    id_map = {
        str(row[0] or "").strip().upper(): str(row[1])
        for row in conn.execute(
            "SELECT id_no, resource_id FROM patient_index WHERE COALESCE(id_no,'') != ''"
        )
    }
    phones: dict[str, tuple[str, str]] = {}
    allergies: list[tuple[str, str, str]] = []
    with USER.open("rb") as handle:
        handle.seek(header_len)
        for _i in range(num):
            data = handle.read(record_len)
            if len(data) < record_len or data[0] == 0x2A:
                continue
            id_no = grab(data, fields, "ID").upper()
            pid = id_map.get(id_no)
            if not pid:
                continue
            tel = grab(data, fields, "TEL")
            tel2 = grab(data, fields, "TEL2")
            if tel or tel2:
                phones[pid] = (tel, tel2)
            allergic = read_memo(grab(data, fields, "ALLERGIC"))
            if allergic:
                allergies.append((pid, id_no, allergic))
    print(f"phones {len(phones)} allergies {len(allergies)} {time.time() - started:.1f}s", flush=True)

    phone_rows = [(tel2 or None, pid) for pid, (_tel, tel2) in phones.items() if tel2]
    conn.executemany(
        "UPDATE patient_index SET phone2 = ? WHERE resource_id = ? AND (phone2 IS NULL OR trim(phone2) = '')",
        phone_rows,
    )
    conn.commit()

    ids = list(phones)
    changed = 0
    for start in range(0, len(ids), 300):
        chunk = ids[start : start + 300]
        marks = ",".join("?" * len(chunk))
        rows = {
            row[0]: row[1]
            for row in conn.execute(
                "SELECT resource_id, payload_json FROM resource_cache "
                f"WHERE resource_type = 'Patient' AND resource_id IN ({marks})",
                chunk,
            )
        }
        writing = []
        for pid in chunk:
            raw = rows.get(pid)
            if not raw:
                continue
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                continue
            tel, tel2 = phones[pid]
            dirty = ensure_phone(payload, "home", tel)
            dirty = ensure_phone(payload, "mobile", tel2) or dirty
            if dirty:
                writing.append((json.dumps(payload, ensure_ascii=False), pid))
        if writing:
            conn.executemany(
                "UPDATE resource_cache SET payload_json = ?, updated_at = datetime('now') "
                "WHERE resource_type = 'Patient' AND resource_id = ?",
                writing,
            )
            changed += len(writing)
        conn.commit()
    print(f"patient json {changed}", flush=True)

    have = {
        row[0]
        for row in conn.execute("SELECT patient_id FROM allergy_index")
    }
    inserted = 0
    for pid, id_no, text in allergies:
        if pid in have:
            continue
        aid = "local-allergy-" + md5_id(id_no)
        payload = {
            "resourceType": "AllergyIntolerance",
            "id": aid,
            "patient": {"reference": f"Patient/{pid}"},
            "clinicalStatus": {"coding": [{"code": "active"}]},
            "verificationStatus": {"coding": [{"code": "confirmed"}]},
            "category": ["medication"],
            "code": {"text": text},
        }
        conn.execute(
            "INSERT OR REPLACE INTO resource_cache (resource_type, resource_id, payload_json, created_at, updated_at) "
            "VALUES ('AllergyIntolerance', ?, ?, datetime('now'), datetime('now'))",
            (aid, json.dumps(payload, ensure_ascii=False)),
        )
        conn.execute(
            """
            INSERT OR REPLACE INTO allergy_index (
                resource_id, patient_id, verification_status, snomed_code, summary_text, category, updated_at
            ) VALUES (?, ?, 'confirmed', '', ?, 'medication', datetime('now'))
            """,
            (aid, pid, text),
        )
        inserted += 1
    conn.commit()
    print(f"allergy inserted {inserted} {time.time() - started:.1f}s", flush=True)
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
