from __future__ import annotations

"""診所端規則 Pack 診斷 API（失敗必回節點）。"""

from fastapi import APIRouter, HTTPException, Query

from src.spoke.hydrator import PackHydrator
from src.spoke.nodes import NODE_CATALOG
from src.spoke.pack_store import PackStore

router = APIRouter(prefix="/sync/packages", tags=["Spoke-規則Pack進站"])


def _store() -> PackStore:
    store = PackStore()
    store.initialize()
    return store


@router.get("/nodes")
def list_hydrate_nodes() -> dict:
    """管線節點說明：更新失敗時對照 failedNode。"""
    return {
        "pipeline": "spoke-pack-hydrator",
        "note": "與 /sync/queue（臨床資料出站）完全分離",
        "nodes": NODE_CATALOG,
    }


@router.get("/status")
def packages_status() -> dict:
    store = _store()
    last = store.last_run()
    latest = store.latest_active_version()
    return {
        "latestActiveVersion": latest,
        "installedCount": len(store.list_installed()),
        "lastRun": last,
        "diagnosis": (last or {}).get("diagnosis")
        or ("尚無執行紀錄；啟動後會自動 Hydrate，或 POST /sync/packages/hydrate" if not last else None),
        "fallbackHint": "若 lastRun.status=failed，診所仍使用 latestActiveVersion（若有）",
    }


@router.get("/installed")
def list_installed_packages() -> dict:
    store = _store()
    return {"entry": store.list_installed()}


@router.get("/resolve")
def resolve_package_for_date(
    target_date: str = Query(..., description="YYYY-MM-DD，看診日或申報所屬日"),
) -> dict:
    store = _store()
    hit = store.resolve_for_date(target_date)
    if not hit:
        raise HTTPException(
            status_code=404,
            detail={
                "errorCode": "NO_PACKAGE_FOR_DATE",
                "message": f"找不到 target_date={target_date} 可套用的 Pack",
                "failedNode": "resolve_for_date",
                "hint": "先確認 /sync/packages/installed 或執行 hydrate",
            },
        )
    return {
        "targetDate": target_date[:10],
        "version": hit["version"],
        "effectiveFrom": hit["effective_from"],
        "effectiveTo": hit["effective_to"],
        "checksumSha256": hit["checksum_sha256"],
        "resources": hit["payload"].get("resources"),
    }


@router.get("/control-index")
def controlled_drug_index(
    target_date: str = Query(..., description="YYYY-MM-DD，看診日"),
) -> dict:
    """
    本機 Pack 裡有管制分級的藥碼索引（食藥署開放資料經 Hub 寫入）。
    不連健保 VPN。
    """
    store = _store()
    hit = store.resolve_for_date(target_date)
    if not hit:
        return {
            "targetDate": target_date[:10],
            "packVersion": None,
            "count": 0,
            "byNhiCode": {},
            "note": "尚無可用 Pack。管制分級與藥價同一條進站口，不經診所 VPN。",
        }
    resources = hit["payload"].get("resources") or {}
    index: dict[str, str] = {}
    raw_index = resources.get("controlledByNhiCode")
    if isinstance(raw_index, dict):
        for code, cls in raw_index.items():
            c = str(code or "").strip()
            v = str(cls or "").strip()
            if c and v:
                index[c] = v
    if not index:
        drugs = resources.get("drugs") or []
        rows = drugs.values() if isinstance(drugs, dict) else drugs
        for row in rows:
            if not isinstance(row, dict):
                continue
            cls = str(row.get("controlClass") or "").strip()
            code = str(row.get("nhiCode") or "").strip()
            if cls and code:
                index[code] = cls
    return {
        "targetDate": target_date[:10],
        "packVersion": hit["version"],
        "count": len(index),
        "byNhiCode": index,
        "note": (
            f"本機 Pack 已含食藥署管制分級 {len(index)} 碼（與藥價同一條進站，不經診所 VPN）。"
            if index
            else "目前 Pack 無管制分級。Hub 下次拉食藥署藥證／銷售一覽表寫進 Pack 即可，不必借診所 VPN。"
        ),
    }


@router.get("/runs")
def list_hydrate_runs(limit: int = Query(20, ge=1, le=100)) -> dict:
    return {"entry": _store().list_runs(limit=limit)}


@router.post("/hydrate")
async def trigger_hydrate() -> dict:
    """手動觸發一輪（除錯用）；背景 worker 亦會定期跑。"""
    result = await PackHydrator(_store()).run_once()
    return result.to_dict()
