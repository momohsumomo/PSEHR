/** Yisheng USEAGE.ISTOTAL -> total amount calculation */

export type UsageCalcMode = "0" | "1" | "2" | "3" | "";

export type CatalogUsage = {
  code: string;
  /** USEAGE.FREQUENCY */
  frequency?: number;
  /** USEAGE.ISTOTAL: 0=qty is the total; 1 and 2=qty*freq*days; 3=do not multiply */
  isTotal?: UsageCalcMode | string;
  label?: string;
  eatType?: string;
  indexFlag?: string;
};

export const DEFAULT_QTY_PICKS = [
  0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 10, 14, 15, 20, 28, 30,
];

export const DEFAULT_DAY_PICKS = [1, 2, 3, 4, 5, 6, 7, 10, 14, 15, 20, 21, 28, 30];

export const DEFAULT_ROUTE_PICKS = [
  "po",
  "im",
  "iv",
  "ivd",
  "ivp",
  "sc",
  "ext",
  "rect",
  "skin",
  "vag",
  "inhl",
  "na",
  "sl",
  "ad",
  "as",
  "au",
  "od",
  "os",
];

/** bid 和 BID 是用法檔兩列。大小寫不同就不能當成同一列。 */
function findUsage(
  sig: string | undefined,
  usages: CatalogUsage[] | undefined,
): CatalogUsage | undefined {
  const code = (sig || "").trim();
  if (!code) return undefined;
  return (usages || []).find((u) => u.code === code);
}

export function packageFrequency(
  sig: string | undefined,
  usages: CatalogUsage[] | undefined,
): number {
  const hit = findUsage(sig, usages);
  return Number(hit?.frequency) > 0 ? Number(hit?.frequency) : 0;
}

export function usageIsTotal(
  sig: string | undefined,
  usages: CatalogUsage[] | undefined,
): string {
  const code = (sig || "").trim();
  if (!code) return "";
  return String(findUsage(sig, usages)?.isTotal ?? "");
}

export function usageCalcLabel(u: CatalogUsage): string {
  const mode = String(u.isTotal ?? "");
  const freq = Number(u.frequency) > 0 ? Number(u.frequency) : 0;
  if ((mode === "1" || mode === "2") && freq > 0) return `\u6b21\u91cf(\u6578\u91cf*${freq}*\u5929\u6578)`;
  if (mode === "0") return "\u7e3d\u91cf(\u6578\u91cf\u7b49\u65bc\u7e3d\u91cf)";
  if (mode === "3" && freq <= 0) return "\u7e3d\u91cf\u4e0d\u8ddf\u6578\u91cf";
  return "\u4e0d\u6307\u5b9a";
}

/** MEDICAL.UNIT. Blank in the master still shows as #. */
export function doseUnit(unit: string | undefined): string {
  const text = String(unit || "").trim();
  return text || "#";
}

/** Compute total display e.g. "1tu" / "7#"; blank when unspecified */
export function computeTotalAmount(
  qty: number | undefined,
  days: number | undefined,
  sig: string | undefined,
  usages: CatalogUsage[] | undefined,
  unit?: string,
): string {
  const q = Number(qty);
  if (!(q > 0)) return "";
  const code = (sig || "").trim();
  if (!code || code === "\u2014") return "";
  const hit = findUsage(sig, usages);
  const mode = String(hit?.isTotal ?? "");
  const freq = Number(hit?.frequency) > 0 ? Number(hit?.frequency) : 0;
  const d = Number(days) > 0 ? Number(days) : 0;
  const mark = doseUnit(unit);
  let total: number | null = null;
  if (mode === "3" && freq <= 0) {
    return `1${mark}`;
  }
  if (mode === "0") {
    total = q;
  } else if ((mode === "1" || mode === "2") && freq > 0 && d > 0) {
    total = q * freq * d;
  } else if (mode === "3") {
    total = q;
  } else {
    return "";
  }
  const rounded =
    Math.abs(total - Math.round(total)) < 1e-6
      ? Math.round(total)
      : Number(total.toFixed(2));
  return `${rounded}${mark}`;
}

export function withComputedTotal<
  T extends {
    qty?: number;
    days?: number;
    sig?: string;
    totalAmount?: string;
    unit?: string;
  },
>(line: T, usages: CatalogUsage[] | undefined, previousSig?: string): T {
  const mode = usageIsTotal(line.sig, usages);
  const freq = packageFrequency(line.sig, usages);
  const mark = doseUnit(line.unit);
  if (mode === "3" && freq <= 0) {
    const prev = usageIsTotal(previousSig, usages);
    const switching = previousSig != null && prev !== "3";
    const current = (line.totalAmount || "").trim();
    const staleHash = current.endsWith(" #") || current.endsWith("#");
    const keep = !switching && current && !(staleHash && mark !== "#");
    return {
      ...line,
      totalAmount: keep ? current : `1${mark}`,
    };
  }
  return {
    ...line,
    totalAmount: computeTotalAmount(line.qty, line.days, line.sig, usages, line.unit),
  };
}
