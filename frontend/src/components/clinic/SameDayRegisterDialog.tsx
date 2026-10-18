import { useEffect, useRef } from "react";
import { appointmentShift } from "@/lib/appointmentCheckIn";
import { HIS, HIS_FONT } from "@/lib/hisTheme";

export type SameDayHit = {
  shift: string;
  queueNumber: string;
  name: string;
};

export function findSameDayHits(
  queue: Array<{
    encounterId?: string;
    patientId?: string;
    idNo?: string;
    queueStatus?: string;
    shift?: string;
    queueNumber?: number;
    patientDisplay?: string;
    prebook?: boolean;
    slotTime?: string;
  }>,
  patientId: string,
  idNo: string,
  excludeEncounterId?: string,
  keepPrebookShift?: string,
): SameDayHit[] {
  const pid = patientId.trim();
  const id = idNo.trim().toUpperCase();
  const skip = (excludeEncounterId || "").split("/").pop() || "";
  return queue
    .filter((e) => e.queueStatus !== "cancelled" && e.queueStatus !== "entered-in-error")
    .filter((e) => !skip || (e.encounterId || "").split("/").pop() !== skip)
    .filter((e) => {
      if (!keepPrebookShift || !e.prebook || e.queueStatus !== "waiting") return true;
      const sh = appointmentShift(e);
      return !sh || sh === keepPrebookShift;
    })
    .filter((e) => (pid && e.patientId === pid) || (id && (e.idNo || "").toUpperCase() === id))
    .map((e) => ({
      shift: e.shift || "",
      queueNumber: e.queueNumber != null ? String(e.queueNumber) : "",
      name: e.patientDisplay || "",
    }));
}

type Props = {
  open: boolean;
  hits: SameDayHit[];
  onConfirm: () => void;
  onCancel: () => void;
};

export function SameDayFlash({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => closeRef.current(), 2000);
    return () => window.clearTimeout(timer);
  }, [open]);
  if (!open) return null;
  return (
    <button
      type="button"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/25"
      onClick={onClose}
    >
      <span
        className="border bg-[#FFF2A8] px-8 py-4 text-2xl font-bold text-black shadow-lg"
        style={{ borderColor: HIS.chromeDark, fontFamily: HIS_FONT }}
      >
        {"\u540c\u65e5\u5c31\u8a3a"}
      </span>
    </button>
  );
}

export function SameDayRegisterDialog({ open, hits, onConfirm, onCancel }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[88] flex items-center justify-center bg-black/40">
      <div
        className="w-[min(28rem,92vw)] border bg-[#F0F0F0] shadow-lg"
        style={{ borderColor: HIS.chromeDark, fontFamily: HIS_FONT }}
      >
        <div className="bg-[#2060A0] px-2 py-1 text-xs font-bold text-white">{"\u540c\u65e5\u5c31\u8a3a"}</div>
        <div className="px-3 py-3 text-[13px] leading-relaxed text-black">
          <p>{"\u672c\u65e5\u5df2\u7d93\u639b\u4e86\u4e00\u7b46\u3002"}</p>
          <ul className="my-1 list-disc pl-4">
            {hits.map((h, i) => (
              <li key={`${h.queueNumber}-${i}`}>
                {(h.shift || "\u2014") + "\u3000\u5e8f\u865f " + (h.queueNumber || "\u2014") + "\u3000" + h.name}
              </li>
            ))}
          </ul>
          <p>{"\u6700\u597d\u4e0d\u8981\u540c\u65e5\u518d\u639b\u4e00\u6b21\u3002"}</p>
          <p>{"\u60a8\u662f\u5426\u78ba\u5b9a\u8981\u8b93\u5b83\u540c\u65e5\u5c31\u8a3a\u5462\uff1f"}</p>
        </div>
        <div className="flex justify-end gap-1 border-t px-2 py-2" style={{ borderColor: HIS.chromeDark }}>
          <button type="button" className="border bg-[#FFFF80] px-2 py-0.5 text-xs font-bold" onClick={onConfirm}>
            {"\u78ba\u5b9a\u639b\u5165"}
          </button>
          <button type="button" className="border bg-[#F0F0F0] px-2 py-0.5 text-xs font-bold" onClick={onCancel}>
            {"\u53d6\u6d88\u639b\u5165"}
          </button>
        </div>
      </div>
    </div>
  );
}
