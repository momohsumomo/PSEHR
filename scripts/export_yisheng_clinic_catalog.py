#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Export clinic catalog from Yisheng SC/dat -> frontend/public/yisheng_clinic_catalog.json

Sources (?????t MEDICAL.Dat?A????B????g???v FHIR)?G
  TRADE_NAME = ???O????t??~?W
  NOTE       = ???????????????]???O???W?^
  MAKING     = ?E???w???W?]?e???W??^o??^
  ALIAS_NO   = ??J??X?]???X??r Enter ??W?^
  USEAGE/DAY/QTY/CODE = ?w?]??k???????q?????O?X
  DIAGNOSE.Dat -> diagnoses
  MEDISET.Dat  -> packages (if present)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.import_yisheng_data import read_dbf_records


def _clean(s: str) -> str:
    return re.sub(r"[\x00-\x1f]", "", (s or "")).strip()


def _num(s: str, default: float = 0.0) -> float:
    t = _clean(s)
    if not t:
        return default
    try:
        return float(t)
    except ValueError:
        return default


def _days(s: str) -> int | float:
    v = _num(s, 0.0)
    if v <= 0:
        return 0
    if abs(v - round(v)) < 1e-6:
        return int(round(v))
    return v


def _route(row: dict[str, str]) -> str:
    """醫聖途徑短碼：優先 MEDICAL.USE_TYPE（po/im/ext…），否則依 CAST。"""
    use_type = _clean(row.get("USE_TYPE") or "").lower()
    if use_type in {
        "po",
        "im",
        "iv",
        "ivd",
        "ivp",
        "sc",
        "ext",
        "skin",
        "topi",
        "rect",
        "vag",
        "inhl",
        "sl",
        "na",
    }:
        return "ext" if use_type == "topi" else use_type
    cast = _clean(row.get("CAST") or "")
    typ = _clean(row.get("TYPE") or "")
    cat = cast or typ
    if cat == "\u5916\u7528":
        return "ext"
    if cat == "\u6ce8\u5c04":
        return "im"
    if cat in ("\u6cbb\u7642", "\u624b\u8853"):
        return "ext"
    if cat == "\u5167\u670d":
        return "po"
    if cat == "\u7279\u6750":
        return "ext"
    if cat == "\u6aa2\u67e5":
        return "exam"
    return "po"


_DRUG_CAST_OK = frozenset(
    {
        "\u5167\u670d",
        "\u5916\u7528",
        "\u6ce8\u5c04",
        "\u6cbb\u7642",
        "\u7279\u6750",
        "\u624b\u8853",
    }
)
_DRUG_CAST_SKIP = frozenset({"\u6aa2\u67e5", "\u865b\u64ec", "\u8ad6\u8cea\u6aa2\u9a57"})


def map_drug(row: dict[str, str]) -> dict | None:
    drug_no = _clean(row.get("DRUG_NO") or "")
    if not drug_no:
        return None
    cast = _clean(row.get("CAST") or "")
    typ = _clean(row.get("TYPE") or "")
    index_y = _clean(row.get("INDEX") or "").upper() == "Y"
    # 論質、虛擬不進下拉。檢查只收診所自己有開的（INDEX=Y），整包健保檢驗不灌。
    if typ in {"\u8ad6\u8cea\u6aa2\u9a57", "\u865b\u64ec"} or cast == "\u865b\u64ec":
        return None
    if (cast in _DRUG_CAST_SKIP or typ in _DRUG_CAST_SKIP) and not index_y:
        return None
    if cast not in _DRUG_CAST_OK and cast != "\u6aa2\u67e5" and typ not in {"\u5167\u670d", "\u5916\u7528", "\u6cbb\u7642"}:
        return None
    trade = _clean(row.get("TRADE_NAME") or "")
    note = _clean(row.get("NOTE") or "")
    making = _clean(row.get("MAKING") or "")
    cht = _clean(row.get("CHT_NAME") or "")
    alias = _clean(row.get("ALIAS_NO") or "")
    custom = making or cht or trade or note
    if not custom:
        return None
    nhi = _clean(row.get("CODE") or "")
    sig = _clean(row.get("USEAGE") or "")
    mark = _clean(row.get("ISSELF") or "")
    self_pay = mark == "\u81ea" or mark.upper() in {"Y", "1", "T"}
    pay_mark = "\u4ea4" if mark == "\u4ea4" else ("\u81ea" if self_pay else "")
    qty = _num(row.get("QTY") or "", 0.0)
    return {
        "drugNo": drug_no,
        "customName": custom,
        "shortName": alias or custom[:40],
        "alias": alias,
        "nhiCode": nhi,
        "sig": sig,
        "days": _days(row.get("DAY") or ""),
        "qty": qty if qty > 0 else None,
        "route": _route(row),
        "selfPay": self_pay,
        "payMark": pay_mark,
        "clinicIndex": _clean(row.get("INDEX") or "").upper() == "Y",
        "name": trade or custom,
        "generic": note or making,
    }


