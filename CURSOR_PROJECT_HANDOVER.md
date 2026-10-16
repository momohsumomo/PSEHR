# 🚀 Wundadi FHIR HIS — 專案開發交接與 Cursor 開發指南 (Project Handover)

> **本文件旨在提供轉移至 Cursor IDE 繼續開發時的完整專案架構說明、技術藍圖、模組地圖與操作流程。**

---

## 📌 一、 專案核心理念與架構 (Project Overview)

**Wundadi FHIR HIS** 是一套專為皮膚科與復健科門診打造的現代化醫療資訊系統。系統徹底拋棄傳統 FoxPro/DBF 舊架構的技術債，採用現代化 Web 與國際醫療標準重構：

1. **Local-First (本機優先雙層架構)**：
   * **本機端**：SQLite 雙層快取 (`encounter_index`, `patient_index`)，提供門診現場毫秒級零延遲反應，即使斷網也能正常看診。
   * **雲端**：非同步背景佇列 (Background Sync Worker)，秒級同步至 GCP Cloud PostgreSQL 資料庫。
2. **FHIR R4 國際醫療標準**：
   * 資料架構原生對齊 HL7 FHIR R4 標準資源（`Patient`, `Encounter`, `Condition`, `MedicationRequest`, `Observation`, `Media`, `ServiceRequest`, `Claim`）。
3. **健保局控制軟體 6.0 RESTful API 整合**：
   * 直接連線健保局主控台 API (`http://127.0.0.1:5066`)，實體 IC 卡讀寫、SAM 卡金鑰驗證與虛擬健保卡（QR Code）全自動連線處理。
4. **FIDO2 / WebAuthn 去中心化安全驗證**：
   * 支援無密碼指紋/實體金鑰登入，符合醫療資安防範規章。

---

## 🎨 二、 前端介面與分頁導航地圖 (Frontend Navigation Map)

* **技術棧**：Vite 6 + React 18 + TypeScript + Tailwind CSS
* **專案目錄**：`frontend/src/pages/`

### 1. 門診主大廳 (`/` -> `LobbyPage.tsx`)
* **頂部分類下拉選單列 (Top Dropdown Navbar)**：
  * 對齊傳統醫聖的 8 大選單（`S 系統工具`、`T 工具程式`、`D 資料庫`、`T 統計分析`、`P 參數設定`、`C 關懷系統`、`F 便捷功能`、`O 其他功能`）。
  * 點選或懸停即可展開二級下拉選單（如：申報加密、備份、輪班表、主訴範本等）。
* **經典 1-8 / 9-X 核心功能按鈕**：
  * 支援鍵盤 `[1-X]` 單鍵快速跳轉。
* **中央尊榮診所看板**：
  * 展示「豐到底皮膚專科診所」、實時系統時鐘與 Port 5066 連線狀態。

### 2. 院所資料與營運參數控制台 (`/clinic-profile` -> `ClinicProfilePage.tsx`)
* **Tab 1: 🏢 院所基本登記資料**：衛福部開業登記全銜 (豐到底皮膚專科診所)、10 碼健保代碼 (`3521013662`)、執照號碼、中英文地址與電話。
* **Tab 2: 💵 門診費用與減免規則 (單一整合入口)**：掛號費 ($200)、押金 ($400)、補刷卡期限 (30天)、老人折扣 ($50)、公衛$0免收設定。
* **Tab 3: 🩺 看診與健保局控制軟體 6.0 API 流程設定**：開藥 3 天預設、小兒磨粉 <=6 歲、病歷自動調閱 16 次、健保局 Port 5066 RESTful API 自動化。
* **Tab 4: 🖨️ 處方箋與報表列印設定**：A6 健保專用頁/六等份報表、商品名列印、藥袋自動列印。

