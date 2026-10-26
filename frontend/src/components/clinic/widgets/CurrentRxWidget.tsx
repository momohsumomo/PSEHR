import { useEffect, useMemo, useState } from "react";
import { RxGrid } from "@/components/clinic/RxGrid";
import { HIS, HIS_FONT } from "@/lib/hisTheme";
import type { RxLine } from "@/mocks/clinicMocks";
import { searchDrugs } from "@/utils/catalogSearch";
import { catalogDrugToRxLine } from "@/utils/catalogRx";
import { withComputedTotal, type CatalogUsage } from "@/utils/rxTotal";

interface CurrentRxWidgetProps {
  catalog: any;
  addRxLines: (lines: any[]) => void;
  currentRx: any[];
  currentRxColumns: any;
  apiMode: boolean;
  historyFontPx: number;
  mockCurrentRx: any[];
  setMockCurrentRx: (lines: any[]) => void;
  onChangeLine?: (id: string, patch: Partial<RxLine>) => void;
  sections: any;
  prefs: any;
  selectedEncounterId: string | null;
  commandFocusBump: React.MutableRefObject<number>;
  defaultUsages: any;
  usages?: CatalogUsage[];
  routes?: string[];
  onOpenPalette?: () => void;
  active?: boolean;
  onActivate?: () => void;
  selectedIndex?: number;
  onSelectIndex?: (index: number) => void;
  onQualityLab?: (line: RxLine) => boolean;
  rxQuery: string;
  setRxQuery: (q: string) => void;
}

function isDraftId(id: string) {
  return id.startsWith("rx-draft-");
}

