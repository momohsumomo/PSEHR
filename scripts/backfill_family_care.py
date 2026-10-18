# -*- coding: utf-8 -*-
"""Copy USER.HF_DATE and USER.CASE_TYPE onto the patient chart.

Does not print names, ids, or chart numbers. Skips a value already stored.
"""
from __future__ import annotations

import json
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.import_yisheng_data import parse_dbf_header, parse_roc_date

USER = Path(r"Z:\SC\dat\USER.Dat")
DB = ROOT / "data" / "shadow.db"
EXT_URL = "https://clinic.org/fhir/StructureDefinition/patient-clinic-ext"


def grab(data: bytes, fields: dict, name: str) -> str:
    _typ, length, offset = fields[name]
    return data[offset : offset + length].decode("cp950", errors="ignore").strip()


def set_ext(payload: dict, url: str, value: str) -> bool:
    value = (value or "").strip()
    if not value:
        return False
    extensions = payload.setdefault("extension", [])
    block = None
    for item in extensions:
        if isinstance(item, dict) and item.get("url") == EXT_URL:
            block = item
            break
    if block is None:
        block = {"url": EXT_URL, "extension": []}
        extensions.append(block)
    subs = block.setdefault("extension", [])
    for sub in subs:
        if isinstance(sub, dict) and sub.get("url") == url:
            if str(sub.get("valueString") or "").strip():
                return False
            sub["valueString"] = value
            return True
    subs.append({"url": url, "valueString": value})
    return True


def main() -> int:
    started = time.time()
    meta = parse_dbf_header(str(USER))
    if not meta:
        print("USER missing")
        return 1
    num, header_len, record_len, field_list = meta
    fields = {name: (typ, length, offset) for name, typ, length, offset in field_list}
    conn = sqlite3.connect(str(DB), timeout=180)
    conn.execute("PRAGMA busy_timeout=180000")
    by_id = {
        str(row[0] or "").strip().upper(): str(row[1])
        for row in conn.execute(
            "SELECT id_no, resource_id FROM patient_index WHERE COALESCE(trim(id_no),'') != ''"
        )
    }
    by_chart = {
        str(row[0] or "").strip(): str(row[1])
        for row in conn.execute(
            "SELECT medical_no, resource_id FROM patient_index WHERE COALESCE(trim(medical_no),'') != ''"
        )
    }
    wanted: dict[str, tuple[str, str]] = {}
    with USER.open("rb") as handle:
        handle.seek(header_len)
        for _i in range(num):
            data = handle.read(record_len)
            if len(data) < record_len or data[0] == 0x2A:
                continue
            hf = parse_roc_date(grab(data, fields, "HF_DATE"))
            case = grab(data, fields, "CASE_TYPE").upper()
            if case not in {"A", "B", "C"}:
                case = ""
            if not hf and not case:
                continue
            pid = by_id.get(grab(data, fields, "ID").upper()) or by_chart.get(grab(data, fields, "MEDICAL_NO"))
            if not pid:
                continue
            wanted[pid] = (hf[0] if hf else "", case)
    print(f"matched {len(wanted)} {time.time() - started:.1f}s", flush=True)
    ids = list(wanted)
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
            hf, case = wanted[pid]
            dirty = set_ext(payload, "familyCareDate", hf)
            dirty = set_ext(payload, "familyCareCase", case) or dirty
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
    print(f"updated {changed}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
