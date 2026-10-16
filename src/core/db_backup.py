# -*- coding: utf-8 -*-
"""Back up the shadow database (data/shadow.db) while the clinic keeps working.

SQLite's online backup copies one consistent snapshot. The database runs in WAL
mode, so registration and charting can keep writing during the copy.
Files land as shadow-YYYYMMDD-HHMMSS.db in the chosen folder; older copies
beyond `keep` are removed (only files this module named).
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

SETTINGS_KEY = "backup_settings_v1"
DEFAULT_KEEP = 7
NAME_RE = re.compile(r"^shadow-(\d{8})-(\d{6})\.db$")
SETTINGS_RE = re.compile(r"^shadow-(\d{8})-(\d{6})\.settings\.json$")


@dataclass
class BackupState:
    running: bool = False
    started_at: str = ""
    finished_at: str = ""
    ok: bool | None = None
    message: str = ""
    file: str = ""
    bytes: int = 0
    seconds: float = 0.0
    removed: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "running": self.running,
            "startedAt": self.started_at,
            "finishedAt": self.finished_at,
            "ok": self.ok,
            "message": self.message,
            "file": self.file,
            "bytes": self.bytes,
            "seconds": round(self.seconds, 1),
            "removed": list(self.removed),
        }


_state = BackupState()
_lock = threading.Lock()


def default_backup_dir(db_path: Path) -> Path:
    return db_path.parent / "backups"


def load_settings(store: Any) -> dict[str, Any]:
    raw = store.get_json_setting(SETTINGS_KEY) or {}
    db_path = Path(store.db_path)
    folder = str(raw.get("dir") or "").strip() or str(default_backup_dir(db_path))
    try:
        keep = int(raw.get("keep") or DEFAULT_KEEP)
    except (TypeError, ValueError):
        keep = DEFAULT_KEEP
    return {"dir": folder, "keep": max(1, min(keep, 60)), "lastOk": raw.get("lastOk") or None}


def save_settings(store: Any, folder: str, keep: int) -> dict[str, Any]:
    current = store.get_json_setting(SETTINGS_KEY) or {}
    folder = (folder or "").strip()
    if folder:
        path = Path(folder)
        if not path.is_absolute():
            raise ValueError("備份資料夾要寫完整路徑，例如 D:\\Wundadi備份 或 E:\\備份。")
    current["dir"] = folder
    current["keep"] = max(1, min(int(keep or DEFAULT_KEEP), 60))
    store.set_json_setting(SETTINGS_KEY, current)
    return load_settings(store)


def list_backups(folder: str | Path) -> list[dict[str, Any]]:
    path = Path(folder)
    if not path.is_dir():
        return []
    out = []
    for item in path.iterdir():
        if not item.is_file() or not (NAME_RE.match(item.name) or SETTINGS_RE.match(item.name)):
            continue
        st = item.stat()
        out.append(
            {
                "name": item.name,
                "bytes": st.st_size,
                "modifiedAt": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
            }
        )
    out.sort(key=lambda r: r["name"], reverse=True)
    return out


def _same_drive(a: Path, b: Path) -> bool:
    try:
        return os.path.splitdrive(str(a.resolve()))[0].upper() == os.path.splitdrive(str(b.resolve()))[0].upper()
    except OSError:
        return False


def describe(store: Any) -> dict[str, Any]:
    settings = load_settings(store)
    db_path = Path(store.db_path)
    folder = Path(settings["dir"])
    free = None
    try:
        probe = folder if folder.exists() else folder.parent
        free = shutil.disk_usage(probe).free
    except OSError:
        pass
    db_bytes = db_path.stat().st_size if db_path.is_file() else 0
    return {
        "settings": settings,
        "dbPath": str(db_path),
        "dbBytes": db_bytes,
        "freeBytes": free,
        "sameDrive": _same_drive(folder, db_path),
        "files": list_backups(folder),
        "state": _state.to_dict(),
    }


def _rotate(folder: Path, keep: int) -> list[str]:
    files = sorted((p for p in folder.iterdir() if p.is_file() and NAME_RE.match(p.name)), key=lambda p: p.name)
    removed: list[str] = []
    while len(files) > keep:
        old = files.pop(0)
        try:
            old.unlink()
            removed.append(old.name)
        except OSError:
            break
        side = folder / old.name.replace(".db", ".settings.json")
        if side.is_file():
            try:
                side.unlink()
                removed.append(side.name)
            except OSError:
                pass
    return removed


def _settings_sidecar(db_path: Path, browser: dict[str, Any] | None) -> dict[str, Any]:
    """Human-readable copy of server settings plus this computer's screen settings.

    The database file already holds patients, visits, orders, staff, and these
    server settings. The sidecar is so a restore can see them without opening sqlite.
    """
    runtime: dict[str, Any] = {}
    try:
        conn = sqlite3.connect(str(db_path))
        try:
            rows = conn.execute("SELECT key, value FROM clinic_runtime_settings").fetchall()
        finally:
            conn.close()
        for key, raw in rows:
            try:
                runtime[str(key)] = json.loads(raw) if raw else None
            except (TypeError, ValueError):
                runtime[str(key)] = raw
    except sqlite3.Error:
        runtime = {}
    return {
        "savedAt": datetime.now().isoformat(timespec="seconds"),
        "database": str(db_path),
        "contains": [
            "patients",
            "visits",
            "diagnoses",
            "orders",
            "staff",
            "runtime-settings",
        ],
        "runtimeSettings": runtime,
        "browserSettings": browser or {},
    }


def run_backup(
    db_path: Path,
    folder: Path,
    keep: int,
    browser_settings: dict[str, Any] | None = None,
) -> BackupState:
    """Blocking copy. Callers use start_backup() for the background version."""
    started = time.monotonic()
    result = BackupState(running=False, started_at=datetime.now().isoformat(timespec="seconds"))
    tmp: Path | None = None
    try:
        if not db_path.is_file():
            raise RuntimeError(f"找不到資料庫：{db_path}")
        folder.mkdir(parents=True, exist_ok=True)
        need = db_path.stat().st_size
        free = shutil.disk_usage(folder).free
        if free < need * 1.1:
            raise RuntimeError(
                f"備份位置空間不夠：需要約 {need / 1e9:.1f} GB，只剩 {free / 1e9:.1f} GB。請換位置或刪舊備份。"
            )
        name = f"shadow-{datetime.now():%Y%m%d-%H%M%S}.db"
        final = folder / name
        tmp = folder / (name + ".partial")
        src = sqlite3.connect(str(db_path), timeout=30)
        try:
            dst = sqlite3.connect(str(tmp))
            try:
                src.backup(dst)
                row = dst.execute("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'").fetchone()
                if not row or int(row[0]) == 0:
                    raise RuntimeError("備份檔裡沒有資料表，已放棄這份備份。")
            finally:
                dst.close()
        finally:
            src.close()
        os.replace(tmp, final)
        tmp = None
        side = folder / final.name.replace(".db", ".settings.json")
        side.write_text(
            json.dumps(_settings_sidecar(db_path, browser_settings), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        result.file = str(final)
        result.bytes = final.stat().st_size + side.stat().st_size
        result.removed = _rotate(folder, keep)
        result.ok = True
        result.message = f"已備份到 {final}"
    except Exception as exc:  # noqa: BLE001 — every failure must reach the screen
        result.ok = False
        result.message = str(exc) or exc.__class__.__name__
        if tmp is not None:
            try:
                tmp.unlink()
            except OSError:
                pass
    result.seconds = time.monotonic() - started
    result.finished_at = datetime.now().isoformat(timespec="seconds")
    return result


def start_backup(store: Any, browser_settings: dict[str, Any] | None = None) -> dict[str, Any]:
    global _state
    with _lock:
        if _state.running:
            return _state.to_dict()
        settings = load_settings(store)
        _state = BackupState(running=True, started_at=datetime.now().isoformat(timespec="seconds"), message="備份中…")
        db_path = Path(store.db_path)
        folder = Path(settings["dir"])
        keep = int(settings["keep"])

    def work() -> None:
        global _state
        result = run_backup(db_path, folder, keep, browser_settings)
        with _lock:
            _state = result
        if result.ok:
            try:
                current = store.get_json_setting(SETTINGS_KEY) or {}
                current["lastOk"] = {"at": result.finished_at, "file": result.file, "bytes": result.bytes}
                store.set_json_setting(SETTINGS_KEY, current)
            except Exception:
                pass

    threading.Thread(target=work, name="wundadi-backup", daemon=True).start()
    return _state.to_dict()
