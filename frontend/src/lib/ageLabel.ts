/** Clinic lists show years.months. The stored age can still carry days. */
export function ageYearsMonths(raw: string | undefined | null): string {
  const text = String(raw ?? "").trim().replace(/[MF\u7537\u5973]$/, "");
  if (!text || text === "\u2014" || text === "-") return "";
  const dotted = /^0*(\d+)\.(\d{1,2})(?:\.(\d{1,2}))?$/.exec(text);
  if (dotted) return yearsDotMonths(Number(dotted[1]), Number(dotted[2]));
  const spoken = /^(\d+)\u6b72(?:(\d+)\u500b\u6708)?/.exec(text);
  if (spoken) return yearsDotMonths(Number(spoken[1]), Number(spoken[2] || 0));
  const monthsOnly = /^(\d+)\u500b\u6708/.exec(text);
  if (monthsOnly) return yearsDotMonths(0, Number(monthsOnly[1]));
  return text.replace(/\d+\u5929$/, "");
}

function yearsDotMonths(years: number, months: number): string {
  const y = Number.isFinite(years) && years > 0 ? Math.floor(years) : 0;
  const m = Number.isFinite(months) && months > 0 ? Math.floor(months) : 0;
  return `${y}.${String(m).padStart(2, "0")}`;
}
