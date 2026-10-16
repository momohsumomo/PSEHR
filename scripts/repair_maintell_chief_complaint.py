#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Repair Encounter.reasonCode from MAINTELL.Dat (not REGISTER.REMARK).

Yisheng mapping:
  MAINTELL.KEYWORDS = REGISTER.KEYWORD + TIMESNO
  MAINTELL.MAINTELL = chief complaint text (multi-row C(40))
  REGISTER.REMARK   = queue note mark only (noteMark extension)
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

from scripts.import_yisheng_data import load_maintell_map, parse_roc_date, read_dbf_records


def md5_id(value: str) -> str:
    return hashlib.md5(value.encode("utf-8")).hexdigest()[:12]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sc-root", default=r"Z:\SC")
    ap.add_argument("--db-path", default=str(ROOT / "data" / "shadow.db"))
    ap.add_argument("--limit", type=int, default=0, help="REGISTER limit; 0=all")
    args = ap.parse_args()

    dat = Path(args.sc_root) / "dat"
    if not dat.is_dir():
        dat = Path(args.sc_root) / "DAT"
    reg_path = dat / "REGISTER.Dat"
    mt_path = dat / "MAINTELL.Dat"
    if not reg_path.is_file() or not mt_path.is_file():
        print(f"Missing REGISTER/MAINTELL under {dat}")
        return 1
    if not Path(args.db_path).is_file():
        print(f"DB not found: {args.db_path}")
        return 1

    limit = args.limit if args.limit > 0 else None
    reg_rows = read_dbf_records(str(reg_path), limit=limit)

    conn = sqlite3.connect(args.db_path)
    existing = {
        r[0]
        for r in conn.execute(
            "SELECT resource_id FROM resource_cache WHERE resource_type='Encounter'"
        )
    }
    print(f"Shadow encounters: {len(existing)}")

    id_to_key: dict[str, str] = {}
    keys: set[str] = set()
    for r in reg_rows:
        keyword = (r.get("KEYWORD") or "").strip()
        timesno = (r.get("TIMESNO") or "").strip()
        o_date = (r.get("O_DATE") or "").strip()
        if not keyword or not parse_roc_date(o_date):
            continue
        eid = f"local-encounter-{md5_id(f'{keyword}-{o_date}-{timesno}')}"
        if eid not in existing:
            continue
        vk = f"{keyword}{timesno}"
        id_to_key[eid] = vk
        keys.add(vk)

    print(f"Matched REGISTER rows in shadow: {len(id_to_key)}")
    maintell = load_maintell_map(str(mt_path), keys)

    updated = 0
    cleared = 0
    filled = 0
    for eid, vk in id_to_key.items():
        row = conn.execute(
            "SELECT payload_json FROM resource_cache "
            "WHERE resource_type='Encounter' AND resource_id=?",
            (eid,),
        ).fetchone()
        if not row:
            continue
        payload = json.loads(row[0])
        old_cc = ""
        for rc in payload.get("reasonCode") or []:
            if isinstance(rc, dict) and rc.get("text"):
                old_cc = str(rc["text"])
                break

        chief = (maintell.get(vk) or "").strip()
        note_like = 0 < len(old_cc.strip()) <= 2
        prefix_bad = old_cc.startswith("\u4e3b\u8a34\u7c21\u78bc")

        changed = False
        if chief and chief != old_cc:
            payload["reasonCode"] = [{"text": chief[:4000]}]
            filled += 1
            changed = True
        elif not chief and (note_like or prefix_bad):
            payload.pop("reasonCode", None)
            cleared += 1
            changed = True

        if not changed:
            continue

        conn.execute(
            "UPDATE resource_cache SET payload_json=?, updated_at=datetime('now') "
            "WHERE resource_type='Encounter' AND resource_id=?",
            (json.dumps(payload, ensure_ascii=False), eid),
        )
        updated += 1

    conn.commit()
    conn.close()
    print(
        f"Updated {updated} encounters "
        f"(filled MAINTELL={filled}, cleared bad CC={cleared})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
