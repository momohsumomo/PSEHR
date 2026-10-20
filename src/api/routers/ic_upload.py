# -*- coding: utf-8 -*-
"""IC daily upload: NHI format 2.0 file. No VPN."""

from __future__ import annotations

import struct
from datetime import date
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from fastapi.responses import Response

from src.app.bootstrap import get_shadow_store
from src.api.routers.clinic_settings import DEFAULT_PROFILE, PROFILE_KEY
from src.claims.ic_daily_upload import collect_ic_day

router = APIRouter(prefix="/ic-upload", tags=["ICDailyUpload"])

LAST_EXPORT_KEY = "ic_upload_last_export_v1"
SENT_KEY = "ic_upload_sent_v1"


def _institution_code(store: Any) -> str:
    saved = store.get_json_setting(PROFILE_KEY) or {}
    profile = (saved.get("profile") if isinstance(saved, dict) else None) or {}
    code = str(profile.get("clinicCode") or "").strip()
    return code or str(DEFAULT_PROFILE["profile"]["clinicCode"])


def _bundle(store: Any, day: str) -> dict[str, Any]:
    bundle = collect_ic_day(store, day, _institution_code(store))
    bundle.pop("xml", None)
    last = store.get_json_setting(LAST_EXPORT_KEY) or {}
    bundle["lastExport"] = last if isinstance(last, dict) else {}
    bundle.pop("records", None)
    return bundle


@router.get("/preview")
def preview_ic_upload(date_day: str = Query(..., alias="date", description="YYYY-MM-DD")) -> dict[str, Any]:
    if len(date_day) < 10:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    return _bundle(get_shadow_store(), date_day[:10])


