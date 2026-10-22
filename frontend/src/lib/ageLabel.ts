/** Clinic lists show years and months. The stored age can still carry days. */
export function ageYearsMonths(raw: string | undefined | null): string {
  const text = String(raw ?? "").trim().replace(/[MF\u7537\u5973]$/, "");
  if (!text || text === "\u2014" || text === "-") return "";
  const dotted = /^0*(\d+)\.(\d{1,2})(?:\.(\d{1,2}))?$/.exec(text);
  if (dotted) {
    const years = Number(dotted[1]);
    const months = Number(dotted[2]);
    if (years <= 0 && months <= 0) return "0\u6b72";
    if (years <= 0) return `${months}\u500b\u6708`;
    if (months <= 0) return `${years}\u6b72`;
    return `${years}\u6b72${months}\u500b\u6708`;
  }
  return text.replace(/\d+\u5929$/, "");
}
