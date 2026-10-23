# -*- coding: utf-8 -*-
"""Consult and pharmacy fee helpers.

Case 01/04/09 is decided in case_rules.py from config/claims_case_rules.json.
Consult tiers are one monthly pool per doctor. The daily bands and the day cap
are the payment-standard schedule in force that month, not the newest one.
Under 6 and age 75+ take the 00110C slots first. Everyone else keeps date then
queue order. Case 01 within three days uses the daily drug fee (MA1-MA4).
"""

from __future__ import annotations

import math
import re
from datetime import date
from functools import lru_cache
from pathlib import Path

from src.claims.case_rules import is_outside_dispense, load_case_rules

_ORDER = re.compile(r"^\d{5}[A-Z]$")
_NOT_A_DRUG = re.compile(r"^(R00[1-8]|S00[1-4]|MA[1-4])$")

# Newest schedule first. 115/8/1: reasonable days 25 -> 22, first band 30 -> 35.
# Before that: 1-30 00110C, 31-40 00224C, 41-60 00112C, 61-80 00114C, 81+ 00116C.
# From 2026-08-01: 1-35, 36-45, 46-65, 66-85, 86+.
_CONSULT_SCHEDULES = (
    (
        "2026-08-01",
        22,
        (
            ("00110C", 397, 35),
            ("00224C", 250, 10),
            ("00112C", 220, 20),
            ("00114C", 160, 20),
            ("00116C", 70, 0),
        ),
    ),
    (
        "1900-01-01",
        25,
        (
            ("00110C", 397, 30),
            ("00224C", 250, 10),
            ("00112C", 220, 20),
            ("00114C", 160, 20),
            ("00116C", 70, 0),
        ),
    ),
)
_CONSULT_04_BASE = 364
# Age bands on 00110C seen in the September file: under 4, age 4-5, and 75+.
_AGE_UNDER_4 = ("00110C", 484, 444, 109.0)
_AGE_UNDER_6 = ("00110C", 397, 364, 109.0)
_AGE_75 = ("00110C", 424, 389, 109.0)
_PHARM = (
    (13, "05203C", 39),
    (27, "05207C", 41),
    (10**9, "05211C", 51),
)
_PHARM_FULL_PER_DAY = 80
_PHARM_HALF_PER_DAY = 100
_PHARM_OVER_CODE = "05234D"
def is_order_code(nhi_code: str) -> bool:
    """Treatment / exam order. Consult (00xxx) and pharmacy (052xx) are not."""
    code = (nhi_code or "").strip().upper()
    if not _ORDER.match(code):
        return False
    if code.startswith("00") or code.startswith("052"):
        return False
    return True


# Payment standard, treatment chapter: named child-addon items only.
# Under 6 months +60%, 6 months to under 2 years +30%, 2 years to under 7 years +20%.
# September's file marked 48026C and left other child procedures at 100%.
_CHILD_ADDON_CODES = frozenset({"48026C"})
# Accepting a referral (01038C, or 00193C on the electronic platform) keeps
# that visit's consult fee on the first band and out of the monthly quota.
_REFERRAL_IN_CODES = frozenset({"01038C", "00193C"})


def is_referral_in(codes: list[str] | tuple[str, ...]) -> bool:
    """True when the visit claims the accept-referral consult add-on."""
    return any((code or "").strip().upper() in _REFERRAL_IN_CODES for code in codes)


def half_up_points(value: float) -> int:
    """Claim point fields are integers. .5 rounds away from zero, up for fees."""
    return int(math.floor(float(value) + 0.5))


def age_months(birth_iso: str, on_iso: str) -> int | None:
    try:
        born = date.fromisoformat(birth_iso[:10])
        on = date.fromisoformat(on_iso[:10])
    except ValueError:
        return None
    months = (on.year - born.year) * 12 + (on.month - born.month)
    if on.day < born.day:
        months -= 1
    return months


def child_rate_percent(birth_iso: str, on_iso: str) -> int:
    """Payment-standard child add-on. 100 means the age band does not apply."""
    months = age_months(birth_iso, on_iso)
    if months is None or months < 0 or months >= 84:
        return 100
    if months < 6:
        return 160
    if months < 24:
        return 130
    return 120


def child_addon_points(
    code: str,
    unit_price: float,
    quantity: float,
    birth_iso: str,
    on_iso: str,
) -> tuple[int, int] | None:
    """(rate percent, filed points) for a named child-addon item. Otherwise None."""
    code_u = (code or "").strip().upper()
    if code_u not in _CHILD_ADDON_CODES:
        return None
    percent = child_rate_percent(birth_iso, on_iso)
    if percent == 100:
        return None
    base = float(unit_price or 0) * float(quantity or 0)
    return percent, half_up_points(base * percent / 100.0)


