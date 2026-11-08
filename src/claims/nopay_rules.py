"""NHI non-payment indicator rules.

The program ships rules/nopay_indicators.json. A newer copy is fetched from GitHub
when the clinic refreshes drug prices; the newer valid version wins.
"""

from __future__ import annotations

import json
import logging
from datetime import date
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

REPO = "momohsumomo/PSEHR"
RAW_URL = f"https://raw.githubusercontent.com/{REPO}/main/rules/nopay_indicators.json"
BUNDLED = Path(__file__).resolve().parents[2] / "rules" / "nopay_indicators.json"
KINDS = {"rate", "cap", "rx_dup", "external"}
SCHEMA = 1


def downloaded_path() -> Path:
    from hub import config

    return config.WORKSPACE / "nopay_indicators.json"


def validate(doc: Any) -> str:
    """Empty when usable; otherwise why not."""
    if not isinstance(doc, dict):
        return "not an object"
    if doc.get("schema") != SCHEMA:
        return f"schema {doc.get('schema')!r}"
    if not str(doc.get("version") or "").strip():
        return "no version"
    rows = doc.get("indicators")
    if not isinstance(rows, list) or not rows:
        return "no indicators"
    for row in rows:
        if not isinstance(row, dict) or not row.get("id") or not row.get("name"):
            return "indicator without id or name"
        if row.get("kind") not in KINDS:
            return f"unknown kind {row.get('kind')!r} in {row.get('id')}"
        if row["kind"] == "rate":
            try:
                threshold = float(row.get("threshold"))
            except (TypeError, ValueError):
                return f"bad threshold in {row['id']}"
            if not 0 <= threshold <= 1:
                return f"threshold out of range in {row['id']}"
        if row["kind"] == "cap" and not isinstance(row.get("cap"), int):
            return f"bad cap in {row['id']}"
    return ""


def _read(path: Path) -> dict[str, Any] | None:
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return doc if not validate(doc) else None


def load_rules() -> dict[str, Any]:
    bundled = _read(BUNDLED) or {"schema": SCHEMA, "version": "", "indicators": []}
    try:
        fetched = _read(downloaded_path())
    except Exception:
        fetched = None
    if fetched and str(fetched["version"]) > str(bundled.get("version") or ""):
        return fetched
    return bundled


def refresh_from_github(timeout: float = 20.0) -> dict[str, Any]:
    """Fetch the central rules. Keeps the current ones on any failure."""
    import httpx

    today = date.today().isoformat()
    current = str(load_rules().get("version") or "")
    try:
        resp = httpx.get(RAW_URL, timeout=timeout, follow_redirects=True)
        resp.raise_for_status()
        doc = resp.json()
    except Exception as exc:
        logger.warning("nopay rules fetch failed: %s", exc)
        return {"status": "failed", "version": current, "checkedOn": today}
    why = validate(doc)
    if why:
        logger.warning("nopay rules rejected: %s", why)
        return {"status": "rejected", "version": current, "checkedOn": today, "detail": why}
    remote = str(doc["version"])
    if remote <= current:
        return {"status": "current", "version": current, "checkedOn": today}
    path = downloaded_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    return {"status": "updated", "version": remote, "checkedOn": today}
