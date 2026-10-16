"""Hub CLI：python -m hub.run [--limit N]"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from hub.pipeline import run_hub_pipeline


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Wundadi Hub：健保用藥開放資料 → Pack 發布")
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="測試用拉取筆數；不設則用環境 HUB_FETCH_LIMIT（0=全量）",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    result = run_hub_pipeline(fetch_limit=args.limit)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result["status"] in ("success", "skipped_no_change"):
        return 0
    # blocked_event 也算「管線有依契約完成」，exit 2 方便排程偵測
    if result["status"] == "blocked_event":
        return 2
    return 1


if __name__ == "__main__":
    sys.exit(main())
