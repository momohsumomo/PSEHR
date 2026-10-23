/** Blank, dash, or 0. A stored positive amount is a real fee. */
export function moneyBlank(value?: string): boolean {
  const text = String(value ?? "").trim();
  if (!text || text === "\u2014" || text === "-") return true;
  const n = Number(text.replace(/[^\d.-]/g, ""));
  return !Number.isFinite(n) || n <= 0;
}

/**
 * New visits always take the schedule. Check-in of an existing appointment
 * does too when both stored amounts are blank or 0. A positive fee stays.
 * The queue note is not an input: an imported hold mark must not zero these.
 */
export function visitNeedsFeeSchedule(
  encounterId: string | undefined,
  priceBlankFees: boolean,
  regFee?: string,
  copayAmt?: string,
): boolean {
  if (!encounterId) return true;
  return priceBlankFees && moneyBlank(regFee) && moneyBlank(copayAmt);
}
