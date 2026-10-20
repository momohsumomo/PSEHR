/** First visit is the 4th mark on the registration stamp. */
export function isFirstVisit(regCc: string | undefined): boolean {
  return String(regCc || "").charAt(3) === "$";
}

/** Appointment, referral-out, then first visit. Combined text is yu + zhuan + chu. */
export function visitListMark(
  entry: {
    prebook?: boolean;
    queueStatus?: string;
    regCc?: string;
    referredOut?: boolean;
  },
  opts?: { appointmentWhileWaiting?: boolean },
): string {
  let text = "";
  const onlyWaiting = opts?.appointmentWhileWaiting !== false;
  if (entry.prebook && (!onlyWaiting || entry.queueStatus === "waiting")) text += "\u9810";
  if (entry.referredOut) text += "\u8f49";
  if (isFirstVisit(entry.regCc)) text += "\u521d";
  return text;
}

export const FIRST_VISIT_NAME = "#0000AA";
