#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Extract USER.Dat TYPE identity codes and seed id_category_settings.

Patient identity (hanging fee discount) lives in USER.TYPE.
Fee rules combine:
  - Frame.Set / clinic_profile fees (base reg / deposit / senior)
  - Sc.ini (senior discount mode, free-identity list)
  - Observed KEYMONEY / practice defaults per TYPE

Writes:
  - clinic_runtime_settings.yisheng_id_categories_v1 (raw inventory)
  - id_category_settings (operational fee table)
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.import_yisheng_clinic_settings import (
    PROFILE_KEY,
    build_profile_from_sources,
    parse_sc_ini,
    parse_set_file,
    resolve_sc_paths,
)
from scripts.import_yisheng_data import read_dbf_records
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore

INVENTORY_KEY = "yisheng_id_categories_v1"

# Canonical aliases: lowercase / typos -> preferred code
ALIASES = {
    "d": "D",
    "s": "S",
    "c": "C",
    "a": "A",
    "b": "B",
    "\u8914\u4fdd": "\u798f\u4fdd",  # typo variant of FuBao
    "\u798f\u4fdd": "\u798f\u4fdd",  # �֫O
    "\u7985\u4fdd": "\u798f\u4fdd",  # �īO typo
    "\u8001\u512a": "\u8001\u4eba\u512a",  # ���u -> �ѤH�u
    "\u81ea": "\u81ea\u8cbb",  # �� -> �۶O
}


def _norm_type(raw: str) -> str:
    t = (raw or "").strip()
    if not t:
        return ""
    if t in ALIASES:
        return ALIASES[t]
    low = t.casefold()
    if low in ALIASES:
        return ALIASES[low]
    return t


def _median_int(vals: list[int]) -> int | None:
    if not vals:
        return None
    s = sorted(vals)
    mid = len(s) // 2
    if len(s) % 2:
        return s[mid]
    return (s[mid - 1] + s[mid]) // 2


def scan_user_types(user_path: Path) -> dict[str, Any]:
    rows = read_dbf_records(str(user_path))
    counts: Counter[str] = Counter()
    keymoney: dict[str, list[int]] = defaultdict(list)
    samples: dict[str, list[str]] = defaultdict(list)

    for r in rows:
        code = _norm_type(r.get("TYPE") or "")
        if not code:
            code = "(empty)"
        counts[code] += 1
        km = (r.get("KEYMONEY") or "").strip()
        if km:
            try:
                keymoney[code].append(int(float(km)))
            except ValueError:
                pass
        name = (r.get("NAME") or "").strip()
        if name and len(samples[code]) < 3:
            samples[code].append(name)

    inventory = []
    for code, n in counts.most_common():
        inventory.append(
            {
                "code": code,
                "count": n,
                "keymoneyMedian": _median_int(keymoney.get(code) or []),
                "keymoneySamples": (keymoney.get(code) or [])[:5],
                "nameSamples": samples.get(code) or [],
            }
        )
    return {
        "totalPatients": len(rows),
        "distinctTypes": len(counts),
        "types": inventory,
    }


def build_fee_table(
    inventory: dict[str, Any],
    base_reg: int,
    base_deposit: int,
    senior_age: int,
    senior_discount: int,
    self_pay_reg: int,
    free_identities: set[str],
) -> list[dict[str, Any]]:
    """Map each TYPE to deposit / reg_fee / copay / age band."""
    senior_reg = max(0, base_reg - senior_discount)
    senior_deposit = base_deposit
    for item in inventory.get("types") or []:
        if item.get("code") == "\u8001\u4eba\u512a" and item.get("keymoneyMedian") is not None:
            senior_deposit = int(item["keymoneyMedian"])
    # Disability / veteran / welfare: clinic practice �X often same base or reduced.
    # Until TypeKeyM is decoded, use conservative rules aligned with Sc.ini + Frame.
    settings: list[dict[str, Any]] = []

    def add(
        code: str,
        *,
        deposit: int,
        reg_fee: int,
        copay: int = 50,
        min_age: int | None = None,
        max_age: int | None = None,
        is_default: int = 0,
    ) -> None:
        settings.append(
            {
                "code": code,
                "deposit": deposit,
                "reg_fee": reg_fee,
                "copay": copay,
                "min_age": min_age,
                "max_age": max_age,
                "is_default": is_default,
            }
        )

    # Always ensure core age-band defaults exist
    add("D", deposit=base_deposit, reg_fee=base_reg, copay=50, min_age=18, max_age=senior_age - 1, is_default=1)
    add("S", deposit=base_deposit, reg_fee=base_reg, copay=50, min_age=3, max_age=17, is_default=0)
    add(
        "\u8001\u4eba\u512a",
        deposit=senior_deposit,
        reg_fee=senior_reg,
        copay=50,
        min_age=senior_age,
        max_age=999,
        is_default=0,
    )

    known = {s["code"] for s in settings}

    for item in inventory.get("types") or []:
        code = item["code"]
        if code in known or code == "(empty)":
            continue
        km_med = item.get("keymoneyMedian")
        deposit = int(km_med) if km_med is not None else base_deposit

        # Heuristics by code text
        if code in free_identities or code == "\u670b\u53cb":  # �B��
            add(code, deposit=0, reg_fee=0, copay=0)
        elif code == "\u81ea\u8cbb":  # �۶O
            add(code, deposit=deposit if deposit else base_deposit, reg_fee=self_pay_reg, copay=0)
        elif code in {"A", "B", "C"}:
            # Common NHI identity letters �X same as base outpatient unless clinic overrides later
            add(code, deposit=deposit, reg_fee=base_reg, copay=50)
        elif "\u8001" in code:  # contains �� (�ѤH�u variants / ��+�a)
            add(code, deposit=0 if deposit == 0 else min(deposit, base_deposit), reg_fee=senior_reg, copay=50, min_age=senior_age, max_age=999)
        elif code.startswith("\u8eab") or "\u6b98" in code:  # ��* / ��
            # Disability cards: often reduced or waived reg �X keep base_reg with 0 deposit common in samples
            add(code, deposit=0 if (km_med is not None and km_med == 0) else deposit, reg_fee=senior_reg, copay=50)
        elif "\u69ae" in code or "\u798f" in code:  # �a / ��
            add(code, deposit=deposit, reg_fee=senior_reg, copay=50)
        elif "\u91cd\u5927" in code:  # ���j
            add(code, deposit=deposit, reg_fee=0, copay=0)
        else:
            add(code, deposit=deposit, reg_fee=base_reg, copay=50)
        known.add(code)

    for code in sorted(free_identities):
        if code and code not in known:
            add(code, deposit=0, reg_fee=0, copay=0)
            known.add(code)

    return settings


