# -*- coding: utf-8 -*-
"""Statistics for 費用統計 (醫聖 統計資料): disease, visits, drugs, orders, claims.

Every report returns the same shape so one screen can preview, print, and export:
{"title", "columns": [{"key", "label", "align"}], "rows": [...], "totals": {...}, "note"}

Visit date is the filter (醫聖 「看診日期」). Cancelled registrations never count.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any

REPORT_KINDS = ("disease", "opdCount", "drug", "treatment", "claim")

_LIVE = "IFNULL(e.queue_status, '') != 'cancelled' AND IFNULL(e.fhir_status, '') != 'cancelled'"


def _col(key: str, label: str, align: str = "left") -> dict[str, str]:
    return {"key": key, "label": label, "align": align}


def _where(date_from: str, date_to: str, shift: str | None, finished_only: bool) -> tuple[str, list[Any]]:
    sql = f"e.encounter_date >= ? AND e.encounter_date <= ? AND {_LIVE}"
    args: list[Any] = [date_from[:10], date_to[:10]]
    if shift:
        sql += " AND IFNULL(e.shift, '') = ?"
        args.append(shift)
    if finished_only:
        sql += " AND e.queue_status = 'finished'"
    return sql, args


def _visit_total(conn: Any, where: str, args: list[Any]) -> int:
    row = conn.execute(f"SELECT COUNT(*) FROM encounter_index e WHERE {where}", args).fetchone()
    return int(row[0] or 0) if row else 0


def disease_report(
    conn: Any,
    date_from: str,
    date_to: str,
    *,
    shift: str | None = None,
    finished_only: bool = False,
    name_filter: str = "",
) -> dict[str, Any]:
    where, args = _where(date_from, date_to, shift, finished_only)
    sql = f"""
        SELECT COALESCE(NULLIF(c.nhi_icd10_code, ''), NULLIF(c.icd10_code, ''), '') AS code,
               MAX(IFNULL(c.summary_text, '')) AS name,
               COUNT(DISTINCT c.encounter_id) AS visits,
               COUNT(DISTINCT c.patient_id) AS people
        FROM condition_index c
        JOIN encounter_index e ON e.resource_id = c.encounter_id
        WHERE {where}
        GROUP BY code
        ORDER BY visits DESC, code
    """
    total_visits = _visit_total(conn, where, args)
    needle = name_filter.strip().lower()
    rows: list[dict[str, Any]] = []
    for code, name, visits, people in conn.execute(sql, args).fetchall():
        if needle and needle not in f"{code} {name}".lower():
            continue
        rows.append(
            {
                "code": code or "（無碼）",
                "name": name or "",
                "visits": int(visits or 0),
                "people": int(people or 0),
                "share": f"{(int(visits or 0) * 100.0 / total_visits):.1f}%" if total_visits else "—",
            }
        )
    return {
        "title": "疾病統計",
        "columns": [
            _col("code", "病名碼"),
            _col("name", "病名"),
            _col("visits", "人次", "right"),
            _col("people", "人數", "right"),
            _col("share", "佔總人次", "right"),
        ],
        "rows": rows,
        "totals": {"code": "合計", "visits": sum(r["visits"] for r in rows), "people": "", "share": ""},
        "note": f"同一次看診有多個病名時，每個病名各算一次。區間總看診 {total_visits} 人次。",
    }


def opd_count_report(
    conn: Any,
    date_from: str,
    date_to: str,
    *,
    shift: str | None = None,
    finished_only: bool = False,
) -> dict[str, Any]:
    where, args = _where(date_from, date_to, shift, finished_only)
    sql = f"""
        SELECT e.encounter_date, IFNULL(e.shift, ''), COUNT(*), COUNT(DISTINCT e.patient_id)
        FROM encounter_index e
        WHERE {where}
        GROUP BY e.encounter_date, IFNULL(e.shift, '')
        ORDER BY e.encounter_date
    """
    by_day: dict[str, dict[str, Any]] = {}
    for day, sh, visits, _people in conn.execute(sql, args).fetchall():
        rec = by_day.setdefault(day, {"date": day, "morning": 0, "afternoon": 0, "evening": 0, "other": 0, "visits": 0})
        key = {"上午": "morning", "下午": "afternoon", "晚上": "evening"}.get(sh, "other")
        rec[key] += int(visits or 0)
        rec["visits"] += int(visits or 0)
    people_sql = f"""
        SELECT e.encounter_date, COUNT(DISTINCT e.patient_id)
        FROM encounter_index e WHERE {where} GROUP BY e.encounter_date
    """
    for day, people in conn.execute(people_sql, args).fetchall():
        if day in by_day:
            by_day[day]["people"] = int(people or 0)
    rows = [by_day[k] for k in sorted(by_day)]
    for r in rows:
        r.setdefault("people", 0)
        try:
            r["weekday"] = "一二三四五六日"[date.fromisoformat(r["date"]).weekday()]
        except ValueError:
            r["weekday"] = ""
    totals = {"date": "合計", "weekday": f"{len(rows)} 診日"}
    for key in ("morning", "afternoon", "evening", "other", "visits", "people"):
        totals[key] = sum(int(r.get(key) or 0) for r in rows)
    distinct = conn.execute(f"SELECT COUNT(DISTINCT e.patient_id) FROM encounter_index e WHERE {where}", args).fetchone()
    totals["people"] = int(distinct[0] or 0) if distinct else 0
    columns = [
        _col("date", "看診日"),
        _col("weekday", "星期"),
        _col("morning", "上午", "right"),
        _col("afternoon", "下午", "right"),
        _col("evening", "晚上", "right"),
    ]
    if totals["other"]:
        columns.append(_col("other", "未分時段", "right"))
    columns += [_col("visits", "人次", "right"), _col("people", "人數", "right")]
    return {
        "title": "門診人數統計",
        "columns": columns,
        "rows": rows,
        "totals": totals,
        "note": "人次＝掛號筆數（不含刪除的掛號）；人數＝不重複病患。合計列的人數是整個區間不重複。",
    }


def _order_lines(conn: Any, where: str, args: list[Any]) -> list[tuple]:
    sql = f"""
        SELECT m.encounter_id, IFNULL(m.nhi_code, ''), IFNULL(m.drug_text, ''), m.quantity, m.total_qty,
               m.days_supply, IFNULL(m.useage, ''), IFNULL(m.pay_mark, ''), m.unit_price
        FROM medication_request_index m
        JOIN encounter_index e ON e.resource_id = m.encounter_id
        WHERE {where} AND IFNULL(m.status, 'active') NOT IN ('cancelled', 'entered-in-error')
    """
    return conn.execute(sql, args).fetchall()


def _is_service_code(code: str) -> bool:
    """Consult (00xxx) and pharmacy service (05xxx) lines are fees, not drugs or orders."""
    c = code.strip().upper()
    return len(c) <= 6 and (c.startswith("00") or c.startswith("05")) and c[-1:].isalpha()


def drug_report(
    conn: Any,
    date_from: str,
    date_to: str,
    *,
    shift: str | None = None,
    finished_only: bool = False,
    self_pay: str = "exclude",
    usages: dict[str, tuple[float, str]] | None = None,
) -> dict[str, Any]:
    """self_pay: exclude（不含自費）／only（只算自費）／all。"""
    from src.claims.engine import _billed_quantity
    from src.claims.yisheng_rules import is_order_code

    where, args = _where(date_from, date_to, shift, finished_only)
    usages = usages or {}
    agg: dict[str, dict[str, Any]] = {}
    encs: dict[str, set[str]] = defaultdict(set)
    for enc_id, code, text, qty, total_qty, days, sig, pay_mark, price in _order_lines(conn, where, args):
        if is_order_code(code) or _is_service_code(code):
            continue
        is_self = pay_mark.strip() == "自"
        if self_pay == "exclude" and is_self:
            continue
        if self_pay == "only" and not is_self:
            continue
        key = code.strip().upper() or f"#{text.strip()}"
        _dose, billed = _billed_quantity(
            raw_qty=float(qty or 0),
            qty_known=qty is not None,
            days=int(days or 0),
            sig=sig,
            nhi_code=code,
            usages=usages,
            total_qty=total_qty,
        )
        rec = agg.setdefault(
            key,
            {"code": code.strip(), "name": text.strip(), "times": 0, "selfTimes": 0, "days": 0, "qty": 0.0, "amount": 0.0},
        )
        if not rec["name"] and text.strip():
            rec["name"] = text.strip()
        rec["times"] += 1
        rec["selfTimes"] += 1 if is_self else 0
        rec["days"] += int(days or 0)
        rec["qty"] += float(billed or 0)
        if price is not None:
            rec["amount"] += float(price) * float(billed or 0)
        encs[key].add(enc_id)
    rows = []
    for key, rec in agg.items():
        rec["visits"] = len(encs[key])
        rec["qty"] = round(rec["qty"], 2)
        rec["amount"] = round(rec["amount"], 1)
        rows.append(rec)
    rows.sort(key=lambda r: (-r["times"], r["code"]))
    label = {"exclude": "不含自費", "only": "只有自費", "all": "健保＋自費"}.get(self_pay, "")
    return {
        "title": f"藥品統計（{label}）",
        "columns": [
            _col("code", "藥品代碼"),
            _col("name", "藥名"),
            _col("times", "開立筆數", "right"),
            _col("visits", "人次", "right"),
            _col("selfTimes", "其中自費", "right"),
            _col("days", "天數合計", "right"),
            _col("qty", "總量", "right"),
            _col("amount", "金額(單價×總量)", "right"),
        ],
        "rows": rows,
        "totals": {
            "code": "合計",
            "name": f"{len(rows)} 項",
            "times": sum(r["times"] for r in rows),
            "visits": "",
            "selfTimes": sum(r["selfTimes"] for r in rows),
            "days": "",
            "qty": "",
            "amount": round(sum(r["amount"] for r in rows), 1),
        },
        "note": "總量依用法換算（與申報同一套規則）。金額＝開藥當下記錄的單價×總量，不是申報點數。",
    }


def treatment_report(
    conn: Any,
    date_from: str,
    date_to: str,
    *,
    shift: str | None = None,
    finished_only: bool = False,
    self_pay: str = "all",
) -> dict[str, Any]:
    from src.claims.yisheng_rules import is_order_code

    where, args = _where(date_from, date_to, shift, finished_only)
    agg: dict[str, dict[str, Any]] = {}
    encs: dict[str, set[str]] = defaultdict(set)
    for enc_id, code, text, qty, _total, _days, _sig, pay_mark, price in _order_lines(conn, where, args):
        if not is_order_code(code):
            continue
        is_self = pay_mark.strip() == "自"
        if self_pay == "exclude" and is_self:
            continue
        if self_pay == "only" and not is_self:
            continue
        key = code.strip().upper()
        name = text.strip()
        if "^" in name and name.split("^", 1)[0].strip().upper() == key:
            name = name.split("^", 1)[1].strip()
        rec = agg.setdefault(key, {"code": key, "name": name, "times": 0, "selfTimes": 0, "qty": 0.0, "amount": 0.0})
        if len(name) > len(rec["name"]):
            rec["name"] = name
        q = float(qty or 1)
        rec["times"] += 1
        rec["selfTimes"] += 1 if is_self else 0
        rec["qty"] += q
        if price is not None:
            rec["amount"] += float(price) * q
        encs[key].add(enc_id)
    rows = []
    for key, rec in agg.items():
        rec["visits"] = len(encs[key])
        rec["qty"] = round(rec["qty"], 2)
        rec["amount"] = round(rec["amount"], 1)
        rows.append(rec)
    rows.sort(key=lambda r: (-r["times"], r["code"]))
    return {
        "title": "診療統計（處置／檢驗）",
        "columns": [
            _col("code", "醫令代碼"),
            _col("name", "名稱"),
            _col("times", "次數", "right"),
            _col("visits", "人次", "right"),
            _col("selfTimes", "其中自費", "right"),
            _col("qty", "數量合計", "right"),
            _col("amount", "金額(單價×數量)", "right"),
        ],
        "rows": rows,
        "totals": {
            "code": "合計",
            "name": f"{len(rows)} 項",
            "times": sum(r["times"] for r in rows),
            "visits": "",
            "selfTimes": sum(r["selfTimes"] for r in rows),
            "qty": "",
            "amount": round(sum(r["amount"] for r in rows), 1),
        },
        "note": "只算處置與檢驗醫令（不含診察費、藥事服務費、藥品）。",
    }


def _months_between(date_from: str, date_to: str) -> list[str]:
    y, m = int(date_from[:4]), int(date_from[5:7])
    y2, m2 = int(date_to[:4]), int(date_to[5:7])
    out: list[str] = []
    while (y, m) <= (y2, m2):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


CLAIM_REPORT_MAX_MONTHS = 6


def claim_report(store: Any, date_from: str, date_to: str) -> dict[str, Any]:
    """申報統計：用月申報同一個引擎算點數，再依案件分類加總。"""
    from src.claims.engine import build_claims_summary

    months = _months_between(date_from, date_to)
    if len(months) > CLAIM_REPORT_MAX_MONTHS:
        raise ValueError(f"申報統計一次最多 {CLAIM_REPORT_MAX_MONTHS} 個月，請縮短起迄。")
    keys = ("consult", "drug", "treat", "pharmacy", "copay", "total", "apply")
    by_case: dict[str, dict[str, Any]] = {}
    skipped = 0
    for ym in months:
        summary = build_claims_summary(store, ym)
        for rec in summary.records:
            if not (date_from[:10] <= (rec.encounterDate or "")[:10] <= date_to[:10]):
                continue
            if not rec.claimable:
                skipped += 1
                continue
            case = rec.caseNo or "01"
            row = by_case.setdefault(case, {"case": case, "count": 0, **{k: 0.0 for k in keys}})
            row["count"] += 1
            row["consult"] += float(rec.consultationPoints or 0)
            row["drug"] += float(rec.drugPoints or 0)
            row["treat"] += float(rec.treatmentPoints or 0)
            row["pharmacy"] += float(rec.pharmacyPoints or 0)
            row["copay"] += float(rec.copayPoints or 0)
            row["total"] += float(rec.totalPoints or 0)
            row["apply"] += float(rec.applyPoints or 0)
    rows = [by_case[k] for k in sorted(by_case)]
    for r in rows:
        for k in keys:
            r[k] = int(round(r[k]))
    totals: dict[str, Any] = {"case": "合計", "count": sum(r["count"] for r in rows)}
    for k in keys:
        totals[k] = sum(r[k] for r in rows)
    return {
        "title": "申報統計（依案件分類）",
        "columns": [
            _col("case", "案件"),
            _col("count", "件數", "right"),
            _col("consult", "診察費", "right"),
            _col("drug", "藥費", "right"),
            _col("treat", "診療費", "right"),
            _col("pharmacy", "藥事費", "right"),
            _col("total", "合計點數", "right"),
            _col("copay", "部分負擔", "right"),
            _col("apply", "申請點數", "right"),
        ],
        "rows": rows,
        "totals": totals,
        "note": (
            "點數與月申報同一個引擎（只算完診、可申報的案件）。"
            + (f"另有 {skipped} 筆不進申報檔（自費、押金未退等）。" if skipped else "")
        ),
    }
