# -*- coding: utf-8 -*-
"""Western outpatient claim check.

Format failures are required fixes. Audit-risk rows are warnings and still export.
Specialty content stays in clinic templates, not in this module.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from src.claims.engine import ClaimEncounterRecord
from src.claims.yisheng_rules import is_order_code

_CASES = {
    "01", "02", "04", "06", "08", "09",
    "A3", "B6", "B7", "B8", "B9", "C1", "D1", "D2", "DF", "E1",
}
_PREVENTIVE_CASE = {"A3", "B9"}
_DETAIL_LIMIT = 80

_MSG_ID = "\u8eab\u5206\u8b49\u672a\u586b"
_MSG_BIRTH = "\u751f\u65e5\u672a\u586b"
_MSG_CASE = "\u6848\u4ef6\u4ee3\u865f\u7a7a\u767d"
_MSG_CASE_UNKNOWN = "\u6848\u4ef6\u4ee3\u865f\u4e0d\u5728\u897f\u91ab\u9580\u8a3a\u5e38\u7528\u6e05\u55ae"
_MSG_DX = "\u6c92\u75c5\u540d"
_MSG_DOCTOR = "\u7533\u5831\u91ab\u5e2b\u7a7a\u767d"
_MSG_SUM = "\u85e5\u8cbb\u52a0\u7e3d\u8207\u91ab\u4ee4\u4e0d\u5408"
_MSG_PRICE = "\u6c92\u6709\u55ae\u50f9\u6216\u55ae\u50f9\u4e0d\u7b26"
_MSG_DX_DUP = "\u540c\u4e00\u7b46\u75c5\u540d\u91cd\u8907"
_MSG_A3 = "\u4e3b\u75c5\u540d\u4f46\u672a\u639b A3 \u6216 B9 \u6848\u4ef6"
_MSG_DAYS = "\u7d66\u85e5\u8d85\u904e 31 \u5929"
_MSG_REPEAT = "\u75c5\u540d\u91cd\u8907"
_MSG_SAME_DAY = "\u540c\u65e5\u7533\u8acb\u4e8c\u7b46"


def _drug_line(code: str) -> bool:
    text = (code or "").strip().upper()
    if not text or is_order_code(text):
        return False
    if text.startswith("00") or text.startswith("052") or text.startswith("MA"):
        return False
    if len(text) >= 4 and text[0] in {"R", "S"} and text[1:4].isdigit():
        return False
    return True


def _day_gap(left: str, right: str) -> int:
    from datetime import date

    try:
        a = date.fromisoformat(left[:10])
        b = date.fromisoformat(right[:10])
    except ValueError:
        return 9999
    return abs((a - b).days)


def _primary(rec: ClaimEncounterRecord) -> str:
    if rec.diagnosisCodes:
        return rec.diagnosisCodes[0].replace(".", "").upper()
    return ""


def check_media(records: list[ClaimEncounterRecord], settings: Any = None) -> dict[str, Any]:
    """Block rows fail the file. Warning rows stay in the export."""
    from src.claims.claim_settings import load_claim_settings
    from src.claims.case_rules import is_outside_dispense

    cfg = settings or load_claim_settings()
    claimable = [rec for rec in records if rec.claimable]
    blocks: list[dict[str, str]] = []
    warns: list[dict[str, str]] = []
    by_person_day: dict[tuple[str, str], int] = defaultdict(int)
    primary_seen: dict[tuple[str, str], str] = {}

    ordered = sorted(
        claimable,
        key=lambda rec: (rec.encounterDate or "", rec.medicalNo or "", rec.encounterId),
    )
    for rec in ordered:
        chart = rec.medicalNo or ""
        day = (rec.encounterDate or "")[:10]
        ident = (rec.patientId or "").strip().upper()
        base = {"medicalNo": chart, "encounterDate": day, "caseNo": rec.caseNo or ""}

        if len(ident) != 10:
            blocks.append({**base, "code": "id", "message": _MSG_ID})
        if not (rec.birthdayRoc or rec.birthDate or "").strip():
            blocks.append({**base, "code": "birthday", "message": _MSG_BIRTH})
        if not (rec.caseNo or "").strip():
            blocks.append({**base, "code": "case", "message": _MSG_CASE})
        elif rec.caseNo not in _CASES:
            warns.append({**base, "code": "case-unknown", "message": _MSG_CASE_UNKNOWN})
        if not rec.diagnosisCodes:
            blocks.append({**base, "code": "dx", "message": _MSG_DX})
        if not (rec.doctorId or "").strip():
            blocks.append({**base, "code": "doctor", "message": _MSG_DOCTOR})

        line_sum = round(sum(float(line.linePoints or 0) for line in rec.medications), 2)
        filed = round(float(rec.drugPoints or 0) + float(rec.treatmentPoints or 0), 2)
        if abs(line_sum - filed) > 0.05:
            blocks.append({**base, "code": "drug-sum", "message": _MSG_SUM})

        for line in rec.medications:
            if not _drug_line(line.nhiCode):
                continue
            if line.priceSource == "missing" or line.unitPrice is None:
                warns.append({**base, "code": "price", "message": _MSG_PRICE})
                break

        codes = [code.replace(".", "").upper() for code in rec.diagnosisCodes if code]
        if len(codes) != len(set(codes)):
            warns.append({**base, "code": "dx-dup", "message": _MSG_DX_DUP})

        primary = _primary(rec)
        if primary.startswith(("Z0", "Z1")) and (rec.caseNo or "") not in _PREVENTIVE_CASE:
            warns.append({**base, "code": "a3", "message": _MSG_A3})
        if int(rec.daysSupply or 0) > 31:
            warns.append({**base, "code": "days", "message": _MSG_DAYS})
        if cfg.max_lines_warn and len(rec.medications) > int(cfg.max_lines_warn):
            warns.append({**base, "code": "too-many-lines", "message": "\u85e5\u54c1\u6216\u8655\u7f6e\u8d85\u904e %d \u7b46" % int(cfg.max_lines_warn)})
        if cfg.qty_less_than_dose:
            for line in rec.medications:
                dose = line.doseEach
                if dose is not None and float(line.quantity or 0) < float(dose):
                    warns.append({**base, "code": "qty", "message": "\u7e3d\u91cf\u5c0f\u65bc\u6b21\u91cf"})
                    break
        if not cfg.card_missing_silent and not (rec.treatSeq or "").strip():
            warns.append({**base, "code": "card", "message": "\u5361\u865f\u672a\u586b"})
        if cfg.dispense_mismatch_warn and is_outside_dispense(rec.dispense):
            warns.append({**base, "code": "dispense", "message": "\u6279\u50f9\u8abf\u5291\u65b9\u5f0f\u8207\u9662\u6240\u4e0d\u540c"})
        excluded = (cfg.simple_table_exclude_order or "").upper()
        if rec.caseNo == "01":
            for line in rec.medications:
                code = (line.nhiCode or "").upper()
                if code == excluded:
                    continue
                if is_order_code(code) and float(line.linePoints or 0) > 0:
                    warns.append({**base, "code": "simple-table", "message": "01\u7c21\u8868\u4e0d\u7b26\u898f\u5b9a"})
                    break
        if cfg.compare_month_price:
            from src.spoke.drug_price import lookup_drug_price

            for line in rec.medications:
                if not getattr(line, "billable", True):
                    continue
                if not _drug_line(line.nhiCode) or line.unitPrice is None:
                    continue
                looked = lookup_drug_price(line.nhiCode, day)
                if not looked:
                    continue
                try:
                    pack_price = float(looked["unitPrice"])
                except (TypeError, ValueError, KeyError):
                    continue
                if abs(pack_price - float(line.unitPrice)) > 0.009:
                    warns.append({**base, "code": "pack-price", "message": "\u55ae\u50f9\u8207\u7576\u6708\u5065\u4fdd\u85e5\u50f9\u4e0d\u7b26"})
                    break
        for note in rec.claimNotes:
            warns.append({**base, "code": "note", "message": note})

        count_same_day = True
        if rec.caseNo == "A3" and not cfg.same_day_include_a3:
            count_same_day = False
        if ident and day and count_same_day:
            by_person_day[(ident, day)] += 1
        if ident and primary:
            key = (ident, primary)
            first = primary_seen.get(key)
            gap = int(cfg.repeat_dx_days or 0)
            repeat = False
            if first and first != day:
                if cfg.repeat_dx_month_only:
                    repeat = first[:7] == day[:7]
                elif gap <= 0:
                    repeat = True
                else:
                    repeat = _day_gap(first, day) <= gap
            if repeat:
                warns.append({**base, "code": "dx-repeat", "message": _MSG_REPEAT})
            elif not first:
                primary_seen[key] = day

    seen_day: set[tuple[str, str]] = set()
    for rec in ordered:
        ident = (rec.patientId or "").strip().upper()
        day = (rec.encounterDate or "")[:10]
        if not ident or not day or by_person_day[(ident, day)] < 2:
            continue
        if (ident, day) in seen_day:
            continue
        seen_day.add((ident, day))
        warns.append({
            "medicalNo": rec.medicalNo or "",
            "encounterDate": day,
            "caseNo": rec.caseNo or "",
            "code": "same-day",
            "message": _MSG_SAME_DAY,
        })

    return {
        "ok": len(blocks) == 0,
        "canExport": len(blocks) == 0 and len(claimable) > 0,
        "blockCount": len(blocks),
        "warnCount": len(warns),
        "blocks": blocks[:_DETAIL_LIMIT],
        "warnings": warns[:_DETAIL_LIMIT],
        "claimable": len(claimable),
        "settingsSource": str(getattr(cfg, "source", "")),
        "acuteChronicTo09": bool(cfg.acute_chronic_to_09),
        "repeatDxDays": int(cfg.repeat_dx_days or 0),
        "repeatDxMonthOnly": bool(cfg.repeat_dx_month_only),
    }
