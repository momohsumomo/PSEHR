/**
 * YiSheng look: Windows XP Luna chrome + clinic content colors.
 * Typography hierarchy (from screenshots):
 * primary=14, body=13, secondary=11, tertiary=10, fbar=12; list row=18px.
 *
 * Keep in sync with CSS variables in src/index.css (:root).
 * Call applyHisDocumentTheme() once at app boot so Chrome dark mode cannot recolor.
 */
export const HIS_FONT =
  '"\u65b0\u7d30\u660e\u9ad4", "PMingLiU", MingLiU, "Microsoft JhengHei", Tahoma, sans-serif';

export const HIS = {
  /** XP dialog face (not Win95 gray) */
  chrome: "#C9DEB4",
  chromeDark: "#ACA899",
  chromeBorder: "#808080",
  titleBarFrom: "#0A5AD6",
  titleBarTo: "#3C91FE",
  titleBarBorder: "#003C74",
  headerBg: "#B7CFA0",
  headerBgGreen: "#C0DCC0",
  rowAlt: "#F0FFF0",
  rowFinished: "#C8F0C8",
  rowWaiting: "#F5F9FF",
  rowSelected: "#FFFF80",
  /** XP selection blue */
  listSelected: "#316AC5",
  listSelectedText: "#FFFFFF",
  listSelectedNavy: "#000080",
  accentCyan: "#00FFFF",
  ccBg: "#F6F1A8",
  ccBorder: "#800080",
  ccText: "#400080",
  dxBg: "#E8FFE8",
  rxBg: "#FFFFF0",
  rxHeader: "#D8D4C8",
  rxSelected: "#404860",
  dxSelected: "#FFFF80",
  labelBg: "#D0D0D0",
  labelText: "#003C74",
  /** Window panels: light grass green. */
  surface: "#D7E8C6",
  /** Fields that stand apart from the green ground. */
  inputBg: "#F6F1A8",
  tabIdle: "#C9DEB4",
  tabIdleText: "#000000",
  tabActive: "#206868",
  tabActiveText: "#FFFFFF",
  allergyBar: "#CC0000",
  lobbyFrom: "#2A6AAA",
  lobbyMid: "#0A3A6A",
  lobbyTo: "#062848",
  lobbyBtnFrom: "#1A4A98",
  lobbyBtnTo: "#0A2868",
  lobbyGold: "#FFD200",
  scGold: "#E8C040",
  patientFace: "#C8F0B8",
  patientRight: "#D0FF40",
  inputBlue: "#0000CC",
  fs: { primary: 14, body: 13, secondary: 11, tertiary: 10, fbar: 12, title: 12 },
  row: { list: 18, listHeader: 17, formField: 20, fbarPrimary: 52, fbarSecondary: 22 },
  labelW: "4.25rem",
};

export const HIS_QUEUE_COL_WIDTHS: Record<string, number> = {
  doneMark: 20,
  queueNumber: 34,
  slotTime: 40,
  medicalNo: 52,
  patientDisplay: 52,
  age: 36,
  sex: 26,
  diseaseName: 168,
  shift: 30,
  note: 24,
  preVisit: 20,
  caseNo: 26,
  copay: 34,
  deposit: 34,
  regFee: 34,
  drugFee: 34,
  totalFee: 38,
  reasonText: 88,
};

export const hisFontStyle = { fontFamily: HIS_FONT } as const;

export const HIS_FBAR_COLORS = {
  F2: "#90EE90",
  F3: "#DDA0DD",
  F4: "#FFFF80",
  F5: "#FF6B6B",
  F6: "#87CEEB",
  F7: "#FFB6C1",
  F8: "#FFE4B5",
  F9: "#7FFFD4",
  Esc: "#D4D0C8",
  X: "#D4D0C8",
} as const;

const COLOR = /^#[0-9A-Fa-f]{6}$/;

/** Saved clinic colors replace the program default. Unknown keys are ignored. */
export function applyClinicAppearance(patch: Record<string, unknown> | null | undefined): void {
  if (!patch) return;
  const target = HIS as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value !== "string" || typeof target[key] !== "string") continue;
    if (!COLOR.test(value)) continue;
    target[key] = value;
  }
}

export async function loadClinicAppearance(): Promise<void> {
  try {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 1200);
    const res = await fetch("/api/maintenance/appearance", { signal: ctrl.signal });
    window.clearTimeout(timer);
    if (!res.ok) return;
    const body = (await res.json()) as { clinic?: Record<string, unknown> };
    applyClinicAppearance(body.clinic);
  } catch {
    /* keep the program default */
  }
}

/** Lock document to HIS light palette (all routes). Safe to call multiple times. */
export function applyHisDocumentTheme(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.add("wundadi-his");
  root.classList.remove("dark");
  root.style.colorScheme = "only light";
  document.body?.classList.add("wundadi-his");
  document.body?.classList.remove("dark");
  if (document.body) {
    document.body.style.colorScheme = "only light";
  }
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute("content", "only light");
  root.style.setProperty("--his-chrome", HIS.chrome);
  root.style.setProperty("--his-chrome-dark", HIS.chromeDark);
  root.style.setProperty("--his-chrome-border", HIS.chromeBorder);
  root.style.setProperty("--his-canvas", HIS.tabIdle);
  root.style.setProperty("--his-surface", HIS.surface);
  root.style.setProperty("--his-input-bg", HIS.inputBg);
  root.style.setProperty("--his-cc-bg", HIS.inputBg);
  root.style.setProperty("--his-text", "#000000");
  root.style.setProperty("--his-input-text", HIS.inputBlue);
  root.style.setProperty("--his-patient-face", HIS.patientFace);
  root.style.setProperty("--his-font", HIS_FONT);
}
