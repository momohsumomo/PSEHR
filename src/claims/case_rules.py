# -*- coding: utf-8 -*-
"""Case 01/04/09 from the NHI form notes, plus an optional clinic file.

The shipped config keeps clinic rules off. Treatment codes and extra
chronic codes do nothing until a clinic sets clinic.enabled to true.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_CONFIG_PATH = _ROOT / "config" / "claims_case_rules.json"
_OFFICIAL_CHRONIC_PATH = _ROOT / "data" / "claims" / "yisheng_chronic_icd10.json"
_CASE_RULES_KEY = "clinic_case_rules_v1"
_ORDER = re.compile(r"^\d{5}[A-Z]$")


@dataclass(frozen=True)
class CoreRules:
    official_chronic_min_days: int = 7
    acute_plus_chronic_to_09: bool = True
    general_outside_dispense_to_09: bool = True


@dataclass(frozen=True)
class ClinicRules:
    enabled: bool = False
    extra_chronic_icd10: frozenset[str] = frozenset()
    order_codes_to_09: frozenset[str] = frozenset()
    order_reasons: dict[str, str] = field(default_factory=dict)
    order_to_09_beaten_by_04: bool = True
    case_09_fixed_consult: bool = False
    # 0 = off. Clinic choice: days 4-6 with drug points under this floor become case 09.
    project_drug_floor: int = 0
    outside_lab_codes: frozenset[str] = frozenset()


@dataclass(frozen=True)
class CaseRules:
    core: CoreRules
    clinic: ClinicRules
    official_chronic: frozenset[str]


def compact_icd(code: str) -> str:
    return str(code or "").replace(".", "").strip().upper()


def _floor_value(raw: object) -> int:
    if raw is None or raw == "":
        return 0
    try:
        number = int(raw)
    except (TypeError, ValueError):
        return 0
    if number < 0:
        return 0
    return number


def _lab_codes(raw: object) -> frozenset[str]:
    if not isinstance(raw, list):
        return frozenset()
    found: set[str] = set()
    for item in raw:
        code = compact_icd(str(item or ""))
        if _ORDER.match(code):
            found.add(code)
    return frozenset(found)


def _as_bool(value: object, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    return default


def _as_int(value: object, default: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        return default
    return value if value >= 0 else default


def _code_set(value: object) -> frozenset[str]:
    if not isinstance(value, list):
        return frozenset()
    return frozenset(compact_icd(item) for item in value if compact_icd(item))


def _load_official_chronic() -> frozenset[str]:
    if not _OFFICIAL_CHRONIC_PATH.is_file():
        return frozenset()
    raw = json.loads(_OFFICIAL_CHRONIC_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        return frozenset()
    return _code_set(raw)


def _default_rules() -> CaseRules:
    return CaseRules(
        core=CoreRules(),
        clinic=ClinicRules(),
        official_chronic=_load_official_chronic(),
    )


def _file_case_rules() -> CaseRules:
    """Shipped file. exampleNotApplied is never read."""
    if not _CONFIG_PATH.is_file():
        return _default_rules()
    raw = json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        return _default_rules()
    core_raw = raw.get("core") if isinstance(raw.get("core"), dict) else {}
    clinic_raw = raw.get("clinic") if isinstance(raw.get("clinic"), dict) else {}
    official = _load_official_chronic()
    return CaseRules(
        core=CoreRules(
            official_chronic_min_days=_as_int(core_raw.get("officialChronicMinDays"), 7),
            acute_plus_chronic_to_09=_as_bool(core_raw.get("acutePlusChronicTo09"), True),
            general_outside_dispense_to_09=_as_bool(
                core_raw.get("generalOutsideDispenseTo09"), True
            ),
        ),
        clinic=_clinic_from_stored(clinic_raw, from_file=True),
        official_chronic=official,
    )


def file_case_rules() -> CaseRules:
    return _file_case_rules()


def _shadow_payload() -> dict | None:
    try:
        from src.app.bootstrap import get_shadow_store

        raw = get_shadow_store().get_json_setting(_CASE_RULES_KEY)
    except Exception:
        return None
    return raw if isinstance(raw, dict) else None


def _clinic_from_stored(raw: dict, *, from_file: bool) -> ClinicRules:
    reasons: dict[str, str] = {}
    order_codes: list[str] = []
    if isinstance(raw.get("orderRules"), list):
        for item in raw["orderRules"]:
            if not isinstance(item, dict):
                continue
            code = compact_icd(str(item.get("code") or ""))
            if not code:
                continue
            order_codes.append(code)
            note = str(item.get("reason") or "").strip()
            if note:
                reasons[code] = note
    else:
        order_codes = list(_code_set(raw.get("orderCodesTo09")))
    if isinstance(raw.get("chronicRules"), list):
        chronic_codes = [
            compact_icd(str(item.get("code") or ""))
            for item in raw["chronicRules"]
            if isinstance(item, dict) and compact_icd(str(item.get("code") or ""))
        ]
    else:
        chronic_codes = list(_code_set(raw.get("extraChronicIcd10")))
    enabled = bool(order_codes or chronic_codes)
    if from_file:
        enabled = _as_bool(raw.get("enabled"), False) and enabled
    return ClinicRules(
        enabled=enabled,
        extra_chronic_icd10=frozenset(chronic_codes),
        order_codes_to_09=frozenset(order_codes),
        order_reasons=reasons,
        order_to_09_beaten_by_04=True,
        case_09_fixed_consult=False,
        project_drug_floor=_floor_value(raw.get("projectDrugFloor")),
        outside_lab_codes=_lab_codes(raw.get("outsideLabCodes")),
    )


@lru_cache(maxsize=1)
def load_case_rules() -> CaseRules:
    """Official core from the shipped file. Clinic rows from ?|???? when saved."""
    base = _file_case_rules()
    saved = _shadow_payload()
    if saved is None:
        return base
    return CaseRules(
        core=base.core,
        clinic=_clinic_from_stored(saved, from_file=False),
        official_chronic=base.official_chronic,
    )


def clear_case_rules_cache() -> None:
    load_case_rules.cache_clear()


def claim_case_rules() -> CaseRules:
    """Monthly filing uses the clinic claim switches converted from Sc.ini."""
    from src.claims.claim_settings import load_claim_settings

    base = load_case_rules()
    settings = load_claim_settings()
    return CaseRules(
        core=CoreRules(
            official_chronic_min_days=base.core.official_chronic_min_days,
            acute_plus_chronic_to_09=settings.acute_chronic_to_09,
            general_outside_dispense_to_09=settings.outside_dispense_to_09,
        ),
        clinic=base.clinic,
        official_chronic=base.official_chronic,
    )


def official_lines(rules: CaseRules) -> list[str]:
    days = rules.core.official_chronic_min_days
    lines = [
        "\u516c\u544a\u6162\u6027\u75c5\uff0c\u7d66\u85e5\u6eff %d \u5929\uff0c\u6848\u4ef6\u662f 04\u3002" % days,
    ]
    if rules.core.acute_plus_chronic_to_09:
        lines.append(
            "\u540c\u4e00\u7b46\u540c\u6642\u6709\u516c\u544a\u6162\u6027\u75c5\u548c\u5176\u4ed6\u75c5\u540d\uff0c\u6848\u4ef6\u662f 09\u3002"
        )
    if rules.core.general_outside_dispense_to_09:
        lines.append("\u4e00\u822c\u6848\u4ef6\u6539\u6210\u4ea4\u4ed8\u8abf\u5291\uff0c\u6848\u4ef6\u662f 09\u3002")
    lines.append("\u5176\u9918\u662f 01\u3002\u8655\u7f6e\u672c\u8eab\u4e0d\u6703\u6539\u6848\u4ef6\u3002")
    return lines


def validate_clinic_payload(raw: dict, official: frozenset[str]) -> dict:
    """Normalize the clinic settings body. Raises ValueError with a short message."""
    if not isinstance(raw, dict):
        raise ValueError("\u683c\u5f0f\u4e0d\u5c0d")
    orders_in = raw.get("orderRules") if isinstance(raw.get("orderRules"), list) else []
    chronics_in = raw.get("chronicRules") if isinstance(raw.get("chronicRules"), list) else []
    orders: list[dict[str, str]] = []
    seen_orders: set[str] = set()
    for item in orders_in:
        if not isinstance(item, dict):
            continue
        code = compact_icd(str(item.get("code") or ""))
        if not _ORDER.match(code) or code.startswith("00") or code.startswith("052"):
            raise ValueError("\u8655\u7f6e\u4ee3\u78bc\u4e0d\u662f\u8a3a\u7642\u9805\u76ee\uff1a%s" % code)
        if code in seen_orders:
            continue
        reason = str(item.get("reason") or "").strip()
        if not reason:
            raise ValueError("\u8acb\u5beb\u4e0b\u70ba\u4ec0\u9ebc\u8981\u628a %s \u7533\u5831\u6210 09" % code)
        if len(reason) > 80:
            raise ValueError("\u7406\u7531\u8acb\u5728 80 \u5b57\u4ee5\u5167")
        seen_orders.add(code)
        orders.append(
            {
                "code": code,
                "name": str(item.get("name") or "").strip()[:40],
                "reason": reason,
            }
        )
    chronics: list[dict[str, str]] = []
    seen_dx: set[str] = set()
    for item in chronics_in:
        if not isinstance(item, dict):
            continue
        code = compact_icd(str(item.get("code") or ""))
        if len(code) < 3 or not code[0].isalpha():
            raise ValueError("\u75c5\u540d\u8acb\u7528 ICD-10\uff1a%s" % code)
        if code in seen_dx:
            continue
        if _hits(code, official):
            raise ValueError("\u9019\u500b\u75c5\u540d\u5df2\u5728\u516c\u544a\u6162\u6027\u75c5\u540d\u55ae\uff0c\u4e0d\u7528\u53e6\u5916\u8a2d\u5b9a\u3002")
        seen_dx.add(code)
        chronics.append({"code": code, "name": str(item.get("name") or "").strip()[:40]})
    if len(orders) > 40 or len(chronics) > 40:
        raise ValueError("\u4f8b\u5916\u8acb\u5404\u4fdd\u7559\u5728 40 \u7b46\u4ee5\u5167")
    floor = _floor_value(raw.get("projectDrugFloor"))
    if floor > 9999:
        raise ValueError("\u5c08\u6848\u6279\u50f9\u7684\u85e5\u50f9\u5e95\u9650\u8acb\u586b 0 \u5230 9999\uff0c0 \u8868\u793a\u4e0d\u7528")
    labs = sorted(_lab_codes(raw.get("outsideLabCodes")))
    if len(labs) > 40:
        raise ValueError("\u5916\u9001\u6aa2\u9a57\u8acb\u7559\u5728 40 \u7b46\u4ee5\u5167")
    return {
        "orderRules": orders,
        "chronicRules": chronics,
        "projectDrugFloor": floor,
        "outsideLabCodes": labs,
    }


def _hits(code: str, table: frozenset[str]) -> bool:
    if not code or not table:
        return False
    if code in table:
        return True
    if len(code) < 4:
        return False
    for item in table:
        if len(item) >= 4 and (item.startswith(code) or code.startswith(item)):
            return True
    return False


def _split_diagnoses(codes: list[str] | None, rules: CaseRules) -> tuple[bool, bool, bool]:
    """Return official chronic, clinic-extra chronic, and any other diagnosis."""
    official = False
    extra = False
    other = False
    extras = rules.clinic.extra_chronic_icd10 if rules.clinic.enabled else frozenset()
    for raw in codes or []:
        code = compact_icd(raw)
        if not code:
            continue
        if _hits(code, rules.official_chronic):
            official = True
        elif extras and _hits(code, extras):
            extra = True
        else:
            other = True
    return official, extra, other


def is_chronic_dx(codes: list[str], rules: CaseRules | None = None) -> bool:
    active = rules or load_case_rules()
    official, extra, _other = _split_diagnoses(codes, active)
    return official or extra


def is_outside_dispense(dispense: str) -> bool:
    text = (dispense or "").strip()
    if not text or text in {"0", "-", "\u2014"}:
        return False
    if text.startswith("2") or "\u4ea4\u4ed8" in text:
        return True
    return False


def assign_case(
    *,
    stored: str,
    days: int,
    dispense: str,
    self_pay: bool,
    diagnosis_codes: list[str] | None = None,
    order_codes: list[str] | None = None,
    rules: CaseRules | None = None,
) -> tuple[str, str]:
    """Return (case, reason). Does not alter the chart."""
    active = rules or load_case_rules()
    raw = (stored or "").strip().upper()
    if self_pay or raw in {"9X", "\u81ea\u8cbb", "\u81ea"}:
        return "9X", "\u81ea\u8cbb\uff0c\u4e0d\u9032\u5065\u4fdd\u7533\u5831\u6a94"
    if raw in {"08", "02", "A3", "04", "09"}:
        return raw, "\u639b\u865f\u5df2\u6307\u5b9a\u6848\u4ef6"

    minimum = active.core.official_chronic_min_days
    official, extra, other = _split_diagnoses(diagnosis_codes, active)
    if official and other and active.core.acute_plus_chronic_to_09:
        case, reason = "09", "\u540c\u4e00\u6b21\u542b\u516c\u544a\u6162\u6027\u75c5\u8207\u5176\u4ed6\u75c5\u540d"
    elif (official or extra) and days >= minimum:
        if official:
            case, reason = (
                "04",
                "\u516c\u544a\u6162\u6027\u75c5\u4e14\u7d66\u85e5\u6eff %d \u5929" % minimum,
            )
        else:
            case, reason = (
                "04",
                "\u8a3a\u6240\u6162\u6027\u75c5\u6e05\u55ae\u4e14\u7d66\u85e5\u6eff %d \u5929" % minimum,
            )
    elif official or extra:
        case, reason = (
            "01",
            "\u6709\u6162\u6027\u75c5\u540d\u4f46\u7d66\u85e5\u672a\u6eff %d \u5929" % minimum,
        )
    else:
        case, reason = "01", "\u4e00\u822c\u9580\u8a3a"

    if (
        case == "01"
        and active.core.general_outside_dispense_to_09
        and is_outside_dispense(dispense)
    ):
        case, reason = "09", "\u4e00\u822c\u6848\u4ef6\u4ea4\u4ed8\u8abf\u5291"

    clinic = active.clinic
    if clinic.enabled and clinic.order_codes_to_09:
        wanted = clinic.order_codes_to_09
        hit = any(compact_icd(code) in wanted for code in (order_codes or []))
        if hit and not (case == "04" and clinic.order_to_09_beaten_by_04):
            if case != "09":
                matched = next(
                    (
                        compact_icd(code)
                        for code in (order_codes or [])
                        if compact_icd(code) in wanted
                    ),
                    "",
                )
                note = (clinic.order_reasons.get(matched) or "").strip()
                if not note:
                    note = "\u8a3a\u6240\u898f\u5247\uff1a\u8655\u7f6e\u4ee3\u78bc\u8f49 09"
                case, reason = "09", note
    return case, reason