def import_id_categories(sc_root: Path, db_path: Path | None = None) -> dict[str, Any]:
    paths = resolve_sc_paths(sc_root)
    user = paths["dat"] / "USER.Dat"
    if not user.exists():
        raise FileNotFoundError(user)

    print(f"[1/3] scan {user} ...")
    inventory = scan_user_types(user)
    print(f"       patients {inventory['totalPatients']} distinct TYPE {inventory['distinctTypes']}")

    print("[2/3] clinic fees from Frame/Sc.ini / profile ...")
    store = SqliteShadowStore(db_path)
    store.initialize()
    profile = store.get_json_setting(PROFILE_KEY) or {}
    if not isinstance(profile, dict) or not profile.get("fees"):
        sections = parse_sc_ini(paths["sc_ini"])
        frame = parse_set_file(paths["frame_set"])
        hosp = parse_set_file(paths["hosp_set"]) if paths["hosp_set"].exists() else []
        profile = build_profile_from_sources(frame, hosp, sections)

    fees = profile.get("fees") or {}
    base_reg = int(fees.get("regFeeOutpatient") or 100)
    base_deposit = int(fees.get("depositAmount") or 300)
    senior_age = int(fees.get("seniorAge") or 70)
    senior_discount = int(fees.get("seniorDiscount") or 50)
    self_pay_reg = int(fees.get("regFeeSelfPay") or 300)

    sections = parse_sc_ini(paths["sc_ini"])
    free_raw = ""
    for sec, items in sections.items():
        for k, v in items.items():
            if "\u514d\u6536\u639b\u865f\u8cbb\u7684\u8eab\u4efd\u5225" in k:  # �K�������O�������O
                free_raw = v
                break
    free_identities = {x.strip() for x in free_raw.replace("\uff0c", ",").split(",") if x.strip()}

    table = build_fee_table(
        inventory,
        base_reg=base_reg,
        base_deposit=base_deposit,
        senior_age=senior_age,
        senior_discount=senior_discount,
        self_pay_reg=self_pay_reg,
        free_identities=free_identities,
    )

    print(f"[3/3] write {len(table)} id_category_settings ...")
    payload = {
        "importedAt": datetime.now(timezone.utc).isoformat(),
        "source": str(user),
        "freeIdentities": sorted(free_identities),
        "baseFees": {
            "regFeeOutpatient": base_reg,
            "depositAmount": base_deposit,
            "seniorAge": senior_age,
            "seniorDiscount": senior_discount,
            "regFeeSelfPay": self_pay_reg,
        },
        "inventory": inventory,
        "settings": table,
    }
    store.set_json_setting(INVENTORY_KEY, payload)
    store.save_id_category_settings(table)

    return {
        "ok": True,
        "totalPatients": inventory["totalPatients"],
        "distinctTypes": inventory["distinctTypes"],
        "settingsCount": len(table),
        "freeIdentities": sorted(free_identities),
        "baseFees": payload["baseFees"],
        "settings": table,
        "types": inventory["types"][:40],
    }


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--sc-root", default=r"Z:\SC")
    ap.add_argument("--db", default="")
    ap.add_argument("--json-out", default="")
    args = ap.parse_args()
    summary = import_id_categories(Path(args.sc_root), Path(args.db) if args.db else None)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