@router.post("/export")
def export_ic_upload(date_day: str = Query(..., alias="date")) -> Response:
    store = get_shadow_store()
    day = date_day[:10]
    built = collect_ic_day(store, day, _institution_code(store))
    if built["readyForExport"] == 0:
        raise HTTPException(
            status_code=400,
            detail="\u9019\u4e00\u5929\u6c92\u6709\u8981\u4e0a\u50b3\u7684\u5065\u4fdd\u5c31\u91ab",
        )
    xml = str(built["xml"])
    raw = xml.encode("cp950", errors="strict")
    meta = {
        "date": day,
        "finished": built["finished"],
        "exported": built["readyForExport"],
        "exportedAt": date.today().isoformat(),
        "institutionCode": built["institutionCode"],
        "format": built["format"],
    }
    store.set_json_setting(LAST_EXPORT_KEY, meta)
    fname = f"IC20_{day.replace('-', '')}_{built['institutionCode']}.xml"
    return Response(
        content=raw,
        media_type="text/xml; charset=big5",
        headers={
            "Content-Disposition": f'attachment; filename="{fname}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


def _stamp_parts(raw: str) -> tuple[str, str]:
    digits = "".join(ch for ch in (raw or "") if ch.isdigit())
    if len(digits) < 8:
        return "", ""
    roc = int(digits[0:4]) - 1911
    shown = f"{roc}.{digits[4:6]}.{digits[6:8]}"
    clock = ""
    if len(digits) >= 14:
        clock = f"{digits[8:10]}:{digits[10:12]}:{digits[12:14]}"
    return shown, clock


def _upload_history(limit: int = 40) -> list[dict[str, str]]:
    """Read-only tail of the clinic upload log. Institution SAM id is never returned."""
    path = Path(r"Z:\SC\dat\UPLOAD.Dat")
    if not path.is_file():
        return []
    limit = max(1, min(limit, 80))
    with path.open("rb") as handle:
        header = handle.read(32)
        if len(header) < 12:
            return []
        num_records, header_len, record_len = struct.unpack("<IHH", header[4:12])
        handle.seek(32)
        fields: list[tuple[str, int, int]] = []
        offset = 1
        while True:
            desc = handle.read(32)
            if len(desc) < 32 or desc[0] == 0x0D:
                break
            name = desc[:11].split(b"\x00", 1)[0].decode("ascii", errors="ignore")
            length = desc[16]
            fields.append((name, length, offset))
            offset += length
        want = {"TIME", "SDATE", "EDATE", "UPLOADTIME", "DWLOADTIME", "DWRECCOUNT", "REMARK"}
        start = max(0, num_records - limit)
        handle.seek(header_len + start * record_len)
        rows: list[dict[str, str]] = []
        for _ in range(start, num_records):
            data = handle.read(record_len)
            if len(data) < record_len:
                break
            if data[0] == 0x2A:
                continue
            raw: dict[str, str] = {}
            for name, length, field_off in fields:
                if name not in want:
                    continue
                raw[name] = (
                    data[field_off : field_off + length]
                    .decode("cp950", errors="ignore")
                    .replace("\x00", "")
                    .strip()
                )
            up_date, up_time = _stamp_parts(raw.get("UPLOADTIME") or raw.get("TIME") or "")
            dn_date, dn_time = _stamp_parts(raw.get("DWLOADTIME") or "")
            count = (raw.get("DWRECCOUNT") or "").strip()
            rows.append(
                {
                    "uploadDate": up_date,
                    "uploadTime": up_time,
                    "startDate": raw.get("SDATE") or "",
                    "endDate": raw.get("EDATE") or "",
                    "receiveDate": dn_date,
                    "receiveTime": dn_time,
                    "uploadCount": count,
                    "receiveCount": count,
                    "kind": raw.get("REMARK") or "",
                }
            )
    rows.reverse()
    return rows


def _sent_rows(store: Any) -> list[dict[str, str]]:
    saved = store.get_json_setting(SENT_KEY) or []
    if not isinstance(saved, list):
        return []
    rows: list[dict[str, str]] = []
    for item in saved:
        if not isinstance(item, dict):
            continue
        rows.append(
            {
                "uploadDate": str(item.get("uploadDate") or ""),
                "uploadTime": str(item.get("uploadTime") or ""),
                "startDate": str(item.get("startDate") or ""),
                "endDate": str(item.get("endDate") or ""),
                "receiveDate": str(item.get("receiveDate") or ""),
                "receiveTime": str(item.get("receiveTime") or ""),
                "uploadCount": str(item.get("uploadCount") or ""),
                "receiveCount": str(item.get("receiveCount") or ""),
                "kind": str(item.get("kind") or "IC20"),
            }
        )
    return rows


def remember_send(store: Any, row: dict[str, str]) -> None:
    rows = _sent_rows(store)
    rows.insert(0, row)
    store.set_json_setting(SENT_KEY, rows[:40])


@router.get("/history")
def ic_upload_history(limit: int = Query(40, ge=1, le=80)) -> dict[str, Any]:
    store = get_shadow_store()
    merged = _sent_rows(store) + _upload_history(limit)
    seen: set[str] = set()
    rows: list[dict[str, str]] = []
    for row in merged:
        key = "|".join(
            [
                row.get("uploadDate", ""),
                row.get("uploadTime", ""),
                row.get("startDate", ""),
                row.get("uploadCount", ""),
            ]
        )
        if key in seen:
            continue
        seen.add(key)
        rows.append(row)
        if len(rows) >= limit:
            break
    return {"rows": rows}


class IcSendBody(BaseModel):
    deskSign: dict[str, Any] | None = None


@router.post("/send")
def send_ic_upload(
    date_day: str = Query(..., alias="date"),
    body: IcSendBody | None = None,
) -> dict[str, Any]:
    from src.claims.ic_upload_send import send_ic_day

    store = get_shadow_store()
    day = date_day[:10]
    desk = body.deskSign if body else None
    result = send_ic_day(store, day, _institution_code(store), desk_sign=desk)
    if result.get("sent"):
        roc = _iso_to_roc(day)
        remember_send(
            store,
            {
                "uploadDate": str(result.get("uploadDate") or ""),
                "uploadTime": str(result.get("uploadTime") or ""),
                "startDate": roc,
                "endDate": roc,
                "receiveDate": str(result.get("receiveDate") or ""),
                "receiveTime": str(result.get("receiveTime") or ""),
                "uploadCount": str(result.get("count") or ""),
                "receiveCount": str(result.get("count") or ""),
                "kind": "IC20",
            },
        )
    return result


def _iso_to_roc(iso: str) -> str:
    parts = iso[:10].split("-")
    if len(parts) != 3:
        return ""
    try:
        return f"{int(parts[0]) - 1911}.{parts[1]}.{parts[2]}"
    except ValueError:
        return ""
