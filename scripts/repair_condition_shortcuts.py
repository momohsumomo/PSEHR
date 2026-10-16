#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Repair condition_index: REGISTER.DIAGNOSE is packed 4-char SICK_NO codes."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.import_yisheng_data import md5_id, parse_roc_date, read_dbf_records
from src.core.yisheng_register_fields import map_visit_state


def _clean(s: str | None) -> str:
    return (s or "").replace("\x00", "").strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sc-root", default=r"Z:\SC")
    ap.add_argument("--db-path", default=str(ROOT / "data" / "shadow.db"))
    args = ap.parse_args()
    dat = Path(args.sc_root) / "dat"
    if not dat.is_dir():
        dat = Path(args.sc_root) / "DAT"

    shortcut: dict[str, tuple[str, str]] = {}
    for r in read_dbf_records(str(dat / "DIAGNOSE.Dat")):
        sick = _clean(r.get("SICK_NO"))
        if not sick:
            continue
        icd10 = _clean(r.get("ICD_10CODE"))
        # 醫聖畫面上多半是 SICK_NAME（診所習慣英文名）；SICK_NAME1 常為中文對照
        name = _clean(r.get("SICK_NAME")) or _clean(r.get("SICK_NAME1")) or sick
        shortcut[sick] = (icd10, name)
    print("shortcuts", len(shortcut))

    # keyword -> patient_id from existing encounters via REGISTER rebuild keys
    keyword_to_patient: dict[str, str] = {}
    conn = sqlite3.connect(args.db_path)
    # Build encounter_id the same way as lean import
    user_rows = read_dbf_records(str(dat / "USER.Dat"))
    for r in user_rows:
        keyword = _clean(r.get("KEYWORD"))
        id_no = _clean(r.get("ID")).upper()
        if keyword and id_no:
            keyword_to_patient[keyword] = f"local-patient-{md5_id(id_no)}"

    new_rows: list[tuple] = []
    new_cache: list[tuple] = []
    encounter_ids: set[str] = set()
    unmatched = 0
    matched = 0

    for r in read_dbf_records(str(dat / "REGISTER.Dat")):
        keyword = _clean(r.get("KEYWORD"))
        timesno = _clean(r.get("TIMESNO"))
        o_date = _clean(r.get("O_DATE"))
        diagnose_field = _clean(r.get("DIAGNOSE"))
        if not diagnose_field:
            continue
        visit_state = map_visit_state(
            r.get("STATUS"),
            r.get("D_END"),
            r.get("ICNO"),
            receipts=r.get("RECEIPTS"),
            diagnose=r.get("DIAGNOSE"),
            caseno=r.get("CASENO"),
            forespeak=r.get("FORESPEAK"),
        )
        if visit_state.get("void"):
            continue
        patient_id = keyword_to_patient.get(keyword)
        if not patient_id:
            continue
        if not parse_roc_date(o_date):
            continue
        eid = f"local-encounter-{md5_id(f'{keyword}-{o_date}-{timesno}')}"
        encounter_ids.add(eid)

        # packed 4-char codes (Yisheng)
        codes = [diagnose_field[x : x + 4].strip() for x in range(0, len(diagnose_field), 4)]
        codes = [c for c in codes if c]
        for idx_seq, sick in enumerate(codes):
            icd10, name = shortcut.get(sick, ("", ""))
            if not name:
                unmatched += 1
                name = sick
            else:
                matched += 1
            cid = f"local-condition-{md5_id(f'{eid}-{sick}-{idx_seq}')}"
            new_rows.append(
                (
                    cid,
                    patient_id,
                    eid,
                    icd10 or None,
                    None,
                    icd10 or None,
                    name,
                    "active",
                )
            )
            payload = {
                "resourceType": "Condition",
                "id": cid,
                "clinicalStatus": {"coding": [{"code": "active"}]},
                "code": {
                    "text": name,
                    "coding": (
                        [{"system": "http://hl7.org/fhir/sid/icd-10", "code": icd10, "display": name}]
                        if icd10
                        else []
                    ),
                },
                "subject": {"reference": f"Patient/{patient_id}"},
                "encounter": {"reference": f"Encounter/{eid}"},
            }
            new_cache.append(("Condition", cid, json.dumps(payload, ensure_ascii=False)))

    print("new conditions", len(new_rows), "matched", matched, "unmatched", unmatched)

    cur = conn.cursor()
    # Replace all conditions (rebuilt from REGISTER)
    cur.execute("DELETE FROM condition_index")
    cur.execute("DELETE FROM resource_cache WHERE resource_type='Condition'")
    BATCH = 8000
    sql_idx = """
        INSERT OR REPLACE INTO condition_index (
            resource_id, patient_id, encounter_id, icd10_code, snomed_code, nhi_icd10_code,
            summary_text, clinical_status, updated_at
        ) VALUES (?,?,?,?,?,?,?,?, datetime('now'))
    """
    sql_cache = """
        INSERT OR REPLACE INTO resource_cache
        (resource_type, resource_id, payload_json, created_at, updated_at)
        VALUES (?,?,?, datetime('now'), datetime('now'))
    """
    for i in range(0, len(new_rows), BATCH):
        cur.executemany(sql_idx, new_rows[i : i + BATCH])
        cur.executemany(sql_cache, new_cache[i : i + BATCH])
        conn.commit()
        print(f"  ... {min(i+BATCH, len(new_rows))}/{len(new_rows)}")

    # sanity
    bad = cur.execute(
        """
        SELECT COUNT(*) FROM condition_index
        WHERE length(IFNULL(summary_text,'')) = 8
          AND summary_text GLOB 'S*'
          AND IFNULL(icd10_code,'') = ''
        """
    ).fetchone()[0]
    total = cur.execute("SELECT COUNT(*) FROM condition_index").fetchone()[0]
    conn.close()
    print("DONE conditions=", total, "remaining glued-S* empty-icd=", bad)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
