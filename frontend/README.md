# Teammomo 前端 — 沙盒 1（Mock Only）

## 界線

- **所有資料** 來自 `src/mocks/`（經 `src/mocks/index.ts` 匯出）
- **禁止** `fetch` 後端、**已移除** Vite `/api` proxy
- `src/config/sandbox.ts` 中 `API_ENABLED` 永遠為 `false`（整合前勿改）

## 啟動

```powershell
cd frontend
npm install
npm run dev
```

瀏覽器：http://127.0.0.1:5173（標題列顯示「沙盒1 · Mock」）

## 調整皮膚科診間佈局

| 檔案 | 用途 |
|------|------|
| `src/mocks/clinicMocks.ts` | 掛號、病患、處方、過敏 Mock |
| `src/pages/ClinicOutpatientPage.tsx` | 雙欄門診骨架 |
| `src/i18n/zh-TW.ts` | 繁中標籤 |

## Jira

**KAN-8**（微前端 UI）— 與 **KAN-2/KAN-4** 後端分開驗收。

## 與後端整合（未開放）

Phase 4 以前請先分開驗收沙盒 2 Swagger API，再開 `VITE_ENABLE_API` 整合開關。
