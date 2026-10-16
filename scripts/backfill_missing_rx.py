# -*- coding: utf-8 -*-
"""Attach HISTORY lines that never landed on the visit.

Two holes in the first import:
- Times numbers past 09 are stored as 0: 0; 0< and were easy to miss.
- Visits with a blank O_DATE were saved as encounters, then later
  prescription passes skipped them because they required O_DATE.

This only inserts missing rows and fills an empty unit price from
HISTORY.PRICE. It does not delete charts and does not replace a price
that is already stored. Quantity stays the on-screen QTY.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.backfill_cash_book import _iter_fields
from scripts.import_yisheng_data import md5_id
from src.core.nhi_clinical_mappers import yisheng_selftype_to_pay_mark


def _num(value: str) -> float | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def main() -> int:
    import argparse

    extracted = ROOT / "BkZip" / "extracted_BK1012" / "SC" / "DAT"
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dat",
        default=str(extracted if extracted.is_dir() else Path(r"Z:\SC\dat")),
        help="folder that contains HISTORY.Dat, REGISTER.Dat, MEDICAL.Dat",
    )
    args = parser.parse_args()
    dat = Path(args.dat)
    if not (dat / "HISTORY.Dat").is_file():
        print("HISTORY.Dat not found", dat)
        return 1
    print("dat", dat)
    conn = sqlite3.connect(str(ROOT / "data" / "shadow.db"), timeout=180)
    known_eid = {
        row[0]: row[1]
        for row in conn.execute("SELECT resource_id, patient_id FROM encounter_index")
    }
    known_med = {row[0] for row in conn.execute("SELECT resource_id FROM medication_request_index")}
    print("encounters", len(known_eid), "meds", len(known_med))

    medicine: dict[str, tuple[str, str]] = {}
    for row in _iter_fields(dat / "MEDICAL.Dat", ("DRUG_NO", "CODE", "MAKING", "TRADE_NAME")):
        drug_no = (row.get("DRUG_NO") or "").replace("\x00", "").strip()
        last3 = drug_no[-3:] if len(drug_no) >= 3 else drug_no
        if not last3:
            continue
        nhi = (row.get("CODE") or "").strip()
        name = (row.get("MAKING") or "").strip() or (row.get("TRADE_NAME") or "").strip() or nhi or last3
        medicine[last3] = (nhi, name)

    visit_keys: dict[str, str] = {}
    for row in _iter_fields(dat / "REGISTER.Dat", ("KEYWORD", "TIMESNO", "O_DATE")):
        keyword = (row.get("KEYWORD") or "").replace("\x00", "").strip()
        timesno = (row.get("TIMESNO") or "").replace("\x00", "").strip()
        o_date = (row.get("O_DATE") or "").replace("\x00", "").strip()
        if not keyword or not timesno:
            continue
        # Blank O_DATE still has an encounter id. The visit date is R_DATE.
        eid = "local-encounter-" + md5_id(keyword + "-" + o_date + "-" + timesno)
        if eid in known_eid:
            visit_keys[keyword + timesno] = eid
    print("visit keys", len(visit_keys))

    inserts: list[tuple] = []
    price_updates: list[tuple] = []
    sort_seen: dict[str, int] = {}
    known_sig = {
        (
            row[0],
            row[1] or "",
            None if row[2] is None else round(float(row[2]), 3),
            None if row[3] is None else int(row[3]),
            row[4] or "",
            row[5] or "",
        )
        for row in conn.execute(
            """
            SELECT encounter_id, nhi_code, quantity, days_supply, useage, pay_mark
            FROM medication_request_index
            """
        )
    }
    for row in _iter_fields(
        dat / "HISTORY.Dat",
        ("KEYWORDS", "DRUG_NO", "QTY", "DAY", "USEAGE", "PRICE", "SELFTYPE", "SORT", "USE_TYPE"),
    ):
        key = (row.get("KEYWORDS") or "").replace("\x00", "").strip()
        eid = visit_keys.get(key)
        if not eid:
            continue
        sort_seq = (row.get("SORT") or "").strip() or "1"
        bucket = eid + "-" + sort_seq
        nth = sort_seen.get(bucket, 0)
        sort_seen[bucket] = nth + 1
        token = bucket if nth == 0 else bucket + "-" + str(nth)
        mid = "local-medicationrequest-" + md5_id(token)
        price = _num(row.get("PRICE") or "")
        if mid in known_med:
            if price is not None and price > 0:
                price_updates.append((price, mid))
            continue
        drug_no = (row.get("DRUG_NO") or "").replace("\x00", "").strip()
        last3 = drug_no[-3:] if len(drug_no) >= 3 else drug_no
        nhi, name = medicine.get(last3, ("", last3 or drug_no))
        day = _num(row.get("DAY") or "")
        qty = _num(row.get("QTY") or "")
        pay = yisheng_selftype_to_pay_mark(row.get("SELFTYPE")) or None
        useage = (row.get("USEAGE") or "").strip() or None
        signature = (
            eid,
            nhi or "",
            None if qty is None else round(qty, 3),
            None if day is None else int(day),
            useage or "",
            pay or "",
        )
        if signature in known_sig:
            continue
        inserts.append(
            (
                mid,
                known_eid[eid],
                eid,
                nhi or None,
                name,
                "active",
                int(day) if day is not None else None,
                qty,
                price if price and price > 0 else None,
                useage,
                (row.get("USE_TYPE") or "").strip() or None,
                pay,
            )
        )
        known_med.add(mid)
        known_sig.add(signature)

    print("insert", len(inserts), "price touch", len(price_updates))
    conn.executemany(
        """
        INSERT OR IGNORE INTO medication_request_index (
            resource_id, patient_id, encounter_id, nhi_code, drug_text, status,
            days_supply, quantity, unit_price, useage, use_type, pay_mark, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
        """,
        inserts,
    )
    conn.executemany(
        """
        UPDATE medication_request_index
        SET unit_price = ?
        WHERE resource_id = ? AND (unit_price IS NULL OR unit_price = 0)
        """,
        price_updates,
    )
    conn.commit()
    left = conn.execute(
        """
        SELECT pi.medical_no, ei.encounter_date, COUNT(m.resource_id),
               SUM(CASE WHEN m.unit_price IS NULL THEN 1 ELSE 0 END)
        FROM encounter_index ei
        JOIN patient_index pi ON pi.resource_id = ei.patient_id
        LEFT JOIN medication_request_index m ON m.encounter_id = ei.resource_id
        WHERE (pi.medical_no = '027129' AND ei.encounter_date = '2026-06-22')
           OR (pi.medical_no = '066933' AND ei.encounter_date = '2026-06-09')
           OR (pi.medical_no = '073160' AND ei.encounter_date = '2026-07-10')
           OR (pi.medical_no = '087962' AND ei.encounter_date = '2026-07-05')
        GROUP BY pi.medical_no, ei.encounter_date
        ORDER BY ei.encounter_date
        """
    ).fetchall()
    print("gap charts (chart, date, lines, missing price)", left)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
