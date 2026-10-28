"""Each host fetches the official drug catalog itself and installs the pack locally."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable

from hub import config

logger = logging.getLogger("drug_price_refresh")

RUNNING = "\u6b63\u5728\u5411\u5065\u4fdd\u7f72\u548c\u98df\u85e5\u7f72\u6293\u6574\u4efd\u85e5\u50f9\u3002"
INSTALLED = "\u5df2\u88dd\u9032\u67e5\u50f9\u3002"
SAME = "\u5b98\u65b9\u85e5\u50f9\u8ddf\u4e0a\u4e00\u7248\u4e00\u6a23\uff0c\u6cbf\u7528\u73fe\u5728\u9019\u4e00\u7248\u3002"
OVERDUE = "\u9019\u500b\u6708\u7684\u85e5\u50f9\u9084\u6c92\u66f4\u65b0\u6210\u3002"
FETCH_FAIL = "\u9019\u6b21\u6c92\u6709\u6293\u6210\uff0c\u4ecd\u7528\u4e0a\u4e00\u7248\u3002"
CHECKSUM_FAIL = "\u85e5\u50f9\u5305\u7684\u6aa2\u67e5\u78bc\u6c92\u904e\uff0c\u6c92\u6709\u88dd\u9032\u67e5\u50f9\uff0c\u4ecd\u7528\u4e0a\u4e00\u7248\u3002"
INTERRUPTED = "\u4e0a\u6b21\u6c92\u6709\u505a\u5b8c\uff0c\u4ecd\u7528\u4e0a\u4e00\u7248\u3002"
OK_MONTH = "\u9019\u500b\u6708\u5df2\u5c0d\u904e\u5b98\u65b9\u85e5\u50f9\u3002"

_lock = threading.Lock()
_running = False
_worker_on = False
_worker_task: asyncio.Task | None = None


def state_path() -> Path:
    return config.WORKSPACE / "refresh_state.json"


def is_due(state: dict[str, Any], today: date) -> bool:
    """A finished check in this calendar month is enough. A failed try waits until tomorrow."""
    success_on = str(state.get("lastSuccessOn") or "")
    if len(success_on) >= 7 and success_on[:7] == f"{today.year:04d}-{today.month:02d}":
        return False
    attempt = str(state.get("lastAttemptOn") or "")
    status = str(state.get("status") or "")
    if attempt == today.isoformat() and status in ("blocked_event", "failed"):
        return False
    return True


def plain_block(message: str) -> str:
    text = message or ""
    parts: list[str] = []
    if "EMPTY_CURRENT" in text or "CATALOG_TOO_SMALL" in text or "FETCH_EMPTY" in text:
        parts.append("\u6574\u4efd\u592a\u5c11\u6216\u662f\u7a7a\u7684")
    if "CATALOG_WIPED" in text:
        parts.append("\u5169\u6210\u4ee5\u4e0a\u7684\u85e5\u4e0d\u898b\u4e86")
    if "PRICE_SPIKE" in text:
        parts.append("\u6709\u4e00\u7b46\u50f9\u683c\u8df3\u4e86\u5169\u500d\u4ee5\u4e0a")
    if not parts:
        parts.append("\u6a94\u6848\u770b\u8d77\u4f86\u4e0d\u5c0d")
    return "\u9019\u6b21\u6c92\u6709\u88dd\u4e0a\uff0c\u4ecd\u7528\u4e0a\u4e00\u7248\u3002" + "\u3001".join(parts) + "\u3002"


def public_view(state: dict[str, Any], today: date) -> dict[str, Any]:
    status = str(state.get("status") or "idle")
    success_on = str(state.get("lastSuccessOn") or "")
    this_month = len(success_on) >= 7 and success_on[:7] == f"{today.year:04d}-{today.month:02d}"
    detail = str(state.get("detail") or "")
    if status == "running":
        notice = RUNNING
    elif status in ("blocked_event", "failed"):
        notice = detail or FETCH_FAIL
    elif not this_month:
        notice = OVERDUE
    else:
        notice = ""
    return {
        "running": status == "running",
        "status": status,
        "version": str(state.get("version") or ""),
        "lastSuccessOn": success_on,
        "notice": notice,
        "detail": notice or detail or OK_MONTH,
    }


def apply_pipeline_result(
    state: dict[str, Any],
    result: dict[str, Any],
    *,
    today: date,
    install: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    new = dict(state)
    new["lastAttemptOn"] = today.isoformat()
    new["finishedAt"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    status = str(result.get("status") or "")
    if status == "success":
        installed = install()
        if str(installed.get("status") or "") not in ("success", "skipped_up_to_date"):
            new["status"] = "failed"
            new["detail"] = CHECKSUM_FAIL
            return new
        new["status"] = "success"
        new["lastSuccessOn"] = today.isoformat()
        new["version"] = str(
            installed.get("installedVersion")
            or result.get("publishedVersion")
            or new.get("version")
            or ""
        )
        new["detail"] = INSTALLED
        return new
    if status == "skipped_no_change":
        new["status"] = "skipped_no_change"
        new["lastSuccessOn"] = today.isoformat()
        new["detail"] = SAME
        return new
    if status == "blocked_event":
        new["status"] = "blocked_event"
        new["detail"] = plain_block(str(result.get("errorMessage") or ""))
        return new
    new["status"] = "failed"
    new["detail"] = FETCH_FAIL
    return new


def load_state(path: Path | None = None) -> dict[str, Any]:
    target = path or state_path()
    try:
        data = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def save_state(state: dict[str, Any], path: Path | None = None) -> None:
    target = path or state_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def describe(path: Path | None = None, today: date | None = None) -> dict[str, Any]:
    view = public_view(load_state(path), today or date.today())
    if view["version"]:
        return view
    try:
        from src.spoke.pack_store import PackStore

        store = PackStore()
        store.initialize()
        view["version"] = store.latest_active_version() or ""
    except Exception:
        logger.debug("installed pack version unavailable", exc_info=True)
    return view


def recover_interrupted(path: Path | None = None) -> None:
    with _lock:
        state = load_state(path)
        if state.get("status") != "running":
            return
        state["status"] = "failed"
        state["detail"] = INTERRUPTED
        state["lastAttemptOn"] = str(state.get("lastAttemptOn") or date.today().isoformat())
        state["finishedAt"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        save_state(state, path)


def _install_published() -> dict[str, Any]:
    from src.spoke.drug_price import clear_price_cache
    from src.spoke.hydrator import PackHydrator

    result = asyncio.run(PackHydrator().run_once())
    body = result.to_dict()
    if body.get("status") in ("success", "skipped_up_to_date"):
        clear_price_cache()
    return body


def _execute(path: Path | None) -> None:
    from hub.pipeline import run_hub_pipeline

    try:
        result = run_hub_pipeline()
    except Exception:
        logger.exception("drug price fetch failed")
        result = {"status": "failed", "errorMessage": "fetch"}
    installed: dict[str, Any] | None = None
    if str(result.get("status") or "") == "success":
        try:
            installed = _install_published()
        except Exception:
            logger.exception("drug price install failed")
            installed = {"status": "failed"}
    with _lock:
        previous = load_state(path)
        updated = apply_pipeline_result(
            previous,
            result,
            today=date.today(),
            install=lambda: installed if installed is not None else {"status": "failed"},
        )
        save_state(updated, path)


def start_refresh(*, force: bool = False, path: Path | None = None) -> dict[str, Any]:
    global _running
    with _lock:
        state = load_state(path)
        if _running:
            return describe(path)
        if not force and not is_due(state, date.today()):
            return describe(path)
        state["status"] = "running"
        state["startedAt"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        state["detail"] = RUNNING
        save_state(state, path)
        _running = True
        view = describe(path)

    def _thread() -> None:
        global _running
        try:
            _execute(path)
        finally:
            with _lock:
                _running = False

    threading.Thread(target=_thread, name="drug-price-refresh", daemon=True).start()
    return view


def _auto_enabled() -> bool:
    return os.environ.get("DRUG_PRICE_AUTO", "1").strip() not in ("0", "false", "False")


async def _loop() -> None:
    await asyncio.sleep(45)
    if not _worker_on:
        return
    await asyncio.to_thread(recover_interrupted)
    while _worker_on:
        try:
            await asyncio.to_thread(start_refresh, force=False)
        except Exception:
            logger.exception("scheduled drug price refresh failed")
        await asyncio.sleep(3600)


def start_drug_price_worker() -> None:
    global _worker_on, _worker_task
    if not _auto_enabled() or _worker_on:
        return
    _worker_on = True
    _worker_task = asyncio.create_task(_loop())
    logger.info("Drug price refresh worker started")


def stop_drug_price_worker() -> None:
    global _worker_on, _worker_task
    _worker_on = False
    if _worker_task is not None:
        _worker_task.cancel()
        _worker_task = None
