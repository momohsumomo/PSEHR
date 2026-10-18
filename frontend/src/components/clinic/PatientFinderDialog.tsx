import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchPatients, isApiMode } from "@/api/clinicApi";
import { mapApiPatientToHit, formatBirthdayRoc, type PatientHit } from "@/lib/patientSearch";
import { useListNav } from "@/hooks/useListNav";

type Props = {
  open: boolean;
  /** 開啟時帶入搜尋欄（掛號頁／調閱頁共用）。 */
  initialQuery?: string;
  onClose: () => void;
  onSelect: (hit: PatientHit) => void;
  /** 掛號找人：沒有符合就開新建，有符合也留新增按鈕。調閱不開。 */
  allowCreate?: boolean;
  onCreate?: (query: string) => void;
};

/**
 * 醫聖風格共用「找人」視窗。
 * Enter／雙擊＝選定病患（呼叫端決定後續：掛號確認／填病歷條件），不是掛號。
 */
export function PatientFinderDialog({ open, initialQuery = "", onClose, onSelect, allowCreate, onCreate }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [hits, setHits] = useState<PatientHit[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [lastSearched, setLastSearched] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const emptyOpened = useRef("");
  const onFinderIndex = useCallback((i: number) => setSelectedIdx(i), []);
  useListNav({
    active: open && hits.length > 0,
    length: hits.length,
    index: selectedIdx,
    onIndex: onFinderIndex,
    scrollerRef: listRef,
    moveWhileTyping: true,
  });

  const runSearch = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q) {
      setHits([]);
      setSearched(false);
      setLastSearched("");
      setError(null);
      return;
    }
    if (!isApiMode()) {
      setError("找人需 API 模式（影子庫病患主檔）");
      setHits([]);
      setSearched(true);
      setLastSearched(q);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPatients({ q, _count: 400 });
      const mapped = (res.entry ?? []).map((e) => mapApiPatientToHit(e.resource));
      setHits(mapped);
      setSelectedIdx(0);
      setSearched(true);
      setLastSearched(q);
    } catch (e) {
      setHits([]);
      setError(e instanceof Error ? e.message : "搜尋失敗");
      setSearched(true);
      setLastSearched(q);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    emptyOpened.current = "";
    setQuery(initialQuery);
    setHits([]);
    setSelectedIdx(0);
    setError(null);
    setSearched(false);
    setLastSearched("");
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    if (initialQuery.trim()) {
      void runSearch(initialQuery);
    }
  }, [open, initialQuery, runSearch]);

  useEffect(() => {
    if (!open || !allowCreate || !onCreate) return;
    if (!searched || loading || error || hits.length > 0 || !lastSearched) return;
    if (emptyOpened.current === lastSearched) return;
    emptyOpened.current = lastSearched;
    onCreate(lastSearched);
  }, [open, allowCreate, onCreate, searched, loading, error, hits.length, lastSearched]);

  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector(`[data-idx="${selectedIdx}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx, open]);

  if (!open) return null;

  const confirmHit = (hit: PatientHit) => {
    onSelect(hit);
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      onClose();
      return;
    }
    if (ev.key === "Enter") {
      ev.preventDefault();
      ev.stopPropagation();
      const active = document.activeElement;
      if (active === inputRef.current) {
        const q = query.trim();
        if (searched && hits.length > 0 && !loading && q === lastSearched) {
          confirmHit(hits[selectedIdx] ?? hits[0]);
          return;
        }
        void runSearch(query);
        return;
      }
      if (hits[selectedIdx]) {
        confirmHit(hits[selectedIdx]);
      }
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-900/45"
      onKeyDown={onKeyDown}
    >
      <div className="flex max-h-[88%] w-[min(42rem,96%)] flex-col overflow-hidden rounded border border-[#004D00] bg-[#D4ECD4] shadow-xl">
        <header className="flex shrink-0 items-center justify-between border-b border-[#80C080] bg-[#004D00] px-3 py-1.5 text-xs text-white">
          <span className="font-bold">搜尋病患</span>
          <span className="font-normal text-lime-100">
            Enter 搜尋／選定　↑↓ PgUp PgDn Home End　Esc 取消
          </span>
        </header>

        <div className="shrink-0 border-b border-[#80C080] bg-[#E8F8E8] px-3 py-2">
          <label className="block text-[10px] font-bold text-[#004D00]">
            身分證／手機／生日（如 82.1.17）／姓名／病歷號
          </label>
          <div className="mt-1 flex gap-1">
            <input
              ref={inputRef}
              type="search"
              className="min-w-0 flex-1 rounded border border-[#80C080] bg-white px-2 py-1 text-sm font-mono focus:outline-none"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="輸入後按 Enter 搜尋"
            />
            <button
              type="button"
              className="shrink-0 rounded border border-[#004D00] bg-white px-3 py-1 text-xs font-bold text-[#004D00]"
              onClick={() => void runSearch(query)}
            >
              搜尋
            </button>
          </div>
        </div>

        {loading && (
          <p className="shrink-0 bg-sky-50 px-3 py-1 text-xs text-sky-900">搜尋中…</p>
        )}
        {error && (
          <p className="shrink-0 bg-red-100 px-3 py-1 text-xs text-red-900">{error}</p>
        )}

        <div ref={listRef} className="min-h-0 flex-1 overflow-auto bg-white">
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 bg-[#C5EBC5] text-[#004D00]">
              <tr>
                <th className="border border-[#80C080] px-2 py-1 text-left">姓名</th>
                <th className="border border-[#80C080] px-2 py-1 text-left">病歷號</th>
                <th className="border border-[#80C080] px-2 py-1 text-left">身分證</th>
                <th className="border border-[#80C080] px-2 py-1 text-left">生日</th>
                <th className="border border-[#80C080] px-2 py-1 text-left">性別</th>
                <th className="border border-[#80C080] px-2 py-1 text-left">電話</th>
              </tr>
            </thead>
            <tbody>
              {hits.map((h, idx) => (
                <tr
                  key={h.id}
                  data-list-row=""
                  data-idx={idx}
                  className={`cursor-pointer ${
                    idx === selectedIdx ? "bg-[#004D00] text-white" : "hover:bg-[#E8F8E8]"
                  }`}
                  onClick={() => setSelectedIdx(idx)}
                  onDoubleClick={() => confirmHit(h)}
                >
                  <td className="border border-[#C5EBC5] px-2 py-1 font-bold">{h.name}</td>
                  <td className="border border-[#C5EBC5] px-2 py-1 font-mono">{h.medicalNo || "—"}</td>
                  <td className="border border-[#C5EBC5] px-2 py-1 font-mono">{h.idNo || "—"}</td>
                  <td className="border border-[#C5EBC5] px-2 py-1 font-mono">
                    {formatBirthdayRoc(h.birthdayRoc) || "\u2014"}
                  </td>
                  <td className="border border-[#C5EBC5] px-2 py-1">
                    {h.sex === "M" ? "男" : h.sex === "F" ? "女" : h.sex || "—"}
                  </td>
                  <td className="border border-[#C5EBC5] px-2 py-1 font-mono">{h.phone || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {searched && !loading && hits.length === 0 && !error && (
            <p className="px-3 py-6 text-center text-xs text-slate-500">
              {allowCreate ? "\u67e5\u7121\u7b26\u5408\u75c5\u60a3\uff0c\u8acb\u65b0\u5efa\u75c5\u6b77" : "\u67e5\u7121\u7b26\u5408\u75c5\u60a3"}
            </p>
          )}
          {!searched && !loading && (
            <p className="px-3 py-6 text-center text-xs text-slate-500">
              輸入條件後按 Enter；選定後由原畫面決定下一步
            </p>
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-[#80C080] bg-[#E8F8E8] px-2 py-1.5">
          <button
            type="button"
            disabled={!hits[selectedIdx]}
            className="rounded border border-[#004D00] bg-white px-3 py-1 text-xs font-bold text-[#004D00] disabled:opacity-40"
            onClick={() => hits[selectedIdx] && confirmHit(hits[selectedIdx])}
          >
            Enter 選定
          </button>
          {allowCreate ? (
            <button
              type="button"
              className="rounded border border-[#8a6a00] bg-[#ffe14a] px-3 py-1 text-xs font-bold"
              onClick={() => onCreate?.(query.trim() || lastSearched)}
            >
              {"\u65b0\u589e\u75c5\u60a3"}
            </button>
          ) : null}
          <button
            type="button"
            className="rounded border border-slate-400 bg-white px-3 py-1 text-xs font-semibold"
            onClick={onClose}
          >
            Esc 取消
          </button>
          <span className="ml-auto text-[10px] text-[#004D00]">
            {hits.length ? `${selectedIdx + 1} / ${hits.length}` : ""}
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
