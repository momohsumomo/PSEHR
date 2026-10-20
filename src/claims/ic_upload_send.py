# -*- coding: utf-8 -*-
"""Send one day's IC 2.0 file. SAM signature, service type 05. No HPC card.

Business API: POST {NHI_BUSINESS_BASE}/v1/UploadData/Upload
This is the same route used to issue a visit number. It is not a VPN webpage.
"""

from __future__ import annotations

import base64
import os
from datetime import datetime
from typing import Any
from urllib.error import URLError

from src.claims.ic_daily_upload import collect_ic_day
from src.core.nhi_cshis6_client import (
    DEFAULT_CONSOLE_BASE,
    request_json,
    status_hint,
)

UPLOAD_PATH = "/v1/UploadData/Upload"
_NO_CONSOLE = "\u8b80\u5361\u6a5f\u4e3b\u63a7\u53f0\u6c92\u958b\uff0c\u5b89\u5168\u6a21\u7d44\u7121\u6cd5\u7c3d\u7ae0\u3002\u8ddf\u53d6\u865f\u4e00\u6a23\uff0c\u4e0d\u7528\u91ab\u4e8b\u4eba\u54e1\u5361\u3002"
_NO_VPN = "\u7121\u6cd5\u9023\u7dda\u5065\u4fdd\u696d\u52d9\u7aef\u3002\u8acb\u78ba\u8a8d\u91ab\u7642\u7db2\u9023\u7dda\u7a0b\u5f0f\u5df2\u958b\u3002\u6c92\u6709\u9001\u51fa\u3002"


def _business_base() -> str:
    return os.environ.get("NHI_BUSINESS_BASE", "https://medvpndc.nhi.gov.tw/api").rstrip("/")


def _sign(console_base: str) -> dict[str, Any]:
    """Desk 6.0 signs SAM service 05. This server does not open a reader."""
    del console_base
    raise RuntimeError("NEED_DESK_SIGN")


def _roc_parts(stamp: str) -> tuple[str, str]:
    digits = "".join(ch for ch in str(stamp or "") if ch.isdigit())
    if len(digits) < 13:
        return "", ""
    return f"{digits[0:3]}.{digits[3:5]}.{digits[5:7]}", f"{digits[7:9]}:{digits[9:11]}:{digits[11:13]}"


def send_ic_day(
    store: Any,
    day: str,
    institution: str,
    *,
    desk_sign: dict[str, Any] | None = None,
    console_base: str = DEFAULT_CONSOLE_BASE,
) -> dict[str, Any]:
    built = collect_ic_day(store, day, institution)
    ready = int(built.get("readyForExport") or 0)
    if ready == 0:
        return {
            "ok": False,
            "sent": False,
            "date": day[:10],
            "count": 0,
            "reason": "\u9019\u4e00\u5929\u6c92\u6709\u8981\u4e0a\u50b3\u7684\u5065\u4fdd\u5c31\u91ab",
        }
    missing = int(built.get("unsignedNormal") or 0)
    if missing:
        return {
            "ok": False,
            "sent": False,
            "date": day[:10],
            "count": ready,
            "reason": f"\u6709 {missing} \u7b46\u6c92\u6709\u53d6\u865f\u6642\u7684\u5b89\u5168\u7c3d\u7ae0\uff0c\u6c92\u6709\u9001\u51fa",
        }
    del console_base
    try:
        from src.core.nhi_seq_bridge import posted_sign

        signed = posted_sign(desk_sign)
    except RuntimeError:
        return {
            "ok": False,
            "sent": False,
            "date": day[:10],
            "count": ready,
            "reason": "\u8acb\u5728\u9019\u53f0\u96fb\u8166\u7c3d\u7ae0\u5f8c\u518d\u4e0a\u50b3\u3002\u6c92\u6709\u9001\u51fa\u3002",
        }
    if not signed.get("samId"):
        return {
            "ok": False,
            "sent": False,
            "date": day[:10],
            "count": ready,
            "reason": "\u9019\u53f0\u5b89\u5168\u6a21\u7d44\u7c3d\u7ae0\u4e0d\u5b8c\u6574\u3002\u6c92\u6709\u9001\u51fa\u3002",
        }

    raw = str(built.get("xml") or "").encode("cp950", errors="strict")
    body = {
        "clientRandom": signed.get("clientRandom"),
        "hospitalId": signed.get("hospitalId") or institution,
        "samId": signed.get("samId"),
        "signature": signed.get("signature"),
        "fileContent": base64.b64encode(raw).decode("ascii"),
        "recordNumber": ready,
    }
    url = _business_base() + UPLOAD_PATH
    try:
        http, data = request_json(url, method="POST", body=body, timeout_sec=60.0)
    except (URLError, TimeoutError, OSError) as exc:
        return {"ok": False, "sent": False, "date": day[:10], "count": ready, "reason": _NO_VPN + str(exc.__class__.__name__)}
    if not isinstance(data, dict):
        return {"ok": False, "sent": False, "date": day[:10], "count": ready, "reason": f"\u5065\u4fdd\u7f72\u56de\u8986\u4e0d\u662f JSON\uff08HTTP {http}\uff09\u3002\u6c92\u6709\u7576\u6210\u6210\u529f\u3002"}
    code = data.get("statusCode")
    up_date, up_time = _roc_parts(str(data.get("uploadDateTime") or ""))
    dn_date, dn_time = _roc_parts(str(data.get("receiveDateTime") or ""))
    if http >= 400 or code not in (None, 0):
        hint = status_hint(int(code)) if isinstance(code, int) else f"HTTP {http}"
        return {
            "ok": False,
            "sent": False,
            "date": day[:10],
            "count": ready,
            "statusCode": code if isinstance(code, int) else None,
            "reason": f"\u5065\u4fdd\u7f72\u6c92\u6536\uff08{hint}\uff09\u3002\u6c92\u6709\u7576\u6210\u6210\u529f\u3002",
        }
    if not up_date:
        now = datetime.now()
        roc = f"{now.year - 1911}.{now.month:02d}.{now.day:02d}"
        clock = now.strftime("%H:%M:%S")
        up_date, up_time = roc, clock
        dn_date, dn_time = roc, clock
    return {
        "ok": True,
        "sent": True,
        "date": day[:10],
        "count": ready,
        "statusCode": 0,
        "uploadDate": up_date,
        "uploadTime": up_time,
        "receiveDate": dn_date,
        "receiveTime": dn_time,
        "reason": "",
    }
