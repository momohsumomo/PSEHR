import { useEffect, useState } from "react";
import { fetchStaff, type ApiStaffRecord } from "@/api/clinicApi";
import { HisRocDateField, isoToRoc, rocToIso } from "@/components/clinic/HisRocDatePicker";
import {
  defaultShift,
  emptyClinicSession,
  lastClinicDept,
  type ClinicSession,
} from "@/lib/clinicSession";

const DEPT_OPTIONS = ["皮膚科", "家醫科", "內科", "外科", "不分科"];

function pharmacistRows(rows: ApiStaffRecord[]): ApiStaffRecord[] {
  return rows.filter(
    (s) =>
      /藥師|pharmacist|pharm/i.test(s.role || "") &&
      (s.status === "在職" || s.status === "active" || !s.status),
  );
}

type Props = {
  initial?: Partial<ClinicSession> | null;
  /** 進診療作業時看診日用今天，不沿用上次被建議的歷史日期。 */
  preferToday?: boolean;
  onConfirm: (session: ClinicSession) => void;
  onCancel: () => void;
};

/** 醫聖進診療作業前：先選看診日與藥師，避免進去後亂跳日期、掛號沒 default 藥師。 */
export function ClinicSessionGate({ initial, preferToday, onConfirm, onCancel }: Props) {
  const base = emptyClinicSession();
  const [date, setDate] = useState(preferToday ? base.date : initial?.date || base.date);
  const [shift, setShift] = useState<ClinicSession["shift"]>(
    preferToday ? defaultShift() : initial?.shift || defaultShift(),
  );
  const [dept, setDept] = useState(initial?.dept || lastClinicDept());
  const [pharmacist, setPharmacist] = useState(initial?.pharmacist || "");
  const [staff, setStaff] = useState<ApiStaffRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchStaff()
      .then((rows) => {
        const list = pharmacistRows(rows);
        setStaff(list);
        setPharmacist((prev) => prev || list[0]?.name || "");
      })
      .catch(() => setStaff([]));
  }, []);

  const confirm = () => {
    const name = pharmacist.trim();
    if (!date) {
      setError("請先選看診日");
      return;
    }
    if (!name) {
      setError("請先選藥師。沒有藥師，掛號不會帶預設藥師");
      return;
    }
    onConfirm({ date, shift, pharmacist: name, dept: dept.trim() || lastClinicDept() });
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        if (document.querySelector("[data-roc-date-picker]")) return;
        ev.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 p-3">
      <div className="w-[min(26rem,96vw)] overflow-hidden rounded border border-[#80C080] bg-[#D4ECD4] shadow-2xl">
        <header className="bg-[#004D00] px-3 py-1.5 text-xs font-black text-white">
          進入診療作業
        </header>
        <div className="space-y-2 bg-[#E8F8E8] p-3 text-[12px] font-bold text-[#004D00]">
          <p className="text-[10px] font-normal">
            看診日右側上下可換前一天、後一天。點日曆選日期，跟費用統計、調閱病歷同一套。
          </p>
          <label className="flex items-center gap-2">
            <span className="w-16 shrink-0">看診日</span>
            <HisRocDateField
              value={isoToRoc(date)}
              onChange={(roc) => {
                const iso = rocToIso(roc);
                if (iso) setDate(iso);
              }}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-16 shrink-0">時段</span>
            <select
              className="flex-1 rounded border border-[#80C080] bg-white px-2 py-1 font-normal"
              value={shift}
              onChange={(e) => setShift(e.target.value as ClinicSession["shift"])}
            >
              <option value="上午">上午</option>
              <option value="下午">下午</option>
              <option value="晚上">晚上</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-16 shrink-0">科別</span>
            <select
              className="flex-1 rounded border border-[#80C080] bg-white px-2 py-1 font-normal"
              value={dept}
              onChange={(e) => setDept(e.target.value)}
            >
              {DEPT_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-16 shrink-0">藥師</span>
            {staff.length > 0 ? (
              <select
                className="flex-1 rounded border border-[#80C080] bg-white px-2 py-1 font-normal"
                value={pharmacist}
                onChange={(e) => setPharmacist(e.target.value)}
              >
                {staff.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                    {p.nhiId ? `（${p.nhiId}）` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="flex-1 rounded border border-[#80C080] bg-white px-2 py-1 font-normal"
                placeholder="人事尚未有藥師時請手填"
                value={pharmacist}
                onChange={(e) => setPharmacist(e.target.value)}
              />
            )}
          </label>
          {error && (
            <p className="rounded border border-red-300 bg-red-50 px-2 py-1 text-[11px] text-red-800">{error}</p>
          )}
        </div>
        <footer className="flex gap-1 border-t border-[#80C080] bg-[#C5EBC5] px-2 py-1.5">
          <button
            type="button"
            className="rounded border border-[#80C080] bg-white px-3 py-1 text-xs font-bold text-[#004D00]"
            onClick={confirm}
          >
            確定
          </button>
          <button
            type="button"
            className="rounded border border-[#80C080] bg-white px-3 py-1 text-xs font-bold text-[#004D00]"
            onClick={onCancel}
          >
            取消
          </button>
        </footer>
      </div>
    </div>
  );
}
