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
