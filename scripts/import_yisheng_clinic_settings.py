#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Import Yisheng clinic settings (SCINI/Sc.ini/Frame.Set) and staff (PEOPLE.Dat).

Sources:
  - scinis.dat / SCINI.Dat: setting catalog
  - Sc.ini: runtime values (Editscini)
  - Frame.Set / HospInfo.Set: org header + fee/workflow defaults
  - PEOPLE.Dat: HR master

Writes shadow DB:
  - clinic_runtime_settings.yisheng_scini_v1
  - clinic_runtime_settings.clinic_profile_v1
  - clinic_staff (replace from PEOPLE)
  - id_category_settings (aligned to reg fee / senior discount)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.import_yisheng_data import read_dbf_records
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore

PROFILE_KEY = "clinic_profile_v1"
SCINI_KEY = "yisheng_scini_v1"

# Traditional Chinese keys as unicode (file stays ASCII-safe)
K_SELF_PAY = "\u81ea\u8cbb\u6848\u4ef6\u639b\u865f\u8cbb\u7528"
K_SENIOR_AMT = "\u5e7e\u6b72\u4ee5\u4e0a\u512a\u5f85\u7684\u91d1\u984d"
K_CHILD_FEE = "\u5c0f\u65bc\u4e09\u6b72\u639b\u8cbb"
K_A3_FEE = "A3 \u6210\u5065\u7684\u639b\u865f\u8cbb"
K_CHILD_CARE = "A3 \u5152\u7ae5\u9810\u9632\u4fdd\u5065\u7684\u639b\u865f\u8cbb"
K_ORAL = "A3 \u53e3\u8154\u7be9\u6aa2\u639b\u865f\u8cbb"
K_HIST = "\u639b\u865f\u6b77\u53f2\u75c5\u6b77\u56de\u63a8\u6b21\u6578"
K_CONSULT = "\u81ea\u8cbb\u6848\u4ef6(\u5370)\u7684\u8a3a\u5bdf\u8cbb\u91d1\u984d"
K_DEP_DAYS = "\u9084\u55ae\u4f5c\u696d\u756b\u9762\u7684\u62bc\u55ae\u8cc7\u6599\u8981\u5411\u524d\u63a8\u5e7e\u5929"
T_LEFT = "\u96e2\u8077"
T_ACTIVE = "\u5728\u8077"
T_DEAN = "\u9662\u9577"
T_DR = "\u91ab\u5e2b"
T_ATTENDING = "\u4e3b\u6cbb\u91ab\u5e2b"
T_PHARM = "\u85e5\u5e2b"
T_STAFF = "\u540c\u4ec1"
C_SENIOR = "\u8001\u4eba\u512a"
DEF_REGION = "A \u672c\u5cf6\u5e73\u5730\u5730\u5340"
DEF_DISPENSE = "0 \u81ea\u884c\u8abf\u5291"
DEF_GRADE = "D \u57fa\u5c64\u9662\u6240"
DEF_DEPT = "11 \u76ae\u819a\u79d1"


def _clean(s: str) -> str:
    return re.sub(r"[\x00-\x1f]", "", (s or "")).strip()


def _to_int(s: str, default: int | None = None) -> int | None:
    t = _clean(s).replace(",", "")
    if not t:
        return default
    try:
        return int(float(t))
    except ValueError:
        return default


def parse_set_file(path: Path) -> list[tuple[str, int, str]]:
    raw = path.read_bytes()
    fields: list[tuple[str, int, str]] = []
    i = 0
    n = len(raw)
    while i < n:
        typ = raw[i : i + 1]
        if typ not in b"CNAX":
            i += 1
            continue
        if typ == b"N":
            if i + 3 > n:
                break
            try:
                ln = int(raw[i + 1 : i + 3])
            except ValueError:
                i += 1
                continue
            start = i + 3
        else:
            if i + 5 > n:
                break
            try:
                ln = int(raw[i + 1 : i + 5])
            except ValueError:
                i += 1
                continue
            start = i + 5
        end = start + ln
        if end > n:
            break
        payload = raw[start:end]
        if typ == b"A":
            i = start
            continue
        text = payload.decode("cp950", errors="replace")
        fields.append((typ.decode("ascii"), ln, text))
        if typ == b"X":
            break
        i = end
    return fields


def parse_sc_ini(path: Path) -> dict[str, dict[str, str]]:
    text = path.read_bytes().decode("cp950", errors="replace")
    sections: dict[str, dict[str, str]] = {}
    cur: str | None = None
    for line in text.splitlines():
        line = line.strip("\ufeff").rstrip()
        if not line or line.startswith(";") or line.startswith("#"):
            continue
        m = re.match(r"^\[([^\]]+)\]\s*$", line)
        if m:
            cur = m.group(1).strip()
            sections.setdefault(cur, {})
            continue
        if cur is None or "=" not in line:
            continue
        key, val = line.split("=", 1)
        sections[cur][key.strip()] = val.strip()
    return sections


