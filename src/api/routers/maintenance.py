# -*- coding: utf-8 -*-
"""系統工具：資料備份、統計報表、改本時段藥師。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from src.app.bootstrap import get_shadow_store
from src.core import app_update, clinic_reports, db_backup
from src.core.appearance import load_appearance
from src.core.desktop_window import open_desktop_window
from src.core.drug_price_refresh import describe as describe_drug_price
from src.core.drug_price_refresh import set_version_active, start_refresh

router = APIRouter(prefix="/maintenance", tags=["Maintenance"])


class BackupSettingsBody(BaseModel):
    dir: str = Field("", max_length=400)
    keep: int = Field(db_backup.DEFAULT_KEEP, ge=1, le=60)


class BackupRunBody(BaseModel):
    browserSettings: dict[str, Any] = Field(default_factory=dict)


class DesktopWindowBody(BaseModel):
    target: str = Field("kiosk", max_length=20)


@router.post("/desktop-window", summary="Open the lobby or kiosk window on this PC")
def desktop_window(body: DesktopWindowBody) -> dict[str, Any]:
    try:
        kind = open_desktop_window(body.target)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="\u53ea\u80fd\u958b\u9580\u8a3a\u3001\u81ea\u52a9\u639b\u865f\u6216\u9810\u5148\u554f\u8a3a\u3002") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "target": kind}


@router.get("/app-update", summary="Compare this install with GitHub main")
def app_update_status() -> dict:
    try:
        return app_update.describe()
    except Exception as exc:
        raise HTTPException(status_code=502, detail="\u9023\u4e0d\u4e0a GitHub\u3002" + str(exc)) from exc


@router.post("/app-update", summary="Replace the program from GitHub, keep data/")
async def app_update_apply(request: Request) -> dict:
    chosen = ""
    raw = await request.body()
    if raw.strip():
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = {}
        if isinstance(data, dict):
            chosen = str(data.get("version") or "").strip()[:80]
    try:
        return app_update.begin_apply(version=chosen)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="\u8edf\u9ad4\u4e0b\u8f09\u5931\u6557\u3002" + str(exc)) from exc


@router.get("/appearance", summary="Clinic appearance saved under data/")
def appearance_saved() -> dict:
    return load_appearance()


@router.get("/drug-pack", summary="Whether this host has refreshed official drug prices")
def drug_pack_status() -> dict:
    return describe_drug_price()


@router.post("/drug-pack", summary="Fetch the official catalog on this host and install it")
def drug_pack_apply() -> dict:
    return start_refresh(force=True)


class DrugPackActiveBody(BaseModel):
    version: str = Field(min_length=1, max_length=80)
    active: bool


@router.post("/drug-pack/active", summary="Stop a bad drug price edition or bring it back")
def drug_pack_active(body: DrugPackActiveBody) -> dict:
    try:
        return set_version_active(body.version, body.active)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="\u6c92\u6709\u9019\u4e00\u7248\u3002") from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=409,
            detail="\u9019\u662f\u552f\u4e00\u555f\u7528\u7684\u4e00\u7248\uff0c\u505c\u7528\u5c31\u67e5\u4e0d\u5230\u50f9\u3002\u5148\u6062\u5fa9\u5225\u7248\u3002",
        ) from exc


@router.get("/backup", summary="備份設定、現有備份、目前是否在備份")
def backup_status() -> dict[str, Any]:
    return db_backup.describe(get_shadow_store())


@router.put("/backup/settings", summary="設定備份資料夾與保留份數")
def backup_settings(body: BackupSettingsBody) -> dict[str, Any]:
    store = get_shadow_store()
    try:
        db_backup.save_settings(store, body.dir, body.keep)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return db_backup.describe(store)


@router.post("/backup/run", summary="立刻備份影子庫（背景執行，看診可照常）")
def backup_run(body: BackupRunBody | None = None) -> dict[str, Any]:
    store = get_shadow_store()
    browser = body.browserSettings if body else None
    db_backup.start_backup(store, browser)
    return db_backup.describe(store)


def _check_range(date_from: str, date_to: str) -> None:
    if len(date_from) < 10 or len(date_to) < 10 or date_from[:10] > date_to[:10]:
        raise HTTPException(status_code=422, detail="起迄日期格式要 YYYY-MM-DD，且起日不能晚於迄日。")


_SHIPPED_CATALOG = Path(__file__).resolve().parents[3] / "frontend" / "public" / "yisheng_clinic_catalog.json"


def _catalog_drugs(store: Any) -> list[Any]:
    """Shipped drug catalog, then the clinic's own edits, so edited costs win."""
    rows: list[Any] = []
    try:
        rows.extend(json.loads(_SHIPPED_CATALOG.read_text(encoding="utf-8")).get("drugs") or [])
    except (OSError, ValueError, AttributeError):
        pass
    edits = store.get_json_setting("clinic_catalog_overrides_v1") or {}
    if isinstance(edits, dict):
        rows.extend(edits.get("drugs") or [])
    return rows


