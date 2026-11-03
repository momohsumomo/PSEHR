# -*- coding: utf-8 -*-
"""Claims API: monthly NHI export (official outpatient XML + legacy)."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from src.app.bootstrap import get_shadow_store
from src.claims import build_claims_summary, render_claims_xml
from src.claims import export_log
from src.claims.case_rules import assign_case, claim_case_rules
from src.claims.media_check import add_unfinished, check_media
from src.claims.engine import clinic_dept_code, clinic_dispense_code, unfinished_visits
from src.claims.xml_export_nhi import (
    DEFAULT_CONSULT_FEE_CODE,
    nhi_total_sheet,
    render_nhi_outpatient_xml,
    render_nhi_outpatient_zip,
)
from src.api.routers.clinic_settings import PROFILE_KEY, DEFAULT_PROFILE

router = APIRouter(prefix="/claims", tags=["健保申報"])

SubmitType = Literal["songhe", "bubao"]
ExportFormat = Literal["nhi", "legacy"]
Packaging = Literal["xml", "zip"]


def _institution_code() -> str:
    store = get_shadow_store()
    saved = store.get_json_setting(PROFILE_KEY) or {}
    profile = (saved.get("profile") if isinstance(saved, dict) else None) or {}
    code = str(profile.get("clinicCode") or "").strip()
    if code:
        return code
    return str(DEFAULT_PROFILE["profile"]["clinicCode"])


def _month_for(store: Any, date_month: str, submit_type: str) -> tuple[Any, dict[str, Any], list[str]]:
    """The month's records, the export log, and reasons no file may be made yet."""
    summary = build_claims_summary(store, date_month)
    log = export_log.load(store, date_month)
    gate: list[str] = []
    if export_log.month_open(date_month):
        gate.append(export_log.MONTH_OPEN)
    if submit_type == "bubao":
        if not export_log.has_songhe(log):
            gate.append(export_log.NO_SONGHE)
        summary = export_log.only_new(summary, log)
    return summary, log, gate


def _stale_price_note(date_month: str) -> str:
    """Prices come from the newest catalog. One fetched before month end may miss that month's new periods."""
    from src.spoke.pack_store import PackStore

    try:
        store = PackStore()
        store.initialize()
        version = store.latest_active_version()
        pack = store.get_package(version) if version else None
    except Exception:
        return ""
    if not pack:
        return "\u672c\u6a5f\u9084\u6c92\u6709\u85e5\u50f9\u76ee\u9304\uff0c\u85e5\u8cbb\u53ea\u80fd\u7528\u75c5\u6b77\u4e0a\u7684\u55ae\u50f9\u3002\u5148\u5230\u300c\u66f4\u65b0\u300d\u6309\u66f4\u65b0\u85e5\u50f9\u3002"
    # The bureau publishes new prices ahead of their start date, so a catalog from inside the month already has them.
    first_day = f"{date_month[:7]}-01"
    fetched = str(pack.get("effective_from") or "")[:10]
    if fetched >= first_day:
        return ""
    return (
        f"\u85e5\u50f9\u76ee\u9304\u662f {fetched} \u6293\u7684\uff0c\u6bd4\u9019\u500b\u6708\u9084\u65e9\uff0c"
        "\u9019\u500b\u6708\u7684\u65b0\u50f9\u53ef\u80fd\u6c92\u6709\u3002\u9019\u4e0d\u662f\u54ea\u4e00\u7b46\u75c5\u6b77\u7684\u554f\u984c\u3002"
        "\u5148\u5230\u300c\u66f4\u65b0\u300d\u6309\u66f4\u65b0\u85e5\u50f9\uff0c\u518d\u6aa2\u67e5\u4e00\u6b21\u3002"
    )


@router.get("/case")
def preview_visit_case(
    stored: str = Query("01"),
    days: int = Query(0),
    dispense: str = Query(""),
    self_pay: bool = Query(False),
    codes: str = Query(""),
    orders: str = Query(""),
    live: bool = Query(False),
) -> dict[str, Any]:
    """Same 01/04/09/9X choice the monthly file uses, for the chart while prescribing.

    live=1 lets 01/04/09 follow the drugs on this visit. 08/02/A3 and self-pay stay put.
    The monthly file does not call this, so a case already saved as 04 is still kept there.
    """
    diagnosis_codes = [part.strip() for part in codes.split(",") if part.strip()]
    order_codes = [part.strip() for part in orders.split(",") if part.strip()]
    stored_for_rule = stored
    if live and stored.strip().upper() in {"01", "04", "09"}:
        stored_for_rule = "01"
    case, reason = assign_case(
        stored=stored_for_rule,
        days=max(0, days),
        dispense=dispense,
        diagnosis_codes=diagnosis_codes,
        order_codes=order_codes,
        self_pay=self_pay,
        rules=claim_case_rules(),
    )
    display = "\u81ea" if case == "9X" else case
    return {"case": case, "display": display, "reason": reason}


@router.get("/statistics")
def get_claims_statistics(date_month: str = Query(..., description="年月份 YYYY-MM，如 2026-06")) -> dict[str, Any]:
    """指定月份健保申報統計（藥費＝單價×量；診察費暫常數）。"""
    summary = build_claims_summary(get_shadow_store(), date_month)
    return summary.to_statistics_dict()


