# Hub：健保用藥 Pack 發布

一人維運的中央端：排程拉官方開放資料 → diff → 閘門 →（可選）LLM 核對 → Publish 到 `data/hub_packages/`。  
診所 Spoke 只下載已發布 Pack；**人只被事件叫醒**，不做月例行審核。

契約：`docs/Hub-Spoke無感更新與人力介入契約.md`

## 快速跑

```bat
scripts\tools\啟動-Hub-健保用藥Pack發布.bat
```

或：

```powershell
$env:HUB_FETCH_LIMIT="3000"              # 煙測；正式設 0 或不設＝全量
$env:HUB_LLM_REQUIRED_ON_MATERIAL="0"    # 首次／無 API Key 時允許發布
python -m hub.run
```

正式有實質出入時：設 `OPENAI_API_KEY`（或 `HUB_LLM_API_KEY`），並保持 `HUB_LLM_REQUIRED_ON_MATERIAL=1`。

藥價與**管制藥品分級**都走開放資料進 Pack，**不經診所健保 VPN**。

| 資料 | 官方來源 | 進 Pack |
|------|----------|---------|
| 藥價／用藥品項 | 健保署 datastore `A21030000I-E41001-001` | `resources.drugs` |
| 管制分級 | 食藥署未註銷藥證（`export/37`，欄「管制藥品分類級別」）以健保列 `FDA_URL` 的 licId 對 6 位字號；銷售一覽表（`export/51`）有健保碼則覆寫 | `controlClass`、`resources.controlledByNhiCode` |

對不上字號＋品名、或同一字號兩張證分級衝突 → **不猜**，該碼維持空。診所連 VPN 只為「保險對象即時查病患跨院紀錄」，不是為了更新主檔。

## 產出

| 路徑 | 用途 |
|------|------|
| `data/hub_packages/{version}.json` | Spoke 下載的 Pack |
| `data/hub_packages/{version}.summary.json` | 人眼摘要（不含藥列） |
| `data/hub_workspace/snapshots/` | 上版基準 |
| `data/hub_workspace/runs/` | 節點級 run 紀錄 |
| `data/hub_workspace/events/` | 擋下／失敗 → **叫醒人** |

Exit code：`0`＝成功或無差異；`2`＝事件擋下；`1`＝失敗。

## 環境變數（摘要）

`HUB_FETCH_LIMIT`、`HUB_PAGE_SIZE`、`HUB_WORKSPACE`、`HUB_PACKAGES_DIR`、  
`HUB_GATE_PRICE_REL_PCT`、`HUB_GATE_CHANGED_ITEMS`、`HUB_GATE_REMOVED_ITEMS`、`HUB_GATE_CONTROL_RECLASSIFIED`、  
`HUB_TFDA_LICENSE_URL`、`HUB_TFDA_SALES_URL`、  
`HUB_LLM_*` / `OPENAI_API_KEY`、`HUB_LLM_REQUIRED_ON_MATERIAL`
