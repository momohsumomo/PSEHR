# -*- coding: utf-8 -*-
"""Claim switches converted from the clinic's live Yisheng Sc.ini.

The open-source default stays in config/claims_case_rules.json.
When data/claims/sc_claim_settings.json exists, monthly claims use it.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_SNAPSHOT = _ROOT / "data" / "claims" / "sc_claim_settings.json"
_LIVE_INI = Path(r"Z:\SC\Sc.ini")

# Live Sc.ini keys. Values are read from that file, then stored as our JSON.
_KEYS = {
    "acute_chronic_to_09": "\u540c\u6642\u6709\u6025\u6027\u8207\u6162\u6027\u540d\u6642\u7533\u5831\u6848\u4ef6\u662f\u5426\u70ba09",
    "outside_dispense_to_09": "\u4ea4\u4ed8\u8abf\u5291\u8981\u4ee509\u5c08\u6848\u6279\u50f9",
    "outside_dispense_on_quota": "\u8abf\u6574\u5408\u7406\u9580\u8a3a\u91cf\u6642\u4ea4\u4ed8\u8abf\u5291\u662f\u5426\u8f4909\u6848\u4ef6",
    "repeat_dx_month_only": "\u75c5\u540d\u91cd\u8986\u662f\u5426\u53ea\u6bd4\u5c0d\u7576\u6708",
    "repeat_dx_days": "\u75c5\u540d\u91cd\u8986\u7684\u5dee\u7570\u5929\u6578\u70ba\u5e7e\u5929",
    "max_lines_warn": "\u6aa2\u67e5\u932f\u8aa4\u4e4b\u85e5\u54c1(\u8655\u7f6e)\u8d85\u904e\u5e7e\u7b46\u8981\u5217\u5165\u63d0\u9192",
    "same_day_include_a3": "\u6aa2\u67e5\u932f\u8aa4\u4e4b\u540c\u79d1\u540c\u65e5\u5c31\u8a3a\u6aa2\u67e5\u662f\u5426\u542bA3\u6848\u4ef6(Y/N)",
    "same_day_include_rehab": "\u6aa2\u67e5\u932f\u8aa4\u4e4b\u540c\u79d1\u540c\u65e5\u5c31\u8a3a\u662f\u5426\u542b(\u5fa9)\u7684\u6848\u4ef6",
    "card_missing_silent": "\u5361\u865f\u672a\u586b\u4e0d\u8b66\u544a",
    "qty_less_than_dose": "\uff38\uff2d\uff2c\u8f49\u6a94\u6aa2\u67e5\u662f\u5426\u986f\u793a\u7e3d\u91cf\u5c0f\u65bc\u6b21\u91cf\u7684\u8a0a\u606f",
    "compare_month_price": "\u7533\u5831\u4f5c\u696d\u662f\u5426\u81ea\u52d5\u6bd4\u5c0d\u7576\u6708\u5065\u4fdd\u50f9\u683c",
    "simple_table_exclude_order": "\u7be9\u9078\u932f\u8aa401\u7c21\u8868\u4e0d\u7b26\u898f\u5b9a\u6392\u9664\u7684\u8655\u7f6e\u4ee3\u78bc",
    "pharmacist_warn_count": "\u7576\u65e5\u85e5\u5e2b\u8abf\u5291\u8b66\u544a\u4ef6\u6578(0\u8868\u4e0d\u8b66\u544a)",
    "material_shape_warn": "\u7279\u6750\u7533\u5831\u5f62\u614b\u7570\u5e38\u662f\u5426\u63d0\u9192",
    "dispense_mismatch_warn": "\u6279\u50f9\u8207\u9662\u6240\u7684\u8abf\u5291\u65b9\u5f0f\u4e0d\u540c\u6642\u662f\u5426\u63d0\u9192",
    "long_course_cheap_stays_01": "\u7528\u85e5\u4e03\u5929\u4ee5\u4e0a\u85e5\u50f9\u4f4e\u65bc\u7c21\u8868\u91d1\u984d\u662f\u5426\u4ee501\u6848\u4ef6\u7533\u5831",
}


def _yn(value: str, default: bool) -> bool:
    text = (value or "").strip().upper()
    if text.startswith("Y"):
        return True
    if text.startswith("N"):
        return False
    return default


def _int(value: str, default: int) -> int:
    digits = "".join(ch for ch in (value or "") if ch.isdigit())
    if not digits:
        return default
    return int(digits)


def parse_ini_text(text: str) -> dict[str, object]:
    found: dict[str, str] = {}
    for line in text.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        found[key.strip()] = value.strip()
    out: dict[str, object] = {"source": "ini"}
    for name, ini_key in _KEYS.items():
        raw = found.get(ini_key, "")
        if name in {"repeat_dx_days", "max_lines_warn", "pharmacist_warn_count"}:
            out[name] = _int(raw, 0 if name != "max_lines_warn" else 20)
        elif name == "simple_table_exclude_order":
            out[name] = raw.upper()
        else:
            default = name != "card_missing_silent"
            out[name] = _yn(raw, default)
    return out


def read_live_ini(path: Path | None = None) -> dict[str, object] | None:
    target = path or _LIVE_INI
    if not target.is_file():
        return None
    text = target.read_bytes().decode("cp950", errors="replace")
    parsed = parse_ini_text(text)
    parsed["source"] = str(target)
    return parsed


def write_snapshot(payload: dict[str, object], path: Path | None = None) -> Path:
    dest = path or _SNAPSHOT
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    load_claim_settings.cache_clear()
    return dest


@dataclass(frozen=True)
class ClaimSettings:
    acute_chronic_to_09: bool = True
    outside_dispense_to_09: bool = True
    outside_dispense_on_quota: bool = True
    repeat_dx_month_only: bool = False
    repeat_dx_days: int = 0
    max_lines_warn: int = 20
    same_day_include_a3: bool = True
    same_day_include_rehab: bool = False
    card_missing_silent: bool = True
    qty_less_than_dose: bool = True
    compare_month_price: bool = True
    simple_table_exclude_order: str = ""
    pharmacist_warn_count: int = 0
    material_shape_warn: bool = False
    dispense_mismatch_warn: bool = True
    long_course_cheap_stays_01: bool = False
    source: str = "default"

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def _from_mapping(raw: dict[str, object]) -> ClaimSettings:
    base = ClaimSettings()
    data = base.as_dict()
    for key in data:
        if key in raw:
            data[key] = raw[key]
    return ClaimSettings(**data)  # type: ignore[arg-type]


@lru_cache(maxsize=1)
def load_claim_settings() -> ClaimSettings:
    """Prefer the converted snapshot. Refresh it from Z:\\SC\\Sc.ini when that file is present."""
    live = read_live_ini()
    if live is not None:
        write_snapshot(live)
        return _from_mapping(live)
    if _SNAPSHOT.is_file():
        raw = json.loads(_SNAPSHOT.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            raw.setdefault("source", str(_SNAPSHOT))
            return _from_mapping(raw)
    return ClaimSettings()
