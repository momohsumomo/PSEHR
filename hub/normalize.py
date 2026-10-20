"""正規化健保用藥列 → 穩定鍵與型別。"""

from __future__ import annotations

import re
from typing import Any


def _s(v: Any) -> str:
    if v is None:
        return ""
    return str(v).strip()


def _fda_lic_id(v: Any) -> str:
    """健保 FDA_URL 的 licId（通常 8 碼：前綴 + 許可證 6 位字號）。"""
    s = _s(v)
    if not s:
        return ""
    m = re.search(r"licId=(\d+)", s, re.I)
    if m:
        return m.group(1)
    if s.isdigit():
        return s
    return ""


def _price(v: Any) -> float | None:
    s = _s(v)
    if not s:
        return None
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None


def roc_yyyymmdd_to_iso(v: Any) -> str | None:
    """民國 YYYMMDD / YYYYMMDD → YYYY-MM-DD；無法解析則 None。"""
    s = _s(v).replace("/", "").replace("-", "")
    if not s.isdigit():
        return None
    # 民國 84年03月01日 is 6 digits. 100年11月30日 is 7. Western is 8.
    if len(s) == 6:
        y = int(s[0:2]) + 1911
        m, d = int(s[2:4]), int(s[4:6])
    elif len(s) == 7:
        y = int(s[0:3]) + 1911
        m, d = int(s[3:5]), int(s[5:7])
    elif len(s) == 8:
        y, m, d = int(s[0:4]), int(s[4:6]), int(s[6:8])
    else:
        return None
    if not (1 <= m <= 12 and 1 <= d <= 31 and y >= 1912):
        return None
    return f"{y:04d}-{m:02d}-{d:02d}"


def normalize_record(raw: dict[str, Any]) -> dict[str, Any] | None:
    code = _s(raw.get("Q1_ID") or raw.get("藥品代號"))
    if not code:
        return None
    start = roc_yyyymmdd_to_iso(raw.get("START_DATE") or raw.get("有效起日"))
    end = roc_yyyymmdd_to_iso(raw.get("END_DATE") or raw.get("有效迄日"))
    price = _price(raw.get("PRICE") or raw.get("支付價") or raw.get("參考價"))
    return {
        "nhiCode": code,
        "nameEn": _s(raw.get("NAME") or raw.get("藥品英文名稱")),
        "nameZh": _s(raw.get("EXPR1") or raw.get("藥品中文名稱")),
        "ingredient": _s(raw.get("CLASSGROUPNAME") or raw.get("成分")),
        "price": price,
        "startDate": start,
        "endDate": end,
        "isUpdate": _s(raw.get("IS_UPDATE") or raw.get("異動")),
        "atc": _s(raw.get("ATC_CODE") or raw.get("ATC代碼")),
        "form": _s(raw.get("DRUG_FORM") or raw.get("劑型")),
        "vendor": _s(raw.get("SALES") or raw.get("藥商")),
        "manufacturer": _s(raw.get("FIRM_NAME") or raw.get("製造廠名稱")),
        "payCode": _s(raw.get("PAY_CODE") or raw.get("給付規定章節")),
        "fdaLicId": _fda_lic_id(raw.get("FDA_URL") or raw.get("fdaLicId")),
        # 健保用藥檔本身沒有分級；由 control_join 用食藥署開放資料填入
        "controlClass": _s(
            raw.get("管制藥品分類")
            or raw.get("CONTROL_CLASS")
            or raw.get("管制級別")
            or raw.get("管制區分")
            or raw.get("管制藥品分類級別")
            or raw.get("controlClass")
        ),
    }


def row_key(row: dict[str, Any]) -> str:
    """同一藥品同一價期。"""
    return f"{row['nhiCode']}|{row.get('startDate') or ''}|{row.get('endDate') or ''}"


def normalize_records(raw_rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """key → normalized row（後寫覆蓋前寫）。"""
    out: dict[str, dict[str, Any]] = {}
    for raw in raw_rows:
        row = normalize_record(raw)
        if not row:
            continue
        out[row_key(row)] = row
    return out
