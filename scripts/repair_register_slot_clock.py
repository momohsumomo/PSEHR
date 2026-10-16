#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Rewrite imported encounter clocks from REGISTER.TIME.

The register list clock is HH:MM from cTon75(TIME), not the old two-byte split.
Only the clock inside period.start and encounter_index.slot_time change.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.import_yisheng_data import parse_dbf_header, parse_roc_date
from src.core.yisheng_register_fields import decode_register_time


def md5_id(value: str) -> str:
    return hashlib.md5(value.encode("utf-8")).hexdigest()[:12]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--register", default=r"Z:\SC\dat\REGISTER.Dat")
    parser.add_argument("--db-path", default=str(ROOT / "data" / "shadow.db"))
    parser.add_argument("--from-rdate", default="", help="ROC R_DATE prefix, e.g. 115.10")
    args = parser.parse_args()

    reg_path = Path(args.register)
    if not reg_path.is_file():
        print(f"REGISTER not found: {reg_path}")
        return 1

    num, header_len, record_len, fields = parse_dbf_header(str(reg_path))
    fm = {name: (length, offset) for name, _kind, length, offset in fields}

    def grab(rec: bytes, name: str) -> str:
        length, offset = fm[name]
        return rec[offset : offset + length].decode("latin1", errors="ignore").strip()

    wanted: dict[str, str] = {}
    with reg_path.open("rb") as handle:
        handle.seek(header_len)
        for _ in range(num):
            rec = handle.read(record_len)
            if len(rec) < record_len or rec[:1] == b"*":
                continue
            r_date = grab(rec, "R_DATE")
            if args.from_rdate and not r_date.startswith(args.from_rdate):
                continue
            keyword = grab(rec, "KEYWORD")
            timesno = grab(rec, "TIMESNO")
            o_date = grab(rec, "O_DATE")
            if not keyword or not parse_roc_date(o_date):
                continue
            clock = decode_register_time(rec[fm["TIME"][1] : fm["TIME"][1] + fm["TIME"][0]])
            if not clock:
                continue
            encounter_id = f"local-encounter-{md5_id(f'{keyword}-{o_date}-{timesno}')}"
            wanted[encounter_id] = clock

    print(f"register clocks {len(wanted)}")
    conn = sqlite3.connect(str(args.db_path))
    updated = 0
    missing = 0
    same = 0
    ids = list(wanted)
    try:
        for start in range(0, len(ids), 200):
            chunk = ids[start : start + 200]
            marks = ",".join("?" for _ in chunk)
            rows = conn.execute(
                f"SELECT resource_id, payload_json FROM resource_cache "
                f"WHERE resource_type='Encounter' AND resource_id IN ({marks})",
                chunk,
            ).fetchall()
            found = {row[0] for row in rows}
            missing += len(chunk) - len(found)
            for resource_id, raw in rows:
                clock = wanted[resource_id]
                payload = json.loads(raw)
                period = payload.get("period") or {}
                old = str(period.get("start") or "")
                if "T" in old:
                    day = old.split("T", 1)[0]
                    tail = old.split("T", 1)[1]
                    zone = ""
                    if "+" in tail:
                        zone = "+" + tail.split("+", 1)[1]
                    elif tail.endswith("Z"):
                        zone = "Z"
                    new_start = f"{day}T{clock}:00{zone or '+08:00'}"
                else:
                    new_start = f"T{clock}:00+08:00"
                if old == new_start:
                    same += 1
                    continue
                period["start"] = new_start
                payload["period"] = period
                conn.execute(
                    "UPDATE resource_cache SET payload_json=?, updated_at=datetime('now') "
                    "WHERE resource_type='Encounter' AND resource_id=?",
                    (json.dumps(payload, ensure_ascii=False), resource_id),
                )
                conn.execute(
                    "UPDATE encounter_index SET slot_time=?, updated_at=datetime('now') "
                    "WHERE resource_id=?",
                    (f"{clock}:00", resource_id),
                )
                updated += 1
            conn.commit()
            print(f"  {min(start + 200, len(ids))}/{len(ids)} updated={updated}")
    finally:
        conn.close()
    print(f"updated={updated} unchanged={same} missing_in_db={missing}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
