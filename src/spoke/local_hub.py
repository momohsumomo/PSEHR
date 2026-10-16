"""開發／無遠端 Hub 時：以本機目錄充當 Hub 發布區。"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

DEFAULT_HUB_DIR = Path(__file__).resolve().parents[2] / "data" / "hub_packages"


def hub_packages_dir() -> Path:
    override = os.environ.get("HUB_PACKAGES_DIR", "").strip()
    return Path(override) if override else DEFAULT_HUB_DIR


def hub_packages_url() -> str:
    return os.environ.get("HUB_PACKAGES_URL", "").strip()


def list_local_manifest(hub_dir: Path | None = None) -> list[dict[str, Any]]:
    root = hub_dir or hub_packages_dir()
    if not root.is_dir():
        return []
    items: list[dict[str, Any]] = []
    for path in sorted(root.glob("*.json")):
        if path.name.startswith("_") or path.name.endswith(".summary.json"):
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        # 略過摘要檔／非 Pack（缺 checksum 或 resources）
        if not data.get("checksumSha256") or "resources" not in data:
            continue
        items.append(
            {
                "version": data.get("version") or path.stem,
                "effectiveFrom": data.get("effectiveFrom"),
                "effectiveTo": data.get("effectiveTo"),
                "checksumSha256": data.get("checksumSha256"),
                "publishedAt": data.get("publishedAt"),
                "publishMode": data.get("publishMode"),
                "path": str(path),
            }
        )
    # 新版在前（字串版本粗排；正式 Hub 應給排序好的清單）
    items.sort(key=lambda x: (str(x.get("effectiveFrom") or ""), str(x.get("version") or "")), reverse=True)
    return items


def load_local_pack(version: str, hub_dir: Path | None = None) -> dict[str, Any] | None:
    root = hub_dir or hub_packages_dir()
    direct = root / f"{version}.json"
    if direct.is_file():
        return json.loads(direct.read_text(encoding="utf-8"))
    for path in root.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if data.get("version") == version:
            return data
    return None
