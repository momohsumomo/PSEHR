"""自動閘門：決定可否靜默自動發布，或升級事件。"""

from __future__ import annotations

from typing import Any

from hub import config


def evaluate_gates(diff_summary: dict[str, Any], *, has_previous: bool) -> dict[str, Any]:
    """Official catalog publishes itself.

    Block only a broken fetch: empty file, tiny catalog, most codes deleted,
    or a single price that jumped by GATE_PRICE_REL_PCT or more.
    A normal monthly price refresh is auto. decision is auto | block_event.
    """
    current = int(diff_summary.get("currentCount") or 0)
    removed = int(diff_summary.get("removed") or 0)
    previous = int(diff_summary.get("previousCount") or 0)
    spike = float(diff_summary.get("maxPriceRelPct") or 0)
    material = bool(diff_summary.get("material"))

    if current == 0:
        return {"decision": "block_event", "reasons": ["EMPTY_CURRENT"], "material": True}
    if current < 10000:
        return {"decision": "block_event", "reasons": ["CATALOG_TOO_SMALL"], "material": True}
    if not has_previous:
        return {"decision": "auto", "reasons": ["FIRST_CATALOG"], "material": True}
    if previous and removed / previous >= 0.20:
        return {
            "decision": "block_event",
            "reasons": ["CATALOG_WIPED"],
            "material": True,
        }
    if spike >= config.GATE_PRICE_REL_PCT:
        return {
            "decision": "block_event",
            "reasons": [f"PRICE_SPIKE>={config.GATE_PRICE_REL_PCT}%"],
            "material": True,
        }
    if not material:
        return {"decision": "auto", "reasons": ["NO_MATERIAL_DIFF"], "material": False}
    return {"decision": "auto", "reasons": ["OFFICIAL_REFRESH"], "material": True}
