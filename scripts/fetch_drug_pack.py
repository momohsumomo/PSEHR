"""Download the latest drug-pack Release into data/hub_packages."""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "data" / "hub_packages"
REPO = os.environ.get("WUNDADI_PACK_REPO", "momohsumomo/wundadi")


def main() -> int:
    url = f"https://api.github.com/repos/{REPO}/releases/latest"
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "wundadi-drug-pack"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            release = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        print("\u6293\u4e0d\u5230\u85e5\u50f9\u5305\u3002GitHub \u4e0a\u9084\u6c92\u6709 Release\uff0c\u6216\u9023\u7dda\u5931\u6557\u3002")
        print(exc)
        return 1
    assets = [a for a in release.get("assets") or [] if str(a.get("name") or "").endswith(".json")]
    if not assets:
        print("\u6700\u65b0\u7684 Release \u88e1\u6c92\u6709\u85e5\u50f9\u6a94\u3002")
        return 1
    DEST.mkdir(parents=True, exist_ok=True)
    for asset in assets:
        name = str(asset["name"])
        target = DEST / name
        urllib.request.urlretrieve(asset["browser_download_url"], target)
        print(name, target.stat().st_size)
    print("\u5df2\u653e\u9032", DEST)
    print("\u8acb\u91cd\u65b0\u555f\u52d5\u9580\u8a3a\uff0c\u85e5\u50f9\u624d\u6703\u88dd\u9032\u67e5\u50f9\u3002")
    print(release.get("tag_name") or "")
    return 0


if __name__ == "__main__":
    sys.exit(main())
