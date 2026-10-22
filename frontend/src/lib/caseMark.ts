import type { RxLine } from "@/mocks/clinicMocks";

const ORDER_CODE = /^\d{5}[A-Z]$/i;

/** Queue and history show ??. The stored value stays 9X so claims still skip the file. */
export function displayCase(caseNo: string | undefined | null): string {
  const raw = String(caseNo ?? "").trim();
  if (!raw || raw === "\u2014" || raw === "-") return "";
  if (raw.toUpperCase() === "9X" || raw === "\u81ea\u8cbb" || raw === "\u81ea") return "\u81ea";
  return raw;
}

export function storedCase(caseNo: string | undefined | null): string {
  const raw = String(caseNo ?? "").trim();
  if (raw === "\u81ea" || raw === "\u81ea\u8cbb" || raw.toUpperCase() === "9X") return "9X";
  return raw;
}

function claimLine(line: RxLine): boolean {
  const mark = String(line.payMark || "").trim();
  if (mark === "\u81ea" || line.selfPay) return false;
  return true;
}

/** Days the monthly file uses: oral course when any oral line has days, otherwise the longest line. Self-pay lines do not count. */
export function prescriptionDays(lines: RxLine[]): number {
  const drugs = lines.filter(
    (line) => claimLine(line) && !ORDER_CODE.test((line.nhiCode || "").trim()),
  );
  const oral = drugs.filter((line) => /^(po|oral)$/i.test(line.route || ""));
  const pool = oral.some((line) => (line.days || 0) > 0) ? oral : drugs;
  return pool.reduce((max, line) => Math.max(max, Number(line.days) || 0), 0);
}

/** NHI treatment codes on this visit. Self-pay procedures do not change the case. */
export function prescriptionOrders(lines: RxLine[]): string[] {
  const seen = new Set<string>();
  for (const line of lines) {
    if (!claimLine(line)) continue;
    const code = String(line.nhiCode || "").trim().toUpperCase();
    if (ORDER_CODE.test(code)) seen.add(code);
  }
  return [...seen];
}
