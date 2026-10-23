import type { RxLine } from "@/mocks/clinicMocks";
import type { CatalogDrug } from "@/types/clinicCatalog";
import { billedDrugQty } from "@/lib/drugCopay";
import { pickDrugForLine } from "@/utils/catalogRx";
import type { CatalogUsage } from "@/utils/rxTotal";

/** Cash self-pay rounds up to the next 10 yuan. 808 becomes 810. 810 stays 810. */
export function ceilCashTen(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const tens = n / 10;
  const nearest = Math.round(tens);
  if (Math.abs(tens - nearest) < 1e-6) return nearest * 10;
  return Math.ceil(tens - 1e-9) * 10;
}

function markOf(row: RxLine): string {
  return (row.payMark || (row.selfPay ? "\u81ea" : "")).trim();
}

/** Cash is added only when the line note contains [ or @. A self-pay mark alone does not. */
function counted(row: RxLine): boolean {
  const memo = (row.memo || "").trim();
  return memo.includes("[") || memo.includes("@");
}

function cashPrice(row: RxLine, drugs: CatalogDrug[]): number | null {
  const hit = drugs.length ? pickDrugForLine(row, drugs) : undefined;
  const self = Number(hit?.selfPayPrice);
  if (Number.isFinite(self) && self > 0) return self;
  const direct = Number(row.unitPrice);
  if (Number.isFinite(direct) && direct > 0) return direct;
  return null;
}

function enteredQty(row: RxLine): number {
  const qty = Number(row.qty);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

/** Old screen math: NHI unit price times the dose, not the billed total. */
function legacyRaw(rows: RxLine[]): number {
  return rows.reduce((sum, row) => {
    const mark = markOf(row);
    const memo = (row.memo || "").trim();
    const cash = mark === "\u81ea" || mark === "\u6750" || memo.includes("[") || memo.includes("@");
    if (!cash) return sum;
    const price = Number(row.unitPrice);
    if (!Number.isFinite(price) || price === 0) return sum;
    return sum + price * enteredQty(row);
  }, 0);
}

/**
 * Unrounded sum of self-pay lines.
 * Price is the master self-pay price. Quantity is the billed total.
 * Add every line first. Do not round each line to 10.
 */
export function rawSelfPay(
  rows: RxLine[],
  drugs: CatalogDrug[] = [],
  usages?: CatalogUsage[],
): number {
  return rows.reduce((sum, row) => {
    if (!counted(row)) return sum;
    const price = cashPrice(row, drugs);
    if (price == null) return sum;
    const billed = billedDrugQty(row, usages);
    const qty = billed > 0 ? billed : enteredQty(row);
    return sum + price * qty;
  }, 0);
}

export function selfPayCeiling(
  rows: RxLine[],
  drugs: CatalogDrug[] = [],
  usages?: CatalogUsage[],
): number {
  return ceilCashTen(rawSelfPay(rows, drugs, usages));
}

/**
 * The amount to charge. A hand-edited number is kept.
 * A stored number that is still the old dose times NHI price is replaced.
 */
export function chargedSelfPay(
  rows: RxLine[],
  stored: number | null,
  drugs: CatalogDrug[] = [],
  usages?: CatalogUsage[],
): number {
  const raw = rawSelfPay(rows, drugs, usages);
  const ceiled = ceilCashTen(raw);
  if (stored == null || !Number.isFinite(stored) || stored <= 0) return ceiled;
  const old = legacyRaw(rows);
  const oldCeil = ceilCashTen(old);
  const unmodified =
    Math.abs(stored - raw) < 0.05 ||
    Math.abs(stored - ceiled) < 0.05 ||
    Math.abs(stored - old) < 0.05 ||
    Math.abs(stored - oldCeil) < 0.05 ||
    Math.abs(stored - Math.round(old)) < 0.05;
  if (unmodified) return ceiled;
  return ceilCashTen(stored);
}
