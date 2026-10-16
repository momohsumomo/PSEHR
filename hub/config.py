"""Hub 路徑與環境設定。"""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = Path(os.environ.get("HUB_WORKSPACE", str(REPO_ROOT / "data" / "hub_workspace")))
PUBLISH_DIR = Path(os.environ.get("HUB_PACKAGES_DIR", str(REPO_ROOT / "data" / "hub_packages")))

# 健保署開放資料：健保用藥品項查詢項目檔
NHI_RESOURCE_ID = os.environ.get("HUB_NHI_RESOURCE_ID", "A21030000I-E41001-001")
NHI_DATASTORE_URL = os.environ.get(
    "HUB_NHI_DATASTORE_URL",
    f"https://info.nhi.gov.tw/api/iode0010/v1/rest/datastore/{NHI_RESOURCE_ID}",
)

# 食藥署開放資料：管制分級（不經診所 VPN）
# 37＝未註銷藥品許可證（含「管制藥品分類級別」）；51＝銷售管制藥品一覽表（含健保碼）
TFDA_LICENSE_URL = os.environ.get(
    "HUB_TFDA_LICENSE_URL",
    "https://data.fda.gov.tw/data/opendata/export/37/csv",
)
TFDA_SALES_URL = os.environ.get(
    "HUB_TFDA_SALES_URL",
    "https://data.fda.gov.tw/data/opendata/export/51/json",
)
# 同一 6 位字號被改分級的筆數超過此值 → 事件擋下
GATE_CONTROL_RECLASSIFIED = int(os.environ.get("HUB_GATE_CONTROL_RECLASSIFIED", "30"))

# 0 = 拉全量；測試可設 3000
FETCH_LIMIT = int(os.environ.get("HUB_FETCH_LIMIT", "0"))
PAGE_SIZE = int(os.environ.get("HUB_PAGE_SIZE", "1000"))

# 閘門：改價相對幅度、影響品項數、刪除數
# One line jumping this far is treated as a bad row, not a normal monthly adjustment.
GATE_PRICE_REL_PCT = float(os.environ.get("HUB_GATE_PRICE_REL_PCT", "200"))
GATE_CHANGED_ITEMS = int(os.environ.get("HUB_GATE_CHANGED_ITEMS", "500"))
GATE_REMOVED_ITEMS = int(os.environ.get("HUB_GATE_REMOVED_ITEMS", "200"))

# LLM：有實質出入時預設需要；無 key 則升事件不發布
LLM_REQUIRED_ON_MATERIAL = os.environ.get("HUB_LLM_REQUIRED_ON_MATERIAL", "1").strip() not in (
    "0",
    "false",
    "False",
)
LLM_API_KEY = (
    os.environ.get("HUB_LLM_API_KEY")
    or os.environ.get("OPENAI_API_KEY")
    or os.environ.get("GEMINI_API_KEY")
    or ""
).strip()
LLM_BASE_URL = os.environ.get("HUB_LLM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
LLM_MODEL = os.environ.get("HUB_LLM_MODEL", "gpt-4o-mini")
