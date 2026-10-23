import type { CatalogDrug } from "@/types/clinicCatalog";
import type { RxLine } from "@/mocks/clinicMocks";
import { pickDrugForLine } from "@/utils/catalogRx";
import { packageFrequency, usageIsTotal, type CatalogUsage } from "@/utils/rxTotal";

/** Western clinic outpatient basic copay. */
const BASIC_COPAY = 50;

const ORDER_CODE = /^\d{5}[A-Z]$/i;

/**
 * Drug copay. Fee at or under 100 is 0.
 * Each further 100 adds 20. 901-1000 is 180. 1001 and above stays at 200.
 */
export function drugCopayFromPoints(points: number): number {
  const fee = Math.round(points);
  if (!Number.isFinite(fee) || fee <= 100) return 0;
  const tiers = Math.ceil((fee - 100) / 100);
  return Math.min(200, tiers * 20);
}

function treatmentOrder(code: string): boolean {
  const text = code.trim().toUpperCase();
  if (!ORDER_CODE.test(text)) return false;
  if (text.startsWith("00") || text.startsWith("052")) return false;
  return true;
}

/** Self-pay and outside-lab lines are not part of the NHI drug fee. A memo bracket alone is not. */
function excludedFromDrugFee(line: RxLine): boolean {
  const mark = (line.payMark || (line.selfPay ? "\u81ea" : "")).trim();
  return (
    mark === "\u81ea" ||
    mark === "\u4ea4" ||
    mark === "\u8f49" ||
    mark === "\u4e0d" ||
    mark === "\u6750"
  );
}

/** Half-up to an integer. 10.5 becomes 11. 10.4 becomes 10. */
function halfUp(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n + 0.5 + 1e-9);
}

function lineUnitPrice(line: RxLine, drugs: CatalogDrug[]): number | null {
  const direct = Number(line.unitPrice);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const hit = drugs.length ? pickDrugForLine(line, drugs) : undefined;
  const catalog = Number(hit?.unitPrice);
  if (Number.isFinite(catalog) && catalog > 0) return catalog;
  return null;
}

/** Usage table decides the billed total. Without a usage, the entered qty is the total. */
export function billedDrugQty(line: RxLine, usages?: CatalogUsage[]): number {
  const raw = Number(line.qty);
  const qty = Number.isFinite(raw) && raw > 0 ? raw : 0;
  if (qty <= 0) return 0;
  const mode = usageIsTotal(line.sig, usages);
  const freq = packageFrequency(line.sig, usages);
  const days = Number(line.days) > 0 ? Number(line.days) : 0;
  if (mode === "3" && freq <= 0) return 1;
  if (mode === "0" || mode === "3") return qty;
  if ((mode === "1" || mode === "2") && freq > 0 && days > 0) return qty * freq * days;
  return qty;
}

/** NHI drug points for this prescription. Self-pay lines are left out. */
export function nhiDrugPoints(
  lines: RxLine[],
  drugs: CatalogDrug[],
  usages?: CatalogUsage[],
): number {
  let sum = 0;
  for (const line of lines) {
    if (excludedFromDrugFee(line)) continue;
    const code = (line.nhiCode || "").trim();
    if (code && treatmentOrder(code)) continue;
    const price = lineUnitPrice(line, drugs);
    if (price == null) continue;
    sum += halfUp(price * billedDrugQty(line, usages));
  }
  return sum;
}

/**
 * Basic copay. A stored 1-50 is the registration basic and is kept.
 * A stored amount above 50 already includes drug copay from the last save.
 * Using that as the basic would add the drug copay again.
 */
export function basicCopayYuan(storedCopay: number | null, storedBurden: number | null): number {
  if (storedCopay != null && storedCopay > 0 && storedCopay <= BASIC_COPAY) return storedCopay;
  if (
    storedCopay == null &&
    storedBurden != null &&
    storedBurden > 0 &&
    storedBurden <= BASIC_COPAY
  ) {
    return storedBurden;
  }
  return BASIC_COPAY;
}

/**
 * The two cash copays, each on its own.
 * basic is the registration copay. drug is only the drug copay.
 * Nothing here is derived by subtracting one stored total from the other.
 */
export function visitCopayParts(args: {
  selfPay: boolean;
  exempt: boolean;
  outsideDispense: boolean;
  waiveDrug: boolean;
  basic: number;
  lines: RxLine[];
  drugs: CatalogDrug[];
  usages?: CatalogUsage[];
}): { basic: number; drug: number } {
  if (args.selfPay || args.exempt) return { basic: 0, drug: 0 };
  const basic = Number.isFinite(args.basic) && args.basic > 0 ? args.basic : 0;
  if (args.outsideDispense || args.waiveDrug) return { basic, drug: 0 };
  return { basic, drug: drugCopayFromPoints(nhiDrugPoints(args.lines, args.drugs, args.usages)) };
}
