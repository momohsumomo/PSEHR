"""Which index columns cannot be rebuilt from the FHIR JSON (read-only).

  python scripts/fhir_gap_report.py --db COPY.db [--types Encounter,Patient]

For every resource in resource_cache, the store's own index field functions
are applied to the JSON and the result compared, column by column, with the
current index row. Prints counts only (no patient data). Columns the store
never derives from JSON are listed with how many rows hold a value, and, when
a reg-extension key looks like the same thing, how often the two agree.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.core.encounter_extensions import extract_reg_meta  # noqa: E402
from src.infrastructure import sqlite_shadow_store as s  # noqa: E402


def _enc_fields(payload: dict[str, Any]) -> dict[str, Any]:
    pid, day, qn, qs, fs = s._encounter_index_fields(payload)
    out = {"patient_id": pid, "encounter_date": day, "queue_number": qn,
           "queue_status": qs, "fhir_status": fs}
    out.update(s._encounter_fee_fields(payload))
    return out


DERIVE: dict[str, tuple[str, Callable[[dict[str, Any]], dict[str, Any]]]] = {
    "Patient": ("patient_index", s._patient_index_fields),
    "Encounter": ("encounter_index", _enc_fields),
    "Condition": ("condition_index", s._condition_index_fields),
    "MedicationRequest": ("medication_request_index", s._medication_request_index_fields),
    "Composition": ("clinical_note_index", s._clinical_note_index_fields),
    "Observation": ("observation_index", s._observation_index_fields),
    "AllergyIntolerance": ("allergy_index", s._allergy_index_fields),
    "Media": ("media_index", s._media_index_fields),
}

# Index-only Encounter columns and the reg key that may carry the same value.
ENC_CANDIDATES = {
    "reg_cc": "regCc", "reg_remark": "noteMark", "treat_seq": "treatSeq", "shift": "shift",
    "claim_doctor_id": "doctorId", "claim_pharmacist_id": "pharmacist", "case_no": "caseNo",
}

SKIP = {"resource_id", "updated_at"}


def _norm(v: Any) -> Any:
    if isinstance(v, str):
        v = v.strip()
        return v or None
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (int, float)):
        return float(v)
    return v


def report(db: Path, types: list[str]) -> None:
    conn = sqlite3.connect("file:" + str(db) + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    for rtype in types:
        table, derive = DERIVE[rtype]
        cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})") if r[1] not in SKIP]
        exact = Counter()
        soft = Counter()
        absent = Counter()
        nonnull_underived = Counter()
        cand_agree = Counter()
        cand_total = Counter()
        examples: dict[str, list[tuple[Any, Any]]] = defaultdict(list)
        n = no_index = 0
        derived_cols: set[str] = set()
        sql = (
            f"SELECT rc.payload_json AS _p, ix.* FROM resource_cache rc "
            f"LEFT JOIN {table} ix ON ix.resource_id = rc.resource_id "
            f"WHERE rc.resource_type = ?"
        )
        for row in conn.execute(sql, (rtype,)):
            n += 1
            if row["resource_id"] is None:
                no_index += 1
                continue
            try:
                payload = json.loads(row["_p"])
                got = derive(payload)
            except Exception:
                exact["<derive error>"] += 1
                continue
            derived_cols.update(got)
            for col in cols:
                want = row[col]
                if col not in got:
                    absent[col] += 1
                    if _norm(want) is not None:
                        nonnull_underived[col] += 1
                    continue
                g = got[col]
                if want == g:
                    continue
                if _norm(want) == _norm(g):
                    soft[col] += 1
                else:
                    exact[col] += 1
                    if len(examples[col]) < 3:
                        examples[col].append((type(want).__name__, type(g).__name__))
            if rtype == "Encounter":
                meta = extract_reg_meta(payload)
                for col, key in ENC_CANDIDATES.items():
                    if col in got or col not in row.keys():
                        continue
                    if _norm(row[col]) is None and _norm(meta.get(key)) is None:
                        continue
                    cand_total[col] += 1
                    if _norm(row[col]) == _norm(meta.get(key)):
                        cand_agree[col] += 1
        index_only = conn.execute(
            f"SELECT count(*) FROM {table} ix WHERE NOT EXISTS (SELECT 1 FROM resource_cache rc "
            f"WHERE rc.resource_type = ? AND rc.resource_id = ix.resource_id)",
            (rtype,),
        ).fetchone()[0]
        print(f"\n== {rtype} -> {table}: json {n}, json without index {no_index}, index without json {index_only}")
        for col in cols:
            if col in derived_cols:
                line = f"  {col:24s} derived   differ {exact[col]:>8}  blank/space {soft[col]:>8}"
                if absent[col]:
                    line += f"  key absent {absent[col]} (kept {nonnull_underived[col]} values)"
                if examples.get(col):
                    line += f"  types {examples[col][0]}"
                print(line)
            else:
                filled = conn.execute(
                    f"SELECT count(*) FROM {table} WHERE {col} IS NOT NULL AND trim(CAST({col} AS TEXT)) != ''"
                ).fetchone()[0]
                line = f"  {col:24s} NOT FROM JSON  rows with value {filled}"
                if col in cand_total:
                    line += f"  same as reg.{ENC_CANDIDATES[col]} {cand_agree[col]}/{cand_total[col]}"
                print(line)
        if exact.get("<derive error>"):
            print("  derive errors:", exact["<derive error>"])
    conn.close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", required=True, type=Path)
    ap.add_argument("--types", default=",".join(DERIVE))
    args = ap.parse_args()
    report(args.db, [t.strip() for t in args.types.split(",") if t.strip()])


if __name__ == "__main__":
    main()