@router.get("/preview")
def preview_claims(
    date_month: str = Query(..., description="年月份 YYYY-MM"),
    submit_type: SubmitType = Query("songhe"),
) -> dict[str, Any]:
    """含醫令明細的組檔預覽（檢查用）。"""
    store = get_shadow_store()
    summary, log, gate = _month_for(store, date_month, submit_type)
    data = summary.to_dict()
    case_counts: dict[str, int] = {}
    for rec in summary.records:
        if rec.claimable:
            case = str(rec.caseNo or "01")
            case_counts[case] = case_counts.get(case, 0) + 1
    report = add_unfinished(check_media(summary.records), unfinished_visits(store, date_month))
    if report["claimable"] == 0 and not gate:
        gate = [
            export_log.NOTHING_NEW
            if submit_type == "bubao"
            else "\u672c\u6708\u6c92\u6709\u53ef\u7533\u5831\u7684\u770b\u8a3a"
        ]
    if gate:
        report["ok"] = False
        report["canExport"] = False
        report["blocks"] = [
            {"medicalNo": "", "encounterDate": "", "caseNo": "", "code": "month", "message": msg}
            for msg in gate
        ] + list(report["blocks"])
        report["blockCount"] = int(report["blockCount"]) + len(gate)
    stale = _stale_price_note(date_month)
    if stale:
        report["warnings"] = [
            {"medicalNo": "", "encounterDate": "", "caseNo": "", "code": "pack-stale", "message": stale}
        ] + list(report.get("warnings") or [])
        report["warnCount"] = int(report.get("warnCount") or 0) + 1
    data["check"] = report
    data["exportHistory"] = log["history"]
    data["caseCounts"] = case_counts
    inst = _institution_code()
    data["institutionCode"] = inst
    data["totalSheet"] = nhi_total_sheet(summary, institution_code=inst, submit_type=submit_type)
    data["exportFormatDefault"] = "nhi"
    data["exportNote"] = (
        "健保給藥滿 7 天就是 04，病名不必在公告慢性病清單。"
        "病名主檔有特定治療代號，不滿 7 天也是 04。"
        "切開排膿、冷凍、電燒、換藥這類處置是 09，滿天數也一樣。"
        "這間診所沒有把急慢性病名混在一起改成 09。交付調劑的一般案件仍是 09。"
        "不改病名、不補藥點。上傳仍由人上健保 VPN。"
    )
    return data


@router.post("/export")
def export_claims_xml(
    date_month: str = Query(..., description="年月份 YYYY-MM，如 2026-06"),
    submit_type: SubmitType = Query(
        "songhe",
        description="songhe=送核（預設）；bubao=補報（漏報追加，少用）",
    ),
    format: ExportFormat = Query(
        "nhi",
        description="nhi=署方 outpatient t/d/p（預設）；legacy=wundadi-claims-v0",
    ),
    packaging: Packaging = Query(
        "xml",
        description="xml=單一 XML；zip=內含 Big5 XML 的壓縮檔（署方上傳習慣）",
    ),
) -> Response:
    """產出月申報檔（預設署方 outpatient schema）。"""
    store = get_shadow_store()
    summary, _log, gate = _month_for(store, date_month, submit_type)
    if gate:
        raise HTTPException(status_code=400, detail=gate[0])
    report = check_media(summary.records)
    if report["claimable"] == 0 or report["blockCount"]:
        raise HTTPException(
            status_code=400,
            detail="必要修正還沒清完，先看檢查清單。提醒可以留著，仍然不能在有必要修正時產檔。",
        )
    inst = _institution_code()
    kind = "SONGHE" if submit_type == "songhe" else "BUBAO"
    roc = summary.yearMonthRoc

    if format == "legacy":
        xml_content = render_claims_xml(summary, institution_code=inst, submit_type=submit_type)
        return Response(
            content=xml_content,
            media_type="application/xml; charset=utf-8",
            headers={
                "Content-Disposition": (
                    f"attachment; filename=NHI_CLAIM_LEGACY_{kind}_{roc}_{inst}.xml"
                ),
                "Access-Control-Expose-Headers": "Content-Disposition",
                "X-Wundadi-Claims-Format": "wundadi-claims-v0",
            },
        )

    dept = clinic_dept_code(store)
    dispense = clinic_dispense_code(store)
    if packaging == "zip":
        blob = render_nhi_outpatient_zip(
            summary,
            institution_code=inst,
            submit_type=submit_type,
            dept_code=dept,
            consult_fee_code=DEFAULT_CONSULT_FEE_CODE,
            default_dispense=dispense,
            encoding="cp950",
        )
        export_log.record(store, summary, submit_type)
        return Response(
            content=blob,
            media_type="application/zip",
            headers={
                "Content-Disposition": (
                    f"attachment; filename=NHI_OPD_{kind}_{roc}_{inst}.zip"
                ),
                "Access-Control-Expose-Headers": "Content-Disposition",
                "X-Wundadi-Claims-Format": "nhi-outpatient-xml",
            },
        )

    xml_content = render_nhi_outpatient_xml(
        summary,
        institution_code=inst,
        submit_type=submit_type,
        dept_code=dept,
        consult_fee_code=DEFAULT_CONSULT_FEE_CODE,
        default_dispense=dispense,
        encoding_decl="UTF-8",
    )
    export_log.record(store, summary, submit_type)
    return Response(
        content=xml_content.encode("utf-8"),
        media_type="application/xml; charset=utf-8",
        headers={
            "Content-Disposition": (
                f"attachment; filename=NHI_OPD_{kind}_{roc}_{inst}.xml"
            ),
            "Access-Control-Expose-Headers": "Content-Disposition",
            "X-Wundadi-Claims-Format": "nhi-outpatient-xml",
        },
    )
