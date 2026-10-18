/** Clinic print settings (localStorage). Shared by system settings and future print jobs. */

export type PrintDocKind = "rx" | "bag" | "receipt" | "report" | "label";

export type PrintPaperSize =
  | "thermal_small"
  | "A6"
  | "A5"
  | "A4"
  | "A4_landscape"
  /** Sc.ini ORDER／收據左右雙欄：114.0×101.6mm */
  | "order_dual"
  /** 掛號簿橫式寬紙 */
  | "register_book";

export type DrugNamePrintMode = "trade" | "generic" | "both";

export type PrintPart = { id: string; label: string; on: boolean };

/** 院所列印表上的一列。紙張可自訂；轉診單／診斷證明／押金單版面固定。 */
export type PrintSetupId =
  | "simple"
  | "formal"
  | "bag"
  | "audit"
  | "certificate"
  | "referral"
  | "deposit";

export type PrintSetup = {
  id: PrintSetupId;
  label: string;
  widthMm: number;
  heightMm: number;
  printerName: string;
  footer: string;
  /** 健保或對外固定版面：只調紙張與印表機 */
  layoutFixed: boolean;
  parts?: PrintPart[];
  fontSizePx?: number;
  /** 藥名那一列表格的字級 */
  drugFontSizePx?: number;
  receiptTitle?: string;
  /** 押金收據：退押天數、是否印身分證生日、不含例假日、只印單邊 */
  depositDays?: number;
  depositShowId?: boolean;
  depositHolidayNote?: boolean;
  depositSingleSide?: boolean;
};

export const DEFAULT_PRINT_SETUPS: PrintSetup[] = [
  {
    id: "simple",
    label: "\u7c21\u5f0f",
    widthMm: 114,
    heightMm: 101.6,
    printerName: "",
    footer: "\u672c\u6536\u64da\u907a\u5931\u6982\u4e0d\u88dc\u767c\uff0c\u85e5\u54c1\u8acb\u4fdd\u5b58\u65bc\u9670\u6dbc\u8655\u6240",
    layoutFixed: false,
    fontSizePx: 9,
    drugFontSizePx: 9,
    parts: [
      { id: "chief", label: "\u4e3b\u8a34", on: true },
      { id: "diagnoses", label: "\u75c5\u540d", on: true },
      { id: "marks", label: "\u8a08\u50f9\u8a3b\u8a18\u8207\u7b26\u865f", on: true },
      { id: "leftMoney", label: "\u5de6\u908a\u91d1\u984d", on: true },
      { id: "due", label: "\u61c9\u6536", on: true },
      { id: "feeTable", label: "\u53f3\u908a\u8cbb\u7528\u660e\u7d30", on: true },
      { id: "warning", label: "\u8b66\u8a9e", on: true },
    ],
  },
  {
    id: "formal",
    label: "\u7e41\u5f0f",
    widthMm: 148,
    heightMm: 210,
    printerName: "",
    footer: "",
    layoutFixed: false,
  },
  {
    id: "bag",
    label: "\u85e5\u888b",
    widthMm: 80,
    heightMm: 152,
    printerName: "",
    footer: "",
    layoutFixed: false,
  },
  {
    id: "audit",
    label: "\u62bd\u5be9",
    widthMm: 210,
    heightMm: 297,
    printerName: "",
    footer: "",
    layoutFixed: false,
  },
  {
    id: "certificate",
    label: "\u8a3a\u65b7\u8b49\u660e",
    widthMm: 210,
    heightMm: 297,
    printerName: "",
    footer: "",
    layoutFixed: true,
  },
  {
    id: "referral",
    label: "\u8f49\u8a3a\u55ae",
    widthMm: 210,
    heightMm: 297,
    printerName: "",
    footer: "",
    layoutFixed: true,
  },
  {
    id: "deposit",
    label: "\u62bc\u91d1\u55ae",
    widthMm: 114,
    heightMm: 101.6,
    printerName: "",
    footer: "\u6ce8 \u610f !!  \u672a\u84cb\u672c\u8a3a\u6240\u5370\u7ae0\u8005\u7121\u6548\uff0e",
    layoutFixed: true,
    depositDays: 7,
    depositShowId: false,
    depositHolidayNote: false,
    depositSingleSide: false,
  },
];

