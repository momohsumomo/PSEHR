import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useListNav } from "@/hooks/useListNav";
import { RxGrid } from "@/components/clinic/RxGrid";
import type { UiColumnDef } from "@/types/uiConfig";
import type { DiagnosisRow, HistoryVisit, RxLine } from "@/mocks/clinicMocks";

const HISTORY_SPLIT_KEY = "wundadi.history.splits";
const HISTORY_SPLIT_DEFAULT = { visits: 168, cc: 36, dx: 42 };
type HistorySplits = typeof HISTORY_SPLIT_DEFAULT;

function clampSplit(n: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function readHistorySplits(): HistorySplits {
  try {
    const raw = localStorage.getItem(HISTORY_SPLIT_KEY);
    if (!raw) return HISTORY_SPLIT_DEFAULT;
    const parsed = JSON.parse(raw) as Partial<HistorySplits>;
    return {
      visits: clampSplit(parsed.visits, 72, 520, HISTORY_SPLIT_DEFAULT.visits),
      cc: clampSplit(parsed.cc, 22, 280, HISTORY_SPLIT_DEFAULT.cc),
      dx: clampSplit(parsed.dx, 22, 280, HISTORY_SPLIT_DEFAULT.dx),
    };
  } catch {
    return HISTORY_SPLIT_DEFAULT;
  }
}

/** SC32.exe \u6b77\u53f2\u700f\u89bd\u5217\u6b04\u540d\uff08His4.set / DrHistory\uff09 */
const VISIT_COLUMNS: { key: keyof HistoryVisit; label: string }[] = [
  { key: "visitDate", label: "就診日" },
  { key: "slotDept", label: "時/科/診" },
  { key: "caseNo", label: "案件" },
  { key: "rxDays", label: "天數" },
  { key: "cardNo", label: "卡號" },
  { key: "diseaseName", label: "病名名稱" },
  { key: "doctor", label: "醫師" },
  { key: "dispense", label: "調劑" },
];

type Props = {
  visits: HistoryVisit[];
  columns: UiColumnDef[];
  fontSizePx?: number;
  hideIcd?: boolean;
  showVisitDateOnRx?: boolean;
  dittoCcEnabled?: boolean;
  dittoDxEnabled?: boolean;
  onDittoCc: (text: string, visitDate: string) => void;
  onDittoDx: (rows: DiagnosisRow[]) => void;
  onDittoRx: (lines: RxLine[]) => void;
  onDittoVisit: (visit: HistoryVisit) => void;
  /** 轉入診療：主訴＋病名＋處置。不轉主訴：病名＋處置。 */
  onTransferVisit?: (visit: HistoryVisit) => void;
  onTransferVisitNoCc?: (visit: HistoryVisit) => void;
  onSelectedChange?: (visit: HistoryVisit | null) => void;
  /** light 清單選列時補載診斷／處方 */
  onEnsureDetail?: (visit: HistoryVisit) => Promise<HistoryVisit>;
  onSaveHistory?: (visit: HistoryVisit) => void | Promise<void>;
};

/**
 * 歷史病歷：與看診左欄相同——上→下 就診列／主述／病名／處置（非 2×2 四方格）。
 */
export function HistoryRxPanel({
  visits,
  columns,
  fontSizePx = 14,
  hideIcd = false,
  showVisitDateOnRx = true,
  dittoCcEnabled = true,
  dittoDxEnabled = true,
  onDittoCc,
  onDittoDx,
  onDittoRx,
  onDittoVisit,
  onTransferVisit,
  onTransferVisitNoCc,
  onSelectedChange,
  onEnsureDetail,
  onSaveHistory,
}: Props) {
  void showVisitDateOnRx;
  const [selectedId, setSelectedId] = useState<string | null>(visits[0]?.encounterId ?? null);
  const [editing, setEditing] = useState<HistoryVisit | null>(null);
  const [editCc, setEditCc] = useState("");
  const [editDx, setEditDx] = useState("");
  const [editRx, setEditRx] = useState("");
  const [overrides, setOverrides] = useState<Record<string, HistoryVisit>>({});

  useEffect(() => {
    if (!visits.some((v) => v.encounterId === selectedId)) {
      setSelectedId(visits[0]?.encounterId ?? null);
    }
  }, [visits, selectedId]);

  const mergedVisits = visits.map((v) => overrides[v.encounterId] ?? v);
  const selected = mergedVisits.find((v) => v.encounterId === selectedId) ?? mergedVisits[0] ?? null;
  const visitListRef = useRef<HTMLDivElement>(null);
  const mergedRef = useRef(mergedVisits);
  mergedRef.current = mergedVisits;
  const onVisitIndex = useCallback((i: number) => {
    const row = mergedRef.current[i];
    if (row) setSelectedId(row.encounterId);
  }, []);
  const visitIndex = mergedVisits.findIndex((v) => v.encounterId === selected?.encounterId);
  useListNav({
    active: !editing,
    length: mergedVisits.length,
    index: visitIndex,
    onIndex: onVisitIndex,
    scrollerRef: visitListRef,
    scopeRef: visitListRef,
  });

  useEffect(() => {
    onSelectedChange?.(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selected identity changes every render
  }, [selected?.encounterId]);

  useEffect(() => {
    if (!selected || !onEnsureDetail) return;
    if ((selected.medications?.length ?? 0) > 0 || (selected.diagnoses?.length ?? 0) > 0) return;
    let cancelled = false;
    void onEnsureDetail(selected).then((full) => {
      if (cancelled || !full) return;
      setOverrides((prev) => ({ ...prev, [full.encounterId]: full }));
    });
    return () => {
      cancelled = true;
    };
  }, [selected?.encounterId, onEnsureDetail, selected]);

  const openEdit = (visit: HistoryVisit) => {
    setSelectedId(visit.encounterId);
    setEditing(visit);
    setEditCc(visit.chiefComplaint);
    setEditDx(visit.diagnoses.map((d) => `${d.icd10} ${d.text}`.trim()).join("\n"));
    setEditRx(
      visit.medications
        .map((m) => [m.nhiCode, m.name, m.sig, m.days, m.qty ?? 1].join(" "))
        .join("\n"),
    );
  };

  const onVisitKey = (ev: KeyboardEvent, visit: HistoryVisit) => {
    if (ev.key === "Enter" && ev.ctrlKey) {
      ev.preventDefault();
      openEdit(visit);
      return;
    }
    if (ev.key === "Enter" && !ev.ctrlKey) {
      ev.preventDefault();
      onDittoVisit(visit);
    }
  };

  const bodyFs = Math.max(fontSizePx, 14);
  const headFs = Math.max(12, bodyFs - 1);
  const dash = "\u2014";
  const [splits, setSplits] = useState(readHistorySplits);
  useEffect(() => {
    localStorage.setItem(HISTORY_SPLIT_KEY, JSON.stringify(splits));
  }, [splits]);
  const startSplitDrag = (key: keyof HistorySplits, min: number, max: number) => (ev: ReactMouseEvent) => {
    ev.preventDefault();
    let last = ev.clientY;
    const move = (e: MouseEvent) => {
      const dy = e.clientY - last;
      last = e.clientY;
      setSplits((prev) => ({ ...prev, [key]: clampSplit(prev[key] + dy, min, max, prev[key]) }));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div
      className="relative flex h-full min-h-0 flex-col border-l border-slate-300 bg-slate-100"
      style={{ fontSize: bodyFs }}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-slate-300 bg-slate-200 px-2 py-0.5">
        <h2 className="font-bold text-slate-800" style={{ fontSize: bodyFs }}>
          {"\u6b77\u53f2\u75c5\u6b77"}
        </h2>
        <span className="text-slate-500" style={{ fontSize: headFs - 1 }}>
          Enter {"\u62f7\u8c9d"} · Ctrl+Enter／{"\u96d9\u64ca\u4fee\u7de8"}
        </span>
      </div>

      {/* Same stack: visits -> CC -> dx -> rx; slightly larger type */}
      <div className="flex min-h-0 flex-1 flex-col">
        <section
          className="flex shrink-0 flex-col overflow-hidden border-b border-[#808080] bg-white"
          style={{ height: splits.visits }}
        >
          <div ref={visitListRef} tabIndex={0} data-list-scope="" className="min-h-0 flex-1 overflow-auto outline-none">
            {mergedVisits.length === 0 ? (
              <p className="px-2 py-3 text-slate-400" style={{ fontSize: headFs }}>
                {"\u6b64\u75c5\u60a3\u5c1a\u7121\u770b\u8a3a\u8cc7\u6599"}
              </p>
            ) : (
              <table className="w-full min-w-max text-left" style={{ fontSize: bodyFs }}>
                <thead className="sticky top-0 bg-slate-100 text-slate-600">
                  <tr>
                    {VISIT_COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        className="whitespace-nowrap border-b px-1 py-0.5 font-semibold"
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mergedVisits.map((v) => (
                    <tr
                      key={v.encounterId}
                      data-list-row=""
                      tabIndex={0}
                      className={`cursor-pointer border-b border-slate-100 ${
                        selected?.encounterId === v.encounterId ? "bg-sky-100" : "hover:bg-slate-50"
                      }`}
                      onClick={() => setSelectedId(v.encounterId)}
                      onDoubleClick={() => openEdit(v)}
                      onKeyDown={(ev) => onVisitKey(ev, v)}
                    >
                      {VISIT_COLUMNS.map((col) => (
                        <td key={col.key} className="whitespace-nowrap px-1 py-0.5 leading-snug">
                          {String(v[col.key] ?? dash)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
        <div
          role="separator"
          aria-orientation="horizontal"
          title={"\u62d6\u66f3\u8abf\u6574\u9ad8\u5ea6\uff0c\u96d9\u64ca\u56de\u5fa9\u9810\u8a2d"}
          className="h-1.5 shrink-0 cursor-row-resize bg-[#6A6A6A] hover:bg-[#0A5AD6]"
          onMouseDown={startSplitDrag("visits", 72, 520)}
          onDoubleClick={() => setSplits(HISTORY_SPLIT_DEFAULT)}
        />

        <section
          className="flex shrink-0 items-stretch overflow-hidden border-b border-[#808080] bg-[#FFF5FA]"
          style={{ height: splits.cc }}
        >
          <pre
            className="min-w-0 flex-1 overflow-auto whitespace-pre-wrap px-1 py-0.5 leading-snug text-slate-800"
            style={{ fontSize: bodyFs }}
          >
            {selected?.chiefComplaint || dash}
          </pre>
          <button
            type="button"
            disabled={!dittoCcEnabled || !selected?.chiefComplaint}
            className="shrink-0 self-start bg-amber-600 px-1 py-0.5 font-bold text-white disabled:opacity-40"
            style={{ fontSize: headFs - 1 }}
            onClick={() => selected && onDittoCc(selected.chiefComplaint, selected.visitDate)}
          >
            Ditto
          </button>
        </section>
        <div
          role="separator"
          aria-orientation="horizontal"
          title={"\u62d6\u66f3\u8abf\u6574\u9ad8\u5ea6\uff0c\u96d9\u64ca\u56de\u5fa9\u9810\u8a2d"}
          className="h-1.5 shrink-0 cursor-row-resize bg-[#6A6A6A] hover:bg-[#0A5AD6]"
          onMouseDown={startSplitDrag("cc", 22, 280)}
          onDoubleClick={() => setSplits(HISTORY_SPLIT_DEFAULT)}
        />

        <section
          className="flex shrink-0 items-stretch overflow-hidden border-b border-[#808080] bg-[#F0FFF0]"
          style={{ height: splits.dx }}
        >
          <ul
            className="min-w-0 flex-1 overflow-auto px-1 py-0.5 leading-snug"
            style={{ fontSize: bodyFs }}
          >
            {(selected?.diagnoses ?? []).length === 0 ? (
              <li className="text-slate-400">{dash}</li>
            ) : (
              selected!.diagnoses.map((dx, i) => (
                <li key={dx.id ?? `${dx.icd10}-${i}`}>
                  {hideIcd ? dx.text : `${dx.icd10 || dx.nhiIcd10 || ""} ${dx.text}`.trim()}
                </li>
              ))
            )}
          </ul>
          <button
            type="button"
            disabled={!dittoDxEnabled || !selected?.diagnoses.length}
            className="shrink-0 self-start bg-amber-600 px-1 py-0.5 font-bold text-white disabled:opacity-40"
            style={{ fontSize: headFs - 1 }}
            onClick={() => selected && onDittoDx(selected.diagnoses)}
          >
            Ditto
          </button>
        </section>
        <div
          role="separator"
          aria-orientation="horizontal"
          title={"\u62d6\u66f3\u8abf\u6574\u9ad8\u5ea6\uff0c\u96d9\u64ca\u56de\u5fa9\u9810\u8a2d"}
          className="h-1.5 shrink-0 cursor-row-resize bg-[#6A6A6A] hover:bg-[#0A5AD6]"
          onMouseDown={startSplitDrag("dx", 22, 280)}
          onDoubleClick={() => setSplits(HISTORY_SPLIT_DEFAULT)}
        />

        <section className="flex min-h-0 flex-1 flex-col border-t border-[#808080] bg-[#FFFFF0]">
          <div className="flex shrink-0 justify-end">
            <button
              type="button"
              disabled={!selected?.medications.length}
              className="bg-amber-600 px-1 py-0.5 font-bold text-white disabled:opacity-40"
              style={{ fontSize: headFs - 1 }}
              onClick={() => selected && onDittoRx(selected.medications)}
            >
              Ditto (F7)
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <RxGrid
              lines={selected?.medications ?? []}
              columns={columns}
              readonly
              active={false}
              fontSizePx={bodyFs}
              onDitto={(line) => onDittoRx([line])}
              emptyText={"\u5c1a\u7121\u524d\u6b21\u8655\u65b9"}
            />
          </div>
        </section>
      </div>

      <div
        className="flex shrink-0 items-center gap-1 border-t px-1 py-1"
        style={{ borderColor: "#808080", background: "#D8D4C8" }}
      >
        <button
          type="button"
          disabled={
            !selected ||
            (!selected.chiefComplaint?.trim() &&
              !selected.diagnoses.length &&
              !selected.medications.length)
          }
          className="border px-2 py-0.5 text-[12px] font-bold text-black disabled:opacity-40"
          style={{ borderColor: "#404040", background: "#FFFF80" }}
          onClick={() => selected && (onTransferVisit ?? onDittoVisit)(selected)}
        >
          轉入診療
        </button>
        <button
          type="button"
          disabled={!selected || (!selected.diagnoses.length && !selected.medications.length)}
          className="border px-2 py-0.5 text-[12px] font-bold text-black disabled:opacity-40"
          style={{ borderColor: "#404040", background: "#F0F0F0" }}
          onClick={() => selected && onTransferVisitNoCc?.(selected)}
        >
          不轉主訴
        </button>
      </div>

      {editing && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30">
          <div className="w-[min(32rem,90vw)] rounded-lg border border-slate-300 bg-white p-4 shadow-xl">
            <h3 className="mb-2 text-sm font-bold">修編歷史病歷 {editing.visitDate}</h3>
            <label className="block text-[11px] font-bold text-slate-600">主述</label>
            <textarea
              className="mb-2 h-24 w-full rounded border border-slate-300 p-2 text-xs"
              value={editCc}
              onChange={(e) => setEditCc(e.target.value)}
            />
            <label className="block text-[11px] font-bold text-slate-600">病名（每行：代碼 名稱）</label>
            <textarea
              className="mb-2 h-16 w-full rounded border border-slate-300 p-2 font-mono text-xs"
              value={editDx}
              onChange={(e) => setEditDx(e.target.value)}
            />
            <label className="block text-[11px] font-bold text-slate-600">
              處方（每行：健保碼 藥名 用法 天數 次量）
            </label>
            <textarea
              className="mb-3 h-20 w-full rounded border border-slate-300 p-2 font-mono text-xs"
              value={editRx}
              onChange={(e) => setEditRx(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded border px-3 py-1 text-xs" onClick={() => setEditing(null)}>
                取消
              </button>
              <button
                type="button"
                className="rounded bg-sky-700 px-3 py-1 text-xs font-bold text-white"
                onClick={async () => {
                  const diagnoses = editDx
                    .split("\n")
                    .map((ln) => ln.trim())
                    .filter(Boolean)
                    .map((line, i) => {
                      const [icd10, ...rest] = line.split(/\s+/);
                      const prev = editing.diagnoses[i];
                      return {
                        id: prev?.id,
                        icd10: icd10 || "",
                        nhiIcd10: prev?.nhiIcd10,
                        text: rest.join(" ") || icd10 || "",
                      };
                    });
                  const medications = editRx
                    .split("\n")
                    .map((ln) => ln.trim())
                    .filter(Boolean)
                    .map((line, i) => {
                      const parts = line.split(/\s+/);
                      const prev = editing.medications[i];
                      const nhiCode = parts[0] || prev?.nhiCode || "";
                      const qty = Number(parts[parts.length - 1]);
                      const days = Number(parts[parts.length - 2]);
                      const hasQtyDays = Number.isFinite(qty) && Number.isFinite(days);
                      const sig = hasQtyDays ? parts[parts.length - 3] : parts[parts.length - 1];
                      const nameParts = hasQtyDays ? parts.slice(1, -3) : parts.slice(1, -1);
                      return {
                        id: prev?.id || `rx-${Date.now()}-${i}`,
                        name: nameParts.join(" ") || prev?.name || nhiCode,
                        nhiCode,
                        sig: sig || prev?.sig || "依醫囑",
                        days: hasQtyDays && days > 0 ? days : prev?.days || 1,
                        qty: hasQtyDays && qty > 0 ? qty : prev?.qty || 1,
                        route: prev?.route ?? "oral",
                      };
                    });
                  const next: HistoryVisit = {
                    ...editing,
                    chiefComplaint: editCc,
                    diseaseName: diagnoses[0]?.text || editing.diseaseName,
                    diagnoses,
                    medications,
                  };
                  setOverrides((o) => ({ ...o, [next.encounterId]: next }));
                  await onSaveHistory?.(next);
                  setEditing(null);
                }}
              >
                存檔
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
