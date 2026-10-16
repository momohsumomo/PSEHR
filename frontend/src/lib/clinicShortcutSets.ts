import type { ShortcutBarItem } from "@/types/uiConfig";

/** 診療作業頂部分頁（對醫聖 F2–F6） */
export type ClinicTab = "list" | "chart" | "history" | "alerts" | "radiology";

export const CLINIC_MODULE_TABS: { id: ClinicTab; key: string; label: string }[] = [
  { id: "list", key: "F2", label: "掛號清單" },
  { id: "chart", key: "F3", label: "診療作業" },
  { id: "history", key: "F4", label: "歷史病歷" },
  { id: "alerts", key: "F5", label: "過敏/檢查/醫囑/提醒" },
  { id: "radiology", key: "F6", label: "放射科檢查" },
];

/** 掛號作業底欄（截圖 06）— 與診療清單文案必須可一眼分辨 */
export const REGISTER_SHORTCUT_BAR: ShortcutBarItem[] = [
  { key: "F2", label: "掛號", action: "register", enabled: true },
  { key: "F3", label: "修編", action: "registerEdit", enabled: true },
  { key: "F4", label: "退押", action: "refundDeposit", enabled: true },
  { key: "F5", label: "病患", action: "editPatient", enabled: true },
  { key: "F6", label: "收據", action: "receipt", enabled: true },
  { key: "F7", label: "刪除", action: "deleteReg", enabled: true },
  { key: "F8", label: "調閱", action: "emrLookup", enabled: true },
  { key: "F11", label: "讀卡", action: "readCard", enabled: true },
  { key: "Esc", label: "回大廳", action: "escapeHome", enabled: true },
];

/** 診療作業 · 當日清單底欄（截圖 20） */
export const CLINIC_LIST_SHORTCUT_BAR: ShortcutBarItem[] = [
  { key: "F2", label: "掛號", action: "register", enabled: true },
  { key: "F3", label: "修編", action: "registerEdit", enabled: true },
  { key: "F4", label: "看診", action: "clinicMain", enabled: true },
  { key: "F5", label: "病患", action: "editPatient", enabled: true },
  { key: "F6", label: "查詢", action: "query", enabled: true },
  { key: "F7", label: "刪除", action: "deleteReg", enabled: true },
  { key: "F8", label: "調閱", action: "emrLookup", enabled: true },
  { key: "Esc", label: "回大廳", action: "escapeHome", enabled: true },
];

/** 診療作業 · 看診底欄（截圖 21）— 不含「F9 讀卡掛號」 */
export const CLINIC_CHART_SHORTCUT_BAR: ShortcutBarItem[] = [
  { key: "F2", label: "掛號", action: "register", enabled: true },
  { key: "F3", label: "修編", action: "registerEdit", enabled: true },
  { key: "F4", label: "歷史", action: "historyChart", enabled: true },
  { key: "F5", label: "病患", action: "editPatient", enabled: true },
  { key: "F6", label: "藥組", action: "bigPalette", enabled: true },
  { key: "F7", label: "Ditto", action: "dittoRx", enabled: true },
  { key: "F8", label: "IC卡", action: "icCard", enabled: true },
  { key: "F9", label: "存檔", action: "saveChart", enabled: true },
];