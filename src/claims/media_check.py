# -*- coding: utf-8 -*-
"""Western outpatient claim check.

Format failures are required fixes. Audit-risk rows are warnings and still export.
Specialty content stays in clinic templates, not in this module.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from src.claims.engine import COPAY_NOTE, REFERRAL_OUT_FEE, ClaimEncounterRecord
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
# Returning every few days with the same diagnosis is normal. Only a month this heavy is worth a look.
_REPEAT_DX_MANY = 6
_MSG_REPEAT = "\u540c\u4e00\u4eba\u540c\u4e00\u4e3b\u75c5\u540d\u672c\u6708\u5df2\u7533\u5831 %d \u6b21" % _REPEAT_DX_MANY
_MSG_SAME_DAY = "\u540c\u65e5\u7533\u8acb\u4e8c\u7b46"
_MSG_DEPOSIT_OPEN = "\u62bc\u91d1\u9084\u6c92\u9000\uff0c\u9019\u7b46\u5148\u4e0d\u7533\u5831\u3002\u9001\u6a94\u524d\u5e36\u5361\u56de\u4f86\u9000\u62bc\u5c31\u6703\u56de\u5230\u7533\u5831"
_MSG_UNFINISHED = "\u9084\u6c92\u5b8c\u8a3a\uff0c\u4e0d\u5728\u7533\u5831\u6a94\u88e1\u3002\u8acb\u5148\u5b8c\u8a3a\u6216\u9000\u639b"


def add_unfinished(report: dict[str, Any], visits: list[dict[str, str]]) -> dict[str, Any]:
    """Visits still waiting or in the room are left out of the file. Say so on the list."""
    if not visits:
        return report
    extra = [
        {
            "medicalNo": v.get("medicalNo", ""),
            "encounterDate": v.get("encounterDate", ""),
            "caseNo": "",
            "code": "unfinished",
            "message": _MSG_UNFINISHED,
        }
        for v in visits
    ]
    report["warnings"] = (extra + list(report.get("warnings") or []))[:_DETAIL_LIMIT]
    report["warnCount"] = int(report.get("warnCount") or 0) + len(extra)
    report["unfinished"] = len(extra)
    return report
_MSG_EXT_PRIMARY = "\u4e3b\u8a3a\u65b7\u4e0d\u80fd\u653e\u5916\u56e0\u78bc\uff0c\u8acb\u6539\u653e\u53d7\u50b7\u90e8\u4f4d\uff0c\u5916\u56e0\u78bc\u62ff\u6389"
_MSG_EXT_SECOND = "\u6b21\u8a3a\u65b7\u6709\u5916\u56e0\u78bc\u3002\u9580\u8a3a\u7533\u5831\u6c92\u6709\u7368\u7acb\u5916\u56e0\u6b04\uff0c\u9019\u78bc\u6703\u9032\u6b21\u8a3a\u65b7\u3002\u53ea\u7559\u53d7\u50b7\u90e8\u4f4d\u5373\u53ef"


_MSG_REFERRAL_OUT = "\u6709\u8fa6\u7406\u8f49\u8a3a\u8cbb\uff0801036C\uff09\uff0c\u4f46\u627e\u4e0d\u5230\u8f49\u5f80\u9662\u6240\u3002\u8acb\u5230\u96fb\u5b50\u8f49\u8a3a\u88dc\u4e0a\u9019\u6b21\u7684\u8f49\u51fa\u55ae"
_MSG_DX_NAMED = "\u75c5\u540d "
_MSG_FEMALE_ONLY = "\u9650\u5973\u6027\uff0c\u9019\u4f4d\u662f\u7537\u6027\u3002\u8acb\u91ab\u5e2b\u6539\u75c5\u540d"
_MSG_MALE_ONLY = "\u9650\u7537\u6027\uff0c\u9019\u4f4d\u662f\u5973\u6027\u3002\u8acb\u91ab\u5e2b\u6539\u75c5\u540d"
# NHI rejects these (W1 male only, W2 female only) when the patient's sex differs.
_FEMALE_ONLY = ("N7", "N8", "N90", "N91", "N92", "N93", "N94", "N95", "N96", "N97", "N98", "O",
                "C51", "C52", "C53", "C54", "C55", "C56", "C57", "C58", "D06", "D25", "D26", "D27", "D28")
_MALE_ONLY = ("N40", "N41", "N42", "N43", "N44", "N45", "N46", "N47", "N48", "N49", "N50", "N51", "N52", "N53",
              "C60", "C61", "C62", "C63", "D29")


def _sex_of(rec: ClaimEncounterRecord) -> str:
    raw = (rec.sex or "").strip().upper()
    if raw in {"M", "MALE", "1"}:
        return "M"
    if raw in {"F", "FEMALE", "2"}:
        return "F"
    ident = (rec.patientId or "").strip().upper()
    if len(ident) == 10 and ident[0].isalpha() and ident[1] in "12":
        return "M" if ident[1] == "1" else "F"
    return ""


def _sex_mismatch(code: str, sex: str) -> str:
    if sex == "M" and code.startswith(_FEMALE_ONLY):
        return _MSG_FEMALE_ONLY
    if sex == "F" and code.startswith(_MALE_ONLY):
        return _MSG_MALE_ONLY
    return ""


def _drug_line(code: str) -> bool:
    text = (code or "").strip().upper()
    if not text or is_order_code(text):
        return False
    if text.startswith("00") or text.startswith("052") or text.startswith("MA"):
        return False
    if len(text) >= 4 and text[0] in {"R", "S"} and text[1:4].isdigit():
        return False
    return True


def _external_cause(code: str) -> bool:
    """ICD-10-CM external cause. Outpatient d19 cannot hold one."""
    text = (code or "").replace(".", "").strip().upper()
    return len(text) >= 3 and text[0] in {"V", "W", "X", "Y"}


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
    primary_count: dict[tuple[str, str], int] = defaultdict(int)

    ordered = sorted(
        claimable,
        key=lambda rec: (rec.encounterDate or "", rec.medicalNo or "", rec.encounterId),
    )
    for rec in ordered:
        chart = rec.medicalNo or ""
        day = (rec.encounterDate or "")[:10]
        ident = (rec.patientId or "").strip().upper()
        base = {
            "medicalNo": chart,
            "encounterDate": day,
            "caseNo": rec.caseNo or "",
            "encounterId": rec.encounterId,
            "chartPatientId": rec.chartPatientId or "",
            "patientName": rec.patientName or "",
        }

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

        sex = _sex_of(rec)
        for code in codes:
            wrong = _sex_mismatch(code, sex)
            if wrong:
                blocks.append({**base, "code": "dx-sex", "message": _MSG_DX_NAMED + code + " " + wrong})
                break
        if not (rec.referralOutHosp or "").strip() and any(
            (line.nhiCode or "").strip().upper() in REFERRAL_OUT_FEE for line in rec.medications
        ):
            blocks.append({**base, "code": "referral-out", "message": _MSG_REFERRAL_OUT})

        primary = _primary(rec)
        if _external_cause(primary):
            blocks.append({**base, "code": "dx-external", "message": _MSG_EXT_PRIMARY})
        elif any(_external_cause(code) for code in codes[1:]):
            warns.append({**base, "code": "dx-external-2", "message": _MSG_EXT_SECOND})
        if primary.startswith(("Z0", "Z1")) and (rec.caseNo or "") not in _PREVENTIVE_CASE:
            warns.append({**base, "code": "a3", "message": _MSG_A3})
        if int(rec.daysSupply or 0) > 31:
            warns.append({**base, "code": "days", "message": _MSG_DAYS})
        if cfg.max_lines_warn and len(rec.medications) > int(cfg.max_lines_warn):
            warns.append({**base, "code": "too-many-lines", "message": "\u85e5\u54c1\u6216\u8655\u7f6e\u8d85\u904e %d \u7b46" % int(cfg.max_lines_warn)})
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
            code = "copay" if note == COPAY_NOTE else "note"
            warns.append({**base, "code": code, "message": note})

        count_same_day = True
        if rec.caseNo == "A3" and not cfg.same_day_include_a3:
            count_same_day = False
        if ident and day and count_same_day:
            by_person_day[(ident, day)] += 1
        if ident and primary:
            key = (ident, primary)
            primary_count[key] += 1
            if primary_count[key] == _REPEAT_DX_MANY:
                warns.append({**base, "code": "dx-repeat", "message": _MSG_REPEAT})

    deposits: list[dict[str, str]] = []
    for rec in records:
        if rec.claimable or not getattr(rec, "depositOpen", False):
            continue
        deposits.append({
            "medicalNo": rec.medicalNo or "",
            "encounterDate": (rec.encounterDate or "")[:10],
            "caseNo": rec.caseNo or "",
            "code": "deposit-open",
            "message": _MSG_DEPOSIT_OPEN,
        })

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

    warns = deposits + warns
    return {
        "ok": len(blocks) == 0,
        "canExport": len(blocks) == 0 and len(claimable) > 0,
        "blockCount": len(blocks),
        "warnCount": len(warns),
        "blocks": blocks[:_DETAIL_LIMIT],
        "warnings": warns[:_DETAIL_LIMIT],
        "claimable": len(claimable),
    }