def map_dx(row: dict[str, str]) -> dict | None:
    sick_no = _clean(row.get("SICK_NO") or "")
    # 醫聖顯示：SICK_NAME；下拉只收 INDEX=Y（診所啟用快碼）
    # 空的 ICD-10 要再跑 scripts/build_diagnose_master.py，用 ICD10.Dat 與 GEM 補上。
    name_en = _clean(row.get("SICK_NAME") or "")
    name_zh = _clean(row.get("SICK_NAME1") or "")
    name = name_en or name_zh
    icd10 = _clean(row.get("ICD_10CODE") or "")
    icd9 = _clean(row.get("A_CODE") or "")
    if _clean(row.get("INDEX") or "").upper() != "Y":
        return None
    if not name and not icd10 and not sick_no:
        return None
    return {
        "icd10": icd10,
        "text": name or icd10 or sick_no,
        "short": sick_no or name[:20],
        "snomed": "",
        "nhiIcd10": icd10,
        "icd9": icd9,
        "nameEn": name_en,
        "nameZh": name_zh,
        "aCode": _clean(row.get("ACODE") or "") or icd9,
        "category": _clean(row.get("TYPE") or ""),
        "special": _clean(row.get("SPECIAL") or ""),
        "enabled": "Y",
    }


def map_usage(row: dict[str, str]) -> dict | None:
    code = _clean(row.get("USEAGE") or "")
    if not code:
        return None
    if _clean(row.get("INDEX") or "").upper() != "Y":
        return None
    freq = _num(row.get("FREQUENCY") or "", 0.0)
    return {
        "code": code,
        "frequency": int(freq) if freq > 0 else 0,
        "isTotal": _clean(row.get("ISTOTAL") or "") or "0",
        "eatType": _clean(row.get("EATTYPE") or ""),
        "label": _clean(row.get("EATTYPE") or ""),
        "useageNo": _clean(row.get("USEAGE_NO") or ""),
    }


def map_packages(rows: list[dict[str, str]]) -> list[dict]:
    groups: dict[str, dict] = {}
    for r in rows:
        set_no = _clean(r.get("SET_NO") or r.get("KEYWORD") or r.get("CODE") or "")
        name = _clean(r.get("SET_NAME") or r.get("NAME") or r.get("NOTE") or "")
        drug_no = _clean(r.get("DRUG_NO") or "")
        if not set_no and not name:
            continue
        key = set_no or name
        g = groups.setdefault(
            key,
            {
                "id": key,
                "code": set_no or key,
                "name": name or set_no or key,
                "dxCode": _clean(r.get("SICK_NO") or r.get("DIAGNOSE") or ""),
                "lines": [],
                "items": [],
            },
        )
        if name and (not g["name"] or g["name"] == g["code"]):
            g["name"] = name
        if drug_no:
            line = {
                "drugNo": drug_no,
                "qty": _num(r.get("QTY") or "", 1.0) or 1.0,
                "sig": _clean(r.get("USEAGE") or ""),
                "days": _days(r.get("DAY") or ""),
            }
            g["lines"].append(line)
            g["items"].append(line)
    return [g for g in groups.values() if g["lines"]]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sc-root", default=r"Z:\SC")
    ap.add_argument(
        "--out",
        default=str(ROOT / "frontend" / "public" / "yisheng_clinic_catalog.json"),
    )
    args = ap.parse_args()
    dat = Path(args.sc_root) / "dat"
    if not dat.is_dir():
        dat = Path(args.sc_root) / "DAT"
    if not dat.is_dir():
        print(f"dat not found under {args.sc_root}")
        return 1

    drugs = []
    for r in read_dbf_records(str(dat / "MEDICAL.Dat")):
        d = map_drug(r)
        if d:
            drugs.append(d)

    diagnoses = []
    diag_path = dat / "DIAGNOSE.Dat"
    if diag_path.is_file():
        for r in read_dbf_records(str(diag_path)):
            dx = map_dx(r)
            if dx:
                diagnoses.append(dx)

    packages: list[dict] = []
    set_path = dat / "MEDISET.Dat"
    if set_path.is_file():
        packages = map_packages(read_dbf_records(str(set_path)))

    usages: list[dict] = []
    use_path = dat / "USEAGE.Dat"
    if use_path.is_file():
        for r in read_dbf_records(str(use_path)):
            u = map_usage(r)
            if u:
                usages.append(u)

    out = {
        "drugs": drugs,
        "diagnoses": diagnoses,
        "packages": packages,
        "usages": usages,
        "routes": [
            "po",
            "im",
            "iv",
            "ivd",
            "ivp",
            "sc",
            "ext",
            "rect",
            "skin",
            "vag",
            "inhl",
            "na",
            "sl",
        ],
        "_meta": {
            "source": str(dat),
            "medicalCount": len(drugs),
            "diagnoseCount": len(diagnoses),
            "packageCount": len(packages),
            "usageCount": len(usages),
            "fields": {
                "displayName": "MEDICAL.MAKING",
                "alias": "MEDICAL.ALIAS_NO",
                "tradeName": "MEDICAL.TRADE_NAME",
                "ingredientNote": "MEDICAL.NOTE",
                "sig": "MEDICAL.USEAGE",
                "days": "MEDICAL.DAY",
                "qty": "MEDICAL.QTY",
                "usageTable": "USEAGE.Dat",
            },
        },
    }
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(out, ensure_ascii=False, indent=2)
    out_path.write_text(text, encoding="utf-8")
    dist = ROOT / "frontend" / "dist" / "yisheng_clinic_catalog.json"
    if dist.parent.is_dir():
        dist.write_text(text, encoding="utf-8")

    with_sig = sum(1 for d in drugs if d.get("sig"))
    with_days = sum(1 for d in drugs if d.get("days"))
    idx_y = sum(1 for d in drugs if d.get("clinicIndex"))
    print(f"Wrote {out_path}")
    print(f"  drugs={len(drugs)} (clinic CAST only; INDEX=Y {idx_y}; sig={with_sig}, days={with_days})")
    print(f"  diagnoses={len(diagnoses)} (INDEX=Y only) packages={len(packages)} usages={len(usages)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
