# 北極星自主電子病歷系統（PSEHR）

開源門診系統（程式內名稱仍見 Wundadi）。下載後用空資料庫跑；**不含**任何診所病歷、安全模組金鑰或藥價整包。

**給 Agent／接手開發：** 先讀根目錄 [`AGENTS.md`](AGENTS.md)，再讀 [`docs/文件索引.md`](docs/文件索引.md)。  
產品原則權威：[`docs/專案憲章-原則與方向.md`](docs/專案憲章-原則與方向.md)。  
近期已定行為：[`docs/交接-目前進度.md`](docs/交接-目前進度.md)。  
目錄職責：[`docs/模組地圖.md`](docs/模組地圖.md)。

公開倉庫：`momohsumomo/PSEHR`。病歷在主機 `data/`，**禁止**進 GitHub。

---

## 兩塊怎麼分

| 區塊 | 內容 |
|------|------|
| **服務端（本倉庫大半）** | 主機：UI :3010、API :5000、UDP 5301、影子庫、申報、藥價 Pack |
| **`客戶端/`** | 只拷到其他電腦：開啟門診、列印、讀卡代理（:5310）。說明：`客戶端/安裝說明.txt` |

主機第一次用 `啟動-Wundadi門診.bat` 後可登記開機自啟（約登入後 20 秒）。其他電腦用 `連到主機.bat`／`開啟門診.exe`，**不要**在工作站再啟一套 API。

詳見 [`docs/主機與工作站.md`](docs/主機與工作站.md)。

---

## 從零開始（開發機）

需要 **Python 3.12** 與 **Node.js**。

```bat
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
cd frontend
npm install
cd ..
啟動-Wundadi門診.bat
```

- 畫面：http://127.0.0.1:3010  
- API 文件：http://127.0.0.1:5000/docs  
- 第一次會在 `data/` 建立本機資料庫（不進版控）

院所代碼、讀卡機與雲端 SAM 在院所自己的環境設定；程式內範例機構代碼上線前必須改掉。

---

## 藥價

主機可自行向健保署／食藥署開放資料抓檔並做成藥價包（見 `hub/`、`src/core/drug_price_refresh.py`）。  
開發機也可：

```bat
scripts\tools\抓取藥價包.bat
```

舊病歷用**就醫當日**價格，不用新價回算。

---

## 診所程式更新

GitHub Release 標籤：`program-YYYY.MM.DD.N`。  
大廳「更新」由診所操作。開發者 `git push` **不等於**已裝到看診主機。

---

## 授權

MIT，見 [LICENSE](LICENSE)。
