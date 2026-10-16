"""Hub 管線節點（失敗必標；人力僅事件觸發）。"""

from __future__ import annotations

from enum import Enum


class HubNode(str, Enum):
    RESOLVE_SOURCE = "resolve_source"
    FETCH_REMOTE = "fetch_remote"
    NORMALIZE = "normalize"
    LOAD_PREVIOUS = "load_previous"
    DIFF = "diff"
    AUTO_GATES = "auto_gates"
    LLM_VERIFY = "llm_verify"
    BUILD_PACK = "build_pack"
    PUBLISH = "publish"
    COMPLETE = "complete"


NODE_CATALOG: list[dict[str, str]] = [
    {"id": HubNode.RESOLVE_SOURCE.value, "title": "解析來源", "means": "鎖定健保用藥 datastore 與食藥署管制分級開放資料"},
    {"id": HubNode.FETCH_REMOTE.value, "title": "拉取遠端", "means": "抓健保用藥列＋食藥署藥證／銷售一覽表"},
    {"id": HubNode.NORMALIZE.value, "title": "正規化", "means": "欄位對齊、型別、鍵值，並對上管制級別"},
    {"id": HubNode.LOAD_PREVIOUS.value, "title": "載入上版", "means": "讀取上一成功 snapshot／已發布 Pack"},
    {"id": HubNode.DIFF.value, "title": "差異比對", "means": "新增／改價／停用／起迄日變更統計"},
    {"id": HubNode.AUTO_GATES.value, "title": "自動閘門", "means": "空檔、幅度、刪除量等；決定 auto／事件升級"},
    {"id": HubNode.LLM_VERIFY.value, "title": "LLM 核對", "means": "確認 diff 語意是否可自動發布；不直接改價"},
    {"id": HubNode.BUILD_PACK.value, "title": "組裝 Pack", "means": "產生版本號、checksum、resources"},
    {"id": HubNode.PUBLISH.value, "title": "發布", "means": "寫入 data/hub_packages 供 Spoke 下載"},
    {"id": HubNode.COMPLETE.value, "title": "完成", "means": "整輪結束（含無需更新）"},
]
