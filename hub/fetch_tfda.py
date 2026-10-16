"""從食藥署開放資料拉管制分級主檔（不經診所 VPN）。"""

from __future__ import annotations

import csv
import io
import json
import logging
import zipfile
from typing import Any

import httpx

from hub import config

logger = logging.getLogger("hub.fetch_tfda")


def _open_maybe_zip_text(content: bytes, *, content_type: str = "", filename: str = "") -> str:
    """CSV/JSON 可能是裸檔或 zip。"""
    head = content[:4]
    looks_zip = head[:2] == b"PK" or "zip" in (content_type or "").lower() or filename.endswith(".zip")
    if looks_zip:
        zf = zipfile.ZipFile(io.BytesIO(content))
        names = [n for n in zf.namelist() if not n.endswith("/")]
        if not names:
            raise RuntimeError("TFDA zip 內沒有檔案")
        raw = zf.read(names[0])
        return raw.decode("utf-8-sig")
    return content.decode("utf-8-sig")


def fetch_tfda_license_rows(*, timeout: float = 180.0) -> list[dict[str, str]]:
    """未註銷藥品許可證（infoId=37）。"""
    url = config.TFDA_LICENSE_URL
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        r = client.get(url)
        r.raise_for_status()
        disp = r.headers.get("content-disposition") or ""
        text = _open_maybe_zip_text(
            r.content,
            content_type=r.headers.get("content-type") or "",
            filename=disp,
        )
    reader = csv.DictReader(io.StringIO(text))
    rows = [{k: (v or "").strip() for k, v in (row or {}).items()} for row in reader]
    logger.info("Fetched %s TFDA license rows from %s", len(rows), url)
    return rows


def fetch_tfda_sales_rows(*, timeout: float = 90.0) -> list[dict[str, Any]]:
    """銷售管制藥品一覽表（infoId=51，含健保藥品代碼）。"""
    url = config.TFDA_SALES_URL
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        r = client.get(url)
        r.raise_for_status()
        ctype = (r.headers.get("content-type") or "").lower()
        disp = r.headers.get("content-disposition") or ""
        if url.endswith("/csv") or "csv" in ctype:
            text = _open_maybe_zip_text(r.content, content_type=ctype, filename=disp)
            reader = csv.DictReader(io.StringIO(text))
            rows: list[dict[str, Any]] = [{k: (v or "").strip() for k, v in (row or {}).items()} for row in reader]
        else:
            payload = json.loads(_open_maybe_zip_text(r.content, content_type=ctype, filename=disp))
            if isinstance(payload, dict):
                payload = payload.get("records") or payload.get("data") or []
            if not isinstance(payload, list):
                raise RuntimeError("TFDA sales JSON 不是陣列")
            rows = payload
    logger.info("Fetched %s TFDA sales rows from %s", len(rows), url)
    return rows


def fetch_tfda_control_sources() -> dict[str, Any]:
    licenses = fetch_tfda_license_rows()
    sales = fetch_tfda_sales_rows()
    return {
        "licenses": licenses,
        "sales": sales,
        "licenseUrl": config.TFDA_LICENSE_URL,
        "salesUrl": config.TFDA_SALES_URL,
        "licenseCount": len(licenses),
        "salesCount": len(sales),
    }