def _saved_drug_picks(store: Any) -> dict[str, Any]:
    """{"drugs", "exclude"}. exclude: the listed drugs are left out and every other drug counts."""
    raw = store.get_json_setting(clinic_reports.DRUG_PICKS_KEY) or {}
    if not isinstance(raw, dict):
        raw = {}
    return {"drugs": clinic_reports.clean_drug_picks(raw.get("drugs")), "exclude": bool(raw.get("exclude"))}


@router.get("/report-drug-picks", summary="Drugs picked for \u85e5\u54c1\u7d71\u8a08; empty means every drug")
def drug_picks_get() -> dict[str, Any]:
    return _saved_drug_picks(get_shadow_store())


@router.put("/report-drug-picks", summary="Save the drugs picked for \u85e5\u54c1\u7d71\u8a08")
def drug_picks_put(payload: dict[str, Any]) -> dict[str, Any]:
    body = payload if isinstance(payload, dict) else {}
    saved = {"drugs": clinic_reports.clean_drug_picks(body.get("drugs")), "exclude": bool(body.get("exclude"))}
    get_shadow_store().set_json_setting(clinic_reports.DRUG_PICKS_KEY, saved)
    return saved


@router.get("/reports/{kind}", summary="統計資料：disease／opdCount／drug／treatment／claim")
def report(
    kind: str,
    dateFrom: str = Query(...),
    dateTo: str = Query(...),
    shift: str = Query("", description="上午／下午／晚上；空白＝全部"),
    finished: bool = Query(False, description="true＝只算完診"),
    selfPay: str = Query("exclude", description="exclude／only／all"),
    name: str = Query("", description="疾病統計：病名或代碼關鍵字"),
) -> dict[str, Any]:
    _check_range(dateFrom, dateTo)
    if kind not in clinic_reports.REPORT_KINDS:
        raise HTTPException(status_code=404, detail=f"沒有這種統計：{kind}")
    store = get_shadow_store()
    sh = shift.strip() or None
    try:
        if kind == "claim":
            return clinic_reports.claim_report(store, dateFrom, dateTo)
        with store._connect() as conn:
            if kind == "disease":
                return clinic_reports.disease_report(conn, dateFrom, dateTo, shift=sh, finished_only=finished, name_filter=name)
            if kind == "opdCount":
                return clinic_reports.opd_count_report(conn, dateFrom, dateTo, shift=sh, finished_only=finished)
            if kind == "treatment":
                return clinic_reports.treatment_report(conn, dateFrom, dateTo, shift=sh, finished_only=finished, self_pay=selfPay)
            from src.claims.engine import _catalog_lookup

            usages, _routes = _catalog_lookup(store)
            saved = _saved_drug_picks(store)
            return clinic_reports.drug_report(
                conn,
                dateFrom,
                dateTo,
                shift=sh,
                finished_only=finished,
                self_pay=selfPay,
                usages=usages,
                picks=saved["drugs"],
                exclude_picks=saved["exclude"],
                costs=clinic_reports.drug_costs(_catalog_drugs(store)),
            )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
