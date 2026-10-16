# -*- coding: utf-8 -*-
"""Go-live cutover: enable modification audit (wipe pre-prod noise by default).

Usage:
  python scripts/enable_audit_go_live.py
  python scripts/enable_audit_go_live.py --keep-history
  python scripts/enable_audit_go_live.py --status
  python scripts/enable_audit_go_live.py --disable
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.infrastructure.sqlite_shadow_store import DEFAULT_DB_PATH, SqliteShadowStore


def main() -> int:
    parser = argparse.ArgumentParser(description="Enable audit recording at go-live")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH), help="shadow.db path")
    parser.add_argument("--status", action="store_true", help="Print status only")
    parser.add_argument(
        "--keep-history",
        action="store_true",
        help="Do not wipe existing audit_modifications rows",
    )
    parser.add_argument(
        "--disable",
        action="store_true",
        help="Disable recording (dev/drill only; keep history)",
    )
    parser.add_argument("--yes", action="store_true", help="Skip confirmation")
    args = parser.parse_args()

    store = SqliteShadowStore(args.db_path)
    store.initialize()

    if args.status:
        print(json.dumps(store.get_audit_status(), ensure_ascii=False, indent=2))
        return 0

    if args.disable:
        status = store.disable_audit_recording()
        print("Audit recording DISABLED (dev/drill).")
        print(json.dumps(status, ensure_ascii=False, indent=2))
        return 0

    wipe = not args.keep_history
    if not args.yes:
        print(f"DB: {args.db_path}")
        print("Will ENABLE modification audit (accountability).")
        print(f"Wipe pre-go-live audit rows: {'YES' if wipe else 'NO'}")
        ans = input("Type YES to continue: ").strip()
        if ans != "YES":
            print("Cancelled.")
            return 1

    status = store.enable_audit_go_live(wipe_existing=wipe)
    print("Audit recording ENABLED (go-live).")
    print(json.dumps(status, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
