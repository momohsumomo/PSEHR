/** Screen shows the physician name only. Staff code stays in doctorId. */
export type ClinicStaffLike = {
  id: string;
  name: string;
  role?: string;
  status?: string;
  certNo?: string;
  nhiId?: string;
};

function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function staffName(value: string, people: ClinicStaffLike[]): string {
  const id = value.trim();
  if (!id) return "";
  const hit = people.find(
    (person) =>
      person.id === id ||
      person.name === id ||
      (person.certNo && person.certNo === id) ||
      (person.nhiId && person.nhiId === id),
  );
  return String(hit?.name || "").trim();
}

/** Receipts and pickers show the person's name. Visits may still store a staff id. */
export function pharmacistDisplayName(
  raw: string | undefined | null,
  staff?: ClinicStaffLike[],
  fallback?: string,
): string {
  const people = staff || [];
  const text = String(raw || "").trim();
  if (text) {
    const named = staffName(text, people);
    if (named) return named;
    if (hasChinese(text)) return text;
  }
  const other = String(fallback || "").trim();
  if (other) {
    const named = staffName(other, people);
    if (named) return named;
    if (hasChinese(other)) return other;
  }
  return "";
}

export function doctorDisplayName(raw: string | undefined | null, doctorId?: string): string {
  const text = String(raw || "").trim();
  if (!text) return "";
  const id = String(doctorId || "").trim();
  if (id && (text === id || text.startsWith(`${id} `))) {
    return text.slice(id.length).trim();
  }
  const lead = text.match(/^([A-Za-z][A-Za-z0-9_-]{1,16})\s+(.+)$/);
  if (lead && /[\u4e00-\u9fff]/.test(lead[2])) return lead[2].trim();
  return text;
}

/** The clinic has one attending physician. Title is often \u9662\u9577, not \u91ab\u5e2b. */
export function pickClinicDoctor<T extends ClinicStaffLike>(staff: T[]): T | null {
  const active = staff.filter((s) => {
    const status = String(s.status || "\u5728\u8077");
    return status === "\u5728\u8077" || status === "active";
  });
  const director = active.find((s) => String(s.role || "").includes("\u9662\u9577"));
  if (director) return director;
  return active.find((s) => /\u91ab\u5e2b|doctor/i.test(String(s.role || ""))) || null;
}
