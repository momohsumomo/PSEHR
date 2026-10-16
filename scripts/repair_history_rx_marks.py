#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Patch MedicationRequest payMark/memoMark/days/qty from HISTORY.SELFTYPE + MEMO."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.import_yisheng_data import md5_id, parse_dbf_header, parse_roc_date, read_dbf_records
from src.core.nhi_clinical_mappers import (
    BILLING_EXT_BASE,
    MEMO_MARK_EXT,
    PAY_MARK_EXT,
    yisheng_selftype_to_pay_mark,
)


def _set_ext(extensions: list, url: str, *, value_string: str | None = None, value_int: int | None = None, value_dec: float | None = None) -> list:
    others = [e for e in extensions if not (isinstance(e, dict) and e.get("url") == url)]
    if value_string is not None and value_string != "":
        others.append({"url": url, "valueString": value_string})
    elif value_int is not None:
        others.append({"url": url, "valueInteger": value_int})
    elif value_dec is not None:
        others.append({"url": url, "valueDecimal": value_dec})
    return others


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sc-root", default=r"Z:\SC")
    ap.add_argument("--db-path", default=str(ROOT / "data" / "shadow.db"))
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    dat = Path(args.sc_root) / "dat"
    if not dat.is_dir():
        dat = Path(args.sc_root) / "DAT"
    reg_path = dat / "REGISTER.Dat"
    hist_path = dat / "HISTORY.Dat"
    if not reg_path.is_file() or not hist_path.is_file():
        print(f"Missing REGISTER/HISTORY under {dat}")
        return 1

    limit = args.limit if args.limit > 0 else None
    reg_rows = read_dbf_records(str(reg_path), limit=limit)
    conn = sqlite3.connect(args.db_path)
    existing_enc = {
        r[0]
        for r in conn.execute(
            "SELECT resource_id FROM resource_cache WHERE resource_type='Encounter'"
        )
    }

    # visit_key -> encounter_id for shadow encounters
    key_to_enc: dict[str, str] = {}
    for r in reg_rows:
        keyword = (r.get("KEYWORD") or "").strip()
        timesno = (r.get("TIMESNO") or "").strip()
        o_date = (r.get("O_DATE") or "").strip()
        if not keyword or not parse_roc_date(o_date):
            continue
        eid = f"local-encounter-{md5_id(f'{keyword}-{o_date}-{timesno}')}"
        if eid not in existing_enc:
            continue
        key_to_enc[f"{keyword}{timesno}"] = eid

    print(f"Visit keys in shadow: {len(key_to_enc)}")
    meta = parse_dbf_header(str(hist_path))
    if not meta:
        return 1
    num, hlen, rlen, fields = meta
    updated = 0
    scanned = 0

    with open(hist_path, "rb") as f:
        f.seek(hlen)
        for _ in range(num):
            data = f.read(rlen)
            if len(data) < rlen:
                break
            if data[0] == 0x2A:
                continue
            keywords = data[1:7].decode("cp950", errors="ignore").strip()
            if keywords not in key_to_enc:
                continue
            scanned += 1
            row = {}
            for name, _t, length, offset in fields:
                row[name] = data[offset : offset + length].decode("cp950", errors="ignore").strip()
            enc_id = key_to_enc[keywords]
            sort_seq = row.get("SORT", "1").strip() or "1"
            med_id = f"local-medicationrequest-{md5_id(f'{enc_id}-{sort_seq}')}"
            hit = conn.execute(
                "SELECT payload_json FROM resource_cache "
                "WHERE resource_type='MedicationRequest' AND resource_id=?",
                (med_id,),
            ).fetchone()
            if not hit:
                continue
            payload = json.loads(hit[0])
            pay = yisheng_selftype_to_pay_mark(row.get("SELFTYPE"))
            memo = (row.get("MEMO") or "").strip()[:2]
            try:
                days_n = int(float(row.get("DAY") or 0))
            except ValueError:
                days_n = 0
            try:
                qty_n = float(row.get("QTY") or 0)
            except ValueError:
                qty_n = 0.0

            exts = list(payload.get("extension") or [])
            if pay:
                exts = _set_ext(exts, PAY_MARK_EXT, value_string=pay)
            else:
                exts = [e for e in exts if not (isinstance(e, dict) and e.get("url") == PAY_MARK_EXT)]
            if memo:
                exts = _set_ext(exts, MEMO_MARK_EXT, value_string=memo)
            else:
                exts = [e for e in exts if not (isinstance(e, dict) and e.get("url") == MEMO_MARK_EXT)]
            if days_n > 0:
                exts = _set_ext(exts, f"{BILLING_EXT_BASE}/daysSupply", value_int=days_n)
            if qty_n > 0:
                exts = _set_ext(exts, f"{BILLING_EXT_BASE}/quantity", value_dec=qty_n)
            payload["extension"] = exts

            conn.execute(
                "UPDATE resource_cache SET payload_json=?, updated_at=datetime('now') "
                "WHERE resource_type='MedicationRequest' AND resource_id=?",
                (json.dumps(payload, ensure_ascii=False), med_id),
            )
            if days_n > 0 or qty_n > 0:
                conn.execute(
                    """
                    UPDATE medication_request_index
                    SET days_supply=COALESCE(?, days_supply),
                        quantity=COALESCE(?, quantity),
                        updated_at=datetime('now')
                    WHERE resource_id=?
                    """,
                    (days_n if days_n > 0 else None, qty_n if qty_n > 0 else None, med_id),
                )
            updated += 1
            if updated % 5000 == 0:
                conn.commit()
                print(f"  ... updated {updated}")

    conn.commit()
    conn.close()
    print(f"Scanned matching HISTORY lines={scanned}, updated MedicationRequest={updated}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
