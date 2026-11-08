# -*- coding: utf-8 -*-
"""費用統計裡的月申報報表（醫聖 送核申報金額總表、申報統計分析、藥師調劑點數）。

都用月申報同一個引擎（build_claims_summary）算，一次一個費用年月。
回傳與 clinic_reports 相同的形狀，多一個 sections：[{title, columns, rows, totals, note}]。
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date
from typing import Any

MONTH_REPORT_KINDS = ("claimSheet", "claimAnalysis", "pharmacist")

_CASE_NAME = {"01": "一般案件", "04": "西醫慢性病", "09": "西醫專案", "08": "慢性病連續處方"}


def _col(key: str, label: str, align: str = "left") -> dict[str, str]:
    return {"key": key, "label": label, "align": align}


def _roc_month(ym: str) -> str:
    return f"{int(ym[:4]) - 1911}{ym[5:7]}"


def _ratio(a: float, b: float, digits: int = 1) -> str:
    return f"{a / b:.{digits}f}" if b else "—"


def _pct(a: float, b: float) -> str:
    return f"{a * 100.0 / b:.1f}%" if b else "—"


def _summary(store: Any, ym: str):
    from src.claims.engine import build_claims_summary

    return build_claims_summary(store, ym)


def _claimed(summary: Any) -> list[Any]:
    return [r for r in summary.records if r.claimable and (r.caseNo or "01") in {"01", "04", "09", "08"}]


def _staff_names(store: Any) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        with store._connect() as conn:
            for name, nhi in conn.execute("SELECT name, nhi_id FROM clinic_staff").fetchall():
                if nhi and name:
                    out[str(nhi).strip()] = str(name).strip()
    except Exception:
        pass
    return out


def claim_sheet_report(store: Any, ym: str) -> dict[str, Any]:
    """送核申報金額總表：依案件的件數與送核點數，加上每位醫師的合理門診量分段。"""
    from src.claims.yisheng_rules import consult_schedule

    summary = _summary(store, ym)
    claimed = _claimed(summary)
    names = _staff_names(store)
    by_case: dict[str, dict[str, Any]] = {}
    for rec in claimed:
        case = rec.caseNo or "01"
        row = by_case.setdefault(case, {"case": case, "name": _CASE_NAME.get(case, ""), "count": 0, "apply": 0.0})
        row["count"] += 1
        row["apply"] += float(rec.applyPoints or 0)
    order = {"04": 0, "01": 1, "09": 2, "08": 3}
    rows = sorted(by_case.values(), key=lambda r: (order.get(r["case"], 9), r["case"]))
    for r in rows:
        r["apply"] = int(round(r["apply"]))
    other = [r for r in summary.records if not r.claimable]
    if other:
        rows.append(
            {
                "case": "自",
                "name": "自費／不申報",
                "count": len(other),
                "apply": int(round(sum(float(r.totalPoints or 0) for r in other))),
            }
        )
    totals = {
        "case": "",
        "name": "申報總件數（不含自費）",
        "count": len(claimed),
        "apply": int(round(sum(float(r.applyPoints or 0) for r in claimed))),
    }

    ladder: dict[tuple[str, str, int], int] = Counter()
    days_by_doc: dict[str, set[str]] = defaultdict(set)
    for rec in claimed:
        doc = rec.doctorId or "_"
        days_by_doc[doc].add((rec.encounterDate or "")[:10])
        ladder[(doc, rec.consultCode or "", int(round(float(rec.consultationPoints or 0))))] += 1
    first_day = f"{ym}-01"
    cap, bands = consult_schedule(first_day)
    span: dict[str, str] = {}
    start = 1
    for code, _pts, width in bands:
        if code in span:
            continue
        span[code] = f"{start:03d}~{start + width - 1:03d}" if width else f"{start:03d}~"
        start += width
    band_order = {code: i for i, (code, _pts, _width) in enumerate(bands)}
    ladder_rows: list[dict[str, Any]] = []
    for (doc, code, pts), count in sorted(ladder.items(), key=lambda kv: (kv[0][0], band_order.get(kv[0][1], 99), kv[0][2])):
        seen = len(days_by_doc[doc])
        ladder_rows.append(
            {
                "doctor": names.get(doc, doc),
                "code": code,
                "days": f"{seen}天",
                "capDays": f"{min(seen, cap)}天",
                "points": pts,
                "count": count,
                "amount": pts * count,
                "range": span.get(code, ""),
            }
        )
    ladder_total = {
        "doctor": "合計",
        "code": "",
        "days": "",
        "capDays": "",
        "points": "",
        "count": sum(r["count"] for r in ladder_rows),
        "amount": sum(r["amount"] for r in ladder_rows),
        "range": "",
    }

    people = len({r.patientId for r in claimed if r.patientId})
    full_consult = sum(float(r.consultFull or r.consultationPoints or 0) for r in claimed)
    paid_consult = sum(float(r.consultationPoints or 0) for r in claimed)
    full_pharm = sum(float(r.pharmacyFull or r.pharmacyPoints or 0) for r in claimed)
    paid_pharm = sum(float(r.pharmacyPoints or 0) for r in claimed)
    apply_after = totals["apply"]
    apply_before = int(round(apply_after + (full_consult - paid_consult) + (full_pharm - paid_pharm)))
    adjust_rows = [
        {"item": "調整前申請點數（診察費都用第一段、藥事費不扣超量）", "points": apply_before},
        {"item": "合理門診量：診察費分段後少掉", "points": -int(round(full_consult - paid_consult))},
        {"item": "藥師每日超過 80／100 件：藥事費少掉", "points": -int(round(full_pharm - paid_pharm))},
    ]
    return {
        "title": f"送核申報金額總表（費用年月 {_roc_month(ym)}）",
        "columns": [
            _col("case", "案件"),
            _col("name", "類別"),
            _col("count", "件數", "right"),
            _col("apply", "申請點數", "right"),
        ],
        "rows": rows,
        "totals": totals,
        "note": (
            f"門診數（不含自費）{len(claimed)}；門診人次（不重複病人）{people}；"
            f"門診覆診率 {_ratio(len(claimed), people, 2)}。申請點數＝總點數扣部分負擔，就是月申報檔的申請點數。"
        ),
        "sections": [
            {
                "title": "合理門診量（每位醫師當月一個池）",
                "columns": [
                    _col("doctor", "醫師"),
                    _col("code", "診察碼"),
                    _col("days", "看診天數", "right"),
                    _col("capDays", "合理量天數", "right"),
                    _col("points", "點數", "right"),
                    _col("count", "人次", "right"),
                    _col("amount", "金額", "right"),
                    _col("range", "每日合理量範圍"),
                ],
                "rows": ladder_rows,
                "totals": ladder_total,
                "note": f"本月合理量天數上限 {cap} 天。00110C 有多列是未滿 6 歲、75 歲以上的加成點數。",
            },
            {
                "title": "調整前與調整後",
                "columns": [_col("item", "項目"), _col("points", "點數", "right")],
                "rows": adjust_rows,
                "totals": {"item": "調整後送核申請點數", "points": apply_after},
                "note": "醫聖的「調整前」是每一筆都用第一段診察費算，「調整後」才是真正送核的數字。",
            },
        ],
    }


def claim_analysis_report(store: Any, ym: str) -> dict[str, Any]:
    """門診費用申請統計分析表：依案件的各類點數、平均值、給藥天數分布。點數是調整前。"""
    summary = _summary(store, ym)
    claimed = _claimed(summary)
    total_count = len(claimed)

    def bucket(recs: list[Any], case: str, label: str) -> dict[str, Any]:
        own = [r for r in recs if r.dispense != "1"]
        e = sum(float(r.drugPoints or 0) for r in own)
        f = sum(float(r.drugPoints or 0) for r in recs if r.dispense == "1")
        g = sum(float(r.pharmacyFull or r.pharmacyPoints or 0) for r in recs)
        h = sum(float(r.treatmentPoints or 0) for r in recs)
        i = sum(float(r.consultFull or r.consultationPoints or 0) for r in recs)
        kj = e + f + g + h + i
        j = sum(float(r.copayPoints or 0) for r in recs)
        days = sum(int(r.daysSupply or 0) for r in recs)
        c = len(recs)
        m = len({r.patientId for r in recs if r.patientId})
        return {
            "case": case,
            "label": label,
            "count": c,
            "drug": int(round(e)),
            "drugOut": int(round(f)),
            "pharmacy": int(round(g)),
            "treat": int(round(h)),
            "consult": int(round(i)),
            "claimed": int(round(kj)),
            "copay": int(round(j)),
            "apply": int(round(kj - j)),
            "days": days,
            "share": _pct(c, total_count),
            "drugPerDay": _ratio(e + f, days),
            "drugPerCase": _ratio(e + f, c),
            "treatPerCase": _ratio(h, c),
            "claimPerCase": _ratio(kj, c),
            "people": m,
            "visitsPer": _ratio(c, m, 2),
        }

    by_case: dict[str, list[Any]] = defaultdict(list)
    for rec in claimed:
        by_case[rec.caseNo or "01"].append(rec)
    rows = [bucket(by_case[k], k, _CASE_NAME.get(k, "")) for k in sorted(by_case)]
    chronic = by_case.get("04", []) + by_case.get("08", [])
    if chronic:
        rows.append(bucket(chronic, "04+08", "慢性病"))
    totals = bucket(claimed, "總計", "")

    dist = Counter(int(r.daysSupply or 0) for r in claimed)
    keys = sorted(dist)
    sum_days = sum(d * n for d, n in dist.items())
    day_cols = [_col("item", "給藥天數")] + [_col(f"d{d}", f"{d}天", "right") for d in keys] + [_col("all", "合計", "right")]
    day_rows = [
        {"item": "給藥件數", **{f"d{d}": dist[d] for d in keys}, "all": total_count},
        {"item": "件數比例", **{f"d{d}": _pct(dist[d], total_count) for d in keys}, "all": "100.0%" if total_count else "—"},
        {"item": "合計天數", **{f"d{d}": d * dist[d] for d in keys}, "all": sum_days},
        {"item": "天數比例", **{f"d{d}": _pct(d * dist[d], sum_days) for d in keys}, "all": "100.0%" if sum_days else "—"},
    ]
    return {
        "title": f"門診費用申請統計分析表（費用年月 {_roc_month(ym)}）",
        "columns": [
            _col("case", "案件"),
            _col("count", "(C)件數", "right"),
            _col("drug", "(E)日調用藥", "right"),
            _col("drugOut", "(F)交調用藥", "right"),
            _col("pharmacy", "(G)藥事費用", "right"),
            _col("treat", "(H)處置金額", "right"),
            _col("consult", "(I)診察費用", "right"),
            _col("claimed", "(K+J)申報金額", "right"),
            _col("copay", "(J)部分負擔", "right"),
            _col("apply", "(K)申請金額", "right"),
            _col("days", "(L)天數", "right"),
            _col("share", "C/Z件數百分比", "right"),
            _col("drugPerDay", "(E+F)/L日平均藥價", "right"),
            _col("drugPerCase", "(E+F)/C件平均藥價", "right"),
            _col("treatPerCase", "H/C平均診療費", "right"),
            _col("claimPerCase", "(K+J)/C平均申報", "right"),
            _col("people", "(M)就診人次", "right"),
            _col("visitsPer", "C/M平均就診", "right"),
        ],
        "rows": rows,
        "totals": totals,
        "note": (
            "與醫聖相同，這張的診察費、藥事費是調整前（診察費都用第一段、藥事費不扣每日超量）；"
            "真正送核的點數看「送核申報金額總表」。(04+08) 列是慢性病合計，不再加進總計。"
        ),
        "sections": [{"title": "給藥天數分布", "columns": day_cols, "rows": day_rows, "totals": {}, "note": ""}],
    }


def pharmacist_report(store: Any, ym: str) -> dict[str, Any]:
    """藥師調劑點數：每位藥師每天調劑人數，與各調劑碼的人數、申請點數。"""
    summary = _summary(store, ym)
    names = _staff_names(store)
    dispensed = [r for r in _claimed(summary) if r.pharmacyCode and r.dispense != "1"]
    people: dict[str, Counter] = defaultdict(Counter)
    codes: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    for rec in dispensed:
        who = rec.pharmacistId or rec.pharmacist or "（未填藥師）"
        day = (rec.encounterDate or "")[:10]
        people[who][day] += 1
        row = codes[who].setdefault(rec.pharmacyCode, {"code": rec.pharmacyCode, "base": Counter(), "count": 0, "points": 0.0})
        row["count"] += 1
        row["points"] += float(rec.pharmacyPoints or 0)
        if rec.pharmacyBase:
            row["base"][int(round(float(rec.pharmacyBase)))] += 1
    year, month = int(ym[:4]), int(ym[5:7])
    days: list[str] = []
    d = date(year, month, 1)
    while d.month == month:
        days.append(d.isoformat())
        d = date.fromordinal(d.toordinal() + 1)
    order = sorted(people, key=lambda w: -sum(people[w].values()))
    label = {w: names.get(w, w) for w in order}
    columns = [_col("date", "日期"), _col("weekday", "星期")] + [_col(f"p{i}", f"{label[w]} 人數", "right") for i, w in enumerate(order)]
    rows = []
    for day in days:
        row: dict[str, Any] = {"date": day[5:].replace("-", "/"), "weekday": "一二三四五六日"[date.fromisoformat(day).weekday()]}
        for i, w in enumerate(order):
            row[f"p{i}"] = people[w].get(day, 0)
        rows.append(row)
    totals: dict[str, Any] = {"date": "合計", "weekday": ""}
    for i, w in enumerate(order):
        totals[f"p{i}"] = sum(people[w].values())
    sections = []
    for w in order:
        code_rows = []
        for code in sorted(codes[w]):
            row = codes[w][code]
            base = row["base"].most_common(1)[0][0] if row["base"] else ""
            code_rows.append({"code": code, "base": base, "count": row["count"], "points": int(round(row["points"]))})
        sections.append(
            {
                "title": f"藥師：{label[w]}",
                "columns": [
                    _col("code", "調劑碼"),
                    _col("base", "基礎點數", "right"),
                    _col("count", "人數", "right"),
                    _col("points", "申請點數", "right"),
                ],
                "rows": code_rows,
                "totals": {
                    "code": "合計",
                    "base": "",
                    "count": sum(r["count"] for r in code_rows),
                    "points": sum(r["points"] for r in code_rows),
                },
                "note": "",
            }
        )
    return {
        "title": f"藥師調劑點數（費用年月 {_roc_month(ym)}）",
        "columns": columns,
        "rows": rows,
        "totals": totals,
        "note": "只算自行調劑、有藥事服務費的申報案件。05234D 是同日第 81～100 件半價，超過 100 件為 0 點。",
        "sections": sections,
    }


def month_report(store: Any, kind: str, date_from: str) -> dict[str, Any]:
    ym = (date_from or "")[:7]
    if len(ym) != 7:
        raise ValueError("起日格式錯誤")
    if kind == "claimSheet":
        return claim_sheet_report(store, ym)
    if kind == "claimAnalysis":
        return claim_analysis_report(store, ym)
    return pharmacist_report(store, ym)
