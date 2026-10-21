# -*- coding: utf-8 -*-
"""Clinic authoritative settings (fees/org/workflow + catalog overrides).

Layers: clinic (shared shadow) < role template < device (this workstation).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from src.app.bootstrap import get_shadow_store
from src.core.clinic_settings_layers import (
    DEVICE_ROLES,
    flatten_catalog_rows,
    merge_scini_values,
    suggest_scope,
)

router = APIRouter(prefix="/clinic/settings", tags=["ClinicSettings"])


@router.post("/print")
def print_named_printer(payload: dict[str, Any]) -> dict[str, Any]:
    """列印不在資料伺服器上做。使用端電腦走 127.0.0.1:5310。"""
    del payload
    raise HTTPException(
        status_code=400,
        detail="\u5217\u5370\u5728\u4f7f\u7528\u9019\u53f0\u96fb\u8166\u4e0a\uff0c\u8ddf\u9580\u8a3a\u4e00\u8d77\u555f\u52d5\uff0c\u4e0d\u7531\u8cc7\u6599\u4f3a\u670d\u5668\u4ee3\u5370\u3002",
    )


@router.get("/printers")
def list_installed_printers() -> dict[str, Any]:
    """本機 Windows 印表機名稱。瀏覽器不能代選，設定頁用來記住預設。"""
    import winreg

    names: list[str] = []
    seen: set[str] = set()

    def add(name: str) -> None:
        text = name.strip()
        if text.startswith("S-1-") and ":" in text:
            text = text.split(":", 1)[1].strip()
        if not text or text in seen:
            return
        seen.add(text)
        names.append(text)

    try:
        key = winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"SYSTEM\CurrentControlSet\Control\Print\Printers",
        )
        index = 0
        while True:
            try:
                add(winreg.EnumKey(key, index))
                index += 1
            except OSError:
                break
    except OSError:
        pass

    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Printers\Connections")
        index = 0
        while True:
            try:
                raw = winreg.EnumKey(key, index)
                index += 1
                parts = raw.split(",")
                if len(parts) >= 4 and parts[2] and parts[3]:
                    add("\\\\" + parts[2] + "\\" + parts[3])
                else:
                    add(raw)
            except OSError:
                break
    except OSError:
        pass

    return {"ok": True, "printers": names}

PROFILE_KEY = "clinic_profile_v1"
CATALOG_KEY = "clinic_catalog_overrides_v1"
SCINI_KEY = "yisheng_scini_v1"
DEVICES_KEY = "clinic_devices_v1"
ROLE_OVERRIDES_KEY = "clinic_role_overrides_v1"

# 後備預設＝本診所 Frame.Set／Sc.ini 常見值；正式以匯入腳本寫入 shadow 為準
DEFAULT_PROFILE: dict[str, Any] = {
    "profile": {
        "clinicGrade": "D \u57fa\u5c64\u9662\u6240",
        "region": "A \u672c\u5cf6\u5e73\u5730\u5730\u5340",
        "clinicCode": "3521013662",
        "clinicName": "\u74ba\u5230\u5e95\u76ae\u819a\u5c08\u79d1\u8a3a\u6240",
        "licenseNo": "\u885b\u8a3a\u5b57\u7b2c 3521013662 \u865f",
        "controlCertNo": "",
        "mainDept": "11 \u76ae\u819a\u79d1",
        "dispenseType": "0 \u81ea\u884c\u8abf\u5291",
        "phone": "06-2882555",
        "zipCode": "701",
        "address": "\u53f0\u5357\u5e02\u6771\u5340\u5d07\u660e\u8def153-1\u865f",
        "engAddress": "No. 153-1, Chongming Rd., East Dist., Tainan City 701, Taiwan",
        "defaultDoctorId": "",
        "defaultPharmacistId": "",
    },
    "fees": {
        "regFeeOutpatient": 100,
        "regFeeEmerg": 100,
        "depositAmount": 300,
        "depositDaysLimit": 30,
        "seniorAge": 70,
        "seniorDiscount": 100,
        "childFreeAge": 3,
        "studentDiscount": 100,
        "studentAutoUntil": 18,
        "studentAskUntil": 25,
        "regFeeSelfPay": 300,
        "regFeeAdultCheckup": 0,
        "regFeeChildCare": 0,
        "regFeeCancerScreen": 0,
        "consultFeeDefault": 0,
    },
    "workflow": {
        "defaultMedDays": 3,
        "grindMaxAge": 6,
        "historyVisitsCount": 16,
        "maxVisitsLimit": 6,
        "medPriceCap": 3000,
        "procedurePriceCap": 5000,
        "adultUsageDefault": "TID/AC",
        "childUsageDefault": "QID/PC",
        "checkAllergyIC": True,
        "checkCatastropheIC": True,
        "readerPort": 5066,
        "morningFrom": "08:00",
        "morningTo": "12:00",
        "afternoonFrom": "12:00",
        "afternoonTo": "18:00",
        "eveningFrom": "18:00",
        "eveningTo": "21:00",
    },
}


def _deep_merge(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for k, v in overlay.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


@router.get("/profile")
def get_clinic_profile() -> dict[str, Any]:
    store = get_shadow_store()
    saved = store.get_json_setting(PROFILE_KEY) or {}
    if not isinstance(saved, dict):
        saved = {}
    merged = _deep_merge(DEFAULT_PROFILE, saved)
    return {"ok": True, "source": "shadow" if saved else "default", "data": merged}


@router.put("/profile")
def put_clinic_profile(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="body must be object")
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    merged = _deep_merge(DEFAULT_PROFILE, data)
    code = str((merged.get("profile") or {}).get("clinicCode") or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="clinicCode required")
    get_shadow_store().set_json_setting(PROFILE_KEY, merged)
    return {"ok": True, "data": merged}


@router.get("/case-rules")
def get_case_rules() -> dict[str, Any]:
    from src.claims.case_rules import claim_case_rules, official_lines

    rules = claim_case_rules()
    saved = get_shadow_store().get_json_setting("clinic_case_rules_v1") or {}
    if not isinstance(saved, dict):
        saved = {}
    return {
        "ok": True,
        "data": {
            "lines": official_lines(rules),
            "minDays": rules.core.official_chronic_min_days,
            "officialChronic": sorted(rules.official_chronic),
            "orderRules": list(saved.get("orderRules") or []),
            "chronicRules": list(saved.get("chronicRules") or []),
            "projectDrugFloor": int(saved.get("projectDrugFloor") or 0),
            "outsideLabCodes": list(saved.get("outsideLabCodes") or []),
        },
    }


@router.put("/case-rules")
def put_case_rules(payload: dict[str, Any]) -> dict[str, Any]:
    from src.claims.case_rules import (
        clear_case_rules_cache,
        load_case_rules,
        official_lines,
        validate_clinic_payload,
    )

    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="body must be object")
    rules = load_case_rules()
    try:
        cleaned = validate_clinic_payload(data, rules.official_chronic)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    get_shadow_store().set_json_setting("clinic_case_rules_v1", cleaned)
    clear_case_rules_cache()
    fresh = load_case_rules()
    return {
        "ok": True,
        "data": {
            "lines": official_lines(fresh),
            "minDays": fresh.core.official_chronic_min_days,
            "officialChronic": sorted(fresh.official_chronic),
            "orderRules": cleaned["orderRules"],
            "chronicRules": cleaned["chronicRules"],
            "projectDrugFloor": cleaned["projectDrugFloor"],
            "outsideLabCodes": cleaned["outsideLabCodes"],
        },
    }


@router.get("/specialty-templates")
def get_specialty_templates() -> dict[str, Any]:
    from src.claims.specialty_templates import list_templates

    return {"ok": True, "templates": list_templates()}


@router.post("/specialty-templates/{template_id}/apply")
def apply_specialty_template(template_id: str) -> dict[str, Any]:
    """Merge a specialty template into clinic case rules. Does not clear drugs or diagnoses."""
    from src.claims.case_rules import clear_case_rules_cache, load_case_rules, official_lines, validate_clinic_payload
    from src.claims.specialty_templates import load_template, merge_order_rules

    try:
        raw = load_template(template_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="沒有這個科別模板") from None
    store = get_shadow_store()
    saved = store.get_json_setting("clinic_case_rules_v1") or {}
    if not isinstance(saved, dict):
        saved = {}
    merged_orders = merge_order_rules(list(saved.get("orderRules") or []), list(raw.get("orderRules") or []))
    payload = {
        "orderRules": merged_orders,
        "chronicRules": list(saved.get("chronicRules") or []),
        "projectDrugFloor": saved.get("projectDrugFloor") or 0,
        "outsideLabCodes": list(saved.get("outsideLabCodes") or []),
    }
    rules = load_case_rules()
    try:
        cleaned = validate_clinic_payload(payload, rules.official_chronic)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    store.set_json_setting("clinic_case_rules_v1", cleaned)
    clear_case_rules_cache()
    fresh = load_case_rules()
    return {
        "ok": True,
        "templateId": raw.get("id"),
        "templateName": raw.get("name"),
        "note": raw.get("note") or "",
        "data": {
            "lines": official_lines(fresh),
            "minDays": fresh.core.official_chronic_min_days,
            "officialChronic": sorted(fresh.official_chronic),
            "orderRules": cleaned["orderRules"],
            "chronicRules": cleaned["chronicRules"],
            "projectDrugFloor": cleaned["projectDrugFloor"],
            "outsideLabCodes": cleaned["outsideLabCodes"],
        },
    }


@router.get("/catalog-overrides")
def get_catalog_overrides() -> dict[str, Any]:
    raw = get_shadow_store().get_json_setting(CATALOG_KEY) or {}
    if not isinstance(raw, dict):
        raw = {}
    return {
        "ok": True,
        "data": {
            "drugs": list(raw.get("drugs") or []),
            "diagnoses": list(raw.get("diagnoses") or []),
            "packages": list(raw.get("packages") or []),
            "usages": list(raw.get("usages") or []),
            "ccTemplates": list(raw.get("ccTemplates") or []),
            "deletedDrugKeys": list(raw.get("deletedDrugKeys") or []),
            "deletedDxKeys": list(raw.get("deletedDxKeys") or []),
            "deletedPackageKeys": list(raw.get("deletedPackageKeys") or []),
        },
    }


@router.put("/catalog-overrides")
def put_catalog_overrides(payload: dict[str, Any]) -> dict[str, Any]:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="body must be object")
    cleaned = {
        "drugs": list(data.get("drugs") or []),
        "diagnoses": list(data.get("diagnoses") or []),
        "packages": list(data.get("packages") or []),
        "usages": list(data.get("usages") or []),
        "ccTemplates": list(data.get("ccTemplates") or []),
        "deletedDrugKeys": list(data.get("deletedDrugKeys") or []),
        "deletedDxKeys": list(data.get("deletedDxKeys") or []),
        "deletedPackageKeys": list(data.get("deletedPackageKeys") or []),
    }
    get_shadow_store().set_json_setting(CATALOG_KEY, cleaned)
    return {"ok": True, "data": cleaned}


def _require_scini() -> dict[str, Any]:
    raw = get_shadow_store().get_json_setting(SCINI_KEY) or {}
    if not isinstance(raw, dict) or not raw:
        raise HTTPException(
            status_code=404,
            detail="尚未匯入 Scini／Sc.ini（請執行 scripts/import_yisheng_clinic_settings.py）",
        )
    return raw


def _load_devices() -> dict[str, Any]:
    raw = get_shadow_store().get_json_setting(DEVICES_KEY) or {}
    return raw if isinstance(raw, dict) else {}


def _load_role_overrides() -> dict[str, Any]:
    raw = get_shadow_store().get_json_setting(ROLE_OVERRIDES_KEY) or {}
    return raw if isinstance(raw, dict) else {}


@router.get("/scini")
def get_scini_settings(
    section: str | None = None,
    with_rows: bool = Query(False, description="附上目錄＋值合併列"),
) -> dict[str, Any]:
    """醫聖院所參數全文（SCINI 目錄 + Sc.ini 值）。可 ?section=Register 過濾。"""
    raw = _require_scini()
    values = raw.get("values") or {}
    catalog = raw.get("catalog") or []
    all_sections = sorted(
        {str(c.get("section") or "") for c in (raw.get("catalog") or []) if c.get("section")},
        key=lambda s: s.casefold(),
    )
    if section:
        want = section.casefold()
        values = {k: v for k, v in values.items() if str(k).casefold() == want}
        catalog = [c for c in catalog if str(c.get("section") or "").casefold() == want]
    out: dict[str, Any] = {
        "ok": True,
        "importedAt": raw.get("importedAt"),
        "sources": raw.get("sources") or {},
        "catalogCount": len(catalog) if section else raw.get("catalogCount"),
        "valueCount": raw.get("valueCount"),
        "values": values,
        "catalog": catalog,
        "frameFields": raw.get("frameFields") or [],
        "hospFields": raw.get("hospFields") or [],
        "sections": all_sections,
    }
    if with_rows:
        out["rows"] = flatten_catalog_rows(list(catalog), dict(values))
    return out


@router.put("/scini")
def put_scini_settings(payload: dict[str, Any]) -> dict[str, Any]:
    """更新院所層 Sc.ini 值（不全量覆蓋：只合併傳入的 section/entry）。"""
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="body must be object")
    patch = payload.get("values") if isinstance(payload.get("values"), dict) else payload
    if not isinstance(patch, dict):
        raise HTTPException(status_code=400, detail="values object required")

    store = get_shadow_store()
    raw = _require_scini()
    values = dict(raw.get("values") or {})
    changed = 0
    for sec, items in patch.items():
        if not isinstance(items, dict):
            continue
        bucket = dict(values.get(str(sec)) or {})
        for entry, val in items.items():
            bucket[str(entry)] = "" if val is None else str(val)
            changed += 1
        values[str(sec)] = bucket
    raw["values"] = values
    raw["valueCount"] = sum(len(v) for v in values.values())
    raw["updatedAt"] = datetime.now(timezone.utc).isoformat()
    store.set_json_setting(SCINI_KEY, raw)
    return {"ok": True, "changed": changed, "valueCount": raw["valueCount"]}


@router.get("/devices")
def list_devices() -> dict[str, Any]:
    devices = _load_devices()
    return {"ok": True, "devices": list(devices.values()) if devices else []}


@router.get("/devices/{device_id}")
def get_device(device_id: str) -> dict[str, Any]:
    devices = _load_devices()
    d = devices.get(device_id)
    if not d:
        raise HTTPException(status_code=404, detail="device not registered")
    return {"ok": True, "device": d}


@router.put("/devices/{device_id}")
def put_device(device_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """登錄／更新本機裝置：角色、顯示名、本機 Scini 覆寫、列印設定。"""
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="body must be object")
    body = payload.get("device") if isinstance(payload.get("device"), dict) else payload
    role = str(body.get("role") or "other").strip()
    if role not in DEVICE_ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of {DEVICE_ROLES}")

    store = get_shadow_store()
    devices = _load_devices()
    prev = devices.get(device_id) if isinstance(devices.get(device_id), dict) else {}
    scini_overrides = body.get("sciniOverrides")
    if scini_overrides is not None and not isinstance(scini_overrides, dict):
        raise HTTPException(status_code=400, detail="sciniOverrides must be object")

    # Merge section patches into previous overrides (do not wipe other sections)
    merged_overrides: dict[str, Any] = dict(prev.get("sciniOverrides") or {})
    if isinstance(scini_overrides, dict):
        replace_all = bool(body.get("replaceSciniOverrides"))
        if replace_all:
            merged_overrides = {str(s): dict(i) for s, i in scini_overrides.items() if isinstance(i, dict)}
        else:
            for sec, items in scini_overrides.items():
                if not isinstance(items, dict):
                    continue
                sec_bucket = dict(merged_overrides.get(str(sec)) or {})
                for entry, val in items.items():
                    sec_bucket[str(entry)] = "" if val is None else str(val)
                merged_overrides[str(sec)] = sec_bucket

    device = {
        "id": device_id,
        "label": str(body.get("label") or prev.get("label") or device_id),
        "role": role,
        "sciniOverrides": merged_overrides,
        "printSettings": body.get("printSettings")
        if isinstance(body.get("printSettings"), dict)
        else (prev.get("printSettings") or {}),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "createdAt": prev.get("createdAt") or datetime.now(timezone.utc).isoformat(),
    }
    devices[device_id] = device
    store.set_json_setting(DEVICES_KEY, devices)
    return {"ok": True, "device": device}


@router.get("/roles/{role}/overrides")
def get_role_overrides(role: str) -> dict[str, Any]:
    if role not in DEVICE_ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of {DEVICE_ROLES}")
    all_roles = _load_role_overrides()
    return {"ok": True, "role": role, "sciniOverrides": all_roles.get(role) or {}}


@router.put("/roles/{role}/overrides")
def put_role_overrides(role: str, payload: dict[str, Any]) -> dict[str, Any]:
    if role not in DEVICE_ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of {DEVICE_ROLES}")
    patch = payload.get("sciniOverrides") if isinstance(payload.get("sciniOverrides"), dict) else payload
    if not isinstance(patch, dict):
        raise HTTPException(status_code=400, detail="sciniOverrides object required")
    store = get_shadow_store()
    all_roles = _load_role_overrides()
    bucket = dict(all_roles.get(role) or {})
    for sec, items in patch.items():
        if not isinstance(items, dict):
            continue
        sec_bucket = dict(bucket.get(str(sec)) or {})
        for entry, val in items.items():
            sec_bucket[str(entry)] = "" if val is None else str(val)
        bucket[str(sec)] = sec_bucket
    all_roles[role] = bucket
    store.set_json_setting(ROLE_OVERRIDES_KEY, all_roles)
    return {"ok": True, "role": role, "sciniOverrides": bucket}


@router.get("/effective")
def get_effective_settings(
    device_id: str | None = None,
    role: str | None = None,
    section: str | None = None,
) -> dict[str, Any]:
    """合併後的參數：院所 < 角色 < 本機。"""
    raw = _require_scini()
    clinic_values = dict(raw.get("values") or {})
    catalog = list(raw.get("catalog") or [])

    resolved_role = role
    device_overlay: dict[str, dict[str, str]] = {}
    if device_id:
        devices = _load_devices()
        d = devices.get(device_id) if isinstance(devices.get(device_id), dict) else None
        if d:
            resolved_role = resolved_role or str(d.get("role") or "")
            ov = d.get("sciniOverrides") or {}
            if isinstance(ov, dict):
                device_overlay = {str(s): dict(i) for s, i in ov.items() if isinstance(i, dict)}

    role_overlay: dict[str, dict[str, str]] = {}
    if resolved_role and resolved_role in DEVICE_ROLES:
        all_roles = _load_role_overrides()
        ov = all_roles.get(resolved_role) or {}
        if isinstance(ov, dict):
            role_overlay = {str(s): dict(i) for s, i in ov.items() if isinstance(i, dict)}

    merged = merge_scini_values(clinic_values, role_overlay, device_overlay)
    if section:
        want = section.casefold()
        merged = {k: v for k, v in merged.items() if str(k).casefold() == want}
        catalog = [c for c in catalog if str(c.get("section") or "").casefold() == want]

    profile_saved = get_shadow_store().get_json_setting(PROFILE_KEY) or {}
    profile = _deep_merge(DEFAULT_PROFILE, profile_saved if isinstance(profile_saved, dict) else {})

    return {
        "ok": True,
        "deviceId": device_id,
        "role": resolved_role,
        "layers": {"clinic": True, "role": bool(role_overlay), "device": bool(device_overlay)},
        "profile": profile,
        "values": merged,
        "rows": flatten_catalog_rows(catalog, merged),
        "suggestScopeSample": {
            "printer": suggest_scope("\u85e5\u888b\u5370\u8868\u540d\u7a31", "Printer"),
            "fee": suggest_scope("\u81ea\u8cbb\u6848\u4ef6\u639b\u865f\u8cbb\u7528", "Register"),
            "bell": suggest_scope("\u639b\u865f\u9234\u8072", "Register"),
        },
    }
