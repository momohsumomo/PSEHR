function yuan(value: string | undefined): number {
  const text = String(value ?? "").trim();
  if (!text || text === "\u2014" || text === "-") return 0;
  const n = Number(text.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Amount of deposit that stays inside the visit total.
 * While it is still held, that is the deposit.
 * After a card refund the held amount is 0 and the collected amount stays,
 * because the return line is what leaves the day's cash.
 */
export function depositInTotal(held: string | undefined, collected: string | undefined): number {
  const stillHeld = yuan(held);
  if (stillHeld > 0) return stillHeld;
  return yuan(collected);
}
