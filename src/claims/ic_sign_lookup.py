# -*- coding: utf-8 -*-
"""Per-visit safety signature (M14) and prescription signature (D11).

New visits keep the signature returned when the sequence number is issued.
Visits already filed by the previous system are read back from that day's
upload XML, matched by the 20-character treatment id. Values are not logged.
"""

from __future__ import annotations

import base64
import os
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any

_HEX = set("0123456789abcdefABCDEF")
_REC = re.compile(r"<REC>(.*?)</REC>", re.S)
_M15 = re.compile(r"<M15>([^<]*)</M15>")
_M14 = re.compile(r"<M14>([^<]*)</M14>")
_M49 = re.compile(r"<M49>([^<]*)</M49>")
_M52 = re.compile(r"<M52>([^<]*)</M52>")
_MB2 = re.compile(r"<MB2>(.*?)</MB2>", re.S)
_D03 = re.compile(r"<D03>([^<]*)</D03>")
_D11 = re.compile(r"<D11>([^<]*)</D11>")


def xml_root() -> Path:
    return Path(os.environ.get("IC20_XML_ROOT", r"Z:\SC\Ic20Xml"))


def as_hex_field(value: str, width: int) -> str:
    text = "".join(str(value or "").split())
    if len(text) == width and all(ch in _HEX for ch in text):
        return text.upper()
    try:
        raw = base64.b64decode(text, validate=True)
    except Exception:
        return ""
    hx = raw.hex().upper()
    return hx if len(hx) == width else ""


def _index_file(path: Path, into: dict[str, dict[str, Any]]) -> None:
    try:
        text = path.read_bytes().decode("cp950", errors="ignore")
    except OSError:
        return
    for rec in _REC.findall(text):
        treat = _M15.search(rec)
        sign = _M14.search(rec)
        if not treat or not sign:
            continue
        key = treat.group(1).strip()
        m14 = as_hex_field(sign.group(1), 256)
        if len(key) != 20 or not m14 or key in into:
            continue
        orders: dict[str, str] = {}
        for block in _MB2.findall(rec):
            seq = _D03.search(block)
            rx = _D11.search(block)
            if not seq or not rx:
                continue
            d11 = as_hex_field(rx.group(1), 40)
            if d11:
                orders[seq.group(1).strip()] = d11
        m49 = _M49.search(rec)
        m52 = _M52.search(rec)
        into[key] = {
            "m14": m14,
            "d11": orders,
            "m49": m49.group(1).strip() if m49 else "",
            "m52": m52.group(1).strip() if m52 else "",
        }


def load_sign_index(iso_day: str) -> dict[str, dict[str, Any]]:
    try:
        start = date.fromisoformat(iso_day[:10])
    except ValueError:
        return {}
    found: dict[str, dict[str, Any]] = {}
    root = xml_root()
    for delta in range(0, 3):
        folder = root / f"{(start + timedelta(days=delta)).day:02d}" / "Upload"
        if not folder.is_dir():
            continue
        for path in sorted(folder.glob("*.Xml")):
            _index_file(path, found)
    return found


def fill_signs(records: list[dict[str, Any]], iso_day: str) -> None:
    pending = []
    for rec in records:
        mb1 = rec.get("mb1") or {}
        if rec.get("h01") == "B":
            continue
        has_m14 = bool(as_hex_field(str(mb1.get("M14") or ""), 256))
        if has_m14:
            mb1["M14"] = as_hex_field(str(mb1.get("M14") or ""), 256)
        needs_d11 = any(not str(order.get("D11") or "").strip() for order in (rec.get("orders") or []))
        remark = str(mb1.get("M12") or "")
        needs_actual = remark in {"2", "3", "4"} and (
            not str(mb1.get("M49") or "").strip() or not str(mb1.get("M52") or "").strip()
        )
        if (not has_m14 or needs_d11 or needs_actual) and str(mb1.get("M15") or "").strip():
            pending.append(rec)
    if not pending:
        return
    index = load_sign_index(iso_day)
    for rec in pending:
        mb1 = rec.setdefault("mb1", {})
        hit = index.get(str(mb1.get("M15") or "").strip())
        if not hit:
            continue
        if not as_hex_field(str(mb1.get("M14") or ""), 256):
            mb1["M14"] = hit["m14"]
        if str(mb1.get("M12") or "") in {"2", "3", "4"}:
            if not str(mb1.get("M49") or "").strip() and hit.get("m49"):
                mb1["M49"] = str(hit["m49"])
            if not str(mb1.get("M52") or "").strip() and hit.get("m52"):
                mb1["M52"] = str(hit["m52"])
        orders = hit.get("d11") or {}
        for order in rec.get("orders") or []:
            if order.get("D11"):
                continue
            d11 = orders.get(str(order.get("D03") or "").strip())
            if d11:
                order["D11"] = d11


def unsigned_normal(records: list[dict[str, Any]]) -> int:
    missing = 0
    for rec in records:
        if rec.get("h01") == "B":
            continue
        if len(str((rec.get("mb1") or {}).get("M14") or "")) != 256:
            missing += 1
    return missing
