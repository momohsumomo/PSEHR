"""把食藥署管制分級對到健保藥碼（官方檔，不猜、不經診所 VPN）。"""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

_NAME_JUNK = re.compile(r'[\s"“”「」『』\'`]+')
_PERMIT_NUM = re.compile(r"字第(\d+)號")
_LIC_ID = re.compile(r"licId=(\d+)", re.I)


def fold_name(v: Any) -> str:
    s = "" if v is None else str(v)
    return _NAME_JUNK.sub("", s).upper()


def permit_serial6(permit_no: str) -> str:
    m = _PERMIT_NUM.search(permit_no or "")
    if not m:
        return ""
    return m.group(1).zfill(6)[-6:]


def fda_lic_serial6(lic_or_url: str) -> str:
    s = (lic_or_url or "").strip()
    m = _LIC_ID.search(s)
    digits = m.group(1) if m else (s if s.isdigit() else "")
    if len(digits) < 6:
        return digits.zfill(6) if digits else ""
    return digits[-6:]


def normalize_control_class(raw: Any) -> str:
    """
    正規成 1–4；「取消管制藥品註記」視為非管制（空字串）。
    無法辨識的官方字串不亂猜，原樣留下（少見）。
    """
    s = "" if raw is None else str(raw).strip()
    if not s:
        return ""
    if "取消" in s:
        return ""
    if s in {"1", "2", "3", "4"}:
        return s
    for i, word in enumerate(("第一級", "第二級", "第三級", "第四級"), start=1):
        if word in s:
            return str(i)
    return s


def _pick_class(classes: set[str]) -> str:
    cleaned = {normalize_control_class(c) for c in classes}
    cleaned.discard("")
    if len(cleaned) == 1:
        return next(iter(cleaned))
    return ""


def apply_control_classes(
    rows: dict[str, dict[str, Any]],
    *,
    licenses: list[dict[str, Any]],
    sales: list[dict[str, Any]],
) -> dict[str, Any]:
    """原地填 controlClass。銷售一覽表（有健保碼）優先於藥證 join。"""
    by_serial: dict[str, list[dict[str, str]]] = defaultdict(list)
    license_controlled = 0
    for raw in licenses:
        permit = str(raw.get("許可證字號") or "").strip()
        serial = permit_serial6(permit)
        cls = normalize_control_class(raw.get("管制藥品分類級別"))
        rec = {
            "permit": permit,
            "serial": serial,
            "controlClass": cls,
            "nameEn": fold_name(raw.get("英文品名")),
            "nameZh": fold_name(raw.get("中文品名")),
        }
        if serial:
            by_serial[serial].append(rec)
        if cls:
            license_controlled += 1

    sales_by_code: dict[str, str] = {}
    for raw in sales:
        code = str(raw.get("健保藥品代碼") or raw.get("nhiCode") or "").strip()
        cls = normalize_control_class(raw.get("管制級別") or raw.get("controlClass"))
        if code and cls:
            prev = sales_by_code.get(code)
            if prev and prev != cls:
                sales_by_code.pop(code, None)
                continue
            sales_by_code[code] = cls

    matched_sales = 0
    matched_license = 0
    ambiguous = 0
    for row in rows.values():
        code = str(row.get("nhiCode") or "").strip()
        if code and code in sales_by_code:
            row["controlClass"] = sales_by_code[code]
            matched_sales += 1
            continue

        serial = fda_lic_serial6(str(row.get("fdaLicId") or ""))
        candidates = by_serial.get(serial, []) if serial else []
        if not candidates:
            continue
        en, zh = fold_name(row.get("nameEn")), fold_name(row.get("nameZh"))
        named = [c for c in candidates if (en and c["nameEn"] == en) or (zh and c["nameZh"] == zh)]
        if named:
            pool = named
        elif len({c["permit"] for c in candidates}) == 1:
            pool = candidates
        else:
            ambiguous += 1
            continue
        picked = _pick_class({c["controlClass"] for c in pool})
        if picked:
            row["controlClass"] = picked
            matched_license += 1

    index: dict[str, str] = {}
    for row in rows.values():
        code = str(row.get("nhiCode") or "").strip()
        cls = normalize_control_class(row.get("controlClass"))
        if code and cls:
            index[code] = cls
    for code, cls in sales_by_code.items():
        index.setdefault(code, cls)

    return {
        "licenseRows": len(licenses),
        "licenseControlledRows": license_controlled,
        "salesRows": len(sales),
        "salesWithNhiCode": len(sales_by_code),
        "matchedSales": matched_sales,
        "matchedLicense": matched_license,
        "ambiguousSkipped": ambiguous,
        "indexCount": len(index),
        "controlledByNhiCode": index,
    }
