# -*- coding: utf-8 -*-
"""Specialty templates: diagnoses, drugs, order sets, and case exceptions."""

from __future__ import annotations

import json
from pathlib import Path

_DIR = Path(__file__).resolve().parents[2] / "data" / "specialty_templates"


def list_templates() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    if not _DIR.is_dir():
        return rows
    for path in sorted(_DIR.glob("*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict) or not raw.get("id"):
            continue
        orders = raw.get("orderRules") if isinstance(raw.get("orderRules"), list) else []
        rows.append(
            {
                "id": str(raw.get("id")),
                "name": str(raw.get("name") or raw.get("id")),
                "note": str(raw.get("note") or ""),
                "orderRuleCount": len(orders),
                "diagnosisCount": len(raw.get("diagnosisShortcuts") or []),
                "drugCount": len(raw.get("drugs") or []),
                "orderSetCount": len(raw.get("orderSets") or []),
            }
        )
    return rows


def load_template(template_id: str) -> dict:
    name = "".join(ch for ch in template_id if ch.isalnum() or ch in {"-", "_"})
    path = _DIR / f"{name}.json"
    if not path.is_file():
        raise FileNotFoundError(name)
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise FileNotFoundError(name)
    return raw


def merge_order_rules(current: list[dict], incoming: list[dict]) -> list[dict]:
    """Add template orders that the clinic does not already have."""
    seen = {str(row.get("code") or "").upper() for row in current if isinstance(row, dict)}
    merged = [row for row in current if isinstance(row, dict)]
    for row in incoming:
        if not isinstance(row, dict):
            continue
        code = str(row.get("code") or "").upper()
        if not code or code in seen:
            continue
        seen.add(code)
        merged.append(
            {
                "code": code,
                "name": str(row.get("name") or "")[:40],
                "reason": str(row.get("reason") or "").strip()[:80],
            }
        )
    return merged
