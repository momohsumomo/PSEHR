"""Hub workspace：snapshot、run 紀錄、事件通知檔。"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from hub import config


def _utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def ensure_dirs() -> None:
    config.WORKSPACE.mkdir(parents=True, exist_ok=True)
    (config.WORKSPACE / "snapshots").mkdir(parents=True, exist_ok=True)
    (config.WORKSPACE / "runs").mkdir(parents=True, exist_ok=True)
    (config.WORKSPACE / "events").mkdir(parents=True, exist_ok=True)
    config.PUBLISH_DIR.mkdir(parents=True, exist_ok=True)


def snapshot_path() -> Path:
    return config.WORKSPACE / "snapshots" / "drugs_latest.json"


def load_previous_snapshot() -> dict[str, dict[str, Any]]:
    path = snapshot_path()
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = data.get("rows") or {}
    return rows


def save_snapshot(rows: dict[str, dict[str, Any]], meta: dict[str, Any]) -> Path:
    path = snapshot_path()
    payload = {"savedAt": _utc(), "meta": meta, "rows": rows}
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    # 另存帶時間戳備份
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    bak = config.WORKSPACE / "snapshots" / f"drugs_{stamp}.json"
    bak.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    return path


def write_run(run: dict[str, Any]) -> Path:
    ensure_dirs()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = config.WORKSPACE / "runs" / f"run_{stamp}.json"
    path.write_text(json.dumps(run, ensure_ascii=False, indent=2), encoding="utf-8")
    latest = config.WORKSPACE / "runs" / "latest.json"
    latest.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    return path


def emit_event(kind: str, title: str, body: dict[str, Any]) -> Path:
    """事件觸發通知：寫入 events/ 並回傳路徑（之後可接 email/LINE）。"""
    ensure_dirs()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = config.WORKSPACE / "events" / f"{stamp}_{kind}.json"
    payload = {"at": _utc(), "kind": kind, "title": title, "body": body}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    latest = config.WORKSPACE / "events" / "latest.json"
    latest.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    return path