export const SIMPLE_PRINT_PARTS: PrintPart[] = [
  { id: "chief", label: "\u4e3b\u8a34", on: true },
  { id: "diagnoses", label: "\u75c5\u540d", on: true },
  { id: "marks", label: "\u8a08\u50f9\u8a3b\u8a18\u8207\u7b26\u865f", on: true },
  { id: "leftMoney", label: "\u5de6\u908a\u91d1\u984d", on: true },
  { id: "due", label: "\u61c9\u6536", on: true },
  { id: "feeTable", label: "\u53f3\u908a\u8cbb\u7528\u660e\u7d30", on: true },
  { id: "warning", label: "\u8b66\u8a9e", on: true },
];

export type PrintSettings = {
  /** Default paper for most clinic slips */
  defaultPaper: PrintPaperSize;
  fontSizePx: number;
  marginMm: number;
  drugNameMode: DrugNamePrintMode;
  printSelfPayDrugs: boolean;
  printMedBag: boolean;
  printDeptCategory: boolean;
  /** Per-document overrides (optional) */
  docs: Partial<Record<PrintDocKind, { paper?: PrintPaperSize; fontSizePx?: number }>>;
  setups: PrintSetup[];
};

export const PRINT_SETTINGS_KEY = "wundadi.printSettings.v1";

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  defaultPaper: "thermal_small",
  fontSizePx: 12,
  marginMm: 4,
  drugNameMode: "trade",
  printSelfPayDrugs: true,
  printMedBag: true,
  printDeptCategory: true,
  docs: {
    receipt: { paper: "order_dual", fontSizePx: 11 },
    bag: { paper: "thermal_small", fontSizePx: 11 },
    rx: { paper: "A6", fontSizePx: 12 },
    report: { paper: "register_book", fontSizePx: 12 },
    label: { paper: "thermal_small", fontSizePx: 10 },
  },
  setups: DEFAULT_PRINT_SETUPS.map((row) => ({ ...row })),
};

export const PAPER_OPTIONS: { value: PrintPaperSize; label: string }[] = [
  { value: "thermal_small", label: "小張熱感（藥袋）" },
  { value: "order_dual", label: "ORDER／收據左右雙欄（114×101.6mm）" },
  { value: "register_book", label: "掛號簿橫式（297×165mm）" },
  { value: "A6", label: "A6" },
  { value: "A5", label: "A5" },
  { value: "A4", label: "A4 直向" },
  { value: "A4_landscape", label: "A4 橫向" },
];

export function loadPrintSettings(): PrintSettings {
  try {
    const raw = localStorage.getItem(PRINT_SETTINGS_KEY);
    if (!raw) {
      return {
        ...DEFAULT_PRINT_SETTINGS,
        docs: { ...DEFAULT_PRINT_SETTINGS.docs },
        setups: DEFAULT_PRINT_SETUPS.map((row) => ({ ...row })),
      };
    }
    const parsed = JSON.parse(raw) as Partial<PrintSettings>;
    return {
      ...DEFAULT_PRINT_SETTINGS,
      ...parsed,
      docs: { ...DEFAULT_PRINT_SETTINGS.docs, ...(parsed.docs || {}) },
      setups: mergePrintSetups(parsed.setups),
    };
  } catch {
    return {
      ...DEFAULT_PRINT_SETTINGS,
      docs: { ...DEFAULT_PRINT_SETTINGS.docs },
      setups: DEFAULT_PRINT_SETUPS.map((row) => ({ ...row })),
    };
  }
}

export function savePrintSettings(settings: PrintSettings): void {
  localStorage.setItem(PRINT_SETTINGS_KEY, JSON.stringify(settings));
}

/** CSS @page size hint for browser print (best-effort). */
export function paperCssSize(paper: PrintPaperSize): string {
  switch (paper) {
    case "A4":
      return "A4 portrait";
    case "A4_landscape":
      return "A4 landscape";
    case "A5":
      return "A5";
    case "A6":
      return "A6";
    case "order_dual":
      return "114mm 101.6mm";
    case "register_book":
      return "297mm 165mm";
    case "thermal_small":
    default:
      return "80mm 200mm";
  }
}

function mergeParts(base: PrintPart[] | undefined, saved: PrintPart[] | undefined): PrintPart[] | undefined {
  if (!base) return undefined;
  return base.map((part) => {
    const hit = (saved || []).find((row) => row && row.id === part.id);
    return hit ? { ...part, on: hit.on !== false } : { ...part };
  });
}