function newDraft(): RxLine {
  // 空列不預填用法／天數；選定處置後才帶入 MEDICAL 內建預設
  return {
    id: `rx-draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: "",
    shortName: "",
    sig: "",
    days: 0,
    qty: undefined,
    nhiCode: "",
    route: "oral",
    payMark: "",
    memo: "",
  };
}

function draftHasContent(line: RxLine): boolean {
  return Boolean((line.name || "").trim() || (line.nhiCode || "").trim());
}

/**
 * 處置表格：↑↓ 在列間選取；到最末列再按 ↓ 才在表格內新增一列（不跳到底部）。
 */
export function CurrentRxWidget({
  catalog,
  addRxLines,
  currentRx,
  currentRxColumns,
  apiMode: _apiMode,
  historyFontPx: _historyFontPx,
  mockCurrentRx,
  setMockCurrentRx,
  onChangeLine,
  sections: _sections,
  prefs: _prefs,
  selectedEncounterId,
  commandFocusBump,
  defaultUsages: _defaultUsages,
  usages = [],
  routes = [],
  onOpenPalette: _onOpenPalette,
  active = false,
  onActivate,
  selectedIndex = -1,
  onSelectIndex,
  onQualityLab,
  rxQuery,
  setRxQuery,
}: CurrentRxWidgetProps) {
  void _historyFontPx;
  void _sections;
  void _prefs;
  void _defaultUsages;
  void _onOpenPalette;

  const [drafts, setDrafts] = useState<RxLine[]>(() => [newDraft()]);
  const [pickIdx, setPickIdx] = useState(0);
  const [focusNonce, setFocusNonce] = useState(0);
  const [coverQuery, setCoverQuery] = useState<string | null>(null);

  const displayLines = useMemo(() => [...currentRx, ...drafts], [currentRx, drafts]);
  const sel =
    selectedIndex >= 0 && selectedIndex < displayLines.length ? selectedIndex : -1;
  const selectedLine = sel >= 0 ? displayLines[sel] : undefined;
  const editingDraft = selectedLine && isDraftId(selectedLine.id);

  const typedName =
    coverQuery !== null ? coverQuery : editingDraft ? selectedLine?.name || "" : "";
  const nameQ = typedName.trim();
  // 空字不查（避免一選到就跳出前 12 筆）
  const hits = nameQ ? searchDrugs(catalog.drugs || [], nameQ, 12) : [];
  void rxQuery;
  void setRxQuery;

  // 切病人時重開一列空稿，但不自動選第一列（否則右欄會被當成要改處置）
  useEffect(() => {
    setDrafts([newDraft()]);
    setCoverQuery(null);
    onSelectIndex?.(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEncounterId]);

  // 已存列變多時，確保尾巴至少一列空稿
  useEffect(() => {
    setDrafts((d) => (d.length === 0 ? [newDraft()] : d));
  }, [currentRx.length]);

  useEffect(() => {
    if (active) setFocusNonce((n) => n + 1);
  }, [active, commandFocusBump.current]);

  useEffect(() => {
    setPickIdx(0);
  }, [selectedLine?.name, coverQuery, rxQuery]);

  const setSel = (i: number) => {
    onSelectIndex?.(i);
    setFocusNonce((n) => n + 1);
  };

  const patchDraft = (id: string, patch: Partial<RxLine>) => {
    setDrafts((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    // 不下推右欄篩選；下拉在格子內完成
  };

  const appendDraftRow = () => {
    const row = newDraft();
    // 以當下長度算新列 index：已存 N 筆 + 既有草稿 M 筆 → 新列在 N+M
    const nextIdx = currentRx.length + drafts.length;
    setDrafts((d) => [...d, row]);
    setSel(nextIdx);
  };

  const commitDraft = (draft: RxLine, drugIndex = pickIdx) => {
    const q = (draft.name || "").trim();
    if (!q) return false;
    const drug = searchDrugs(catalog.drugs || [], q, 8)[drugIndex];
    if (!drug) return false;
    // 用法／天數／量以目錄（MEDICAL）為準；僅當使用者在該列有改過才覆寫
    const line = catalogDrugToRxLine(drug, usages);
    if (draft.qty != null && draft.qty > 0 && draft.qty !== drug.qty) {
      line.qty = draft.qty;
    }
    if ((draft.sig || "").trim() && draft.sig !== (drug.sig || "")) {
      line.sig = draft.sig;
    }
    if (draft.days > 0 && draft.days !== (drug.days || 0)) {
      line.days = draft.days;
    }
    if ((draft.route || "").trim() && draft.route !== drug.route) {
      line.route = draft.route;
    }
    if (draft.payMark) {
      line.payMark = draft.payMark;
      line.selfPay = draft.selfPay;
    }
    if ((draft.memo || "").trim()) {
      line.memo = draft.memo;
    }
    addRxLines([withComputedTotal(line, usages)]);
    setDrafts((rows) => {
      const rest = rows.filter((r) => r.id !== draft.id);
      return rest.length ? rest : [newDraft()];
    });
    // 剛寫入的那一列在 currentRx.length；下一列空白稿才是要繼續打的地方
    setSel(currentRx.length + 1);
    setCoverQuery(null);
    return true;
  };

  const applyCover = (id: string, text: string, suggestIndex = 0) => {
    const base = displayLines.find((l) => l.id === id);
    const q = text.trim();
    if (!base || !q) return false;
    if (isDraftId(id)) {
      const ok = commitDraft({ ...base, name: q }, suggestIndex);
      setCoverQuery(null);
      return ok;
    }
    const drug = searchDrugs(catalog.drugs || [], q, 8)[suggestIndex];
    if (!drug) return false;
    const next = catalogDrugToRxLine(drug, usages);
    handleChangeLine(id, {
      name: next.name,
      shortName: next.shortName,
      nhiCode: next.nhiCode,
      sig: next.sig,
      days: next.days,
      qty: next.qty,
      route: next.route,
      cast: next.cast,
      typeName: next.typeName,
      totalAmount: next.totalAmount,
      payMark: base.payMark || next.payMark,
      selfPay: base.payMark ? base.selfPay : next.selfPay,
      memo: base.memo || next.memo,
    });
    setCoverQuery(null);
    return true;
  };

  const handleChangeLine = (id: string, patch: Partial<RxLine>) => {
    const base = displayLines.find((l) => l.id === id);
    const nextPatch = base
      ? withComputedTotal({ ...base, ...patch }, usages, base.sig)
      : patch;
    const fieldPatch: Partial<RxLine> = { ...patch, totalAmount: nextPatch.totalAmount };
    if (isDraftId(id)) {
      patchDraft(id, fieldPatch);
      return;
    }
    onChangeLine?.(id, fieldPatch);
  };

  const handleArrowDownPastEnd = () => {
    // 最末列若已是空白草稿 → 不再新增（禁止無限空列）
    const last = displayLines[displayLines.length - 1];
    if (last && isDraftId(last.id) && !draftHasContent(last)) {
      setSel(displayLines.length - 1);
      return;
    }
    appendDraftRow();
  };

  return (
    <section
      className="flex h-full flex-col overflow-hidden border p-0"
      style={{
        background: HIS.rxBg,
        borderColor: HIS.chromeBorder,
        borderWidth: 1,
        outline: active ? "1px solid #000080" : undefined,
        outlineOffset: -1,
        fontFamily: HIS_FONT,
      }}
      onMouseDown={() => onActivate?.()}
      onKeyDown={(e) => {
        // 區已啟動且焦點在 section（非 input）時也能逐步換列
        if (e.target !== e.currentTarget) return;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const from = sel;
          if (e.key === "ArrowUp") {
            if (from > 0) setSel(from - 1);
            return;
          }
          if (from >= displayLines.length - 1) {
            handleArrowDownPastEnd();
          } else {
            setSel(from + 1);
          }
        }
      }}
      tabIndex={active ? 0 : -1}
    >
      <div data-rx-scroll className="min-h-0 flex-1 overflow-y-auto" style={{ background: HIS.rxBg }}>
        <RxGrid
          lines={displayLines}
          columns={currentRxColumns}
          readonly={false}
          active={active}
          fontSizePx={HIS.fs.body}
          selectedIndex={sel}
          focusNonce={focusNonce}
          draftIds={new Set(drafts.map((d) => d.id))}
          suggestHits={active && (editingDraft || coverQuery !== null) ? hits : []}
          suggestActive={pickIdx}
          onSuggestActiveChange={setPickIdx}
          onSelectIndex={(i) => setSel(i)}
          onQualityLab={onQualityLab}
          onChangeLine={handleChangeLine}
          onCommitDraft={(id, suggestIndex, patch) => {
            const d = drafts.find((x) => x.id === id);
            if (d) commitDraft({ ...d, ...patch }, suggestIndex ?? pickIdx);
          }}
          onCoverQuery={setCoverQuery}
          onApplyCover={applyCover}
          onArrowDownPastEnd={handleArrowDownPastEnd}
          usages={usages}
          drugs={catalog?.drugs || []}
          routes={routes}
          onRemove={(id) => {
            const idx = displayLines.findIndex((line) => line.id === id);
            const committed = !isDraftId(id);
            const nextCommitted = committed ? mockCurrentRx.filter((line) => line.id !== id) : mockCurrentRx;
            const nextDrafts = committed
              ? drafts
              : drafts.filter((line) => line.id !== id);
            const draftRows = nextDrafts.length ? nextDrafts : [newDraft()];
            if (committed) setMockCurrentRx(nextCommitted);
            else setDrafts(draftRows);
            const remain = nextCommitted.length + (committed ? drafts.length : draftRows.length);
            const nextIdx = remain > 0 ? Math.min(Math.max(idx, 0), remain - 1) : 0;
            setSel(nextIdx);
          }}
        />
      </div>
      <div
        className="shrink-0 truncate border-t px-1 py-0.5 text-[10px] text-[#404040]"
        style={{ borderColor: HIS.chromeBorder, background: HIS.chrome }}
      >
        {active
          ? "\u55ae\u64ca\u9078\u53d6\uff0cDel \u522a\u9664 \u00b7 \u9078\u4e2d\u5f8c\u76f4\u63a5\u6253\u5b57 \u00b7 \u96d9\u64ca\u8986\u84cb\uff0cEnter \u84cb\u4e0a\uff0c\u2191\u2193 \u6216\u9ede\u5225\u8655\u53d6\u6d88 \u00b7 \u9078\u55ae\u958b\u8457 \u2191\u2193 \u5728\u9078\u55ae\u88e1\u79fb\u52d5"
          : "點此區後再編輯處置"}
      </div>
    </section>
  );
}
