#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bulk-build FHIR stubs into resource_cache FROM index tables.

Same clinical result as fat import; method = field map + executemany (not one-by-one API).
Patient/Encounter thin stubs already written by import_yisheng_lean.py.
This fills Condition + MedicationRequest cache from *_index.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.core.nhi_clinical_mappers import MEMO_MARK_EXT, PAY_MARK_EXT

BATCH = 8000


def _flush(cur: sqlite3.Cursor, rows: list[tuple], label: str) -> None:
    sql = """
        INSERT OR REPLACE INTO resource_cache
        (resource_type, resource_id, payload_json, created_at, updated_at)
        VALUES (?,?,?, datetime('now'), datetime('now'))
    """
    total = 0
    n = len(rows)
    for i in range(0, n, BATCH):
        chunk = rows[i : i + BATCH]
        cur.executemany(sql, chunk)
        total += len(chunk)
        print(f"  ... {label} {total}/{n}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db-path", default=str(ROOT / "data" / "shadow.db"))
    args = ap.parse_args()

    conn = sqlite3.connect(args.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = OFF;")
    conn.execute("PRAGMA temp_store = MEMORY;")
    cur = conn.cursor()

    print("[1] Condition <- condition_index")
    cond_rows = cur.execute("SELECT * FROM condition_index").fetchall()
    cond_cache: list[tuple] = []
    for row in cond_rows:
        icd = row["icd10_code"] or row["nhi_icd10_code"] or ""
        text = row["summary_text"] or icd
        payload = {
            "resourceType": "Condition",
            "id": row["resource_id"],
            "subject": {"reference": f"Patient/{row['patient_id']}"},
            "encounter": {"reference": f"Encounter/{row['encounter_id']}"}
            if row["encounter_id"]
            else None,
            "code": {
                "text": text,
                "coding": [{"system": "http://hl7.org/fhir/sid/icd-10", "code": icd, "display": text}]
                if icd
                else [],
            },
            "clinicalStatus": {"coding": [{"code": row["clinical_status"] or "active"}]},
        }
        if payload["encounter"] is None:
            payload.pop("encounter")
        cond_cache.append(("Condition", row["resource_id"], json.dumps(payload, ensure_ascii=False)))
    _flush(cur, cond_cache, "Condition cache")
    conn.commit()

    print("[2] MedicationRequest <- medication_request_index")
    keys = {r[1] for r in cur.execute("PRAGMA table_info(medication_request_index)").fetchall()}
    med_rows = cur.execute("SELECT * FROM medication_request_index").fetchall()
    med_cache: list[tuple] = []
    for row in med_rows:
        nhi = row["nhi_code"] or ""
        text = row["drug_text"] or nhi
        days = row["days_supply"] if "days_supply" in keys else None
        qty = row["quantity"] if "quantity" in keys else None
        useage = row["useage"] if "useage" in keys else None
        pay_mark = row["pay_mark"] if "pay_mark" in keys else None
        memo_mark = row["memo_mark"] if "memo_mark" in keys else None
        # Short USEAGE only (QD/BID); days/qty stay in extensions / index
        dosage = (useage or "").strip()
        extensions = []
        if days is not None:
            extensions.append(
                {
                    "url": "https://clinic.org/fhir/StructureDefinition/billing/daysSupply",
                    "valueInteger": int(days),
                }
            )
        if qty is not None:
            extensions.append(
                {
                    "url": "https://clinic.org/fhir/StructureDefinition/billing/quantity",
                    "valueDecimal": float(qty),
                }
            )
        if pay_mark:
            extensions.append({"url": PAY_MARK_EXT, "valueString": pay_mark})
        if memo_mark:
            extensions.append({"url": MEMO_MARK_EXT, "valueString": memo_mark})
        payload = {
            "resourceType": "MedicationRequest",
            "id": row["resource_id"],
            "status": row["status"] or "active",
            "intent": "order",
            "subject": {"reference": f"Patient/{row['patient_id']}"},
            "encounter": {"reference": f"Encounter/{row['encounter_id']}"}
            if row["encounter_id"]
            else None,
            "medicationCodeableConcept": {
                "text": text,
                "coding": [
                    {
                        "system": "https://nhidcc.nhi.gov.tw/medication",
                        "code": nhi,
                        "display": text,
                    }
                ]
                if nhi
                else [],
            },
            "dosageInstruction": [{"text": dosage.strip()}] if dosage.strip() else [],
            "extension": extensions,
        }
        if payload["encounter"] is None:
            payload.pop("encounter")
        med_cache.append(
            ("MedicationRequest", row["resource_id"], json.dumps(payload, ensure_ascii=False))
        )
    _flush(cur, med_cache, "MedicationRequest cache")
    conn.commit()

    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    n_cache = cur.execute("SELECT COUNT(*) FROM resource_cache").fetchone()[0]
    by = cur.execute(
        "SELECT resource_type, COUNT(*) FROM resource_cache GROUP BY resource_type"
    ).fetchall()
    conn.close()
    print("\nDONE materialize")
    print("  resource_cache total:", f"{n_cache:,}")
    for t, c in by:
        print(f"    {t}: {c:,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
