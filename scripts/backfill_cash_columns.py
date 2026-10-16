"""Copy cash-book amounts out of Encounter JSON onto encounter_index columns."""
from __future__ import annotations

import json
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.infrastructure.sqlite_shadow_store import (  # noqa: E402
    DEFAULT_DB_PATH,
    SqliteShadowStore,
    _encounter_fee_fields,
)

UPDATE_SQL = """
UPDATE encounter_index SET
    copay_code = ?,
    fee_deposit = ?,
    fee_copay = ?,
    fee_card_disc = ?,
    fee_drug_disc = ?,
    fee_reg = ?,
    fee_self = ?,
    fee_total = ?,
    fee_arrears = ?
WHERE resource_id = ?
"""


def main() -> None:
    SqliteShadowStore(DEFAULT_DB_PATH).initialize()
    read = sqlite3.connect(f"file:{DEFAULT_DB_PATH}?mode=ro", uri=True, timeout=60)
    write = sqlite3.connect(str(DEFAULT_DB_PATH), timeout=120)
    write.execute("PRAGMA busy_timeout=120000")
    ids = [
        row[0]
        for row in read.execute(
            "SELECT resource_id FROM encounter_index WHERE copay_code IS NULL"
        )
    ]
    print(f"todo {len(ids)}", flush=True)
    started = time.time()
    done = 0
    missing = 0
    for offset in range(0, len(ids), 400):
        chunk = ids[offset : offset + 400]
        marks = ",".join("?" * len(chunk))
        rows = read.execute(
            "SELECT resource_id, payload_json FROM resource_cache "
            f"WHERE resource_type = 'Encounter' AND resource_id IN ({marks})",
            chunk,
        ).fetchall()
        found = {row[0] for row in rows}
        missing += len(chunk) - len(found)
        updates = []
        for resource_id, raw in rows:
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                payload = {}
            fees = _encounter_fee_fields(payload)
            updates.append(
                (
                    fees["copay_code"],
                    fees["fee_deposit"],
                    fees["fee_copay"],
                    fees["fee_card_disc"],
                    fees["fee_drug_disc"],
                    fees["fee_reg"],
                    fees["fee_self"],
                    fees["fee_total"],
                    fees["fee_arrears"],
                    resource_id,
                )
            )
        if updates:
            write.executemany(UPDATE_SQL, updates)
            write.commit()
        done += len(updates)
        if done and done % 20000 < 400:
            print(f"done {done} {time.time() - started:.1f}s", flush=True)
    print(f"finished {done} missing {missing} {time.time() - started:.1f}s", flush=True)
    store = SqliteShadowStore(DEFAULT_DB_PATH)
    for label, start, end in (
        ("day", "2026-10-06", "2026-10-06"),
        ("q", "2026-07-06", "2026-10-06"),
    ):
        t1 = time.time()
        summary = store.cash_book_summary(start, end)
        elapsed = time.time() - t1
        people = sum(day["people"] for day in summary["days"])
        received = sum(day["received"] for day in summary["days"])
        returned = sum(day["returnSlip"] for day in summary["days"])
        total = sum(day["total"] for day in summary["days"])
        print(
            f"{label} {elapsed:.4f}s people {people} received {received} "
            f"return {returned} total {total} buckets {len(summary['buckets'])}",
            flush=True,
        )
        if label == "day":
            for bucket in summary["buckets"]:
                print(
                    f"  {bucket['code']} first {bucket['firstVisit']} "
                    f"revisit {bucket['revisit']} owe {bucket['missingCard']} "
                    f"return {bucket['returnCard']}",
                    flush=True,
                )


if __name__ == "__main__":
    main()
