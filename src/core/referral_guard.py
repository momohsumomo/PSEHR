# -*- coding: utf-8 -*-
"""When a referral row may leave the list.

A row that was never sent leaves with the registration.
An outbound row may be withdrawn only within one hour of upload.
A reply may be withdrawn only when the visit day is today.
Nothing else is removed. Acceptance is not read from a download.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

_HOUR = timedelta(hours=1)
_DRAFT_WORDS = ("\u8349\u7a3f", "\u5f85\u67e5", "\u624b\u586b", "\u672a\u4e0a\u50b3")


def _parse_when(text: str) -> datetime | None:
    raw = (text or "").strip()
    if len(raw) < 19:
        return None
    try:
        return datetime.strptime(raw[:19], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def uploaded(row: dict[str, Any]) -> bool:
    status = str(row.get("status") or "")
    for word in _DRAFT_WORDS:
        if word in status:
            return False
    if str(row.get("localId") or row.get("local_id") or "").strip():
        return True
    if str(row.get("nhiId") or row.get("nhi_id") or "").strip():
        return True
    return (
        "\u5df2\u4e0a\u50b3" in status
        or "\u5df2\u56de\u8986" in status
        or "\u5df2\u56de\u5fa9" in status
    )


def classify(row: dict[str, Any], now: datetime | None = None) -> dict[str, str]:
    """action is draft, delete-open, delete-reply, or keep."""
    moment = now or datetime.now()
    if not uploaded(row):
        return {"action": "draft", "reason": ""}
    kind = str(row.get("kind") or "")
    if kind == "out":
        sent = _parse_when(str(row.get("uploadedAt") or row.get("uploaded_at") or ""))
        if sent is None:
            return {
                "action": "keep",
                "reason": "\u9019\u5f35\u8f49\u51fa\u6c92\u6709\u4e0a\u50b3\u6642\u9593\uff0c\u4e0d\u80fd\u522a\u9664\u3002",
            }
        if moment - sent <= _HOUR:
            return {"action": "delete-open", "reason": ""}
        return {
            "action": "keep",
            "reason": "\u8f49\u51fa\u4e0a\u50b3\u5df2\u8d85\u904e\u4e00\u5c0f\u6642\uff0c\u4e0d\u80fd\u522a\u9664\u3002",
        }
    if kind == "reply":
        day = str(row.get("openedOn") or row.get("opened_on") or "")[:10]
        if day and day == moment.strftime("%Y-%m-%d"):
            return {"action": "delete-reply", "reason": ""}
        return {
            "action": "keep",
            "reason": "\u56de\u5fa9\u4e0d\u662f\u7576\u5929\u7684\uff0c\u4e0d\u80fd\u522a\u9664\u3002",
        }
    return {"action": "keep", "reason": "\u9019\u7b46\u8f49\u8a3a\u7d00\u9304\u4e0d\u80fd\u522a\u9664\u3002"}
