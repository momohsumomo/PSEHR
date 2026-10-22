/** 1 means room 1. Older rows stored the department text in this field; those are room 1. */
export function roomNumber(raw: string | undefined | null): string {
  const text = String(raw ?? "").trim();
  if (!text || text === "\u2014" || text === "-" || /\u79d1/.test(text)) return "1";
  const digits = text.replace(/\u8a3a/g, "").replace(/\D/g, "");
  if (!digits) return "1";
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) return "1";
  return String(n);
}

export function roomLabel(raw: string | undefined | null): string {
  return `${roomNumber(raw)}\u8a3a`;
}
