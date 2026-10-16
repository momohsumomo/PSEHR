"""依看診日從已安裝 Pack 的價期查藥價（供開藥快照／申報）。

Pack 的 effectiveFrom 是這一版目錄的發布日。目錄裡每一列的 startDate／endDate
才是該藥價的有效期間。健保署月更不會刪掉舊價期，所以回看任何看診日都用
當時那一列，不用發布日之後的新價。
"""

from __future__ import annotations

from typing import Any

from src.spoke.pack_store import PackStore

_INDEX: dict[str, dict[str, list[dict[str, Any]]]] = {}
_PACK: dict[str, dict[str, Any]] = {}
_READY: dict[str, str] = {}


def _row_price(row: dict[str, Any]) -> float | None:
    for key in ("price", "unitPrice", "支付價"):
        v = row.get(key)
        if v is None or v == "":
            continue
        try:
            return float(v)
        except (TypeError, ValueError):
            continue
    return None


def _in_force(row: dict[str, Any], day: str) -> bool:
    start = (row.get("startDate") or row.get("effectiveFrom") or "")[:10]
    end = (row.get("endDate") or row.get("effectiveTo") or "")[:10]
    if start and day < start:
        return False
    if end and day > end:
        return False
    return True


def _index(pack: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    version = str(pack.get("version") or "")
    cached = _INDEX.get(version)
    if cached is not None:
        return cached
    drugs = ((pack.get("payload") or {}).get("resources") or {}).get("drugs") or []
    by_code: dict[str, list[dict[str, Any]]] = {}
    for row in drugs:
        if not isinstance(row, dict):
            continue
        code = str(row.get("nhiCode") or row.get("Q1_ID") or "").strip().upper()
        if not code or _row_price(row) is None:
            continue
        by_code.setdefault(code, []).append(row)
    _INDEX[version] = by_code
    return by_code


def _catalog(store: PackStore) -> dict[str, Any] | None:
    """Latest installed catalog. Row dates, not the edition's publish date, select the price."""
    key = str(store._db_path)
    version = _READY.get(key)
    if version is None:
        store.initialize()
        version = store.latest_active_version() or ""
        _READY[key] = version
    if not version:
        return None
    cached = _PACK.get(version)
    if cached is not None:
        return cached
    pack = store.get_package(version)
    if pack:
        _PACK[version] = pack
        _index(pack)
    return pack


def _covering(rows: list[dict[str, Any]], day: str) -> dict[str, Any] | None:
    dated = [row for row in rows if row.get("startDate") or row.get("endDate")]
    pool = dated or rows
    chosen = [row for row in pool if _in_force(row, day)]
    if not chosen:
        return None
    chosen.sort(key=lambda row: str(row.get("startDate") or ""), reverse=True)
    return chosen[0]


def lookup_drug_price(
    nhi_code: str,
    target_date: str,
    *,
    pack_store: PackStore | None = None,
) -> dict[str, Any] | None:
    """
    回傳 {unitPrice, packVersion, nhiCode, matchedRow?}；找不到則 None。
    同碼多價期時取符合 target_date 且 startDate 最新者。
    沒有涵蓋該日的價期時不拿別的月份補價。
    """
    code = (nhi_code or "").strip().upper()
    day = (target_date or "")[:10]
    if not code or not day:
        return None

    store = pack_store or PackStore()
    pack = _catalog(store)
    if not pack:
        return None

    best = _covering(_index(pack).get(code) or [], day)
    if best is None:
        return None
    price = _row_price(best)
    if price is None:
        return None
    return {
        "nhiCode": code,
        "unitPrice": float(price),
        "packVersion": pack.get("version") or (pack.get("payload") or {}).get("version"),
        "matchedRow": {
            "nhiCode": best.get("nhiCode"),
            "nameZh": best.get("nameZh") or best.get("display"),
            "startDate": best.get("startDate"),
            "endDate": best.get("endDate"),
        },
    }
