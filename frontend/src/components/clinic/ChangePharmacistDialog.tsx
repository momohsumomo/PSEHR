import { useEffect, useState } from "react";
import { fetchStaff, patchEncounterReg, type ApiStaffRecord } from "@/api/clinicApi";
import { useEscLayer } from "@/hooks/useEscLayer";
import { loadClinicSession, saveClinicSession, type ClinicSession } from "@/lib/clinicSession";
import { pharmacistDisplayName } from "@/lib/doctorName";
import { HIS, HIS_FONT } from "@/lib/hisTheme";

export type PharmacistVisitRow = {
  encounterId: string;
  patientId: string;
  patientDisplay: string;
  queueNumber: number;
  pharmacist?: string;
  paperCard?: boolean;
  prebook?: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  date: string;
  shift: ClinicSession["shift"];
  dept: string;
  rows: PharmacistVisitRow[];
  onDone: (message: string) => void;
};

function pharmacistRows(rows: ApiStaffRecord[]): ApiStaffRecord[] {
  return rows.filter(
    (s) =>
      /藥師|pharmacist|pharm/i.test(s.role || "") &&
      (s.status === "在職" || s.status === "active" || !s.status),
  );
}

function staffLabel(row: ApiStaffRecord): string {
  return (row.name || row.id || "").trim();
}

/** 改這台電腦之後掛號的藥師，並可把同一天、同一時段已掛的筆改過去。 */
export function ChangePharmacistDialog({ open, onClose, date, shift, dept, rows, onDone }: Props) {
  const [staff, setStaff] = useState<ApiStaffRecord[]>([]);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadNote, setLoadNote] = useState<string | null>(null);

  useEscLayer([{ open, close: onClose }]);

  useEffect(() => {
    if (!open) return;
    setPicked("");
    setError(null);
    setLoadNote(null);
    void fetchStaff()
      .then((list) => {
        const ph = pharmacistRows(list);
        setStaff(ph);
        if (!ph.length) setLoadNote("人事資料裡沒有藥師。");
      })
      .catch((e: unknown) => {
        setStaff([]);
        setLoadNote(e instanceof Error ? e.message : "讀不到人事資料");
      });
  }, [open]);

  if (!open) return null;

  const apply = async () => {
    const name = picked.trim();
    if (!name) {
      setError("請先選一位藥師");
      return;
    }
    setBusy(true);
    setError(null);
    saveClinicSession({
      date,
      shift,
      pharmacist: name,
      dept: dept || "皮膚科",
      room: loadClinicSession()?.room || "1",
    });
    const failed: string[] = [];
    for (const row of rows) {
      if (!row.patientId) {
        failed.push(row.patientDisplay || row.encounterId);
        continue;
      }
      try {
        await patchEncounterReg(row.encounterId, {
          patientId: row.patientId,
          pharmacist: name,
          paperCard: Boolean(row.paperCard),
          prebook: Boolean(row.prebook),
        });
      } catch {
        failed.push(row.patientDisplay || row.encounterId);
      }
    }
    setBusy(false);
    if (failed.length) {
      setError(
        `這台電腦之後的掛號會用 ${name}。同一天、同一時段有 ${failed.length} 筆沒改成：${failed.slice(0, 4).join("、")}`,
      );
      onDone(`藥師已改為 ${name}，但有 ${failed.length} 筆掛號沒改成`);
      return;
    }
    onDone(
      rows.length
        ? `藥師已改為 ${name}，同一天、同一時段 ${rows.length} 筆一併改過`
        : `藥師已改為 ${name}。這個時段還沒有掛號可改`,
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4">
      <div
        className="flex max-h-[80vh] w-[460px] flex-col border-2 bg-[#ECE9D8] shadow-lg"
        style={{ borderColor: HIS.titleBarBorder, fontFamily: HIS_FONT }}
      >
        <div
          className="flex items-center justify-between px-2 py-1 text-[13px] font-bold text-white"
          style={{ background: `linear-gradient(180deg, ${HIS.titleBarFrom}, ${HIS.titleBarTo})` }}
        >
          <span>更改本時段藥師</span>
          <button type="button" className="px-1" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-[12px]">
          <p className="mb-2 text-[#404040]">
            {date} {shift}。選好後，這台電腦接下來的掛號會帶這位藥師；下面同一天、同一時段已經掛號的筆，按確定才會改。
          </p>
          {loadNote ? <p className="mb-2 font-bold text-[#800000]">{loadNote}</p> : null}
          <div className="mb-2 max-h-28 overflow-auto border bg-white" style={{ borderColor: HIS.chromeBorder }}>
            {staff.map((row) => {
              const label = staffLabel(row);
              return (
                <label key={row.id || label} className="flex items-center gap-2 px-2 py-1">
                  <input
                    type="radio"
                    name="pharmacist"
                    checked={picked === label}
                    onChange={() => setPicked(label)}
                  />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
          <p className="mb-1 font-bold">同一天、同一時段已掛號 {rows.length} 筆</p>
          <div className="max-h-36 overflow-auto border bg-white" style={{ borderColor: HIS.chromeBorder }}>
            {rows.length ? (
              rows.map((row) => (
                <div key={row.encounterId} className="flex justify-between px-2 py-0.5">
                  <span>
                    {row.queueNumber} {row.patientDisplay}
                  </span>
                  <span className="text-[#606060]">{pharmacistDisplayName(row.pharmacist, staff, row.pharmacist) || "—"}</span>
                </div>
              ))
            ) : (
              <div className="px-2 py-1 text-[#606060]">這個時段還沒有掛號</div>
            )}
          </div>
          {error ? <p className="mt-2 font-bold text-[#800000]">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t px-3 py-2" style={{ borderColor: HIS.chromeBorder }}>
          <button
            type="button"
            className="border px-3 py-1 font-bold"
            style={{ borderColor: HIS.chromeBorder, background: "#D4D0C8" }}
            disabled={busy}
            onClick={() => void apply()}
          >
            {busy ? "改寫中" : "確定"}
          </button>
          <button
            type="button"
            className="border px-3 py-1 font-bold"
            style={{ borderColor: HIS.chromeBorder, background: "#D4D0C8" }}
            onClick={onClose}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
