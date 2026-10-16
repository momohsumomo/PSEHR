"""從健保署開放資料 datastore 分頁拉取用藥品項。"""

from __future__ import annotations

import logging
from typing import Any, Callable

import httpx

from hub import config

logger = logging.getLogger("hub.fetch")


def fetch_nhi_drug_records(
    *,
    limit: int | None = None,
    page_size: int | None = None,
    progress: Callable[[int, int], None] | None = None,
) -> list[dict[str, Any]]:
    """
    回傳原始 records 列表。
    limit=0/None 且 config.FETCH_LIMIT=0 → 拉到空頁為止。
    """
    max_rows = config.FETCH_LIMIT if limit is None else limit
    size = page_size or config.PAGE_SIZE
    url = config.NHI_DATASTORE_URL
    out: list[dict[str, Any]] = []
    offset = 0

    with httpx.Client(timeout=120.0, follow_redirects=True) as client:
        while True:
            if max_rows and len(out) >= max_rows:
                break
            req_limit = size
            if max_rows:
                req_limit = min(size, max_rows - len(out))
            r = client.get(url, params={"limit": req_limit, "offset": offset})
            r.raise_for_status()
            body = r.json()
            if not body.get("success"):
                raise RuntimeError(f"datastore success=false: {body}")
            records = (body.get("result") or {}).get("records") or []
            if not records:
                break
            out.extend(records)
            if progress:
                progress(len(out), offset)
            if len(records) < req_limit:
                break
            offset += len(records)
            # 安全閥：避免 API 異常無限回傳
            if offset > 500_000:
                raise RuntimeError("FETCH_SAFETY_STOP: offset > 500000")

    logger.info("Fetched %s raw rows from %s", len(out), config.NHI_RESOURCE_ID)
    return out
