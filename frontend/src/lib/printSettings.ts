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

/** 院所列印表上的一列。紙張可自訂；轉診單／診斷證明版面固定。 */
export type PrintSetupId =
  | "simple"
  | "formal"
  | "bag"
  | "audit"
  | "certificate"
  | "referral";

export type PrintSetup = {
  id: PrintSetupId;
  label: string;
  widthMm: number;
  heightMm: number;
  printerName: string;
  footer: string;
  /** 健保或對外固定版面：只調紙張與印表機 */
  layoutFixed: boolean;
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

function mergePrintSetups(saved: PrintSetup[] | undefined): PrintSetup[] {
  const rows = Array.isArray(saved) ? saved : [];
  return DEFAULT_PRINT_SETUPS.map((base) => {
    const hit = rows.find((row) => row && row.id === base.id);
    if (!hit) return { ...base };
    if (base.layoutFixed) {
      return {
        ...base,
        printerName: String(hit.printerName || ""),
      };
    }
    const width = Number(hit.widthMm);
    const height = Number(hit.heightMm);
    return {
      ...base,
      widthMm: Number.isFinite(width) && width > 0 ? width : base.widthMm,
      heightMm: Number.isFinite(height) && height > 0 ? height : base.heightMm,
      printerName: String(hit.printerName || ""),
      footer: base.layoutFixed ? "" : String(hit.footer || ""),
    };
  });
}

export function findPrintSetup(
  settings: PrintSettings,
  id: PrintSetupId,
): PrintSetup {
  return settings.setups.find((row) => row.id === id) || DEFAULT_PRINT_SETUPS.find((row) => row.id === id)!;
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
