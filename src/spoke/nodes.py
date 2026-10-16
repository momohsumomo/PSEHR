"""Spoke 進站更新管線節點定義（失敗時必標節點，禁止只回「更新失敗」）。"""

from __future__ import annotations

from enum import Enum


class HydrateNode(str, Enum):
    """依序執行；失敗時 API／run 記錄會帶此 node id。"""

    RESOLVE_SOURCE = "resolve_source"
    HUB_REACHABLE = "hub_reachable"
    FETCH_MANIFEST = "fetch_manifest"
    SELECT_CANDIDATE = "select_candidate"
    DOWNLOAD_PACK = "download_pack"
    VERIFY_CHECKSUM = "verify_checksum"
    VALIDATE_SCHEMA = "validate_schema"
    INSTALL_LOCAL = "install_local"
    ACTIVATE = "activate"
    COMPLETE = "complete"


NODE_CATALOG: list[dict[str, str]] = [
    {
        "id": HydrateNode.RESOLVE_SOURCE.value,
        "title": "解析來源",
        "means": "決定用本機 Hub 目錄或遠端 Hub URL",
    },
    {
        "id": HydrateNode.HUB_REACHABLE.value,
        "title": "Hub 可連",
        "means": "檢查目錄存在或 HTTP 健康／清單端點可達",
    },
    {
        "id": HydrateNode.FETCH_MANIFEST.value,
        "title": "拉取版本清單",
        "means": "取得 Hub 上已發布 Pack 清單",
    },
    {
        "id": HydrateNode.SELECT_CANDIDATE.value,
        "title": "選擇候選版",
        "means": "比對本機已安裝，決定是否有可下載新版；無新版則正常結束",
    },
    {
        "id": HydrateNode.DOWNLOAD_PACK.value,
        "title": "下載 Pack",
        "means": "取得 Pack JSON 內容",
    },
    {
        "id": HydrateNode.VERIFY_CHECKSUM.value,
        "title": "Checksum 驗證",
        "means": "SHA-256 與宣告值一致",
    },
    {
        "id": HydrateNode.VALIDATE_SCHEMA.value,
        "title": "Schema 驗證",
        "means": "必要欄位／生效日／結構合法",
    },
    {
        "id": HydrateNode.INSTALL_LOCAL.value,
        "title": "寫入本機",
        "means": "存入 rule_package 表",
    },
    {
        "id": HydrateNode.ACTIVATE.value,
        "title": "啟用版本",
        "means": "標記為可用（依 effectiveFrom 供 target_date 選用）",
    },
    {
        "id": HydrateNode.COMPLETE.value,
        "title": "完成",
        "means": "整輪 Hydrate 成功（含「已是最新」）",
    },
]
