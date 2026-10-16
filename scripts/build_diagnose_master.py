# -*- coding: utf-8 -*-
"""Build the diagnosis master from Yisheng DIAGNOSE.Dat + ICD10.Dat.

Clinic catalog (visit menu) stays the INDEX=Y rows.
The diagnosis screen reads frontend/public/yisheng_diagnose.json.
An ICD-9 with no ICD-10 in either file is filled by the GEM crosswalk.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.import_yisheng_data import read_dbf_records
from src.core.icd_crosswalk import map_code


def clean(value: str) -> str:
    return (value or "").replace("\x00", "").strip()


def bare(value: str) -> str:
    return "".join(ch for ch in clean(value).upper() if ch.isalnum())


def main() -> int:
    dat = Path(r"Z:\SC\dat")
    links: dict[str, list[dict[str, str]]] = {}
    by_icd10: dict[str, tuple[str, str]] = {}
    for row in read_dbf_records(str(dat / "ICD10.Dat")):
        icd9 = bare(row.get("ICD_9CODE") or "")
        icd10 = bare(row.get("ICD_10CODE") or "")
        if not icd9 or not icd10:
            continue
        en = clean(row.get("ICD_10EN") or "")
        zh = clean(row.get("ICD_10CH") or "")
        match = clean(row.get("MATCH") or "")
        bucket = links.setdefault(icd9, [])
        if any(item["icd10"] == icd10 for item in bucket):
            continue
        bucket.append({"icd10": icd10, "en": en, "zh": zh, "match": match})
        by_icd10.setdefault(icd10, (en, zh))
    for bucket in links.values():
        bucket.sort(key=lambda item: (-int(item["match"] or "0"), item["icd10"]))
        for item in bucket:
            item.pop("match", None)

    cross_cache: dict[str, str] = {}

    def crosswalk(icd9: str) -> str:
        if icd9 not in cross_cache:
            mapped = map_code(icd9)
            cross_cache[icd9] = bare(mapped.icd10)
        return cross_cache[icd9]

    rows_out: list[dict] = []
    catalog_dx: list[dict] = []
    stats = {"file": 0, "dat": 0, "crosswalk": 0, "empty": 0}
    categories: set[str] = set()
    for row in read_dbf_records(str(dat / "DIAGNOSE.Dat")):
        short = clean(row.get("SICK_NO") or "")
        if not short:
            continue
        icd9 = bare(row.get("A_CODE") or "")
        stored = bare(row.get("ICD_10CODE") or "")
        related = links.get(icd9, [])
        if stored:
            icd10 = stored
            source = "file"
        elif related:
            icd10 = related[0]["icd10"]
            source = "dat"
        elif icd9:
            icd10 = crosswalk(icd9)
            source = "crosswalk" if icd10 else ""
        else:
            icd10 = ""
            source = ""
        stats[source or "empty"] += 1
        en10, zh10 = by_icd10.get(icd10, ("", ""))
        if not en10:
            for item in related:
                if item["icd10"] == icd10:
                    en10, zh10 = item["en"], item["zh"]
                    break
        name_en = clean(row.get("SICK_NAME") or "")
        name_zh = clean(row.get("SICK_NAME1") or "")
        category = clean(row.get("TYPE") or "")
        if category:
            categories.add(category)
        enabled = clean(row.get("INDEX") or "").upper()
        item = {
            "short": short,
            "nameEn": name_en,
            "nameZh": name_zh,
            "icd9": icd9,
            "aCode": bare(row.get("ACODE") or "") or icd9,
            "icd10": icd10,
            "icd10From": source,
            "icd10En": en10,
            "icd10Zh": zh10,
            "special": clean(row.get("SPECIAL") or ""),
            "category": category,
            "enabled": enabled,
            "sort": clean(row.get("SORT") or ""),
            "typeSort": clean(row.get("TYPESORT") or ""),
            "group": clean(row.get("DRGROUP") or ""),
        }
        rows_out.append(item)
        if enabled == "Y":
            catalog_dx.append(
                {
                    "icd10": icd10,
                    "text": name_en or name_zh or short,
                    "short": short,
                    "snomed": "",
                    "nhiIcd10": icd10,
                    "icd9": icd9,
                    "nameEn": name_en,
                    "nameZh": name_zh,
                    "aCode": item["aCode"],
                    "category": category,
                    "special": item["special"],
                    "enabled": "Y",
                }
            )

    used = {row["icd9"] for row in rows_out if row["icd9"]}
    link_out = {code: links[code] for code in used if code in links}
    out = {
        "rows": rows_out,
        "links": link_out,
        "categories": sorted(categories),
    }
    dest = ROOT / "frontend" / "public" / "yisheng_diagnose.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    catalog_path = ROOT / "frontend" / "public" / "yisheng_clinic_catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    catalog["diagnoses"] = catalog_dx
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        "rows",
        len(rows_out),
        "enabled",
        len(catalog_dx),
        "links",
        len(link_out),
        "stats",
        stats,
        "diagnoseMB",
        round(dest.stat().st_size / 1e6, 2),
        "catalogMB",
        round(catalog_path.stat().st_size / 1e6, 2),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
