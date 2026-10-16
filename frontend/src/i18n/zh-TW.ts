/**
 * 繁體中文臨床字典（Phase 0）
 * 後續可換 react-i18next；現階段 UI 倒逼後端，保持輕量。
 */
export const zhTW = {
  app: {
    title: "Teammomo FHIR 門診",
    subtitle: "本地優先 · 病患自主加密 · 皮膚科工作站",
    localFirst: "Local-First 影子庫",
  },
  nav: {
    clinic: "門診看診",
  },
  queue: {
    title: "今日掛號",
    waiting: "候診中",
    in_progress: "看診中",
    no_show: "已過號",
    finished: "已看診",
    call: "叫號",
    finish: "完成看診",
    noshow: "過號",
    deleteReg: "刪除掛號",
  },
  allergy: {
    banner: "過敏警示",
    confirmed: "已確認過敏",
    unconfirmed: "未確認過敏 — 需人工核對",
    none: "未登錄過敏史",
    highRisk: "高風險 — 開立前請再次確認",
  },
  avatar: {
    preVisit: "已完成預診",
    allergy: "藥物過敏",
  },
  chart: {
    patientTitle: "病患資料",
    lesionPhotos: "病灶照片（歷史對照）",
    cc: "主訴",
    diagnosis: "診斷（ICD-10 / Condition）",
    prevRx: "前次處方",
    copyPrevRx: "一鍵複製前次處方",
    currentRx: "當前處方",
    medblocksPatient: "Medblocks FHIR 病患表單",
    medblocksEncounter: "Medblocks FHIR 就診表單",
    medblocksHint: "mb-fhir-form · FHIR Patient（medblocks-ui）",
    medblocksEncounterHint: "mb-fhir-form · FHIR Encounter（medblocks-ui）",
  },
  nhi: {
    code: "健保碼",
    icd10: "ICD-10-CM",
    placeholder: "台灣健保碼對齊 — Phase 1 接術語伺服器",
  },
  shortcuts: {
    title: "右欄捷徑",
    packages: "處方套餐",
    icd: "常用 ICD",
    complete: "完成看診",
  },
} as const;

export type ZhTW = typeof zhTW;
