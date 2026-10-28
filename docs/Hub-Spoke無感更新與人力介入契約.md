# Hub–Spoke 無感更新與人力介入契約

> 定稿依據：產品方確認（一人公司、診所無感、人力僅事件觸發）  
> 狀態：**已定案** — 相關功能開發／驗收必須遵守本文件

---

## 1. 目標

- **每台主機**：自己向健保署、食藥署抓整份，檢查通過就做成藥價包並裝進查價；不重開機。抓壞、擋下、或檢查碼沒過，沿用上一成功版。
- **人不審價**：機器可以每個月自己抓；**人只在事件發生時被通知**，不因「又到月初」而介入。
- **計價正確性**：靠擋下壞檔；正常的舊檔對新檔直接發布。不靠每月例行人工審核，也不靠 GitHub 轉送藥價。

---

## 2. 職責切分

| 端 | 做 | 不做 |
|----|----|------|
| **主機** | 取得官方整份、正規化、與上一版對照、壞檔就擋下、通過則發布藥價包、裝進查價前再對檢查碼、擋下或這個月沒抓成時在大廳顯示 | 把未過檢查的價格裝進去；用日曆逼人審核；為了藥價去連 GitHub |
| **查價** | 依就醫日選已裝上的藥價包、失敗就沿用上一版 | LLM、人工審價、為更新重啟 |

診所端**永遠不做人審藥價**。人工只在壞檔或沒抓成時出現。

---

## 3. 兩種觸發（必須分開）

| 對象 | 時間觸發（排程） | 事件觸發 |
|------|------------------|----------|
| **機器（Hub）** | **允許**（例：定期抓官方檔、跑校驗） | 失敗／出入時升級 |
| **人（維運者）** | **禁止**（禁止「每月請審核」類通知） | **僅允許**（見 §4） |

一句話：**機器可以有日曆；人的日曆上不該出現例行更新票。**

---

## 4. 人力介入 = 純事件（唯三類）

只有下列情況可通知並要求動手：

1. **壞檔**：整份是空的、少於一萬筆、兩成以上的藥不見了，或單筆價格跳了兩倍以上。正常月份的改價直接發布，不叫人。
2. **管線 BUG／失敗**：抓檔失敗、解析／schema 不過、checksum 異常、重複失敗等。
3. **無法自動判定**：來源改版或差異使系統沒把握自動 Publish。

通知須包含：發生什麼、差在哪、要人做什麼決定（發布／退回／凍結沿用舊版）。

### 明確禁止的人力觸發

- 每月／每季「例行確認」
- 僅有新檔但 diff 無實質影響仍打擾
- 單純「有更新可下載」且已可自動過

---

## 5. 自動路徑（常態、零通知）

Hub 靜默完成且**全部**通過時：

1. 取得資料  
2. schema／checksum／diff  
3. 規則閘門（幅度、刪除量、來源指紋等）  
4. （可選）LLM：僅輔助判定「有無實質出入／能否自動過」— **不得在無人事件下直接改價後當最終真相偷發**；自動路徑僅允許「判定可過 → 發布未改寫或僅機械正規化之資料」  
5. **自動 Publish** 帶 `version` / `effectiveFrom` / `checksum` 的 Pack  
6. **不通知人**  
7. Spoke Hydrator 無感下載

不確定或未過閘 → **不發布**；診所繼續用上一成功 Pack；並依 §4 **事件通知人**。

原則：**寧可停更，不可灌錯價。**

---

## 6. Pack 契約（最低欄位）

每個已發布 Package 至少包含：

- `version`（如 `2026.09.1`）
- `effectiveFrom` / `effectiveTo`（可 null）
- `checksumSha256`
- `publishedAt`
- `publishMode`: `auto` | `manual`（事件後人工發布）
- `interventionEvent`（若為 manual：出入／失敗／無法判定之摘要）

Spoke：只安裝 **已發布** Pack；校驗 checksum；依看診日或申報月之 `target_date` 選生效版。

---

## 7. 與現有 Codebase 的關係

| 現有 | 角色 |
|------|------|
| `sync_queue` + `BackgroundSyncWorker` | **臨床資料出站**（本機 → 雲）— 勿與 Pack 進站混用 |
| 本文件之 Hydrator | **參考資料／藥價／格式 Pack 進站**（Hub → 診所）— **已做**（`src/spoke/`、`/sync/packages/*`） |
| `yisheng_clinic_catalog.json` 等 | 過渡期本機樣本；最終由版本化 Pack 取代／演進 |

---

## 8. 開發驗收定義（DoD）

相關 Ticket／PR 必須可勾選：

- [ ] 已標明：機器排程 vs 人力事件（人力無日曆例行）
- [ ] 自動過閘路徑：通過則 Publish 且**零通知**
- [ ] 未過閘／失敗／無法判定：不發布 + **事件通知** + Spoke 可 fallback
- [ ] Spoke 無爬蟲、無 LLM、無為更新而重啟
- [ ] 未 Publish 則診所版本號不變

未遵守本契約的「每月人工審核」設計 = **驗收不合格**。

---

## 9. 實作分期

1. Pack 契約 + 本機／Hub 檔案布局 — **已做**（`data/hub_packages/`）
2. Spoke Hydrator（分節點、checksum、fallback、診斷 API）— **已做**（`src/spoke/`、`/sync/packages/*`）
3. `target_date` 多版本選用 — **API 已做**（`GET /sync/packages/resolve`）；開藥已依就醫日 Pack 查價寫入快照；申報組檔已讀快照／補查
4. Hub 自動抓檔＋閘門＋事件通知（人力僅 §4）— **已做**（`hub/`、`scripts/tools/啟動-Hub-健保用藥Pack發布.bat`）

### Hub 端（中央／一人維運）

| 項目 | 說明 |
|------|------|
| 進入點 | `python -m hub.run` 或 `scripts/tools/啟動-Hub-健保用藥Pack發布.bat` |
| 資料源 | 健保開放資料 datastore `A21030000I-E41001-001`（非爬 HTML） |
| 工作區 | `data/hub_workspace/`（snapshots／runs／**events**） |
| 發布目錄 | `data/hub_packages/`（Spoke Hydrator 讀此目錄） |
| 測試拉檔 | `HUB_FETCH_LIMIT=3000`（0＝全量，約 20 萬列） |
| 誰來跑 | 主機服務啟動後，這個月還沒對過就自己抓。大廳「更新藥價」也可立刻抓。不需要 LLM API |
| 事件（叫醒人） | `data/hub_workspace/events/`；**禁止**月例行審核通知 |
| 節點診斷 | 每次 run 寫入 `data/hub_workspace/runs/`，含 failedNode／diagnosis |

詳見 `hub/README.md`。

### 診所端糾錯（不要只看到「更新失敗」）

| 端點 | 用途 |
|------|------|
| `GET /sync/packages/nodes` | 管線節點說明 |
| `GET /sync/packages/status` | 最新版、上次執行、`diagnosis`、失敗節點 |
| `GET /sync/packages/runs` | 歷史執行（每步 ok/code/message） |
| `POST /sync/packages/hydrate` | 手動再跑一輪 |
| `GET /health` → `packages` | 一眼看上次 Hydrate 是否失敗 |

失敗時必有：`failedNode` + `errorCode` + `diagnosis`；診所繼續用上一成功版（`fallback`）。

與臨床出站分離：`/sync/queue` ≠ `/sync/packages`。

---

**定案句：**  
機器可按時間跑；通過就靜默更新診所；**人只在實質出入、BUG、或無法判定時被叫來。**