def _ini_get(sections: dict[str, dict[str, str]], section: str, key: str, default: str = "") -> str:
    want_sec = section.casefold()
    want_key = key.casefold()
    for sec, items in sections.items():
        if sec.casefold() != want_sec:
            continue
        for k, v in items.items():
            if k.casefold() == want_key:
                return v
    return default


def load_scini_catalog(dat_path: Path) -> list[dict[str, Any]]:
    rows = read_dbf_records(str(dat_path))
    out: list[dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "seqNo": _clean(r.get("SEQNO") or ""),
                "section": _clean(r.get("SECTION") or ""),
                "entry": _clean(r.get("ENTRY") or ""),
                "valueDefault": _clean(r.get("VALUE") or ""),
                "canEdit": _clean(r.get("CANEDIT") or ""),
                "combox": _clean(r.get("COMBOX") or ""),
                "picture": _clean(r.get("PICTURE") or ""),
                "desc": _clean(r.get("DESC") or ""),
                "public": _clean(r.get("LPUBLIC") or ""),
                "group": _clean(r.get("GROUP") or ""),
                "group1": _clean(r.get("GROUP1") or ""),
            }
        )
    return out


def build_profile_from_sources(
    frame_fields: list[tuple[str, int, str]],
    hosp_fields: list[tuple[str, int, str]],
    sections: dict[str, dict[str, str]],
) -> dict[str, Any]:
    cvals = [c for t, _n, c in frame_fields if t == "C"]
    nvals = [c for t, _n, c in frame_fields if t == "N"]

    def c_at(i: int, default: str = "") -> str:
        return _clean(cvals[i]) if i < len(cvals) else default

    def n_at(i: int, default: int | None = None) -> int | None:
        if i >= len(nvals):
            return default
        return _to_int(nvals[i], default)

    if hosp_fields:
        hc = [c for t, _n, c in hosp_fields if t == "C"]
        if len(hc) >= 5 and not c_at(0):
            cvals = hc + cvals

    fee_blob = c_at(7)
    fee_parts = fee_blob.split()
    reg_opd = _to_int(fee_parts[0], 100) if fee_parts else 100
    reg_er = _to_int(fee_parts[1], reg_opd) if len(fee_parts) > 1 else reg_opd

    deposit = n_at(0, 300)
    default_days = n_at(3, 3)
    grind_age = n_at(4, 6)
    med_cap = n_at(5, 3000)
    proc_cap = n_at(6, 5000)
    history_n = n_at(7, 16)
    senior_age = n_at(8, 70)

    phone = c_at(2)
    if phone and not phone.startswith("0") and re.match(r"^\d", phone):
        phone = "0" + phone

    self_pay = _to_int(_ini_get(sections, "Register", K_SELF_PAY), 300) or 300
    senior_disc = _to_int(_ini_get(sections, "Register", K_SENIOR_AMT), 50) or 50
    _child_fee = _to_int(_ini_get(sections, "Register", K_CHILD_FEE), -1)
    adult_checkup = _to_int(_ini_get(sections, "Register", K_A3_FEE), 0) or 0
    child_care = _to_int(_ini_get(sections, "Register", K_CHILD_CARE), 0) or 0
    cancer = _to_int(_ini_get(sections, "Register", K_ORAL), 0) or 0
    hist_ini = _to_int(_ini_get(sections, "Register", K_HIST), None)
    if hist_ini is not None:
        history_n = hist_ini
    consult = _to_int(_ini_get(sections, "Price", K_CONSULT), 0) or 0
    deposit_days = _to_int(_ini_get(sections, "Register", K_DEP_DAYS), 30)
    if deposit_days is None or deposit_days <= 0:
        deposit_days = 30

    # C-only index map (Frame.Set after stripping A/N/X):
    # 0 code 1 name 2 phone 3 blank 4 addr 5 dept 6 preview 7 "100 100 0"
    # 8 float 9 TID/AC 10 QID/PC 11 paper 12 region 13 dispense
    # 14 Y 15 showAll 16 printMode 17 zip 18 priceDecide 19 F188
    # 20 blank 21 grade 22 printId ...
    code = c_at(0) or "3521013662"
    profile = {
        "clinicGrade": c_at(21) or DEF_GRADE,
        "region": c_at(12) or DEF_REGION,
        "clinicCode": code,
        "clinicName": c_at(1) or "",
        "licenseNo": f"\u885b\u8a3a\u5b57\u7b2c {code} \u865f",
        "controlCertNo": c_at(19),
        "mainDept": c_at(5) or DEF_DEPT,
        "dispenseType": c_at(13) or DEF_DISPENSE,
        "phone": phone,
        "zipCode": c_at(17) or "701",
        "address": c_at(4),
        "engAddress": "",
        "defaultDoctorId": "",
        "defaultPharmacistId": "",
    }
    fees = {
        "regFeeOutpatient": reg_opd if reg_opd is not None else 100,
        "regFeeEmerg": reg_er if reg_er is not None else 100,
        "depositAmount": deposit if deposit is not None else 300,
        "depositDaysLimit": deposit_days,
        "seniorAge": senior_age if senior_age is not None else 70,
        "seniorDiscount": senior_disc,
        "childFreeAge": 3,
        "regFeeSelfPay": self_pay,
        "regFeeAdultCheckup": adult_checkup,
        "regFeeChildCare": child_care,
        "regFeeCancerScreen": cancer,
        "consultFeeDefault": consult,
    }
    workflow = {
        "defaultMedDays": default_days if default_days is not None else 3,
        "grindMaxAge": grind_age if grind_age is not None else 6,
        "historyVisitsCount": history_n if history_n is not None else 16,
        "maxVisitsLimit": 6,
        "medPriceCap": med_cap if med_cap is not None else 3000,
        "procedurePriceCap": proc_cap if proc_cap is not None else 5000,
        "adultUsageDefault": c_at(9) or "TID/AC",
        "childUsageDefault": c_at(10) or "QID/PC",
        "checkAllergyIC": True,
        "checkCatastropheIC": True,
        "readerPort": 5066,
    }
    return {"profile": profile, "fees": fees, "workflow": workflow}


