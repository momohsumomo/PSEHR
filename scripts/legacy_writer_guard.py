"""Stop old import / backfill / repair scripts on a DB already in the final FHIR format.

Those scripts write index tables or old URLs directly, so on a converted DB the
tables would no longer match FHIR. Each one calls refuse_on_final_db() first
thing under __main__. A script is allowed again once it writes through the
store (cache_resource / put_side_row) and drops the call.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_DB_FLAGS = ("--db", "--db-path", "--shadow", "--shadow-db", "--database")


def _targets(argv: list[str]) -> list[Path]:
    found: list[Path] = []
    for i, arg in enumerate(argv):
        for flag in _DB_FLAGS:
            if arg == flag and i + 1 < len(argv):
                found.append(Path(argv[i + 1]))
            elif arg.startswith(flag + "="):
                found.append(Path(arg.split("=", 1)[1]))
    return found or [ROOT / "data" / "shadow.db"]


def is_final(db: Path) -> bool:
    if not db.is_file():
        return False
    conn = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
    try:
        row = conn.execute("SELECT value FROM clinic_runtime_settings WHERE key = 'fhir_format' LIMIT 1").fetchone()
    except sqlite3.OperationalError:
        return False
    finally:
        conn.close()
    return bool(row and row[0])


def refuse_on_final_db(argv: list[str] | None = None) -> None:
    for db in _targets(list(sys.argv[1:] if argv is None else argv)):
        if is_final(db):
            sys.exit(
                f"refused: {db} is already in the final FHIR format and this script writes the old way. "
                "Rewrite it to save through the store before running it."
            )