def age_years(birth_iso: str, on_iso: str) -> int | None:
    try:
        born = date.fromisoformat(birth_iso[:10])
        on = date.fromisoformat(on_iso[:10])
    except ValueError:
        return None
    years = on.year - born.year
    if (on.month, on.day) < (born.month, born.day):
        years -= 1
    return years


def consult_schedule(on_date: str | None) -> tuple[int, tuple[tuple[str, int, int], ...]]:
    """Day cap and daily bands for the fee month that contains on_date.

    An empty date uses the newest schedule. Callers that are pricing a real
    month pass that month's visit date.
    """
    day = (on_date or "")[:10]
    if not day:
        cap, bands = _CONSULT_SCHEDULES[0][1], _CONSULT_SCHEDULES[0][2]
        return cap, bands
    for start, cap, bands in _CONSULT_SCHEDULES:
        if day >= start:
            return cap, bands
    cap, bands = _CONSULT_SCHEDULES[-1][1], _CONSULT_SCHEDULES[-1][2]
    return cap, bands


def consult_at(
    index: int,
    visit_days: int,
    age: int | None,
    on_date: str | None = None,
) -> tuple[str, int, int, float]:
    """1-based month index after under-6 and 75+ visits have been placed first.

    Returns code, points, base points, rate percent. The 00110C band uses the
    dermatology rate; under 4 and 75+ replace that amount. Band widths and the
    day cap follow the schedule in force on on_date.
    """
    code, pts = "00116C", 70
    left = index
    cap_days, bands = consult_schedule(on_date)
    days = min(visit_days, cap_days) if visit_days > 0 else 0
    for bcode, bpts, width in bands:
        room = 10**9 if width == 0 else width * days
        if left <= room:
            code, pts = bcode, bpts
            break
        left -= room
    if code == "00110C":
        band = _age_band(age)
        if band is not None and age is not None and (age < 6 or age >= 75):
            return band
        return "00110C", pts, _CONSULT_04_BASE, 109.0
    return code, pts, pts, 100.0


def flat_consult_points(birthday_roc: str, on_iso: str) -> int:
    """One amount per person for the daily upload total.

    The monthly ladder (which code after the reasonable-volume cap) stays on
    the monthly file. Here everyone gets the first band for that date, with
    the under-4 and 75+ amounts.
    """
    digits = "".join(ch for ch in (birthday_roc or "") if ch.isdigit())
    iso_birth = ""
    if len(digits) >= 7:
        try:
            iso_birth = f"{int(digits[:3]) + 1911:04d}-{int(digits[3:5]):02d}-{int(digits[5:7]):02d}"
        except ValueError:
            iso_birth = ""
    age = age_years(iso_birth, (on_iso or "")[:10]) if iso_birth else None
    _cap, bands = consult_schedule(on_iso)
    points = int(bands[0][1]) if bands else 397
    if age is None:
        return points
    band = _age_band(age)
    if band is not None and (age < 6 or age >= 75):
        return int(band[1])
    return points


def consult_for(
    case: str,
    *,
    rank: int,
    age: int | None,
    fixed_09: bool = False,
    visit_days: int = 22,
    on_date: str | None = None,
) -> tuple[str, int, int, float]:
    """Backward-compatible wrapper. rank is the 1-based volume index."""
    del case, fixed_09
    return consult_at(rank, visit_days, age, on_date)


def _age_band(age: int | None) -> tuple[str, int, int, float] | None:
    """00110C age amounts. Ages 6-74 stay on the normal ladder or case-04 rate."""
    if age is None:
        return None
    if age < 4:
        return _AGE_UNDER_4
    if age < 6:
        return _AGE_UNDER_6
    if age >= 75:
        return _AGE_75
    return None


def pharmacy_day_adjustment(index: int, points: int) -> tuple[str, int] | None:
    """1-based visit among one doctor's dispensing visits that day.

    The first 80 keep the normal fee. 81-100 become 05234D at half points.
    After 100 the same code is filed at 0.
    """
    if index <= _PHARM_FULL_PER_DAY:
        return None
    if index <= _PHARM_HALF_PER_DAY:
        return _PHARM_OVER_CODE, (int(points) + 1) // 2
    return _PHARM_OVER_CODE, 0


