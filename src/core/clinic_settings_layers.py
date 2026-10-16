# -*- coding: utf-8 -*-
"""Clinic settings layering: clinic (shared) < role < device (local)."""

from __future__ import annotations

from typing import Any, Literal

Scope = Literal["clinic", "role", "device"]

DEVICE_ROLES = (
    "register",
    "outpatient",
    "billing",
    "pharmacy",
    "admin",
    "other",
)

# Substrings -> device-local
_DEVICE_HINTS = (
    "\u5370\u8868\u6a5f",  # printer
    "\u5370\u8868\u540d",
    "COM",
    "com port",
    "\u5b57\u578b",
    "RGB",
    "\u80cc\u666f\u8272",
    "\u8def\u5f91",
    "\u9a45\u52d5\u5668",
)

# Substrings -> role layer
_ROLE_HINTS = (
    "\u9234\u8072",
    "\u5b58\u6a94\u5f8c",
    "\u6279\u50f9\u5b58\u6a94",
    "\u662f\u5426\u5217\u5370",
    "\u81ea\u52d5\u5217\u5370",
    "\u63d0\u9192\u8996\u7a97",
)


def suggest_scope(entry: str, section: str = "") -> Scope:
    text = f"{section} {entry}".casefold()
    for h in _DEVICE_HINTS:
        if h.casefold() in text:
            return "device"
    for h in _ROLE_HINTS:
        if h.casefold() in text:
            return "role"
    return "clinic"


def merge_scini_values(
    clinic: dict[str, dict[str, str]],
    role_overlay: dict[str, dict[str, str]] | None = None,
    device_overlay: dict[str, dict[str, str]] | None = None,
) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {s: dict(items) for s, items in (clinic or {}).items()}

    def apply(layer: dict[str, dict[str, str]] | None) -> None:
        if not layer:
            return
        for sec, items in layer.items():
            bucket = out.setdefault(str(sec), {})
            for k, v in (items or {}).items():
                bucket[str(k)] = "" if v is None else str(v)

    apply(role_overlay)
    apply(device_overlay)
    return out


def flatten_catalog_rows(
    catalog: list[dict[str, Any]],
    values: dict[str, dict[str, str]],
) -> list[dict[str, Any]]:
    val_map: dict[str, dict[str, str]] = {}
    for sec, items in (values or {}).items():
        val_map[str(sec).casefold()] = items

    rows: list[dict[str, Any]] = []
    for c in catalog or []:
        section = str(c.get("section") or "")
        entry = str(c.get("entry") or "")
        if not entry:
            continue
        items = val_map.get(section.casefold()) or {}
        value = items.get(entry, c.get("valueDefault") or "")
        rows.append(
            {
                "seqNo": c.get("seqNo") or "",
                "section": section,
                "entry": entry,
                "value": value,
                "canEdit": c.get("canEdit") or "",
                "combox": c.get("combox") or "",
                "picture": c.get("picture") or "",
                "desc": c.get("desc") or "",
                "suggestedScope": suggest_scope(entry, section),
            }
        )
    return rows
