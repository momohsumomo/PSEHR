"""Download the latest drug-pack Release into the local Hub folder."""

from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path

from src.core.github_release import pick_release

REPO = os.environ.get("PSEHR_PACK_REPO", "momohsumomo/PSEHR")


def download_latest(dest: Path, repo: str | None = None) -> dict:
    repo_name = (repo or REPO).strip()
    url = f"https://api.github.com/repos/{repo_name}/releases?per_page=30"
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "psehr-drug-pack"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            listed = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        raise RuntimeError(
            "\u6293\u4e0d\u5230\u85e5\u50f9\u5305\u3002GitHub \u4e0a\u9084\u6c92\u6709 Release\uff0c\u6216\u9023\u7dda\u5931\u6557\u3002"
        ) from exc
    if not isinstance(listed, list):
        listed = []
    release = pick_release(listed, "drug-pack-")
    if not release:
        raise RuntimeError(
            "\u6293\u4e0d\u5230\u85e5\u50f9\u5305\u3002GitHub \u4e0a\u9084\u6c92\u6709 Release\uff0c\u6216\u9023\u7dda\u5931\u6557\u3002"
        )
    assets = [a for a in release.get("assets") or [] if str(a.get("name") or "").endswith(".json")]
    if not assets:
        raise RuntimeError("\u6700\u65b0\u7684 Release \u88e1\u6c92\u6709\u85e5\u50f9\u6a94\u3002")
    dest.mkdir(parents=True, exist_ok=True)
    names: list[str] = []
    for asset in assets:
        name = str(asset["name"])
        target = dest / name
        urllib.request.urlretrieve(asset["browser_download_url"], target)
        names.append(name)
    return {"tag": str(release.get("tag_name") or ""), "files": names, "dir": str(dest)}
