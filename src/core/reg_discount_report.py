# -*- coding: utf-8 -*-
"""掛號費優惠統計：每個月各身分少收了多少掛號費。

基數＝當月一般健保看診最常見的掛號費（每個年度的掛號費不同，所以逐月找）。
優惠＝基數減實收，只算實收比基數低的看診。自費看診、A、B 身分不算。
身分先用掛號當下記在看診上的；舊資料沒有，就用病人主檔現在的身分。
主檔是一般身分卻少收的，依看診當天年齡分：未滿 18、18～24 學生、滿 70、其他。
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from typing import Any

_ALIASES = {"老優": "老人優", "自": "自費"}
_SKIP = {"A", "B"}
_LIVE = "IFNULL(e.queue_status, '') != 'cancelled' AND IFNULL(e.fhir_status, '') != 'cancelled'"
_UNDER_18 = "一般：未滿18歲（當時算S）"
_STUDENT = "一般：18～24歲學生"
_SENIOR = "一般：滿70歲"
_OTHER = "一般：其他手動減免"
_AGE_LABELS = (_UNDER_18, _STUDENT, _SENIOR, _OTHER)


def _col(key: str, label: str, align: str = "left") -> dict[str, str]:
    return {"key": key, "label": label, "align": align}


def _fee(text: Any) -> int | None:
    raw = str(text or "").replace(",", "").strip()
    if not raw:
        return None
    try:
        return int(round(float(raw)))
    except ValueError:
        return None


def _canon(code: str) -> str:
    text = (code or "").strip()
    if len(text) == 1 and text.isalpha():
        text = text.upper()
    return _ALIASES.get(text, text)


def _self_pay(reg: dict[str, Any]) -> bool:
    case = str(reg.get("caseNo") or "").strip()
    return (
        case in {"自", "9X"}
        or str(reg.get("payType") or "").strip() == "自費"
        or str(reg.get("icException") or "").strip() == "selfPay"
    )


def _age(birthday_roc: str, on_iso: str) -> int | None:
    digits = "".join(ch for ch in (birthday_roc or "") if ch.isdigit())
    if len(digits) < 7 or len(on_iso) < 10:
        return None
    try:
        y, m, d = int(digits[:-4]) + 1911, int(digits[-4:-2]), int(digits[-2:])
        vy, vm, vd = int(on_iso[:4]), int(on_iso[5:7]), int(on_iso[8:10])
    except ValueError:
        return None
    return vy - y - ((vm, vd) < (m, d))


def _by_age(age: int | None) -> str:
    """Identity says ordinary, yet the fee was cut. Age at the visit tells which rule did it."""
    if age is None:
        return _OTHER
    if age < 18:
        return _UNDER_18
    if age < 25:
        return _STUDENT
    if age >= 70:
        return _SENIOR
    return _OTHER


def reg_discount_report(conn: Any, date_from: str, date_to: str) -> dict[str, Any]:
    from src.core.encounter_extensions import extract_reg_meta

    rows = conn.execute(
        f"""
        SELECT e.encounter_date, IFNULL(p.id_category, ''), rc.payload_json, IFNULL(p.birthday_roc, '')
        FROM encounter_index e
        LEFT JOIN patient_index p ON p.resource_id = e.patient_id
        LEFT JOIN resource_cache rc ON rc.resource_type = 'Encounter' AND rc.resource_id = e.resource_id
        WHERE e.encounter_date >= ? AND e.encounter_date <= ? AND {_LIVE}
        """,
        (date_from[:10], date_to[:10]),
    ).fetchall()
    visits: list[tuple[str, int, str, int | None]] = []
    base_votes: dict[str, Counter] = defaultdict(Counter)
    for day, current_cat, payload, birthday in rows:
        try:
            reg = extract_reg_meta(json.loads(payload) if payload else {})
        except (TypeError, ValueError):
            continue
        if reg.get("prebook") or _self_pay(reg):
            continue
        fee = _fee(reg.get("regFee"))
        if fee is None:
            continue
        day_s = str(day or "")
        month = day_s[:7]
        cat = _canon(str(reg.get("idCategory") or "") or current_cat)
        visits.append((month, fee, cat, _age(birthday, day_s)))
        if fee > 0:
            base_votes[month][fee] += 1
    base = {m: votes.most_common(1)[0][0] for m, votes in base_votes.items() if votes}

    by_month: dict[str, Counter] = defaultdict(Counter)
    by_cat: dict[str, dict[str, int]] = {}
    for month, fee, cat, age in visits:
        full = base.get(month)
        if not full or fee >= full or cat in _SKIP:
            continue
        label = cat if cat and cat not in {"D", "一般"} else _by_age(age)
        off = full - fee
        by_month[month][label] += off
        rec = by_cat.setdefault(label, {"count": 0, "amount": 0})
        rec["count"] += 1
        rec["amount"] += off

    def order(label: str) -> tuple:
        if label in _AGE_LABELS:
            return (1, _AGE_LABELS.index(label), 0)
        return (0, 0, -by_cat[label]["amount"])

    labels = sorted(by_cat, key=order)
    keys = {label: f"c{i}" for i, label in enumerate(labels)}
    month_rows = []
    for month in sorted(set(base)):
        row: dict[str, Any] = {"month": f"{int(month[:4]) - 1911}.{month[5:7]}", "base": base[month]}
        for label in labels:
            row[keys[label]] = by_month[month].get(label, 0)
        row["total"] = sum(by_month[month].values())
        month_rows.append(row)
    totals: dict[str, Any] = {"month": "合計", "base": ""}
    for label in labels:
        totals[keys[label]] = by_cat[label]["amount"]
    totals["total"] = sum(r["total"] for r in month_rows)

    cat_rows = [
        {
            "cat": label,
            "count": by_cat[label]["count"],
            "amount": by_cat[label]["amount"],
            "avg": round(by_cat[label]["amount"] / by_cat[label]["count"]) if by_cat[label]["count"] else "",
        }
        for label in labels
    ]
    return {
        "title": "掛號費優惠統計",
        "columns": [_col("month", "月份"), _col("base", "掛號費基數", "right")]
        + [_col(keys[label], label, "right") for label in labels]
        + [_col("total", "合計少收", "right")],
        "rows": month_rows,
        "totals": totals,
        "note": (
            "基數是當月一般健保看診最常見的掛號費，所以各年度掛號費不同也照樣算得對。"
            "少收＝基數－實收，只算實收比基數低的看診；自費看診與 A、B 身分不算。"
        ),
        "sections": [
            {
                "title": "依身分合計",
                "columns": [
                    _col("cat", "身分"),
                    _col("count", "人次", "right"),
                    _col("amount", "少收金額", "right"),
                    _col("avg", "平均每次", "right"),
                ],
                "rows": cat_rows,
                "totals": {
                    "cat": "合計",
                    "count": sum(r["count"] for r in cat_rows),
                    "amount": sum(r["amount"] for r in cat_rows),
                    "avg": "",
                },
                "note": (
                    "身分以掛號當下記在看診上的為準；較早的看診沒有記，改用病人現在的身分。"
                    "「一般：」開頭的是主檔登記為一般身分、但當次掛號費比基數低的看診，依看診當天年齡分開："
                    "未滿 18 歲多半是當時還是 S，18～24 歲是學生自報，滿 70 歲是依年齡的老人優惠。"
                ),
            }
        ],
    }
