/** A chart line ditto can compare. Pay mark and the trailing memo keep a self-pay twin distinct. */
export type DittoRxLine = {
  name?: string;
  shortName?: string;
  nhiCode?: string;
  payMark?: string;
  selfPay?: boolean;
  memo?: string;
};

function drugToken(line: DittoRxLine): string {
  const alias = String(line.shortName || "").trim().toUpperCase();
  const name = String(line.name || "").trim().toUpperCase();
  const code = String(line.nhiCode || "").trim().toUpperCase();
  return alias || name || code;
}

function payToken(line: DittoRxLine): string {
  const mark = String(line.payMark || "").trim();
  if (mark) return mark;
  return line.selfPay ? "\u81ea" : "";
}

/** Same drug, same pay mark, same trailing mark (such as "["). */
export function dittoRxKey(line: DittoRxLine): string {
  return `${drugToken(line)}\t${payToken(line)}\t${String(line.memo || "").trim()}`;
}

/**
 * Lines from a past visit that are not already on this chart.
 * A second click adds nothing already present. A deleted line comes back.
 * NHI and self-pay copies of one drug are different keys, so both copy.
 */
export function rxLinesMissingFrom<T extends DittoRxLine>(current: T[], incoming: T[]): T[] {
  const counts = new Map<string, number>();
  for (const line of current) {
    if (!drugToken(line)) continue;
    const key = dittoRxKey(line);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const missing: T[] = [];
  for (const line of incoming) {
    if (!drugToken(line)) continue;
    const key = dittoRxKey(line);
    const have = counts.get(key) || 0;
    if (have > 0) {
      counts.set(key, have - 1);
      continue;
    }
    missing.push(line);
  }
  return missing;
}
