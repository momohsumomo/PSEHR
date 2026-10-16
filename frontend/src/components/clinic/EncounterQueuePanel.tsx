import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { PatientClinicalAvatar } from "@/components/clinic/PatientClinicalAvatar";
import { QueueRegisterStrip } from "@/components/clinic/QueueRegisterStrip";
import {
  getPatientClinicalProfile,
  type QueueEntry,
  type QueueStatus,
} from "@/mocks/clinicMocks";
import { HIS, HIS_FONT, HIS_QUEUE_COL_WIDTHS } from "@/lib/hisTheme";
import { clockLabel, compareClinicQueue } from "@/lib/queueOrder";

const COL_WIDTH_STORAGE = "wundadi.queue.colWidths.v2";

const DEFAULT_COL_WIDTHS: Record<string, number> = { ...HIS_QUEUE_COL_WIDTHS };

function loadColWidths(): Record<string, number> {
  try {
    const raw = localStorage.getItem(COL_WIDTH_STORAGE);
    if (!raw) return { ...DEFAULT_COL_WIDTHS };
    const parsed = JSON.parse(raw) as Record<string, number>;
    return { ...DEFAULT_COL_WIDTHS, ...parsed };
  } catch {
    return { ...DEFAULT_COL_WIDTHS };
  }
}

/**
 * 完診欄：勾＝完診尚未寫入；黃圈＋勾＝該次有寫入。
 * 舊醫聖資料的圈＝健保卡 IC 序號已寫；6.0 以後的圈＝雲端寫入成功。
 * 兩種都留著，歷史才分得出來。以後若不寫卡，新資料就只會是勾。
 */
function DoneMarkCell({ entry }: { entry: QueueEntry }) {
  const check = "\u2713";
  if (entry.queueStatus === "in_progress") {
    return (
      <span
        className="inline-block w-[1.1em] text-center text-[0.95em] leading-none"
        title={"\u66ab\u505c\uff08\u672a F9 \u5b58\u6a94\uff09"}
        style={{ color: "#0033AA" }}
      >
        {"\u23F8"}
      </span>
    );
  }
  if (entry.queueStatus !== "finished" && entry.queueStatus !== "no_show") {
    return <span className="inline-block w-[1.1em] text-center">&nbsp;</span>;
  }
  if (entry.cardWritten) {
    return (
      <span
        className="inline-flex h-[1.15em] w-[1.15em] items-center justify-center rounded-full text-[0.75em] font-bold leading-none text-black"
        style={{ background: "#FFD000" }}
        title={"\u5b8c\u8a3a\u4e14\u5df2\u5beb\u5165\uff08\u820a\u8cc7\u6599\uff1d\u5361\u7247\uff1b6.0\uff1d\u96f2\u7aef\u5beb\u5165\u6210\u529f\uff09"}
      >
        {check}
      </span>
    );
  }
  return (
    <span className="inline-block w-[1.1em] text-center font-bold" title={"\u5b8c\u8a3a"}>
      {check}
    </span>
  );
}

function queueCellValue(entry: QueueEntry, key: string): string {
  const dash = "\u2014";
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
    return s.length && s !== "—" ? s : dash;
  };

  switch (key) {
    case "queueNumber":
      return String(entry.queueNumber);
    case "slotTime":
      return empty(clockLabel(timeLabel));
    case "medicalNo":
      return empty(entry.medicalNo);
    case "patientDisplay":
      return empty(entry.patientDisplay);
    case "age":
      return empty(ageLabel);
    case "sex":
      return empty(sexLabel);
    case "diseaseName":
      return empty(entry.diseaseName);
    case "shift":
      return empty(shift);
    case "note":
      return empty(entry.note);
    case "preVisit":
      return entry.prebook && entry.queueStatus === "waiting" ? "\u9810" : dash;
    case "caseNo":
      return empty(entry.caseNo);
    case "reasonText":
      return empty(entry.reasonText);
    case "weight":
      return empty(entry.weight);
    case "totalFee":
      return empty(entry.totalFee);
    case "deposit":
      return empty(entry.deposit);
    case "regFee":
      return empty(entry.regFee);
    case "copay":
      return empty(entry.copayAmt);
    case "drugDisc":
    case "drugFee":
      return empty(entry.drugFee);
    default:
      return dash;
  }
}

