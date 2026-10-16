/** ?E???M????q?]??W??U?^?A?P?@?q???A??????C */

export type QueueBandEntry = {
  queueStatus: string;
  queueNumber?: number;
  cardWritten?: boolean;
  prebook?: boolean;
};

export function clinicQueueBand(entry: QueueBandEntry): number {
  const status = entry.queueStatus;
  if (status === "finished" || status === "no_show") {
    return entry.cardWritten ? 0 : 1;
  }
  if (status === "in_progress") return 2;
  if (entry.prebook && status === "waiting") return 4;
  return 3;
}

/** 同時段已用序號。連續就直接最後一號+1；有空號才問要不要插入最小空號。 */
export function planQueueNumber(used: number[]):
  | { contiguous: true; next: number }
  | { contiguous: false; gap: number; tail: number } {
  const nums = [...new Set(used.filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
  if (!nums.length) return { contiguous: true, next: 1 };
  const max = nums[nums.length - 1];
  for (let i = 1; i <= max; i += 1) {
    if (!nums.includes(i)) return { contiguous: false, gap: i, tail: max + 1 };
  }
  return { contiguous: true, next: max + 1 };
}

/** Kiosk takes the smallest open number. Staff still get asked. */
export function takeSmallestQueueNumber(used: number[]): number {
  const plan = planQueueNumber(used);
  return plan.contiguous ? plan.next : plan.gap;
}

export function shiftQueueNumbers(
  rows: { queueNumber?: number; shift?: string; queueStatus?: string }[],
  shift: string,
): number[] {
  return rows
    .filter((row) => row.queueStatus !== "cancelled" && (!row.shift || !shift || row.shift === shift))
    .map((row) => Number(row.queueNumber) || 0);
}

export function compareClinicQueue(a: QueueBandEntry, b: QueueBandEntry): number {
  const band = clinicQueueBand(a) - clinicQueueBand(b);
  if (band !== 0) return band;
  return (Number(a.queueNumber) || 0) - (Number(b.queueNumber) || 0);
}

export function clockForShift(shift: string): string {
  if (shift === "\u4e0a\u5348") return "09:00";
  if (shift === "\u665a\u4e0a") return "18:30";
  return "14:00";
}

export function shiftFromClock(clock: string): string {
  const hour = Number.parseInt(clock.split(":")[0] || "", 10);
  if (!Number.isFinite(hour)) return "";
  if (hour < 12) return "\u4e0a\u5348";
  if (hour < 18) return "\u4e0b\u5348";
  return "\u665a\u4e0a";
}

/** 清單只顯示時:分。秒數是存檔時鐘，不必佔欄寬。 */
export function clockLabel(raw?: string): string {
  const text = (raw || "").trim();
  const m = text.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return text;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

export function nowClock(): string {
  const n = new Date();
  return [n.getHours(), n.getMinutes(), n.getSeconds()]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
}

/** Keep HH:MM:SS. Digits only; colons are not part of the typed text. */
export function normalizeClock(raw: string): string {
  const parts = (raw || "").split(":");
  const max = [23, 59, 59];
  return [0, 1, 2]
    .map((i) => {
      const n = Number.parseInt((parts[i] || "").replace(/\D/g, ""), 10);
      const v = Number.isFinite(n) ? Math.min(max[i], Math.max(0, n)) : 0;
      return String(v).padStart(2, "0");
    })
    .join(":");
}
