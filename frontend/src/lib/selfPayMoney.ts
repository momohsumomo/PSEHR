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

function selfMark(row: RxLine): boolean {
  const mark = (row.payMark || (row.selfPay ? "\u81ea" : "")).trim();
  return mark === "\u81ea";
}

/**
 * Cash total needs both marks: pay mark 自 and a [ note. [ alone is not charged.
 * A self-pay patient pays for every line, NHI items included.
 */
function counted(row: RxLine, allSelf: boolean): boolean {
  if (allSelf) return Boolean((row.name || "").trim() || (row.nhiCode || "").trim());
  const memo = (row.memo || "").trim();
  return selfMark(row) && memo.includes("[");
}

/** Self-pay unit times the billed total. Null when this line is not in the cash total. */
export function cashSelfPayLine(
  row: RxLine,
  drugs: CatalogDrug[] = [],
  usages?: CatalogUsage[],
  allSelf = false,
): number | null {
  if (!counted(row, allSelf)) return null;
  const price = cashPrice(row, drugs, allSelf);
  if (price == null) return null;
  const billed = billedDrugQty(row, usages);
  const qty = billed > 0 ? billed : enteredQty(row);
  return price * qty;
}

function cashPrice(row: RxLine, drugs: CatalogDrug[], allSelf: boolean): number | null {
  const hit = drugs.length ? pickDrugForLine(row, drugs) : undefined;
  const self = Number(hit?.selfPayPrice);
  if (Number.isFinite(self) && self > 0) return self;
  const direct = Number(row.unitPrice);
  if (Number.isFinite(direct) && direct > 0) return direct;
  if (!allSelf) return null;
  const listed = Number(hit?.unitPrice);
  if (Number.isFinite(listed) && listed > 0) return listed;
  return null;
}

function enteredQty(row: RxLine): number {
  const qty = Number(row.qty);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
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
  allSelf = false,
): number {
  return rows.reduce((sum, row) => {
    const line = cashSelfPayLine(row, drugs, usages, allSelf);
    return line == null ? sum : sum + line;
  }, 0);
}

export function selfPayCeiling(
  rows: RxLine[],
  drugs: CatalogDrug[] = [],
  usages?: CatalogUsage[],
  allSelf = false,
): number {
  return ceilCashTen(rawSelfPay(rows, drugs, usages, allSelf));
}

/** Amount to charge from the prescription open on this save. */
export function chargedSelfPay(
  rows: RxLine[],
  drugs: CatalogDrug[] = [],
  usages?: CatalogUsage[],
  allSelf = false,
): number {
  return selfPayCeiling(rows, drugs, usages, allSelf);
}
