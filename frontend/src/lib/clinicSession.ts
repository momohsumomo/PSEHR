import { readLocalClinicBundle } from "@/lib/clinicProfile";

/** 診療作業進門選擇：看診日＋藥師。掛號作業沿用最後一位藥師當 default。 */

export type ClinicSession = {
  date: string;
  pharmacist: string;
  shift: "上午" | "下午" | "晚上";
  /** 進門選定；清單不顯示科別欄 */
  dept: string;
  /** 診間號碼。1 是 1 診。 */
  room: string;
};

const KEY = "wundadi.clinicSession";
const DEPT_KEY = "wundadi.lastClinicDept";

function todayIso(): string {
  const d = new Date();
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${dy}`;
}

function clockMinutes(value: string | undefined, fallback: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value || "").trim());
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return fallback;
  return hour * 60 + minute;
}

type ShiftBand = { shift: ClinicSession["shift"]; from: number; to: number };

function clinicBands(): ShiftBand[] {
  const workflow = readLocalClinicBundle().workflow;
  return [
    { shift: "\u4e0a\u5348", from: clockMinutes(workflow.morningFrom, 8 * 60), to: clockMinutes(workflow.morningTo, 12 * 60) },
    { shift: "\u4e0b\u5348", from: clockMinutes(workflow.afternoonFrom, 12 * 60), to: clockMinutes(workflow.afternoonTo, 18 * 60) },
    { shift: "\u665a\u4e0a", from: clockMinutes(workflow.eveningFrom, 18 * 60), to: clockMinutes(workflow.eveningTo, 21 * 60) },
  ];
}

function bandCovers(band: ShiftBand, current: number): boolean {
  if (band.from === band.to) return false;
  if (band.from < band.to) return current >= band.from && current < band.to;
  return current >= band.from || current < band.to;
}

/** Clinics whose start and end are the same time are closed and never selected. */
function openBands(): ShiftBand[] {
  return clinicBands().filter((band) => band.from !== band.to);
}

/** Which clinic this clock belongs to. Each clinic has a start and an end. */
export function shiftForClock(now = new Date()): ClinicSession["shift"] {
  const current = now.getHours() * 60 + now.getMinutes();
  const bands = openBands();
  if (bands.length === 0) return "\u4e0a\u5348";
  const inside = [...bands].reverse().find((band) => bandCovers(band, current));
  if (inside) return inside.shift;
  const upcoming = bands.find((band) => band.from > current);
  if (upcoming) return upcoming.shift;
  return bands[bands.length - 1].shift;
}

export function defaultShift(now = new Date()): ClinicSession["shift"] {
  return shiftForClock(now);
}

export function lastClinicDept(): string {
  try {
    return localStorage.getItem(DEPT_KEY)?.trim() || "皮膚科";
  } catch {
    return "皮膚科";
  }
}

export function saveLastClinicDept(dept: string) {
  try {
    localStorage.setItem(DEPT_KEY, dept.trim() || "皮膚科");
  } catch {
    /* ignore */
  }
}

export function emptyClinicSession(): ClinicSession {
  return { date: todayIso(), pharmacist: "", shift: defaultShift(), dept: lastClinicDept(), room: "1" };
}

export function loadClinicSession(): ClinicSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ClinicSession>;
    if (!parsed.date || !parsed.pharmacist) return null;
    return {
      date: parsed.date,
      pharmacist: parsed.pharmacist,
      shift: parsed.shift === "下午" || parsed.shift === "晚上" ? parsed.shift : "上午",
      dept: (parsed.dept || lastClinicDept()).trim() || "皮膚科",
      room: String(parsed.room || "1").replace(/\D/g, "") || "1",
    };
  } catch {
    return null;
  }
}

export function saveClinicSession(session: ClinicSession): void {
  sessionStorage.setItem(KEY, JSON.stringify(session));
  saveLastClinicDept(session.dept || lastClinicDept());
}

export function lastPharmacist(): string {
  return loadClinicSession()?.pharmacist?.trim() || "";
}