def map_people_to_staff(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    staff: list[dict[str, Any]] = []
    for r in rows:
        username = _clean(r.get("USERNAME") or "")
        name = _clean(r.get("NAME") or "")
        if not name or name in {"11"}:
            continue
        title = _clean(r.get("TITLE") or "")
        klass = _clean(r.get("CLASS") or "").upper()
        serial = _clean(r.get("SERIAL") or "") or "00"
        nhi_id = _clean(r.get("ID") or "")
        cert = _clean(r.get("LICENSE") or "")
        status = T_LEFT if title == T_LEFT else T_ACTIVE

        # TITLE may be ??? ?X derive clinical role from CLASS / USERNAME
        if title in {T_DEAN, T_DR, T_ATTENDING} or klass == "A":
            role = T_DEAN if title == T_DEAN else (title if title in {T_DR, T_ATTENDING} else T_DR)
            if title == T_LEFT:
                role = T_DR
        elif title == T_PHARM or klass == "B" or username.upper().startswith("RX"):
            role = T_PHARM
        elif title and title != T_LEFT:
            role = title
        else:
            role = T_STAFF

        try:
            pin = f"{int(serial):04d}"
        except ValueError:
            pin = re.sub(r"\D", "", serial).zfill(4)[:6] or "0000"

        staff.append(
            {
                "id": f"ys-{username or serial}",
                "name": name,
                "role": role,
                "nhiId": nhi_id,
                "certNo": cert,
                "pin": pin,
                "status": status,
            }
        )
    return staff


def resolve_sc_paths(sc_root: Path) -> dict[str, Path]:
    dat = sc_root / "dat"
    if not dat.is_dir():
        dat = sc_root / "DAT"
    scini = dat / "scinis.dat" if (dat / "scinis.dat").exists() else dat / "SCINI.Dat"
    sc_ini = dat / "Sc.ini" if (dat / "Sc.ini").exists() else sc_root / "Sc.ini"
    frame = sc_root / "Frame.Set" if (sc_root / "Frame.Set").exists() else dat / "Frame.Set"
    return {
        "sc_root": sc_root,
        "dat": dat,
        "scini_dat": scini,
        "sc_ini": sc_ini,
        "frame_set": frame,
        "hosp_set": dat / "HospInfo.Set",
        "people": dat / "PEOPLE.Dat",
    }


def import_all(sc_root: Path, db_path: Path | None = None, replace_staff: bool = True) -> dict[str, Any]:
    paths = resolve_sc_paths(sc_root)
    required = ["scini_dat", "sc_ini", "frame_set", "people"]
    missing = [k for k in required if not paths[k].exists()]
    if missing:
        raise FileNotFoundError("missing: " + ", ".join(f"{k}={paths[k]}" for k in missing))

    print(f"[1/4] catalog {paths['scini_dat'].name} ...")
    catalog = load_scini_catalog(paths["scini_dat"])
    print(f"       entries {len(catalog)}")

    print("[2/4] Sc.ini / Frame.Set / HospInfo.Set ...")
    sections = parse_sc_ini(paths["sc_ini"])
    frame_fields = parse_set_file(paths["frame_set"])
    hosp_fields = parse_set_file(paths["hosp_set"]) if paths["hosp_set"].exists() else []
    values = {sec: dict(items) for sec, items in sections.items()}
    ini_count = sum(len(v) for v in values.values())
    print(f"       sections {len(values)} keys {ini_count}; frame fields {len(frame_fields)}")

    bundle = build_profile_from_sources(frame_fields, hosp_fields, sections)

    print("[3/4] PEOPLE.Dat ...")
    people_rows = read_dbf_records(str(paths["people"]))
    staff = map_people_to_staff(people_rows)
    print(f"       staff {len(staff)}")

    doctors = [s for s in staff if s["status"] == T_ACTIVE and (T_DR in s["role"] or s["role"] == T_DEAN)]
    pharms = [s for s in staff if s["status"] == T_ACTIVE and T_PHARM in s["role"]]
    if doctors:
        bundle["profile"]["defaultDoctorId"] = doctors[0]["id"]
    if pharms:
        bundle["profile"]["defaultPharmacistId"] = pharms[0]["id"]

    store = SqliteShadowStore(db_path)
    store.initialize()

    scini_payload = {
        "importedAt": datetime.now(timezone.utc).isoformat(),
        "sources": {k: str(v) for k, v in paths.items() if k != "sc_root"},
        "catalogCount": len(catalog),
        "valueCount": ini_count,
        "catalog": catalog,
        "values": values,
        "frameFields": [{"type": t, "len": ln, "value": v} for t, ln, v in frame_fields],
        "hospFields": [{"type": t, "len": ln, "value": v} for t, ln, v in hosp_fields],
    }
    store.set_json_setting(SCINI_KEY, scini_payload)
    store.set_json_setting(PROFILE_KEY, bundle)

    fees = bundle["fees"]
    settings = store.get_id_category_settings()
    by_code = {s["code"]: s for s in settings}
    opd = int(fees["regFeeOutpatient"])
    senior_age = int(fees["seniorAge"])
    senior_disc = int(fees["seniorDiscount"])
    senior_reg = max(0, opd - senior_disc)
    updated = []
    for code, deposit, reg_fee, copay, min_age, max_age, is_default in [
        (C_SENIOR, 0, senior_reg, 50, senior_age, 999, 0),
        ("S", 0, opd, 50, 3, 17, 0),
        ("D", 0, opd, 50, 18, senior_age - 1, 1),
    ]:
        row = by_code.get(code) or {}
        updated.append(
            {
                "code": code,
                "deposit": deposit,
                "reg_fee": reg_fee,
                "copay": int(row.get("copay") or copay),
                "min_age": min_age,
                "max_age": max_age,
                "is_default": bool(is_default),
            }
        )
    for s in settings:
        if s["code"] not in {C_SENIOR, "S", "D"}:
            updated.append(s)
    store.save_id_category_settings(updated)

    print(f"[4/5] staff replace={replace_staff} ...")
    if replace_staff:
        with store._connect() as conn:
            conn.execute("DELETE FROM clinic_staff")
    for s in staff:
        store.save_staff(
            {
                "id": s["id"],
                "name": s["name"],
                "role": s["role"],
                "nhiId": s["nhiId"],
                "certNo": s["certNo"],
                "pin": s["pin"],
                "status": s["status"],
            }
        )

    print("[5/5] USER.TYPE identity fee table ...")
    idcat_summary: dict[str, Any] = {}
    try:
        from scripts.import_yisheng_id_categories import import_id_categories

        idcat_summary = import_id_categories(sc_root, db_path=db_path)
    except Exception as exc:
        idcat_summary = {"ok": False, "error": str(exc)}

    return {
        "ok": True,
        "catalogCount": len(catalog),
        "iniSections": len(values),
        "iniKeys": ini_count,
        "staffCount": len(staff),
        "staffActive": sum(1 for s in staff if s["status"] == T_ACTIVE),
        "profile": bundle["profile"],
        "fees": bundle["fees"],
        "workflow": bundle["workflow"],
        "staff": [
            {"id": s["id"], "name": s["name"], "role": s["role"], "status": s["status"], "pin": s["pin"]}
            for s in staff
        ],
        "idCategories": {
            "ok": idcat_summary.get("ok"),
            "settingsCount": idcat_summary.get("settingsCount"),
            "distinctTypes": idcat_summary.get("distinctTypes"),
        },
    }


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="Import Yisheng clinic settings + staff")
    ap.add_argument("--sc-root", default=r"Z:\SC")
    ap.add_argument("--db", default="")
    ap.add_argument("--keep-staff", action="store_true")
    ap.add_argument("--json-out", default="")
    args = ap.parse_args()
    db = Path(args.db) if args.db else None
    summary = import_all(Path(args.sc_root), db_path=db, replace_staff=not args.keep_staff)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if args.json_out:
        Path(args.json_out).write_text(
            json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
