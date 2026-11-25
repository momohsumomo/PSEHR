"""Hold the API start until the chart DB carries the format this program needs.

After a program update the new version refuses an unconverted DB. Instead of
crashing once and staying down, host_service runs this first: it checks once a
minute and returns when the converted DB is in place, so the API comes up by
itself after the swap. Each check opens the file immutable (no locks, no -wal or
-shm files) and closes it at once, so moving or renaming shadow.db is never blocked.
"""

from __future__ import annotations

import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.infrastructure.sqlite_shadow_store import (  # noqa: E402
    DEFAULT_DB_PATH,
    FHIR_FORMAT,
    FHIR_FORMAT_KEY,
)

WAIT_SECONDS = 60


def ready(db: Path) -> bool:
    if not db.is_file():
        return True
    try:
        conn = sqlite3.connect(f"file:{db.as_posix()}?mode=ro&immutable=1", uri=True)
    except sqlite3.Error:
        return True
    try:
        try:
            row = conn.execute(
                "SELECT value FROM clinic_runtime_settings WHERE key = ?", (FHIR_FORMAT_KEY,)
            ).fetchone()
        except sqlite3.Error:
            row = None
        if row and row[0] == FHIR_FORMAT:
            return True
        for table in ("resource_cache", "encounter_index"):
            try:
                if conn.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone():
                    return False
            except sqlite3.Error:
                continue
        return True
    finally:
        conn.close()


def main() -> None:
    db = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DB_PATH
    said = False
    while not ready(db):
        if not said:
            stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            print(f"{stamp} chart DB is not in FHIR format {FHIR_FORMAT}; waiting for the converted file", flush=True)
            said = True
        time.sleep(WAIT_SECONDS)
    if said:
        print(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} chart DB ready; starting the API", flush=True)


if __name__ == "__main__":
    main()
