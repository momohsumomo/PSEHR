# -*- coding: utf-8 -*-
"""Insert missing real diagnoses onto visits that already exist.

Does not delete charts. Skips ! delete-markers other than !07Y.
"""
from __future__ import annotations

import hashlib
import sqlite3
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.import_yisheng_data import md5_id, parse_roc_date, read_dbf_records
from scripts.import_yisheng_lean import _clean
from src.core.yisheng_register_fields import map_visit_state

DAT = Path(r"Z:\SC\dat")
DB = ROOT / "data" / "shadow.db"


def main() -> int:
    shortcut: dict[str, tuple[str, str]] = {}
    for rec in read_dbf_records(str(DAT / "DIAGNOSE.Dat")):
        sick = _clean(rec.get("SICK_NO"))
        if not sick:
            continue
        icd10 = _clean(rec.get("ICD_10CODE"))
        name = _clean(rec.get("SICK_NAME")) or _clean(rec.get("SICK_NAME1")) or sick
        shortcut[sick] = (icd10, name)
    print("shortcuts", len(shortcut))

    conn = sqlite3.connect(DB)
    known = {row[0] for row in conn.execute("SELECT resource_id FROM encounter_index")}
    has_dx = {
        row[0]
        for row in conn.execute(
            "SELECT DISTINCT encounter_id FROM condition_index WHERE encounter_id IS NOT NULL"
        )
    }
    print("encounters", len(known), "with_dx", len(has_dx))

    src_days: Counter[str] = Counter()
    inserted_rows = 0
    inserted_visits = 0
    pending: list[tuple] = []
    for rec in read_dbf_records(str(DAT / "REGISTER.Dat")):
        rmeta = parse_roc_date(_clean(rec.get("R_DATE")))
        iso = rmeta[1] if rmeta else ""
        state = map_visit_state(
            rec.get("STATUS"),
            rec.get("D_END"),
            rec.get("ICNO"),
            receipts=rec.get("RECEIPTS"),
            diagnose=rec.get("DIAGNOSE"),
            caseno=rec.get("CASENO"),
            forespeak=rec.get("FORESPEAK"),
        )
        if iso >= "2026-10-01" and iso <= "2026-10-19" and not state.get("void"):
            src_days[iso] += 1
        if state.get("void"):
            continue
        diag = _clean(rec.get("DIAGNOSE"))
        parts_probe = [diag[i:i + 4].strip() for i in range(0, len(diag), 4)]
        mapped = any(shortcut.get(part, ("", ""))[0] for part in parts_probe if part)
        real = bool(diag) and (mapped or not diag.startswith("!") or diag.startswith("!07Y"))
        if not real:
            continue
        keyword = _clean(rec.get("KEYWORD"))
        o_date = _clean(rec.get("O_DATE"))
        timesno = _clean(rec.get("TIMESNO"))
        eid = "local-encounter-" + md5_id(f"{keyword}-{o_date}-{timesno}")
        if eid not in known or eid in has_dx:
            continue
        pid = conn.execute(
            "SELECT patient_id FROM encounter_index WHERE resource_id=?",
            (eid,),
        ).fetchone()
        if not pid:
            continue
        parts = [diag[i : i + 4].strip() for i in range(0, len(diag), 4)]
        parts = [p for p in parts if p][:8]
        if not parts:
            continue
        inserted_visits += 1
        has_dx.add(eid)
        for i, sick in enumerate(parts):
            icd10, name = shortcut.get(sick, ("", sick))
            cid = "local-condition-" + hashlib.md5(f"{eid}|{sick}|{i}".encode()).hexdigest()
            pending.append(
                (cid, pid[0], eid, icd10 or None, None, icd10 or None, name or sick, "active")
            )
            inserted_rows += 1

    conn.executemany(
        """
        INSERT OR IGNORE INTO condition_index (
            resource_id, patient_id, encounter_id, icd10_code, snomed_code, nhi_icd10_code,
            summary_text, clinical_status, updated_at
        ) VALUES (?,?,?,?,?,?,?,?, datetime('now'))
        """,
        pending,
    )
    conn.commit()
    print("inserted_visits", inserted_visits, "inserted_rows", inserted_rows)
    print("source_days")
    for day in sorted(src_days):
        shadow = conn.execute(
            "SELECT COUNT(*) FROM encounter_index WHERE encounter_date=? AND queue_status!='cancelled'",
            (day,),
        ).fetchone()[0]
        print(day, "source", src_days[day], "shadow_active", shadow)
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
