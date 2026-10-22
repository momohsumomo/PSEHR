import type { RxLine } from "@/mocks/clinicMocks";

/** Cash self-pay rounds up to the next 10 yuan. 808 becomes 810. 810 stays 810. */
export function ceilCashTen(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const tens = n / 10;
  const nearest = Math.round(tens);
  if (Math.abs(tens - nearest) < 1e-6) return nearest * 10;
  return Math.ceil(tens - 1e-9) * 10;
}

function counted(row: RxLine): boolean {
  const mark = (row.payMark || (row.selfPay ? "\u81ea" : "")).trim();
  const memo = (row.memo || "").trim();
  return mark === "\u81ea" || mark === "\u6750" || memo.includes("[") || memo.includes("@");
}

/** Unrounded sum of self-pay drugs and procedures. */
export function rawSelfPay(rows: RxLine[]): number {
  return rows.reduce((sum, row) => {
    if (!counted(row)) return sum;
    const price = Number(row.unitPrice);
    if (!Number.isFinite(price) || price === 0) return sum;
    const qty = Number(row.qty);
    const q = Number.isFinite(qty) && qty > 0 ? qty : 1;
    return sum + price * q;
  }, 0);
}

export function selfPayCeiling(rows: RxLine[]): number {
  return ceilCashTen(rawSelfPay(rows));
}

/**
 * The amount to charge. A hand-edited number is kept.
 * A stored number that is still the unmodified line sum is replaced by the ceiling.
 */
export function chargedSelfPay(rows: RxLine[], stored: number | null): number {
  const raw = rawSelfPay(rows);
  const ceiled = ceilCashTen(raw);
  if (stored == null || !Number.isFinite(stored)) return ceiled;
  const unmodified =
    Math.abs(stored - raw) < 0.001 || Math.abs(stored - Math.round(raw)) < 0.001;
  if (unmodified) return ceiled;
  return stored;
}
