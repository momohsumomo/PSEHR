# -*- coding: utf-8 -*-
"""Clinic claim switches, owned by PSEHR.

config/claim_settings.json ships with the program.
data/claims/claim_settings.json, when present, overrides it for one clinic.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_SHIPPED = _ROOT / "config" / "claim_settings.json"
_CLINIC = _ROOT / "data" / "claims" / "claim_settings.json"


@dataclass(frozen=True)
class ClaimSettings:
    acute_chronic_to_09: bool = False
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

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def _read(path: Path) -> dict[str, object]:
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return {}
    return raw if isinstance(raw, dict) else {}


@lru_cache(maxsize=1)
def load_claim_settings() -> ClaimSettings:
    data = ClaimSettings().as_dict()
    for layer in (_read(_SHIPPED), _read(_CLINIC)):
        for key in data:
            if key in layer:
                data[key] = layer[key]
    return ClaimSettings(**data)  # type: ignore[arg-type]
