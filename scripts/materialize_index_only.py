"""Give index-only Condition / MedicationRequest rows a FHIR JSON in resource_cache.

  python scripts/materialize_index_only.py --db COPY.db            # check only
  python scripts/materialize_index_only.py --db COPY.db --apply    # write

Only rows with no resource_cache entry are touched, by plain INSERT; existing
JSON and every *_index table stay as they are (verified by checksum before
commit). Each generated JSON is parsed back with the same functions the store
uses to build index rows; any column that would not come back unchanged is
reported. Columns the store never reads from JSON (total_qty, use_type,
line_sort) are written as billing extensions so the JSON holds everything.
Refuses network paths and paths inside the repo: run on a local copy.
"""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import sqlite3
import sys
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.core import fhir_urls  # noqa: E402
from src.core.terminology import build_condition_codeable, build_medication_codeable  # noqa: E402
from src.infrastructure.sqlite_shadow_store import (  # noqa: E402
    _condition_index_fields,
    _insert_audit_row,
    _is_audit_recording_enabled,
    _medication_request_index_fields,
)

CONDITION_CLINICAL = "http://terminology.hl7.org/CodeSystem/condition-clinical"
INDEX_TABLES = ("condition_index", "medication_request_index", "encounter_index", "patient_index")
BATCH = 2000

COND_COLS = ("patient_id", "encounter_id", "icd10_code", "snomed_code", "nhi_icd10_code",
             "summary_text", "clinical_status")
MR_COLS = ("patient_id", "encounter_id", "nhi_code", "rxnorm_code", "drug_text", "status",
           "days_supply", "quantity", "unit_price", "pack_version", "body_site", "pay_mark",
           "memo_mark", "useage")
MR_JSON_ONLY = ("total_qty", "use_type", "line_sort")


def _is_remote(path: Path) -> bool:
    text = str(path.resolve())
    if text.startswith("\\\\"):
        return True
    if os.name == "nt":
        drive = os.path.splitdrive(text)[0] + "\\"
        return ctypes.windll.kernel32.GetDriveTypeW(drive) == 4
    return False


def _inside_repo(path: Path) -> bool:
    resolved = path.resolve()
    return resolved == ROOT or ROOT in resolved.parents


def _norm(value: Any) -> Any:
    if isinstance(value, str):
        return value or None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return value


def _ref(kind: str, rid: Any) -> dict[str, str]:
    return {"reference": f"{kind}/{rid}"}


def condition_payload(row: sqlite3.Row) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "resourceType": "Condition",
        "id": row["resource_id"],
        "clinicalStatus": {
            "coding": [{"system": CONDITION_CLINICAL, "code": row["clinical_status"] or "active"}]
        },
        "code": build_condition_codeable(
            summary_text=row["summary_text"] or None,
            icd10_code=row["icd10_code"] or None,
            snomed_code=row["snomed_code"] or None,
            nhi_icd10_code=row["nhi_icd10_code"] or None,
        ),
        "subject": _ref("Patient", row["patient_id"]),
    }
    if row["encounter_id"]:
        payload["encounter"] = _ref("Encounter", row["encounter_id"])
    return payload


def medication_payload(row: sqlite3.Row) -> dict[str, Any]:
    base = fhir_urls.MEDICATION_BILLING
    payload: dict[str, Any] = {
        "resourceType": "MedicationRequest",
        "id": row["resource_id"],
        "status": row["status"] or "active",
        "intent": "order",
        "medicationCodeableConcept": build_medication_codeable(
            summary_text=row["drug_text"] or None,
            nhi_code=row["nhi_code"] or None,
            rxnorm_code=row["rxnorm_code"] or None,
        ),
        "subject": _ref("Patient", row["patient_id"]),
    }
    if row["encounter_id"]:
        payload["encounter"] = _ref("Encounter", row["encounter_id"])
    if row["useage"] is not None:
        payload["dosageInstruction"] = [{"text": row["useage"]}]

    dispense: dict[str, Any] = {}
    if row["quantity"] is not None:
        dispense["quantity"] = {"value": row["quantity"]}
    if row["days_supply"] is not None:
        dispense["expectedSupplyDuration"] = {
            "value": row["days_supply"], "unit": "d",
            "system": "http://unitsofmeasure.org", "code": "d",
        }
    if dispense:
        payload["dispenseRequest"] = dispense

    ext: list[dict[str, Any]] = []
    if row["days_supply"] is not None:
        ext.append({"url": f"{base}/daysSupply", "valueInteger": int(row["days_supply"])})
    for col, key in (("quantity", "quantity"), ("unit_price", "unitPrice"), ("total_qty", "totalQty")):
        if row[col] is not None:
            ext.append({"url": f"{base}/{key}", "valueDecimal": float(row[col])})
    for col, key in (("pack_version", "packVersion"), ("body_site", "bodySite"),
                     ("pay_mark", "payMark"), ("memo_mark", "memoMark"), ("use_type", "useType")):
        if row[col] is not None:
            ext.append({"url": f"{base}/{key}", "valueString": str(row[col])})
    if row["line_sort"] is not None:
        ext.append({"url": f"{base}/lineSort", "valueInteger": int(row["line_sort"])})
    if ext:
        payload["extension"] = ext
    return payload


def json_only_back(payload: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"total_qty": None, "use_type": None, "line_sort": None}
    for e in payload.get("extension") or []:
        url = str(e.get("url") or "")
        if url.endswith("/totalQty"):
            out["total_qty"] = e.get("valueDecimal")
        elif url.endswith("/useType"):
            out["use_type"] = e.get("valueString")
        elif url.endswith("/lineSort"):
            out["line_sort"] = e.get("valueInteger")
    return out


