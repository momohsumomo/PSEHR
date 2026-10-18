# -*- coding: utf-8 -*-
"""Which workstation currently has a visit open.

A paused queue mark is not this. The hold exists only while that visit's chart
is on a screen, and it drops if that screen stops refreshing.
"""

from __future__ import annotations

import threading
import time

_STALE_SEC = 45.0
_guard = threading.Lock()
_holds: dict[str, dict[str, float | str]] = {}


def _now(now: float | None) -> float:
    return time.monotonic() if now is None else now


def _live(row: dict[str, float | str], now: float) -> bool:
    return now - float(row["touched"]) <= _STALE_SEC


def claim(encounter_id: str, device_id: str, *, now: float | None = None) -> bool:
    """True when this workstation may show the visit. False when another live screen has it."""
    encounter_id = encounter_id.strip()
    device_id = device_id.strip()
    if not encounter_id or not device_id:
        return False
    clock = _now(now)
    with _guard:
        for eid, row in list(_holds.items()):
            if not _live(row, clock):
                _holds.pop(eid, None)
        current = _holds.get(encounter_id)
        if current and current["device_id"] != device_id and _live(current, clock):
            return False
        for eid, row in list(_holds.items()):
            if eid != encounter_id and row["device_id"] == device_id:
                _holds.pop(eid, None)
        _holds[encounter_id] = {"device_id": device_id, "touched": clock}
        return True


def release(encounter_id: str, device_id: str) -> None:
    encounter_id = encounter_id.strip()
    device_id = device_id.strip()
    with _guard:
        row = _holds.get(encounter_id)
        if row and row["device_id"] == device_id:
            _holds.pop(encounter_id, None)


def held_encounter_ids(encounter_ids: list[str], *, now: float | None = None) -> set[str]:
    clock = _now(now)
    wanted = {item.strip() for item in encounter_ids if item and item.strip()}
    with _guard:
        return {eid for eid in wanted if (row := _holds.get(eid)) and _live(row, clock)}


def clear_for_tests() -> None:
    with _guard:
        _holds.clear()
