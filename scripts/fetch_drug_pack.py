"""Download the latest drug-pack Release into data/hub_packages."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.core.drug_pack_fetch import download_latest

DEST = ROOT / "data" / "hub_packages"


def main() -> int:
    try:
        got = download_latest(DEST)
    except RuntimeError as exc:
        print(exc)
        return 1
    print("\u5df2\u653e\u9032", got["dir"])
    print(got["tag"])
    for name in got["files"]:
        print(name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