function renderQueueCell(entry: QueueEntry, key: string): ReactNode {
  if (key === "doneMark") return <DoneMarkCell entry={entry} />;
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
  fontSizePx = HIS.fs.primary,
  highlighted,
  panelRef,
  searchQuery = "",
  onSearchChange,
  variant = "sidebar",
  onOpen,
  showChrome = true,
}: Props) {
  const isPage = variant === "page";
  const [widths, setWidths] = useState<Record<string, number>>(loadColWidths);
  const dragRef = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const bindScroller = (node: HTMLElement | null) => {
    scrollerRef.current = node;
  };

  useEffect(() => {
    try {
      localStorage.setItem(COL_WIDTH_STORAGE, JSON.stringify(widths));
    } catch {
      /* ignore */
    }
  }, [widths]);

  const onResizeMove = useCallback((ev: MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const next = Math.max(16, d.startW + (ev.clientX - d.startX));
    setWidths((prev) => ({ ...prev, [d.key]: next }));
  }, []);

  const onResizeEnd = useCallback(() => {
    dragRef.current = null;
    document.removeEventListener("mousemove", onResizeMove);
    document.removeEventListener("mouseup", onResizeEnd);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, [onResizeMove]);

  const startResize = (key: string, clientX: number) => {
    dragRef.current = {
      key,
      startX: clientX,
      startW: widths[key] ?? DEFAULT_COL_WIDTHS[key] ?? 64,
    };
    document.addEventListener("mousemove", onResizeMove);
    document.addEventListener("mouseup", onResizeEnd);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", onResizeMove);
      document.removeEventListener("mouseup", onResizeEnd);
    };
  }, [onResizeMove, onResizeEnd]);

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
          { label: "\u5b8c", key: "doneMark" },
          { label: "\u5e8f\u865f", key: "queueNumber" },
          { label: "\u59d3\u540d", key: "patientDisplay" },
        ];

  const sortedEntries = useMemo(
    () => [...entries].sort(compareClinicQueue),
    [entries],
  );

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || !selectedId) return;
    root.querySelector(`[data-qid="${selectedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId, sortedEntries]);

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const onWheel = (ev: WheelEvent) => {
      if (!sortedEntries.length) return;
      ev.preventDefault();
      const current = sortedEntries.findIndex((e) => e.encounterId === selectedId);
      const step = ev.deltaY > 0 ? 2 : ev.deltaY < 0 ? -2 : 0;
      if (!step) return;
      const next =
        current < 0
          ? step > 0
            ? 0
            : sortedEntries.length - 1
          : Math.min(sortedEntries.length - 1, Math.max(0, current + step));
      if (next !== current) onSelect(sortedEntries[next].encounterId);
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [onSelect, selectedId, sortedEntries]);

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      className={`flex h-full min-h-0 flex-col outline-none transition ${
        isPage
          ? "min-w-0 w-full flex-1 bg-white"
          : `shrink-0 border-r bg-white ${mode === "table" ? "w-[min(38rem,36vw)]" : "w-64"}`
      } ${highlighted ? "ring-2 ring-inset ring-[#808080]" : ""}`}
      style={!isPage ? { borderColor: HIS.chromeDark } : undefined}
    >
      {showChrome && (
        <div className="border-b px-2 py-0" style={{ borderColor: HIS.chromeDark, background: HIS.headerBg }}>
          <h2 className="text-[12px] font-bold leading-none text-black">
            {"\u7576\u5929\u770b\u8a3a\u6e05\u55ae"}
          </h2>
        </div>
      )}

      {showChrome && onSearchChange && (
        <QueueRegisterStrip searchQuery={searchQuery} onSearchChange={onSearchChange} />
      )}

      {mode === "table" ? (
        <div
          ref={bindScroller}
          data-queue-scroller=""
          className="min-h-0 flex-1 overflow-auto"
          style={{ fontFamily: HIS_FONT, fontSize: fontSizePx }}
        >
          <table
            className="border-collapse text-left text-black"
            style={{
              tableLayout: "fixed",
              width: "max-content",
              minWidth: "100%",
              fontFamily: HIS_FONT,
            }}
          >
            <colgroup>
              {tableCols.map((col) => (
                <col
                  key={col.key}
                  style={{ width: widths[col.key] ?? DEFAULT_COL_WIDTHS[col.key] ?? 64 }}
                />
              ))}
            </colgroup>
            <thead
              className="sticky top-0 z-10 text-black"
              style={{ background: isPage ? "#D8D4C8" : HIS.headerBg }}
            >
              <tr style={{ height: HIS.row.listHeader }}>
                {tableCols.map((col) => (
                  <th
                    key={col.key}
                    className="relative border py-0 font-bold leading-none select-none"
                    style={{
                      width: widths[col.key] ?? DEFAULT_COL_WIDTHS[col.key] ?? 64,
                      maxWidth: widths[col.key] ?? DEFAULT_COL_WIDTHS[col.key] ?? 64,
                      height: HIS.row.listHeader,
                      fontSize: HIS.fs.secondary,
                      borderColor: HIS.chromeDark,
                      background: isPage ? "#D8D4C8" : HIS.headerBg,
                    }}
                    title="拖右緣調寬"
                  >
                    <span
                      className={`block w-full truncate text-left font-bold leading-none ${
                        col.key === "doneMark" ? "px-0.5 text-center" : "px-0.5"
                      }`}
                      style={{ fontSize: HIS.fs.secondary }}
                    >
                      {col.label}
                    </span>
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      className="absolute right-0 top-0 z-20 h-full w-1.5 cursor-col-resize hover:bg-black/20"
                      onMouseDown={(ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        startResize(col.key, ev.clientX);
                      }}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map((e, rowIdx) => {
                const selected = selectedId === e.encounterId;
                const alt = rowIdx % 2 === 1;
                const finished = e.queueStatus === "finished" || e.queueStatus === "no_show";
                const waiting = e.queueStatus === "waiting";
                return (
                <tr
                  key={e.encounterId}
                  data-qid={e.encounterId}
                  className="cursor-pointer leading-none"
                  style={{
                    height: HIS.row.list,
                    background: selected
                      ? HIS.rowSelected
                      : finished
                        ? HIS.rowFinished
                        : waiting
                          ? HIS.rowWaiting
                          : alt
                            ? HIS.rowAlt
                            : "#FFFFFF",
                    color: finished && !selected ? "#666666" : "#000000",
                  }}
                  onClick={() => onSelect(e.encounterId)}
                  onDoubleClick={() => enterPatient(e.encounterId, e.queueStatus)}
                >
                  {tableCols.map((col) => {
                    const isPrimary =
                      col.key === "patientDisplay" || col.key === "diseaseName";
                    return (
                    <td
                      key={col.key}
                      className={`overflow-hidden border px-0.5 py-0 leading-none ${
                        col.key === "doneMark" ? "text-center" : ""
                      }`}
                      style={{
                        width: widths[col.key] ?? DEFAULT_COL_WIDTHS[col.key] ?? 64,
                        maxWidth: widths[col.key] ?? DEFAULT_COL_WIDTHS[col.key] ?? 64,
                        borderColor: "#A0A0A0",
                        fontSize: isPrimary ? HIS.fs.primary : HIS.fs.body,
                        fontWeight: isPrimary ? 700 : 400,
                      }}
                      title={
                        col.key === "doneMark" ? undefined : queueCellValue(e, col.key)
                      }
                    >
                      <div className="truncate whitespace-nowrap leading-none">
                        {renderQueueCell(e, col.key)}
                      </div>
                    </td>
                    );
                  })}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <ul ref={bindScroller} className="flex-1 overflow-y-auto">
          {sortedEntries.map((e) => (
            <li key={e.encounterId} data-qid={e.encounterId}>
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
                <div className="mb-1 flex items-center gap-1.5">
                  <DoneMarkCell entry={e} />
                  <span className="font-mono text-xs text-slate-700">#{e.queueNumber}</span>
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
