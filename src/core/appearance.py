"""Clinic appearance stays in data/ so a program update does not replace it.

The program ships a default. This file stores only what a clinic has saved.
Missing keys keep the program default. byStaff holds a later per-person overlay.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parents[2]
_PATH = _ROOT / "data" / "appearance.json"
_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")
_ALLOWED = frozenset(
    {
        "chrome",
        "chromeDark",
        "chromeBorder",
        "titleBarFrom",
        "titleBarTo",
        "titleBarBorder",
        "headerBg",
        "headerBgGreen",
        "rowAlt",
        "rowFinished",
        "rowWaiting",
        "rowSelected",
        "listSelected",
        "listSelectedText",
        "listSelectedNavy",
        "accentCyan",
        "ccBg",
        "ccBorder",
        "ccText",
        "dxBg",
        "rxBg",
        "rxHeader",
        "rxSelected",
        "dxSelected",
        "labelBg",
        "labelText",
        "surface",
        "inputBg",
        "tabIdle",
        "tabIdleText",
        "tabActive",
        "tabActiveText",
        "allergyBar",
        "lobbyFrom",
        "lobbyMid",
        "lobbyTo",
        "lobbyBtnFrom",
        "lobbyBtnTo",
        "lobbyGold",
        "scGold",
        "patientFace",
        "patientRight",
        "inputBlue",
    }
)


def _colors(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for key, value in raw.items():
        if key not in _ALLOWED or not isinstance(value, str):
            continue
        text = value.strip()
        if _COLOR.match(text):
            out[key] = text.upper()
    return out


def _staff_map(raw: Any) -> dict[str, dict[str, str]]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, dict[str, str]] = {}
    for key, value in raw.items():
        staff = str(key or "").strip()
        if not staff or len(staff) > 40:
            continue
        colors = _colors(value)
        if colors:
            out[staff] = colors
    return out


def load_appearance() -> dict[str, Any]:
    if not _PATH.is_file():
        return {"clinic": {}, "byStaff": {}}
    try:
        data = json.loads(_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"clinic": {}, "byStaff": {}}
    if not isinstance(data, dict):
        return {"clinic": {}, "byStaff": {}}
    return {"clinic": _colors(data.get("clinic")), "byStaff": _staff_map(data.get("byStaff"))}
