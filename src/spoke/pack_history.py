"""A new drug catalog may add prices. It must not rewrite a price already in force.

Every lookup reads the newest active catalog, also for old visits, so a catalog
that changed or dropped a past price would reprice old charts and claims.
"""

from __future__ import annotations

from datetime import date
from typing import Any

# Official retroactive corrections are rare and small; more than this is a broken file.
MAX_PAST_CHANGES = 10


def _drugs(pack: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not pack:
        return []
    body = pack.get("payload") if isinstance(pack.get("payload"), dict) else pack
    rows = ((body or {}).get("resources") or {}).get("drugs") or []
    if isinstance(rows, dict):
        rows = list(rows.values())
    return [row for row in rows if isinstance(row, dict)]


def _price(row: dict[str, Any]) -> float | None:
    try:
        return float(row.get("price"))
    except (TypeError, ValueError):
        return None


def _next_day(day: str) -> str:
    try:
        return date.fromordinal(date.fromisoformat(day).toordinal() + 1).isoformat()
    except ValueError:
        return ""


def _key(row: dict[str, Any]) -> tuple[str, str]:
    code = str(row.get("nhiCode") or "").strip().upper()
    return code, str(row.get("startDate") or "")[:10]


def past_price_changes(old_pack: dict[str, Any] | None, new_pack: dict[str, Any], today: date) -> list[dict[str, Any]]:
    """Price rows that started before today and are missing, repriced, or cut short in the new catalog."""
    day = today.isoformat()
    fresh: dict[tuple[str, str], dict[str, Any]] = {}
    starts: dict[str, set[str]] = {}
    for row in _drugs(new_pack):
        fresh[_key(row)] = row
        code, start = _key(row)
        starts.setdefault(code, set()).add(start)
    out: list[dict[str, Any]] = []
    for row in _drugs(old_pack):
        code, start = _key(row)
        price = _price(row)
        # A zero price is an item not priced yet; filling it in is not a rewrite.
        if not code or not price or not start or start > day:
            continue
        hit = fresh.get((code, start))
        if hit is None:
            out.append({"nhiCode": code, "startDate": start, "was": price, "now": None})
            continue
        now = _price(hit)
        if now is None or abs(now - price) > 0.0001:
            out.append({"nhiCode": code, "startDate": start, "was": price, "now": now})
            continue
        old_end = str(row.get("endDate") or "")[:10]
        new_end = str(hit.get("endDate") or "")[:10]
        covered_until = min(old_end, day) if old_end else day
        if new_end and new_end < covered_until and _next_day(new_end) not in starts.get(code, set()):
            out.append({"nhiCode": code, "startDate": start, "was": price, "now": now, "endDate": new_end})
    return out
