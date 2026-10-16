# -*- coding: utf-8 -*-
"""系統工具：資料備份、統計報表、改本時段藥師。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from src.app.bootstrap import get_shadow_store
from src.core import clinic_reports, db_backup

router = APIRouter(prefix="/maintenance", tags=["Maintenance"])


class BackupSettingsBody(BaseModel):
    dir: str = Field("", max_length=400)
    keep: int = Field(db_backup.DEFAULT_KEEP, ge=1, le=60)


class BackupRunBody(BaseModel):
    browserSettings: dict[str, Any] = Field(default_factory=dict)


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
            return clinic_reports.drug_report(
                conn, dateFrom, dateTo, shift=sh, finished_only=finished, self_pay=selfPay, usages=usages
            )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
