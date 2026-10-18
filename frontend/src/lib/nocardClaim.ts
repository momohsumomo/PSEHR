/** Same pairing as src/claims/nocard_seq.py. H000 is never used. */

const BAD = "\u5361\u7247\u4e0d\u826f";

const BY_REASON: Record<string, string> = {
  "\u8b80\u5361\u8a2d\u5099\u6545\u969c": "A000",
  "\u8b80\u5361\u6a5f\u6545\u969c": "A000",
  [BAD]: "B000",
  "\u7db2\u8def\u8a2d\u5099\u6545\u969c": "C000",
  "\u504f\u9060\u5340\u7121\u6cd5\u4e0a\u7db2": "C000",
  "\u5c45\u5bb6\u85cd\u7259\u7db2\u8def\u7570\u5e38": "C000",
  "\u5b89\u5168\u6a21\u7d44\u6545\u969c": "D000",
  "\u9662\u6240\u96fb\u8166\u6545\u969c": "D000",
  "\u91ab\u7642\u7cfb\u7d71\u7576\u6a5f": "D000",
  "\u5065\u4fdd\u5c40\u7576\u6a5f": "E000",
  "\u505c\u96fb": "F000",
};

const NOCARD = new Set(["noCard", "childNoCard", "pregnantNoCard", "badCard", "paper"]);

export function claimSeqFor(mode: string, reason: string): string {
  const text = reason.trim();
  if (mode === "badCard" || text === BAD) return "B000";
  if (!NOCARD.has(mode)) return "";
  return BY_REASON[text] || "G000";
}

export const BAD_CARD_REASON = BAD;
