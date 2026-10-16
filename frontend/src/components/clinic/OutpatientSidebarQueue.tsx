/** Right rail waiting/family — ~half each (waiting slightly larger) */
import { useEffect, useState } from "react";
import { fetchPatientFamily, type FamilyMember } from "@/api/clinicApi";
import { HIS_FONT } from "@/lib/hisTheme";

export type WaitingQueueRow = {
  encounterId: string;
  queueNumber?: number;
  patientDisplay?: string;
  ageSex?: string;
  age?: string;
  sex?: string;
  queueStatus?: string;
  prebook?: boolean;
  hcId?: string;
  cardNo?: string;
  idNo?: string;
};

interface OutpatientSidebarQueueProps {
  queue: WaitingQueueRow[];
  selectedEncounterId: string | null;
  setSelectedEncounterId: (id: string | null) => void;
  onOpenChart?: (encounterId: string) => void;
  currentDate: string;
  /** 目前看診病患；家族用同電話／手機或同住址。 */
  patientId?: string | null;
}

function statusMark(status?: string): string {
  if (status === "in_progress") return "\u23F8";
  if (status === "waiting") return "\u5019";
  return "";
}

function sexAge(e: WaitingQueueRow): string {
  const sex =
    e.sex === "M" || e.ageSex?.includes("\u7537")
      ? "\u7537"
      : e.sex === "F" || e.ageSex?.includes("\u5973")
        ? "\u5973"
        : "";
  const age = (e.age || e.ageSex || "").replace(/[\u7537\u5973MF]/g, "").trim();
  if (sex && age) return `(${sex})${age.slice(0, 2)}`;
  if (sex) return `(${sex})`;
  return age.slice(0, 4);
}

function cardTail(e: WaitingQueueRow): string {
  const raw = e.hcId || e.cardNo || e.idNo || "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4);
  return raw.slice(-4) || "";
}

export function OutpatientSidebarQueue({
  queue,
  selectedEncounterId,
  setSelectedEncounterId,
  onOpenChart,
  currentDate,
  patientId,
}: OutpatientSidebarQueueProps) {
  const [family, setFamily] = useState<FamilyMember[]>([]);
  const [familyNote, setFamilyNote] = useState("");

  useEffect(() => {
    if (!patientId) {
      setFamily([]);
      setFamilyNote("");
      return;
    }
    let cancel = false;
    setFamilyNote("\u8b80\u53d6\u4e2d\u2026");
    void fetchPatientFamily(patientId)
      .then((rows) => {
        if (cancel) return;
        setFamily(rows);
        if (!rows.length) setFamilyNote("（無相同電話、手機或住址）");
      })
      .catch(() => {
        if (!cancel) {
          setFamily([]);
          setFamilyNote("（家族清單讀取失敗）");
        }
      });
    return () => {
      cancel = true;
    };
  }, [patientId]);

  const live = queue.filter(
    (e) =>
      !e.prebook &&
      (e.queueStatus === "waiting" || e.queueStatus === "in_progress"),
  );

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ fontFamily: HIS_FONT }}>
      {/* Waiting ~55% */}
      <div className="flex min-h-0 flex-[11] flex-col overflow-hidden">
        <div
          className="shrink-0 px-2 py-0.5 text-[11px] font-bold text-white"
          style={{ background: "#2060A0" }}
        >
          {"\u5019\u8a3a\u6e05\u55ae"} ({live.length}) · {currentDate}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto" style={{ background: "#103060" }}>
          {live.map((e) => {
            const sel = selectedEncounterId === e.encounterId;
            return (
              <li key={e.encounterId}>
                <button
                  type="button"
                  className="flex w-full items-center gap-1 border-b px-1.5 py-0.5 text-left text-[11px] leading-tight"
                  style={{
                    borderColor: "#204080",
                    background: sel ? "#FFFF80" : "transparent",
                    color: sel ? "#000" : "#C0E0FF",
                    fontWeight: sel ? 700 : 400,
                  }}
                  onClick={() => setSelectedEncounterId(e.encounterId)}
                  onDoubleClick={() => {
                    setSelectedEncounterId(e.encounterId);
                    onOpenChart?.(e.encounterId);
                  }}
                >
                  <span className="w-4 shrink-0 font-bold">{statusMark(e.queueStatus)}</span>
                  <span className="w-8 shrink-0 font-mono tabular-nums">
                    {String(e.queueNumber ?? "\u2014").padStart(3, "0")}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{e.patientDisplay || "\u2014"}</span>
                  <span className="w-10 shrink-0 truncate text-[10px] opacity-90">{sexAge(e)}</span>
                  <span className="w-8 shrink-0 font-mono text-[10px] opacity-80">{cardTail(e)}</span>
                </button>
              </li>
            );
          })}
          {!live.length && (
            <li className="px-3 py-6 text-center text-[11px] text-[#80A0C0]">
              {"\u7121\u5019\u8a3a\uff08\u5df2\u5831\u5230\u672a\u770b\u5b8c\uff09"}
            </li>
          )}
        </ul>
      </div>

      {/* Family ~45% — always visible, never collapsed away */}
      <div
        className="flex min-h-0 flex-[9] flex-col overflow-hidden border-t bg-white"
        style={{ borderColor: "#808080" }}
      >
        <div
          className="shrink-0 px-2 py-0.5 text-[11px] font-bold"
          style={{ background: "#D8D4C8" }}
        >
          {"\u5bb6\u65cf\u6e05\u55ae"}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr style={{ background: "#ECE9D8" }}>
                <th className="border px-1 font-semibold" style={{ borderColor: "#A0A0A0" }}>
                  {"\u6700\u8fd1\u770b\u8a3a"}
                </th>
                <th className="border px-1 font-semibold" style={{ borderColor: "#A0A0A0" }}>
                  {"\u59d3\u540d"}
                </th>
                <th className="border px-1 font-semibold" style={{ borderColor: "#A0A0A0" }}>
                  {"\u5e74\u9f61"}
                </th>
                <th className="border px-1 font-semibold" style={{ borderColor: "#A0A0A0" }}>
                  {"\u6027\u5225"}
                </th>
                <th className="border px-1 font-semibold" style={{ borderColor: "#A0A0A0" }}>
                  {"\u75c5\u540d"}
                </th>
              </tr>
            </thead>
            <tbody>
              {family.map((row) => (
                <tr key={row.patientId}>
                  <td className="border px-1 whitespace-nowrap" style={{ borderColor: "#C0C0C0" }}>
                    {row.lastVisit || "\u2014"}
                  </td>
                  <td className="border px-1" style={{ borderColor: "#C0C0C0" }}>
                    {row.name}
                  </td>
                  <td className="border px-1 font-mono whitespace-nowrap" style={{ borderColor: "#C0C0C0" }}>
                    {row.age || "\u2014"}
                  </td>
                  <td className="border px-1" style={{ borderColor: "#C0C0C0" }}>
                    {row.sex || "\u2014"}
                  </td>
                  <td className="border px-1" style={{ borderColor: "#C0C0C0" }}>
                    {row.disease || "\u2014"}
                  </td>
                </tr>
              ))}
              {!family.length && (
                <tr>
                  <td
                    className="border px-1 py-3 text-center text-[#808080]"
                    style={{ borderColor: "#C0C0C0" }}
                    colSpan={5}
                  >
                    {familyNote || "\uff08\u540c\u96fb\u8a71\u3001\u624b\u6a5f\u6216\u4f4f\u5740\uff09"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
