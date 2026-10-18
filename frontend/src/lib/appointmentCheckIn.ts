/** A waiting appointment on today's list that check-in should replace. */

import { shiftForClock } from "@/lib/clinicSession";

export type WaitingAppointment = {
  encounterId: string;
  patientId?: string;
  idNo?: string;
  prebook?: boolean;
  queueStatus?: string;
  shift?: string;
  queueNumber?: number;
  slotTime?: string;
};

/** Stored shift, or the clock on the row. Blank means we will not guess. */
export function appointmentShift(row: {
  shift?: string;
  slotTime?: string;
}): string {
  if (row.shift === "\u4e0a\u5348" || row.shift === "\u4e0b\u5348" || row.shift === "\u665a\u4e0a") return row.shift;
  const parts = (row.slotTime || "").split(":");
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isFinite(hour)) return "";
  const clock = new Date();
  clock.setHours(hour, Number.isFinite(minute) ? minute : 0, 0, 0);
  return shiftForClock(clock);
}

function idTail(id: string | undefined): string {
  return (id || "").split("/").pop() || "";
}

function normIdNo(idNo: string | undefined): string {
  return (idNo || "").replace(/\s/g, "").toUpperCase();
}

function waitingHits<T extends WaitingAppointment>(
  queue: T[],
  who: { patientId?: string; idNo?: string },
): T[] {
  const pid = idTail(who.patientId);
  const idNo = normIdNo(who.idNo);
  if (!pid && !idNo) return [];
  return queue.filter((row) => {
    if (!row.prebook || row.queueStatus !== "waiting" || !row.encounterId) return false;
    if (pid && idTail(row.patientId) === pid) return true;
    if (idNo && normIdNo(row.idNo) === idNo) return true;
    return false;
  });
}

/**
 * Check-in only replaces an appointment in this shift.
 * A morning arrival does not take the afternoon booking.
 */
export function findWaitingAppointment<T extends WaitingAppointment>(
  queue: T[],
  who: { patientId?: string; idNo?: string },
  shift?: string,
  shiftOf?: (row: T) => string,
): T | null {
  if (!shift) return null;
  return (
    waitingHits(queue, who).find((row) => (shiftOf ? shiftOf(row) : appointmentShift(row)) === shift) ??
    null
  );
}

/** Desk reminder when another shift still has a booking we are leaving alone. */
export function otherShiftAppointmentNote<T extends WaitingAppointment>(
  queue: T[],
  who: { patientId?: string; idNo?: string },
  shift?: string,
  shiftOf?: (row: T) => string,
): string {
  if (!shift) return "";
  const other = waitingHits(queue, who).find((row) => {
    const sh = shiftOf ? shiftOf(row) : appointmentShift(row);
    return Boolean(sh) && sh !== shift;
  });
  if (!other) return "";
  const sh = shiftOf ? shiftOf(other) : appointmentShift(other);
  return `\u9019\u4f4d${sh}\u9084\u6709\u9810\u7d04\u3002\u9019\u6b21\u5148\u639b${shift}\uff0c${sh}\u90a3\u7b46\u7559\u8457\uff0c\u8acb\u7a0d\u5f8c\u5728\u639b\u865f\u4f5c\u696d\u522a\u9664\u3002`;
}