function mergePrintSetups(saved: PrintSetup[] | undefined): PrintSetup[] {
  const rows = Array.isArray(saved) ? saved : [];
  return DEFAULT_PRINT_SETUPS.map((base) => {
    const hit = rows.find((row) => row && row.id === base.id);
    if (!hit) return { ...base };
    if (base.layoutFixed) {
      if (base.id !== "deposit") {
        return {
          ...base,
          printerName: String(hit.printerName || ""),
        };
      }
      const days = Number(hit.depositDays);
      const width = Number(hit.widthMm);
      const height = Number(hit.heightMm);
      return {
        ...base,
        widthMm: Number.isFinite(width) && width > 0 ? width : base.widthMm,
        heightMm: Number.isFinite(height) && height > 0 ? height : base.heightMm,
        printerName: String(hit.printerName || ""),
        footer: String(hit.footer || base.footer || ""),
        depositDays: Number.isFinite(days) && days > 0 ? days : base.depositDays,
        depositShowId: hit.depositShowId === true,
        depositHolidayNote: hit.depositHolidayNote === true,
        depositSingleSide: hit.depositSingleSide === true,
      };
    }
    const width = Number(hit.widthMm);
    const height = Number(hit.heightMm);
    const font = Number(hit.fontSizePx);
    return {
      ...base,
      widthMm: Number.isFinite(width) && width > 0 ? width : base.widthMm,
      heightMm: Number.isFinite(height) && height > 0 ? height : base.heightMm,
      printerName: String(hit.printerName || ""),
      footer: String(hit.footer ?? base.footer),
      fontSizePx: Number.isFinite(font) && font > 0 ? font : base.fontSizePx,
      drugFontSizePx:
        Number(hit.drugFontSizePx) > 0 ? Number(hit.drugFontSizePx) : base.drugFontSizePx,
      receiptTitle: typeof hit.receiptTitle === "string" ? hit.receiptTitle : base.receiptTitle,
      parts: mergeParts(base.parts, hit.parts),
    };
  });
}

export function partOn(setup: PrintSetup, id: string): boolean {
  const part = setup.parts?.find((row) => row.id === id);
  return part ? part.on !== false : true;
}

export function findPrintSetup(
  settings: PrintSettings,
  id: PrintSetupId,
): PrintSetup {
  return settings.setups.find((row) => row.id === id) || DEFAULT_PRINT_SETUPS.find((row) => row.id === id)!;
}

export function depositPrintOptions(setup: PrintSetup): {
  days: number;
  showIdBirthday: boolean;
  excludeHoliday: boolean;
  singleSide: boolean;
  warning: string;
} {
  const days = Number(setup.depositDays);
  return {
    days: Number.isFinite(days) && days > 0 ? days : 7,
    showIdBirthday: setup.depositShowId === true,
    excludeHoliday: setup.depositHolidayNote === true,
    singleSide: setup.depositSingleSide === true,
    warning: setup.footer || "",
  };
}

/** Deposit keeps the two-copy layout, but its sheet size is set with the other slips. */
export function paperSizeEditable(setup: Pick<PrintSetup, "id" | "layoutFixed">): boolean {
  return !setup.layoutFixed || setup.id === "deposit";
}

/** Width shorter than height is portrait. The printer's last job does not override this. */
export function paperDirectionLabel(widthMm: number, heightMm: number): string {
  return Number(widthMm) > Number(heightMm) ? "\u6a6b\u5411" : "\u76f4\u5411";
}

export function setupPageCss(setup: Pick<PrintSetup, "widthMm" | "heightMm">): string {
  const width = Number(setup.widthMm);
  const height = Number(setup.heightMm);
  if (Math.abs(width - 210) <= 1 && Math.abs(height - 297) <= 1) return "A4 portrait";
  if (Math.abs(width - 297) <= 1 && Math.abs(height - 210) <= 1) return "A4 landscape";
  return `${width}mm ${height}mm`;
}

export function resolveDocPrint(
  settings: PrintSettings,
  kind: PrintDocKind,
): { paper: PrintPaperSize; fontSizePx: number; marginMm: number } {
  const over = settings.docs[kind] || {};
  return {
    paper: over.paper || settings.defaultPaper,
    fontSizePx: over.fontSizePx ?? settings.fontSizePx,
    marginMm: settings.marginMm,
  };
}
