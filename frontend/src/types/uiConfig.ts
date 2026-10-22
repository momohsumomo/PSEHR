/** 醫聖 Sc.ini / *.Set 對應之可調 UI 預設（default_ui_config.json） */

export type UiColumnDef = {
  key: string;
  label: string;
  widthCh?: number;
};

export type CcTemplate = {
  id: string;
  text: string;
  type?: string;
};

export type ShortcutBarAction =
  | "queueList"
  | "register"
  | "registerEdit"
  | "clinicMain"
  | "historyChart"
  | "clinicalAlerts"
  | "quickPrice"
  | "dittoRx"
  | "lesionPhoto"
  | "readCard"
  | "radiology"
  | "saveChart"
  | "bigPalette"
  | "editPatient"
  | "icCard"
  | "refundDeposit"
  | "receipt"
  | "printVisit"
  | "deleteReg"
  | "emrLookup"
  | "query"
  | "escapeHome"
  | "otherFunctions"
  | "certificate";

export type ShortcutBarItem = {
  key: string;
  label: string;
  action: ShortcutBarAction;
  enabled?: boolean;
};

export type DoctorPreferences = {
  rightPanelMode?: "history" | "queue";
  entryFocus?: "cc" | "diagnosis" | "rx" | "command" | "history";
  /** Sc.ini：診療多功能按鈕鍵是否增加 F2 快速批價 */
  enableQuickPriceF2?: boolean;
  drugDisplayMode?: "customName" | "tradeName" | "generic";
  historyFontSizePx?: number;
  historyRxColWidthCh?: number;
  useBigRxPalette?: boolean;
  newHistoryPanel?: boolean;
  dittoCc?: boolean;
  dittoDx?: boolean;
  dittoRxSkipDuplicate?: boolean;
  /** Sc.ini：歷史病歷Ditto是否加註連續處方原就醫日在主述區內 */
  dittoCcStampVisitDate?: boolean;
  /** Sc.ini：新歷史病歷的病名欄位是否省略ICD9碼 */
  hideHistoryIcd?: boolean;
  /** Sc.ini：新歷史病歷的處方內容是否顯示就醫日期 */
  showHistoryRxVisitDate?: boolean;
  allergyEmptyText?: string;
  rxSearchOrder?: string;
  dxSearchOrder?: string;
};

export type LayoutGrid = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type LayoutComponent = {
  id: string;
  type: string;
  grid: LayoutGrid;
  visible: boolean;
  title?: string;
};

export type UiLayout = {
  columns: number;
  rows: number;
  components: LayoutComponent[];
};

export type DefaultUiConfig = {
  version?: string;
  source?: string;
  layout?: string;
  layoutGrid?: UiLayout;
  sections?: {
    allergyBanner?: { sticky?: boolean; enabled?: boolean };
    lesionPhotos?: { heightRatio?: number; minHeightPx?: number; enabled?: boolean };
    commandLine?: { enabled?: boolean; autoFocus?: boolean };
    rightPanel?: { mode?: string; defaultExpanded?: boolean; widthPx?: number };
    queuePanel?: { mode?: "card" | "table"; fontSizePx?: number };
    prevRxAboveCurrent?: boolean;
    rightRailCollapsedByDefault?: boolean;
  };
  doctorPreferences?: DoctorPreferences;
  queueColumns?: string[];
  queueColumnKeys?: string[];
  currentRxColumns?: UiColumnDef[];
  rxPickerColumns?: UiColumnDef[];
  ccChips?: string[];
  ccTemplates?: CcTemplate[];
  shortcuts?: Record<string, string>;
  shortcutBar?: ShortcutBarItem[];
  defaultUsages?: string[];
};


export const FALLBACK_UI_CONFIG: DefaultUiConfig = {
  ccChips: ["搔癢", "脫屑", "痤瘡", "色素斑", "紅疹", "水泡"],
  doctorPreferences: {
    rightPanelMode: "history",
    entryFocus: "command",
    allergyEmptyText: "無",
  },
  layoutGrid: {
    columns: 12,
    rows: 12,
    components: [
      { id: "queue-panel", type: "QueuePanel", grid: { x: 0, y: 0, w: 2, h: 12 }, visible: true, title: "掛號清單" },
      { id: "allergy-banner", type: "AllergyBanner", grid: { x: 2, y: 0, w: 7, h: 1 }, visible: true, title: "過敏警示帶" },
      { id: "patient-header", type: "PatientHeader", grid: { x: 2, y: 1, w: 7, h: 1 }, visible: true, title: "病患標題列" },
      { id: "lesion-photos", type: "LesionPhotos", grid: { x: 2, y: 2, w: 7, h: 3 }, visible: true, title: "病灶照片區" },
      { id: "chief-complaint", type: "ChiefComplaint", grid: { x: 2, y: 5, w: 7, h: 2 }, visible: true, title: "主訴 CC" },
      { id: "diagnoses", type: "Diagnoses", grid: { x: 2, y: 7, w: 7, h: 2 }, visible: true, title: "診斷病名" },
      { id: "current-rx", type: "CurrentRx", grid: { x: 2, y: 9, w: 7, h: 3 }, visible: true, title: "處方開立" },
      { id: "right-panel", type: "RightPanel", grid: { x: 9, y: 0, w: 3, h: 12 }, visible: true, title: "快捷與歷史" }
    ]
  },
  sections: {
    rightPanel: { mode: "history", defaultExpanded: true, widthPx: 320 },
    queuePanel: { mode: "table", fontSizePx: 14 },
    commandLine: { enabled: true, autoFocus: true },
    lesionPhotos: { enabled: false, minHeightPx: 160, heightRatio: 0.28 },
    prevRxAboveCurrent: false,
  },
  currentRxColumns: [
    { key: "payMark", label: "", widthCh: 2 },
    { key: "name", label: "處置名稱", widthCh: 22 },
    { key: "qty", label: "數量", widthCh: 5 },
    { key: "route", label: "途徑", widthCh: 4 },
    { key: "sig", label: "用法", widthCh: 8 },
    { key: "days", label: "天", widthCh: 3 },
    { key: "totalAmount", label: "總量", widthCh: 6 },
    { key: "memo", label: "註", widthCh: 4 },
    { key: "bodySite", label: "部位", widthCh: 14 },
    { key: "tag", label: "標", widthCh: 3 },
  ],
  queueColumns: [
    "完",
    "序號",
    "時間",
    "病歷號",
    "姓名",
    "年齡",
    "性別",
    "病名",
    "時段",
    "診間",
    "註",
    "預",
    "案",
    "自付",
    "押金",
    "掛費",
    "藥費",
    "總計",
    "備註記載",
  ],
  queueColumnKeys: [
    "doneMark",
    "queueNumber",
    "slotTime",
    "medicalNo",
    "patientDisplay",
    "age",
    "sex",
    "diseaseName",
    "shift",
    "room",
    "note",
    "preVisit",
    "caseNo",
    "copay",
    "deposit",
    "regFee",
    "drugFee",
    "totalFee",
    "reasonText",
  ],
};
