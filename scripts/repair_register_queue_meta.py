#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Repair encounter queue meta from REGISTER.Dat.

Clinic day = R_DATE (看診日 per REGIBRW), not O_DATE.
Encounter id stays hash(KEYWORD-O_DATE-TIMESNO).
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

from scripts.import_yisheng_data import parse_roc_date, read_dbf_records
from src.core.encounter_extensions import QUEUE_EXTENSION_URL, attach_reg_extension
from src.core.yisheng_register_fields import (
    decode_register_time,
    forespeak_text,
    map_visit_state,
    parse_serno,
    remark_text,
    slot_to_shift,
)


def md5_id(value: str) -> str:
    return hashlib.md5(value.encode("utf-8")).hexdigest()[:12]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--register",
        default=str(ROOT / "BkZip" / "extracted_BK0408" / "SC" / "DAT" / "REGISTER.Dat"),
    )
    parser.add_argument("--db-path", default=str(ROOT / "data" / "shadow.db"))
    parser.add_argument("--limit", type=int, default=25000)
    args = parser.parse_args()

    reg_path = Path(args.register)
    if not reg_path.is_file():
        print(f"REGISTER not found: {reg_path}")
        return 1

    limit = args.limit if args.limit > 0 else None
    rows = read_dbf_records(str(reg_path), limit=limit)
    conn = sqlite3.connect(str(args.db_path))
    updated = 0
    voided = 0
    appointments = 0
    missing = 0
    try:
        for r in rows:
            keyword = (r.get("KEYWORD") or "").strip()
            timesno = (r.get("TIMESNO") or "").strip()
            o_date = (r.get("O_DATE") or "").strip()
            o_meta = parse_roc_date(o_date)
            if not o_meta:
                continue
            _, iso_opd_date = o_meta
            r_meta = parse_roc_date(str(r.get("R_DATE") or "").strip())
            iso_visit_date = r_meta[1] if r_meta else iso_opd_date

            encounter_id = f"local-encounter-{md5_id(f'{keyword}-{o_date}-{timesno}')}"
            cur = conn.execute(
                "SELECT payload_json FROM resource_cache WHERE resource_type='Encounter' AND resource_id=?",
                (encounter_id,),
            )
            hit = cur.fetchone()
            if not hit:
                missing += 1
                continue

            payload = json.loads(hit[0])
            serno = parse_serno(r.get("SERNO"))
            slot_raw = str(r.get("SLOT") or "").strip()
            slot_time = decode_register_time(r.get("TIME")) or (
                "14:00" if slot_raw == "2" else "18:00" if slot_raw == "3" else "09:00"
            )
            shift = slot_to_shift(r.get("SLOT"))
            note_mark = remark_text(r.get("REMARK"))
            forespeak = forespeak_text(r.get("FORESPEAK"))
            case_no = str(r.get("CASENO") or "").strip()
            visit_state = map_visit_state(
                r.get("STATUS"),
                r.get("D_END"),
                r.get("ICNO"),
                receipts=r.get("RECEIPTS"),
                diagnose=r.get("DIAGNOSE"),
                caseno=r.get("CASENO"),
                forespeak=r.get("FORESPEAK"),
            )

            payload["status"] = visit_state["fhir_status"]
            payload["period"] = {"start": f"{iso_visit_date}T{slot_time}:00+08:00"}
            others = [
                e for e in (payload.get("extension") or []) if e.get("url") != QUEUE_EXTENSION_URL
            ]
            others.append(
                {
                    "url": QUEUE_EXTENSION_URL,
                    "extension": [
                        {"url": "queueNumber", "valueInteger": serno},
                        {"url": "queueStatus", "valueCode": visit_state["queue_status"]},
                    ],
                }
            )
            payload["extension"] = others
            # REMARK＝掛號註記，不是主訴；勿寫入 reasonCode（主訴見 repair_maintell_chief_complaint.py）

            payload = attach_reg_extension(
                payload,
                {
                    "caseNo": case_no or None,
                    "shift": shift,
                    "noteMark": note_mark or None,
                    "forespeak": forespeak or None,
                    "prebook": bool(
                        visit_state.get("prebook") or visit_state.get("appointment")
                    ),
                    "cardWritten": bool(visit_state["card_written"]),
                    "opdDate": iso_opd_date,
                    "regFee": str(r.get("REGISTER") or "").strip() or None,
                    "copayAmt": str(r.get("PARTPAYMO") or "").strip() or None,
                    "deposit": str(r.get("KEYMONEY") or "").strip() or None,
                    "copayCode": str(r.get("PARTPAYNO") or "").strip() or None,
                    "drugFee": str(r.get("DRUG_PRICE") or "").strip() or None,
                    "treatFee": str(r.get("TREA_PRICE") or "").strip() or None,
                    "selfPay": str(r.get("SELF_PRICE") or "").strip() or None,
                    "cardDisc": str(r.get("DISCARD") or "").strip() or None,
                    "drugDisc": str(r.get("DISDRUG") or "").strip() or None,
                    "arrears": str(r.get("ARREARAGE") or "").strip() or None,
                    "totalFee": str(r.get("RECEIPTS") or "").strip() or None,
                },
            )

            conn.execute(
                "UPDATE resource_cache SET payload_json=?, updated_at=datetime('now') "
                "WHERE resource_type='Encounter' AND resource_id=?",
                (json.dumps(payload, ensure_ascii=False), encounter_id),
            )
            conn.execute(
                """
                UPDATE encounter_index
                SET queue_number=?, queue_status=?, fhir_status=?, encounter_date=?, updated_at=datetime('now')
                WHERE resource_id=?
                """,
                (
                    serno,
                    visit_state["queue_status"],
                    visit_state["fhir_status"],
                    iso_visit_date,
                    encounter_id,
                ),
            )
            updated += 1
            if visit_state.get("void"):
                voided += 1
            if visit_state.get("appointment"):
                appointments += 1
        conn.commit()
    finally:
        conn.close()

    print(
        f"updated={updated} voided={voided} appointments={appointments} missing_in_db={missing}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
