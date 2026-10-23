/** Patient-master debt. Blank and 0 are not a debt. Visit fee arrears stay a separate field. */
export function owesPatient(raw: unknown): boolean {
  const text = String(raw ?? "").replace(/,/g, "").trim();
  if (!text) return false;
  const amount = Number(text);
  return Number.isFinite(amount) && amount > 0;
}

export const ARREARS_NAME_COLOR = "#CC0000";