### 3. 其他核心模組一覽
| 模組名稱 | 路由 (Route) | 檔案位置 (File) | 功能說明 |
| :--- | :--- | :--- | :--- |
| **門診看診工作台** | `/clinic` | `ClinicOutpatientPage.tsx` | 兩階段 SOAP 看診、ICD-10 診斷開立與處方 |
| **掛號作業** | `/register` | `RegisterPage.tsx` | 病患報到、預約掛號、欠卡押單與報到佇列 |
| **病患資料** | `/patients` | `PatientListPage.tsx` | 病患基本資料建檔、查詢與歷次就醫記錄 |
| **健保申報作業** | `/claims` | `ClaimsPage.tsx` | 健保費用月申報打包、XML 轉檔校對與下載 |
| **費用與收費統計** | `/billing` | `BillingPage.tsx` | 收費批價明細、門診現金收訖與財務統計 |
| **語音叫號系統** | `/speaker` | `SpeakerPage.tsx` | 呼叫瀏覽器原生 Web Speech API 自動國語/台語叫號 |
| **病灶影像管理** | `/img-manager` | `ImgManagerPage.tsx` | 皮膚科病灶部位照片上傳、PACS 歷次時序對照 |
| **電子轉診作業** | `/referral` | `ReferralPage.tsx` | FHIR `ServiceRequest` 健保電子轉診單開立 |
| **預防保健篩檢** | `/preventive-care` | `PreventiveCarePage.tsx` | 成人健檢、四大癌篩與黃卡疫苗通報 |

---

## 🛠️ 三、 後端 API 與資料庫架構 (Backend API Architecture)

* **技術棧**：Python 3.11+ + FastAPI + SQLite (SQLAlchemy) + Pydantic
* **進入點**：`src/main.py`
* **Swagger 互動文件**：啟動後登入 `http://127.0.0.1:5000/docs`

### 核心 REST API 端點分類
* `GET /api/v1/patients` & `POST /api/v1/patients`：病患 CRUD 與 FHIR Patient JSON 轉換。
* `POST /api/v1/encounters`：門診 SOAP 病歷寫入與兩階段看診狀態切換。
* `POST /api/v1/claims/export-xml`：健保醫療費用月申報 XML 生成。
* `POST /api/v1/media/upload`：病灶照片上傳與 PACS 時序庫歸檔。
* `GET /api/v1/health`：Local-First 雙層快取與雲端佇列狀態監控。

---

## ⚡ 四、 專案啟動與驗收測試指南 (Commands & Run Guide)

在 Cursor 開發環境中，雙擊根目錄：

### 1. 日常開診（後端 5000 + 畫面 3010）
```
啟動-Wundadi門診.bat
```

### 2. 其它根目錄入口
* `開啟-用Cursor問本專案.bat`：用 Cursor 開本資料夾
* `fix-nhi-cshis6-port-5066.bat`：讀卡機埠 5066 被 Windows 佔用時

### 3. 自動化驗收（不在根目錄）
* `scripts\验收\測試-沙盒2-門診一日閉環-自動驗收.bat`
* `scripts\验收\測試-沙盒2-健保患者進場-自動驗收.bat`
* `scripts\验收\測試-沙盒2-健保SOAP門診紀錄-自動驗收.bat`

---

## 🤖 五、 Cursor AI 開發提示與建議 (Cursor Prompts & Tips)

當您在 Cursor 中使用 `Cmd+K` 或 `Ctrl+I` / Composer 進行開發時，可以參考以下 Prompt 提示範例：

### 1. 新增或修改前端頁面時
> "請參考 `frontend/src/pages/ClinicProfilePage.tsx` 的設計風格（Tailwind CSS 深色尊榮主題 + 頁籤切換 Tabs），在 `[頁面名稱]` 中新增 [功能描述]，並確保組件遵循單一職責原則。"

### 2. 擴充 FHIR API 端點時
> "請在 `src/api/` 中新增一個 [Resource 名稱] 端點，資料結構需符合 HL7 FHIR R4 標準規範，並維護 SQLite 雙層快取 (`src/db/`) 與 Pydantic 數據校驗。"

### 3. 進行健保申報或讀卡機調試時
> "請參考 `主控台元件 - Web API 規格書.pdf` 與 `讀卡機控制軟體6.0` 規格，更新對應的 API 請求 JSON Payload。"

---

**交接時不要當成全部做完。** 2026-10-13：主畫面名稱是北極星自主電子病歷系統。已補費用統計預覽、診療印收據、F2 按鈕分流、更改本時段藥師。轉診單只在診療看診畫面。還沒做：業績統計、自費差異優待、押金逾期自動改自費、轉診沒序號時的申報檢查、轉診上傳（要醫事人員卡）、醫事登入。見 `docs/醫聖對照/全模組對照差距表.md`。