@lru_cache(maxsize=1)
def bottled_oral_codes() -> frozenset[str]:
    """Clinic drugs marked as bottled oral liquid. That mark selects MA2-MA4."""
    path = Path(r"Z:\SC\dat\MEDICAL.Dat")
    if not path.is_file():
        return frozenset()
    try:
        from scripts.backfill_cash_book import _iter_fields
    except Exception:
        return frozenset()
    mark = "\u74f6\u88dd\u53e3\u670d\u6db2"
    liquid = "\u5167\u670d\u6db2\u5291"
    found: set[str] = set()
    try:
        rows = _iter_fields(path, ("CODE", "PROFILE", "DRUGTYPE"))
    except KeyError:
        return frozenset()
    for row in rows:
        code = (row.get("CODE") or "").strip().upper()
        if code and mark in (row.get("PROFILE") or "") and (row.get("DRUGTYPE") or "").strip() == liquid:
            found.add(code)
    return frozenset(found)


def daily_drug_fee(days: int, *, bottled_kinds: int = 0, age: int | None = None) -> tuple[str, int, int] | None:
    """Case 01 flat drug fee. Returns code, points per day, and total points."""
    if days < 1 or days > 3:
        return None
    if age is not None and age <= 12 and bottled_kinds >= 1:
        if bottled_kinds == 1:
            code, per_day = "MA2", 31
        elif bottled_kinds == 2:
            code, per_day = "MA3", 37
        else:
            code, per_day = "MA4", 41
    else:
        code, per_day = "MA1", 22
    return code, per_day, per_day * int(days)


def apply_daily_drug_fee(rec: object, *, days: int, case: str) -> float:
    """Use the daily fee on case 01. Itemize when the visit has a priced procedure."""
    from src.claims.engine import ClaimMedLine

    drugs = [
        m
        for m in rec.medications
        if m.nhiCode and not is_order_code(m.nhiCode) and not _NOT_A_DRUG.match(m.nhiCode.strip().upper())
    ]
    orders = [m for m in rec.medications if is_order_code(m.nhiCode)]
    itemized = round(sum(float(m.linePoints or 0) for m in drugs), 2)
    if case != "01" or not drugs or any(float(m.linePoints or 0) > 0 for m in orders):
        return itemized
    age = age_years(getattr(rec, "birthDate", ""), getattr(rec, "encounterDate", ""))
    bottled = bottled_oral_codes()
    kinds = len({(m.nhiCode or "").strip().upper() for m in drugs if (m.nhiCode or "").strip().upper() in bottled})
    fee = daily_drug_fee(days, bottled_kinds=kinds, age=age)
    if fee is None:
        return itemized
    code, per_day, points = fee
    for med in drugs:
        med.unitPrice = 0.0
        med.linePoints = 0.0
        med.billable = False
    rec.medications.append(
        ClaimMedLine(
            medicationRequestId="",
            nhiCode=code,
            drugText="",
            daysSupply=0,
            quantity=float(days),
            unitPrice=float(per_day),
            linePoints=float(points),
            priceSource="daily",
        )
    )
    return float(points)


def claim_supply_days(lines: list) -> int:
    """給藥日份. Oral plus topical uses the longest oral course."""
    def longest(rows: list) -> int:
        return max((int(getattr(row, "daysSupply", 0) or 0) for row in rows), default=0)

    oral = [row for row in lines if str(getattr(row, "routeCode", "") or "").upper() == "PO"]
    if oral and longest(oral) > 0:
        return longest(oral)
    return longest(lines)


def pharmacy_supply_days(lines: list) -> int:
    """Pharmacy tier uses the longest line on the prescription, including creams."""
    vals = [int(getattr(row, "daysSupply", 0) or 0) for row in lines]
    positive = [v for v in vals if v > 0]
    return max(positive) if positive else 0


def shorter_flat_days(lines: list) -> int | None:
    """1-3 day flat fee when every line is still inside the 13-day pharmacy band."""
    vals = [int(getattr(row, "daysSupply", 0) or 0) for row in lines if int(getattr(row, "daysSupply", 0) or 0) > 0]
    if not vals or max(vals) > 13:
        return None
    short = [v for v in vals if v <= 3]
    if not short:
        return None
    return max(short)


def pharmacy_for(days: int, dispense: str) -> tuple[str, int]:
    if days <= 0 or is_outside_dispense(dispense):
        return "", 0
    for limit, code, pts in _PHARM:
        if days <= limit:
            return code, pts
    return "", 0


def visit_notes(*, days: int, chronic: bool, drug_points: float, case: str) -> list[str]:
    notes: list[str] = []
    minimum = load_case_rules().core.official_chronic_min_days
    if chronic and days < minimum:
        notes.append(
            "\u6709\u6162\u6027\u75c5\u540d\u4f46\u7d66\u85e5\u672a\u6eff %d \u5929\uff0c\u4e0d\u6539\u6210 04"
            % minimum
        )
    if days > 31:
        notes.append("\u7d66\u85e5\u8d85\u904e 31 \u5929")
    return notes
