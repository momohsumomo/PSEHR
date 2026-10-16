#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Copy patient_index.id_category into Patient FHIR extension.

Lean import stored USER.TYPE on the index only. The chart reads idCategory
from patient-clinic-ext, so every patient looked blank.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXT_URL = "https://clinic.org/fhir/StructureDefinition/patient-clinic-ext"


def _ensure(payload: dict, code: str) -> bool:
    code = (code or "").strip()
    if not code:
        return False
    exts = payload.setdefault("extension", [])
    clinic = None
    for ext in exts:
        if "patient-clinic-ext" in str(ext.get("url") or ""):
            clinic = ext
            break
    if clinic is None:
        clinic = {"url": EXT_URL, "extension": []}
        exts.append(clinic)
    subs = clinic.setdefault("extension", [])
    for sub in subs:
        if sub.get("url") == "idCategory":
            if str(sub.get("valueString") or "").strip():
                return False
            sub["valueString"] = code
            return True
    subs.append({"url": "idCategory", "valueString": code})
    return True


def main() -> int:
    db = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "shadow.db"
    conn = sqlite3.connect(str(db))
    rows = conn.execute(
        """
        SELECT resource_id, id_category
        FROM patient_index
        WHERE id_category IS NOT NULL AND trim(id_category) != ''
        """
    ).fetchall()
    updated = 0
    missing = 0
    try:
        for pid, code in rows:
            hit = conn.execute(
                "SELECT payload_json FROM resource_cache WHERE resource_type='Patient' AND resource_id=?",
                (pid,),
            ).fetchone()
            if not hit:
                missing += 1
                continue
            payload = json.loads(hit[0])
            if not _ensure(payload, code):
                continue
            conn.execute(
                "UPDATE resource_cache SET payload_json=?, updated_at=datetime('now') "
                "WHERE resource_type='Patient' AND resource_id=?",
                (json.dumps(payload, ensure_ascii=False), pid),
            )
            updated += 1
            if updated % 2000 == 0:
                conn.commit()
                print(f"  ...{updated}", flush=True)
        conn.commit()
    finally:
        conn.close()
    print(f"candidates={len(rows)} updated={updated} missing_payload={missing}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