def round_trip(row: sqlite3.Row, back: dict[str, Any], cols: tuple[str, ...]) -> tuple[list[str], list[str]]:
    """Return (exact mismatches, mismatches only between '' and NULL / whitespace)."""
    hard: list[str] = []
    soft: list[str] = []
    for col in cols:
        want = row[col]
        got = back.get(col)
        if col in ("clinical_status", "status") and want is None:
            want = "active"
        if want == got or (_norm(want) == _norm(got) and want is not None and got is not None):
            continue
        if _norm(want) == _norm(got):
            soft.append(col)
        elif isinstance(want, str) and isinstance(got, str) and want.strip() == got.strip():
            soft.append(col)
        elif isinstance(want, str) and got is None and not want.strip():
            soft.append(col)
        else:
            hard.append(col)
    return hard, soft


def index_digest(conn: sqlite3.Connection) -> dict[str, str]:
    out: dict[str, str] = {}
    for table in INDEX_TABLES:
        h = hashlib.sha256()
        for row in conn.execute(f"SELECT * FROM {table} ORDER BY resource_id"):
            h.update(repr(tuple(row)).encode("utf-8"))
        out[table] = h.hexdigest()
    return out


def cache_counts(conn: sqlite3.Connection) -> dict[str, int]:
    return {rt: n for rt, n in conn.execute(
        "SELECT resource_type, count(*) FROM resource_cache GROUP BY resource_type")}


def missing_rows(conn: sqlite3.Connection, table: str, rtype: str):
    return conn.execute(
        f"SELECT ix.* FROM {table} ix WHERE NOT EXISTS (SELECT 1 FROM resource_cache rc "
        f"WHERE rc.resource_type = ? AND rc.resource_id = ix.resource_id) ORDER BY ix.resource_id",
        (rtype,),
    )


def run(db: Path, apply: bool) -> int:
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    before_digest = index_digest(conn)
    before_counts = cache_counts(conn)

    plan = (
        ("Condition", "condition_index", condition_payload, _condition_index_fields, COND_COLS),
        ("MedicationRequest", "medication_request_index", medication_payload,
         _medication_request_index_fields, MR_COLS),
    )
    totals: dict[str, int] = {}
    hard_by: Counter[str] = Counter()
    soft_by: Counter[str] = Counter()
    hard_rows = 0
    conn.execute("BEGIN")
    try:
        for rtype, table, build, derive, cols in plan:
            batch: list[tuple[str, str, str, str, str]] = []
            n = 0
            for row in missing_rows(conn, table, rtype).fetchall():
                payload = build(row)
                back = derive(payload)
                checked = cols
                if rtype == "MedicationRequest":
                    if "pay_mark" not in back:
                        back["pay_mark"] = None
                    if "memo_mark" not in back:
                        back["memo_mark"] = None
                    if "useage" not in back:
                        back["useage"] = None
                    back.update(json_only_back(payload))
                    checked = cols + MR_JSON_ONLY
                hard, soft = round_trip(row, back, checked)
                for c in hard:
                    hard_by[f"{rtype}.{c}"] += 1
                for c in soft:
                    soft_by[f"{rtype}.{c}"] += 1
                if hard:
                    hard_rows += 1
                stamp = row["updated_at"]
                batch.append((rtype, row["resource_id"],
                              json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                              stamp, stamp))
                n += 1
                if apply and len(batch) >= BATCH:
                    conn.executemany(
                        "INSERT INTO resource_cache (resource_type, resource_id, payload_json, "
                        "created_at, updated_at) VALUES (?, ?, ?, ?, ?)", batch)
                    batch.clear()
            if apply and batch:
                conn.executemany(
                    "INSERT INTO resource_cache (resource_type, resource_id, payload_json, "
                    "created_at, updated_at) VALUES (?, ?, ?, ?, ?)", batch)
            totals[rtype] = n

        print("missing JSON:", totals)
        print("round-trip exact mismatches:", dict(hard_by) or "none", f"(rows {hard_rows})")
        print("round-trip blank/space-only:", dict(soft_by) or "none")

        if not apply:
            conn.rollback()
            print("check only; nothing written")
            return 0
        if hard_rows:
            conn.rollback()
            print("exact mismatches found; rolled back")
            return 2
        after_digest = index_digest(conn)
        if after_digest != before_digest:
            conn.rollback()
            print("index tables changed; rolled back")
            return 3
        after_counts = cache_counts(conn)
        for rtype, n in totals.items():
            if after_counts.get(rtype, 0) - before_counts.get(rtype, 0) != n:
                conn.rollback()
                print(f"{rtype} cache count off; rolled back")
                return 4
        for rtype in set(before_counts) | set(after_counts):
            if rtype not in totals and before_counts.get(rtype) != after_counts.get(rtype):
                conn.rollback()
                print(f"{rtype} cache count changed; rolled back")
                return 4
        if _is_audit_recording_enabled(conn):
            _insert_audit_row(
                conn,
                action="materialize",
                resource_type="Migration",
                resource_id="index-only-condition-medicationrequest",
                machine_id=os.environ.get("COMPUTERNAME") or "Unknown_Machine",
                operator_identity="System_Migration",
                changed_fields={"inserted": totals},
            )
        conn.commit()
        print("written; index tables unchanged")
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", required=True, type=Path)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    db: Path = args.db
    if not db.is_file():
        sys.exit(f"not found: {db}")
    if _is_remote(db):
        sys.exit("refused: DB is on a network path; copy it locally first")
    if _inside_repo(db):
        sys.exit("refused: DB is inside the repo")
    sys.exit(run(db, args.apply))


if __name__ == "__main__":
    main()
