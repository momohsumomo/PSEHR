# -*- coding: utf-8 -*-
from pathlib import Path

CHECK = "\u2713"
CONTENT = r'''import type { ReactNode, Ref } from "react";
import { PatientClinicalAvatar } from "@/components/clinic/PatientClinicalAvatar";
import { QueueRegisterStrip } from "@/components/clinic/QueueRegisterStrip";
import { useI18n } from "@/i18n/I18nContext";
import { getPatientClinicalProfile, type QueueEntry, type QueueStatus } from "@/mocks/clinicMocks";

function QueueSeqCell({ entry }: { entry: QueueEntry }) {
  if (entry.queueStatus === "finished" || entry.queueStatus === "no_show") {
    if (entry.cardWritten) {
      return (
        <span
          className="inline-flex h-[1.15em] w-[1.15em] items-center justify-center rounded-full border border-current text-[0.85em] leading-none"
          title={`seq ${entry.queueNumber} finished+card`}
        >
          __CHECK__
        </span>
      );
    }
    return <span title={`seq ${entry.queueNumber} finished`}>__CHECK__</span>;
  }
  return <span title={`seq ${entry.queueNumber}`}>{entry.queueNumber}</span>;
}

function queueCellValue(entry: QueueEntry, key: string): string {
  const timeLabel = entry.slotTime;
  const hour = timeLabel?.includes(":") ? parseInt(timeLabel.split(":")[0], 10) : NaN;
  const shift = entry.shift
    ? entry.shift
    : Number.isFinite(hour)
      ? hour < 12
        ? "\u4e0a\u5348"
        : hour < 18
          ? "\u4e0b\u5348"
          : "\u665a\u4e0a"
      : "";
  const sexLabel =
    entry.sex === "M" || entry.ageSex.endsWith("M")
      ? "\u7537"
      : entry.sex === "F" || entry.ageSex.endsWith("F")
        ? "\u5973"
        : "";
  const ageLabel = entry.age ?? entry.ageSex.replace(/[MF]$/, "");
  const empty = (v: unknown) => {
    const s = String(v ?? "").trim();
    return s.length ? s : "\u2014";
  };

  switch (key) {
    case "slotTime":
      return empty(timeLabel);
    case "medicalNo":
      return empty(entry.medicalNo);
    case "patientDisplay":
      return empty(entry.patientDisplay);
    case "age":
      return empty(ageLabel);
    case "sex":
      return empty(sexLabel);
    case "shift":
      return empty(shift);
    case "note":
      return empty(entry.note);
    case "preVisit":
      return entry.prebook ? "\u9810" : "\u2014";
    case "caseNo":
      return empty(entry.caseNo);
    case "reasonText":
      return empty(entry.reasonText);
    case "weight":
      return empty(entry.weight);
    case "deposit":
      return empty(entry.deposit);
    case "regFee":
      return empty(entry.regFee);
    case "copay":
      return empty(entry.copayAmt);
    default:
      return "\u2014";
  }
}

function renderQueueCell(entry: QueueEntry, key: string): ReactNode {
  if (key === "queueNumber") return <QueueSeqCell entry={entry} />;
  return queueCellValue(entry, key);
}

interface Props {
  entries: QueueEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onStatusChange: (encounterId: string, status: QueueStatus) => void;
  mode?: "card" | "table";
  columnLabels?: string[];
  columnKeys?: string[];
  fontSizePx?: number;
  highlighted?: boolean;
  panelRef?: Ref<HTMLElement>;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  variant?: "sidebar" | "page";
  onOpen?: (id: string) => void;
  showChrome?: boolean;
}

export function EncounterQueuePanel({
  entries,
  selectedId,
  onSelect,
  onStatusChange,
  mode = "card",
  columnLabels = [],
  columnKeys = [],
  fontSizePx = 14,
  highlighted,
  panelRef,
  searchQuery = "",
  onSearchChange,
  variant = "sidebar",
  onOpen,
  showChrome = true,
}: Props) {
  const isPage = variant === "page";

  const enterPatient = (encounterId: string, status: QueueStatus) => {
    onSelect(encounterId);
    if (status === "waiting") {
      onStatusChange(encounterId, "in_progress");
    }
    onOpen?.(encounterId);
  };

  const tableCols =
    columnLabels.length > 0
      ? columnLabels.map((label, i) => ({
          label,
          key: columnKeys[i] ?? `col${i}`,
        }))
      : [
          { label: "\u5e8f\u865f", key: "queueNumber" },
          { label: "\u59d3\u540d", key: "patientDisplay" },
        ];

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      className={`flex h-full min-h-0 flex-col outline-none transition ${
        isPage
          ? "min-w-0 w-full flex-1 bg-white"
          : `shrink-0 border-r border-slate-300 bg-white ${mode === "table" ? "w-[min(38rem,36vw)]" : "w-64"}`
      } ${highlighted ? "ring-2 ring-inset ring-[#004D00]" : ""}`}
    >
      {showChrome && (
        <div className="border-b border-[#80C080] bg-[#E8F8E8] px-3 py-1">
          <h2 className="text-sm font-bold text-[#004D00]">\u7576\u5929\u770b\u8a3a\u6e05\u55ae</h2>
        </div>
      )}

      {showChrome && onSearchChange && (
        <QueueRegisterStrip searchQuery={searchQuery} onSearchChange={onSearchChange} />
      )}

      {mode === "table" ? (
        <div className="min-h-0 flex-1 overflow-auto" style={{ fontSize: fontSizePx }}>
          <table className="w-full min-w-max border-collapse text-left text-[#004D00]">
            <thead className="sticky top-0 z-10 bg-[#C5EBC5] text-[#004D00]">
              <tr>
                {tableCols.map((col) => (
                  <th key={col.key} className="border border-[#80C080] px-1.5 py-1 font-bold">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr
                  key={e.encounterId}
                  className={`cursor-pointer ${
                    selectedId === e.encounterId
                      ? "bg-[#004D00] text-white"
                      : e.queueStatus === "in_progress"
                        ? "bg-[#E8F8E8] hover:bg-[#D4ECD4]"
                        : e.queueStatus === "finished"
                          ? "bg-[#F2FAF2] text-[#666] hover:bg-[#E8F8E8]"
                          : "hover:bg-[#E8F8E8]"
                  }`}
                  onClick={() => onSelect(e.encounterId)}
                  onDoubleClick={() => enterPatient(e.encounterId, e.queueStatus)}
                >
                  {tableCols.map((col) => (
                    <td
                      key={col.key}
                      className={`whitespace-nowrap border border-[#C5EBC5] px-1.5 ${isPage ? "py-1" : "py-0.5"}`}
                    >
                      {renderQueueCell(e, col.key)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {entries.map((e) => (
            <li key={e.encounterId}>
              <button
                type="button"
                onClick={() =>
                  isPage || onOpen
                    ? enterPatient(e.encounterId, e.queueStatus)
                    : onSelect(e.encounterId)
                }
                onDoubleClick={() => enterPatient(e.encounterId, e.queueStatus)}
                className={`w-full border-b border-slate-50 px-2.5 py-2 text-left transition ${
                  selectedId === e.encounterId ? "bg-sky-50" : "hover:bg-slate-50"
                }`}
              >
                <div className="mb-1 flex items-center gap-1">
                  <span className="font-mono text-xs text-slate-700">
                    <QueueSeqCell entry={e} />
                  </span>
                </div>
                <div className="flex gap-2">
                  <PatientClinicalAvatar
                    profile={getPatientClinicalProfile(e.patientId)}
                    size={40}
                    listBadges={{
                      preVisit: e.preVisitCompleted,
                      allergy: e.hasAllergyAlert,
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-900">{e.patientDisplay}</div>
                    <div className="text-[10px] text-slate-500">{e.ageSex}</div>
                    <div className="line-clamp-2 text-xs text-slate-500">{e.reasonText}</div>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
'''.replace("__CHECK__", CHECK)

# drop unused import warning for useI18n - remove if unused
CONTENT = CONTENT.replace("import { useI18n } from \"@/i18n/I18nContext\";\n", "")

out = Path("frontend/src/components/clinic/EncounterQueuePanel.tsx")
out.write_text(CONTENT, encoding="utf-8", newline="\n")
print("wrote", out, "bytes", out.stat().st_size)
