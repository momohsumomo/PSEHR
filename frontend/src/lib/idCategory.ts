import type { IdCategorySetting } from "@/api/clinicApi";

const ALIASES: Record<string, string> = {
  a: "A",
  b: "B",
  c: "C",
  d: "D",
  s: "S",
  "\u8001\u512a": "\u8001\u4eba\u512a",
  "\u81ea": "\u81ea\u8cbb",
  "\u8914\u4fdd": "\u798f\u4fdd",
  "\u7985\u4fdd": "\u798f\u4fdd",
};

export function canonicalIdCategory(raw: string): string {
  const t = (raw || "").trim();
  if (!t) return "";
  if (ALIASES[t]) return ALIASES[t];
  const low = t.toLowerCase();
  if (ALIASES[low]) return ALIASES[low];
  return t;
}

export function matchIdCategory(
  rows: IdCategorySetting[],
  raw: string,
): IdCategorySetting | undefined {
  const key = canonicalIdCategory(raw);
  return rows.find((r) => r.code === key) || rows.find((r) => r.code === (raw || "").trim());
}

const COPAY_FIXED = 50;

/** Same numbers the counter uses: reg_fee is a discount, copay > 0 waives the copay. */
export function identityVisitFees(args: {
  clinicReg: number;
  selfPayReg: number;
  selfPay: boolean;
  depositVisit: boolean;
  clinicDeposit: string;
  hit?: { reg_fee?: number; copay?: number; deposit?: number };
  personCopayDisc?: string;
}): { regFee: string; copayAmt: string; copayDiscAmt: string; deposit: string } {
  if (args.selfPay) {
    return {
      regFee: String(Math.max(0, Math.round(args.selfPayReg || 0))),
      copayAmt: "0",
      copayDiscAmt: "0",
      deposit: "",
    };
  }
  const discount = args.hit?.reg_fee != null ? Math.max(0, Number(args.hit.reg_fee) || 0) : 0;
  const reg = Math.max(0, (Number(args.clinicReg) || 0) - discount);
  const waive = args.personCopayDisc === "2" || Number(args.hit?.copay) > 0;
  const deposit = args.depositVisit
    ? args.hit?.deposit != null
      ? String(args.hit.deposit)
      : args.clinicDeposit
    : "";
  return {
    regFee: String(reg),
    copayAmt: String(COPAY_FIXED),
    copayDiscAmt: waive ? String(COPAY_FIXED) : "0",
    deposit,
  };
}
