"""Empty every table derived from FHIR, rebuild it from resource_cache only, compare.

  python scripts/rebuild_from_fhir.py --db CONVERTED_COPY.db

Runs inside one transaction that is always rolled back, so even the copy is
left as it was. Prints, per table, rows before / after and how many rows are
only in the old table or only in the rebuilt one (counts only, no patient
data). Completion standard: every count of "only old" and "only rebuilt" is 0.

Not from FHIR by design: clinic_staff.pin (security setting) is put back from
the old row; cash_return.id is a local row number and is not compared.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.fhir_convert import _bound, _inside_repo, _is_remote  # noqa: E402
from src.core.side_records import SPECS, from_resource  # noqa: E402
from src.infrastructure import sqlite_shadow_store as s  # noqa: E402

ORDER = ["Patient", "Encounter", "Condition", "MedicationRequest", "Composition",
         "Observation", "AllergyIntolerance", "Media", "Basic",
         "DocumentReference", "ServiceRequest", "DiagnosticReport", "Practitioner"]
SKIP_COLS = {"cash_return": {"id"}}


def _tables(conn: sqlite3.Connection) -> list[str]:
    want = list(s.INDEX_TABLE_FOR.values()) + ["cash_return"] + list(SPECS)
    have = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    return [t for t in want if t in have]


def _cols(conn: sqlite3.Connection, table: str) -> list[str]:
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table})") if r[1] not in SKIP_COLS.get(table, set())]


def _derive(store: s.SqliteShadowStore, conn: sqlite3.Connection, rtype: str, rid: str, payload: dict, pins: dict) -> None:
    if rtype == "Practitioner":
        found = from_resource(payload)
        if found:
            store._local.side_table_only = {"pin": pins.get(found[1].get("id"))}
    try:
        if store._upsert_side_row(conn, payload):
            return
    finally:
        store._local.side_table_only = None
    upsert = {
        "Patient": lambda: store._upsert_patient_index(conn, rid, payload, check_keys=False),
        "Encounter": lambda: store._upsert_encounter_index(conn, rid, payload),
        "Condition": lambda: store._upsert_condition_index(conn, rid, payload),
        "MedicationRequest": lambda: store._upsert_medication_request_index(conn, rid, payload),
        "Composition": lambda: store._upsert_clinical_note_index(conn, rid, payload),
        "Observation": lambda: store._upsert_observation_index(conn, rid, payload),
        "AllergyIntolerance": lambda: store._upsert_allergy_index(conn, rid, payload),
        "Media": lambda: store._upsert_media_index(conn, rid, payload),
        "Basic": lambda: store._upsert_cash_return_index(conn, rid, payload),
    }.get(rtype)
    if upsert is not None:
        upsert()
        s._sync_index_time(conn, rtype, rid, payload)


def run(db: Path) -> int:
    store = s.SqliteShadowStore(db)
    conn = sqlite3.connect(str(db), isolation_level=None)
    conn.row_factory = sqlite3.Row
    store._connect = _bound(conn)
    conn.execute("BEGIN")
    started = time.time()
    try:
        tables = _tables(conn)
        before = {}
        pins = {}
        if "clinic_staff" in tables:
            pins = {r["id"]: r["pin"] for r in conn.execute("SELECT id, pin FROM clinic_staff")}
        for t in tables:
            cols = ", ".join(_cols(conn, t))
            conn.execute(f"CREATE TEMP TABLE snap_{t} AS SELECT {cols} FROM {t}")
            before[t] = conn.execute(f"SELECT COUNT(*) FROM snap_{t}").fetchone()[0]
            conn.execute(f"DELETE FROM {t}")
        print(f"emptied {len(tables)} tables")
        for rtype in ORDER:
            ids = [r[0] for r in conn.execute("SELECT resource_id FROM resource_cache WHERE resource_type = ?", (rtype,))]
            for i in range(0, len(ids), 2000):
                chunk = ids[i : i + 2000]
                marks = ",".join("?" * len(chunk))
                for rid, text in conn.execute(
                    f"SELECT resource_id, payload_json FROM resource_cache WHERE resource_type = ? AND resource_id IN ({marks})",
                    (rtype, *chunk),
                ).fetchall():
                    _derive(store, conn, rtype, rid, json.loads(text), pins)
            print(f"  rebuilt from {rtype}: {len(ids)}", flush=True)
        bad = 0
        print(f"\n{'table':28s} {'before':>9} {'after':>9} {'only old':>9} {'only new':>9}")
        for t in tables:
            cols = ", ".join(_cols(conn, t))
            after = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            only_old = conn.execute(f"SELECT COUNT(*) FROM (SELECT {cols} FROM snap_{t} EXCEPT SELECT {cols} FROM {t})").fetchone()[0]
            only_new = conn.execute(f"SELECT COUNT(*) FROM (SELECT {cols} FROM {t} EXCEPT SELECT {cols} FROM snap_{t})").fetchone()[0]
            bad += only_old + only_new + (before[t] != after)
            print(f"{t:28s} {before[t]:>9} {after:>9} {only_old:>9} {only_new:>9}")
        print(f"\n{'IDENTICAL' if not bad else 'DIFFERENT'} ({int(time.time() - started)}s)")
        return 0 if not bad else 1
    finally:
        conn.execute("ROLLBACK")
        conn.close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", required=True, type=Path)
    args = ap.parse_args()
    if not args.db.is_file():
        sys.exit(f"not found: {args.db}")
    if _is_remote(args.db):
        sys.exit("refused: DB is on a network path; copy it locally first")
    if _inside_repo(args.db):
        sys.exit("refused: DB is inside the repo")
    sys.exit(run(args.db))


if __name__ == "__main__":
    main()
