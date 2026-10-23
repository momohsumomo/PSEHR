import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { UiColumnDef } from "@/types/uiConfig";
import {
  RX_MEMO_MARKS,
  RX_PAY_MARK_HINT,
  RX_PAY_MARKS,
  type RxLine,
  type RxMemoMark,
  type RxPayMark,
} from "@/mocks/clinicMocks";
import { CatalogDropdown } from "@/components/clinic/CatalogDropdown";
import { RxDetailSheet } from "@/components/clinic/IcdBrowseDialogs";
import { HIS, HIS_FONT } from "@/lib/hisTheme";
import type { CatalogDrug } from "@/types/clinicCatalog";
import {
  DEFAULT_DAY_PICKS,
  DEFAULT_QTY_PICKS,
  DEFAULT_ROUTE_PICKS,
  computeTotalAmount,
  usageCalcLabel,
  withComputedTotal,
  type CatalogUsage,
} from "@/utils/rxTotal";

type CatalogHit = {
  customName: string;
  nhiCode: string;
  drugNo?: string;
  alias?: string;
  shortName?: string;
};

type Props = {
  lines: RxLine[];
  columns: UiColumnDef[];
  readonly?: boolean;
  /** Only handle ArrowUp/Down when this pane is active */
  active?: boolean;
  fontSizePx?: number;
  onRemove?: (id: string) => void;
  onDitto?: (line: RxLine) => void;
  onChangeLine?: (id: string, patch: Partial<RxLine>) => void;
  onArrowDownPastEnd?: () => void;
  onCommitDraft?: (id: string, suggestIndex?: number, patch?: Partial<RxLine> | null) => void;
  /** 雙擊既有內容時，打字只停在這一層，還沒按 Enter。null 表示這層收掉。 */
  onCoverQuery?: (text: string | null) => void;
  /** Enter 才把這一層蓋上既有藥品。找不到藥就回 false，舊的不動。 */
  onApplyCover?: (id: string, text: string, suggestIndex?: number) => boolean;
  draftIds?: Set<string>;
  focusNonce?: number;
  suggestHits?: CatalogHit[];
  suggestActive?: number;
  onSuggestActiveChange?: (i: number) => void;
  emptyText?: string;
  selectedIndex?: number;
  onSelectIndex?: (index: number) => void;
  usages?: CatalogUsage[];
  drugs?: CatalogDrug[];
  routes?: string[];
  qtyPicks?: number[];
  dayPicks?: number[];
};

type CtxMenu =
  | { kind: "pay"; lineId: string; rowIdx: number; x: number; y: number }
  | { kind: "memo"; lineId: string; rowIdx: number; x: number; y: number }
  | { kind: "sig"; lineId: string; rowIdx: number; x: number; y: number }
  | { kind: "qty"; lineId: string; rowIdx: number; x: number; y: number }
  | { kind: "route"; lineId: string; rowIdx: number; x: number; y: number }
  | { kind: "days"; lineId: string; rowIdx: number; x: number; y: number };

function resolvedPayMark(line: RxLine): RxPayMark {
  if (line.payMark != null) return line.payMark;
  return line.selfPay ? "\u81ea" : "";
}

function routeLabel(route: RxLine["route"]): string {
  if (!route) return "";
  if (route === "topical") return "ext";
  if (route === "injection") return "im";
  if (route === "oral") return "po";
  if (route === "treatment" || route === "exam" || route === "material") return "ext";
  return String(route);
}

function cellValue(line: RxLine, key: string, usages?: CatalogUsage[]): string {
  switch (key) {
    case "payMark":
      return resolvedPayMark(line);
    case "name":
    case "shortName":
      return key === "shortName" ? line.shortName ?? line.name : line.name;
    case "qty":
      return line.qty != null && Number(line.qty) > 0 ? Number(line.qty).toFixed(2) : "";
    case "sig":
      return line.sig || "";
    case "days":
      return line.days != null && Number(line.days) > 0 ? String(line.days) : "";
    case "nhiCode":
      return line.nhiCode;
    case "selfPay":
      return resolvedPayMark(line) === "\u81ea" || resolvedPayMark(line) === "\u6750" ? "\u81ea" : "";
    case "memo":
      return line.memo ?? "";
    case "route":
      return routeLabel(line.route);
    case "totalAmount":
      return (
        line.totalAmount ||
        computeTotalAmount(line.qty, line.days, line.sig, usages, line.unit) ||
        ""
      );
    case "bodySite":
      return line.bodySite ?? "";
    case "tag":
      return line.tag ?? "";
    default:
      return "";
  }
}

function isPrimaryCol(key: string): boolean {
  return key === "name" || key === "shortName";
}

function isNarrowCol(key: string): boolean {
  return (
    key === "qty" ||
    key === "days" ||
    key === "selfPay" ||
    key === "payMark" ||
    key === "route" ||
    key === "tag" ||
    key === "memo" ||
    key === "totalAmount"
  );
}

function isEditableDraftCol(key: string): boolean {
  return (
    key === "name" ||
    key === "shortName" ||
    key === "qty" ||
    key === "sig" ||
    key === "days" ||
    key === "route"
  );
}

function isPickerCol(key: string): boolean {
  return key === "qty" || key === "sig" || key === "days" || key === "route";
}

function cyclePayMark(current: RxPayMark): RxPayMark {
  const i = RX_PAY_MARKS.indexOf(current);
  return RX_PAY_MARKS[(i + 1) % RX_PAY_MARKS.length] ?? "";
}

function clampMenuPos(x: number, y: number, w: number, h: number) {
  const pad = 4;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(pad, Math.min(x, vw - w - pad));
  const below = vh - y - pad;
  const above = y - pad;
  if (below >= h) return { x: left, y, h };
  if (above >= h) return { x: left, y: Math.max(pad, y - h), h };
  if (below >= above) return { x: left, y, h: Math.max(96, below) };
  const height = Math.max(96, above);
  return { x: left, y: Math.max(pad, y - height), h: height };
}

function patchWithTotal(
  line: RxLine,
  patch: Partial<RxLine>,
  usages?: CatalogUsage[],
): Partial<RxLine> {
  const next = withComputedTotal({ ...line, ...patch }, usages, line.sig);
  return {
    ...patch,
    totalAmount: next.totalAmount,
  };
}

/** Yisheng-style Rx grid: pickers on right-click for qty/route/sig/days */
type BodyPhrase = { code: string; name: string };

const strokeOrder = new Intl.Collator("zh-Hant-u-co-stroke");

function byStroke(a: BodyPhrase, b: BodyPhrase): number {
  const byName = strokeOrder.compare(a.name, b.name);
  if (byName) return byName;
  return strokeOrder.compare(a.code, b.code);
}

function splitSites(value: string): string[] {
  return value.split(/\s+/).map((s) => s.trim()).filter(Boolean);
}

function BodySiteDialog({
  drugName,
  value,
  onClose,
  onApply,
}: {
  drugName: string;
  value: string;
  onClose: () => void;
  onApply: (next: string) => void;
}) {
  const [phrases, setPhrases] = useState<BodyPhrase[]>([]);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>(() => splitSites(value));
  const [typed, setTyped] = useState(value);
  useEffect(() => {
    let cancel = false;
    void fetch("/body_sites.json")
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: BodyPhrase[]) => {
        if (!cancel && Array.isArray(rows)) setPhrases(rows);
      })
      .catch(() => {
        if (!cancel) setPhrases([]);
      });
    return () => {
      cancel = true;
    };
  }, []);
  const q = query.trim();
  const shown = phrases
    .filter((row) => !q || row.name.includes(q) || row.code.includes(q))
    .sort(byStroke);
  const toggle = (name: string) => {
    setPicked((prev) => {
      const next = prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name];
      setTyped(next.join(" "));
      return next;
    });
  };
  const addTyped = () => {
    const text = query.trim();
    if (!text) return;
    setPicked((prev) => {
      const next = prev.includes(text) ? prev : [...prev, text];
      setTyped(next.join(" "));
      return next;
    });
    setQuery("");
  };
  return createPortal(
    <div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/35" onMouseDown={onClose}>
      <div
        className="flex max-h-[80vh] w-[min(36rem,94vw)] flex-col border-2 border-[#003C74] bg-[#F0F0F0] shadow-lg"
        style={{ fontFamily: HIS_FONT }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="bg-[#0A5AD6] px-2 py-1 text-xs font-bold text-white">{"\u90e8\u4f4d\u4f5c\u696d"}</div>
        <div className="px-2 py-1 text-xs font-bold">{drugName || "\u8655\u7f6e"}</div>
        <input
          className="mx-2 min-h-[1.6rem] border bg-white px-1 text-xs"
          value={typed}
          autoFocus
          onChange={(e) => {
            const text = e.target.value;
            setTyped(text);
            setPicked(splitSites(text));
          }}
        />
        <input
          className="mx-2 mt-1 border px-1 text-xs"
          value={query}
          placeholder={"\u641c\u5c0b\u6216\u81ea\u5df1\u6253\uff0cEnter \u52a0\u9032\u4e0a\u9762"}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            addTyped();
          }}
        />
        <div className="m-2 grid min-h-0 flex-1 grid-cols-5 gap-px overflow-auto border border-[#808080] bg-[#808080]">
          {shown.map((row) => {
            const on = picked.includes(row.name);
            return (
              <button
                key={`${row.code}-${row.name}`}
                type="button"
                className="bg-white px-1 py-0.5 text-left text-[12px]"
                style={{ background: on ? "#FFFF80" : "#fff" }}
                onClick={() => toggle(row.name)}
              >
                {row.name}
              </button>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 px-2 py-1">
          <button type="button" className="border bg-[#D4D0C8] px-2 py-0.5 text-xs" onClick={() => setPicked([])}>
            {"\u6e05\u9664"}
          </button>
          <button
            type="button"
            className="border bg-[#D4D0C8] px-2 py-0.5 text-xs font-bold"
            onClick={() => {
              onApply(typed.trim());
              onClose();
            }}
          >
            {"\u78ba\u5b9a"}
          </button>
          <button type="button" className="border bg-[#D4D0C8] px-2 py-0.5 text-xs" onClick={onClose}>
            {"\u95dc\u9589"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function RxGrid({
  lines,
  columns,
  readonly = false,
  active = true,
  fontSizePx = HIS.fs.body,
  onRemove,
  onDitto,
  onChangeLine,
  onArrowDownPastEnd,
  onCommitDraft,
  onCoverQuery,
  onApplyCover,
  draftIds,
  focusNonce = 0,
  suggestHits = [],
  suggestActive = 0,
  onSuggestActiveChange,
  emptyText = "\u2014",
  selectedIndex,
  onSelectIndex,
  usages = [],
  drugs = [],
  routes = DEFAULT_ROUTE_PICKS,
  qtyPicks = DEFAULT_QTY_PICKS,
  dayPicks = DEFAULT_DAY_PICKS,
}: Props) {
  const [menu, setMenu] = useState<CtxMenu | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [siteLineId, setSiteLineId] = useState<string | null>(null);
  /** 單擊只選取。雙擊既有內容才開覆蓋層，Enter 才寫入。 */
  const [editCell, setEditCell] = useState<{ id: string; key: string } | null>(null);
  const [focusCol, setFocusCol] = useState("name");
  const [qtyDraft, setQtyDraft] = useState("");
  const [daysDraft, setDaysDraft] = useState("");
  const daysDraftRef = useRef("");
  const daysEditRef = useRef("");
  const [qtyMenuText, setQtyMenuText] = useState("");
  const [coverOn, setCoverOn] = useState(false);
  const [coverText, setCoverText] = useState("");
  const editOrigin = useRef<RxLine | null>(null);
  const keepOnBlur = useRef(false);
  const armEdit = useRef(false);
  const qtyCancelRef = useRef(false);
  const nameInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const tableRef = useRef<HTMLTableElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const lastFocusNonce = useRef(focusNonce);
  const suggestOpen = active && !readonly && suggestHits.length > 0;
  const routeList = routes.length ? routes : DEFAULT_ROUTE_PICKS;

  useEffect(() => {
    if (!menu) return;
    const insideMenu = (ev: Event) => {
      const t = ev.target;
      return t instanceof Node && !!menuRef.current?.contains(t);
    };
    const close = (ev?: Event) => {
      if (ev && insideMenu(ev)) return;
      setMenu(null);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  useEffect(() => {
    if (!coverOn) return;
    const onDown = (ev: MouseEvent) => {
      const t = ev.target;
      if (t instanceof Node && tableRef.current?.contains(t)) return;
      if (t instanceof Element && t.closest("[role='listbox']")) return;
      cancelCover();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [coverOn]);

  useEffect(() => {
    if (!active) return;
    if (selectedIndex == null || selectedIndex < 0 || selectedIndex >= lines.length) return;
    const line = lines[selectedIndex];
    if (!line) return;
    const nonceBump = lastFocusNonce.current !== focusNonce;
    if (nonceBump) lastFocusNonce.current = focusNonce;
    if (editCell?.id === line.id || coverOn) return;
    const row = rowRefs.current[line.id];
    if (row && document.activeElement !== row) row.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex, focusNonce, active, editCell, lines.length]);

  if (!lines.length) {
    return (
      <p style={{ fontFamily: HIS_FONT, fontSize: HIS.fs.secondary, color: "#808080" }}>
        {emptyText}
      </p>
    );
  }

  const openMenu = (
    kind: CtxMenu["kind"],
    lineId: string,
    rowIdx: number,
    ev: React.MouseEvent,
  ) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (readonly || !onChangeLine) return;
    onSelectIndex?.(rowIdx);
    if (kind === "qty") setQtyMenuText("");
    setMenu({ kind, lineId, rowIdx, x: ev.clientX, y: ev.clientY });
  };

  const lineOfMenu = menu ? lines.find((l) => l.id === menu.lineId) : undefined;

  const applyPay = (mark: RxPayMark) => {
    if (!menu || menu.kind !== "pay" || !onChangeLine || !lineOfMenu) return;
    onChangeLine(
      menu.lineId,
      patchWithTotal(
        lineOfMenu,
        { payMark: mark, selfPay: mark === "\u81ea" || mark === "\u6750" },
        usages,
      ),
    );
    setMenu(null);
  };

  const applyMemo = (mark: RxMemoMark) => {
    if (!menu || menu.kind !== "memo" || !onChangeLine || !lineOfMenu) return;
    onChangeLine(menu.lineId, patchWithTotal(lineOfMenu, { memo: mark }, usages));
    setMenu(null);
  };

  const applyField = (patch: Partial<RxLine>) => {
    if (!menu || !onChangeLine || !lineOfMenu) return;
    onChangeLine(menu.lineId, patchWithTotal(lineOfMenu, patch, usages));
    setMenu(null);
  };

  const beginEdit = (line: RxLine, key: string) => {
    setFocusCol(key);
    if (!(editCell?.id === line.id && editCell.key === key)) {
      editOrigin.current = { ...line };
      if (key === "qty") {
        setQtyDraft(line.qty != null && Number(line.qty) > 0 ? String(line.qty) : "");
      }
      if (key === "days") {
        const shown = line.days != null && Number(line.days) > 0 ? String(line.days) : "";
        daysDraftRef.current = shown;
        daysEditRef.current = line.id;
        setDaysDraft(shown);
      }
    }
    setEditCell({ id: line.id, key });
  };

  const discardEdit = (line: RxLine, key: string) => {
    const origin = editOrigin.current;
    if (!origin || origin.id !== line.id) return;
    if (key === "qty" || key === "days") {
      qtyCancelRef.current = true;
      if (key === "days") daysEditRef.current = "";
      return;
    }
    const back: Partial<RxLine> = {};
    if (key === "name" || key === "shortName") back.name = origin.name;
    else if (key === "sig") back.sig = origin.sig;
    else if (key === "route") back.route = origin.route;
    else return;
    onChangeLine?.(line.id, back);
  };

  const cancelCover = () => {
    setCoverOn(false);
    setCoverText("");
    daysEditRef.current = "";
    onCoverQuery?.(null);
    setEditCell(null);
  };

  const commitDaysEdit = (line: RxLine, text: string): Partial<RxLine> | null => {
    daysEditRef.current = "";
    const raw = text.trim();
    if (raw === "") {
      const patch = patchWithTotal(line, { days: 0 }, usages);
      onChangeLine?.(line.id, patch);
      return patch;
    }
    if (!/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    const patch = patchWithTotal(line, { days: n }, usages);
    onChangeLine?.(line.id, patch);
    return patch;
  };

  const cancelOpenEdit = () => {
    if (!editCell) return;
    if (coverOn) {
      cancelCover();
      return;
    }
    const prev = lines.find((l) => l.id === editCell.id);
    if (prev) discardEdit(prev, editCell.key);
    qtyCancelRef.current = true;
    setEditCell(null);
  };

  const commitQtyEdit = (line: RxLine, text: string): Partial<RxLine> | null => {
    const raw = text.trim();
    if (raw === "" || raw === ".") {
      const patch = patchWithTotal(line, { qty: 0 }, usages);
      onChangeLine?.(line.id, patch);
      return patch;
    }
    if (!/^\d+\.?\d*$|^\d*\.\d+$/.test(raw)) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    const patch = patchWithTotal(line, { qty: n }, usages);
    onChangeLine?.(line.id, patch);
    return patch;
  };

  const menuWidth =
    menu?.kind === "sig" ? 260 : menu?.kind === "memo" ? 220 : menu?.kind === "pay" ? 200 : 120;
  const menuHeight =
    menu?.kind === "sig" ? 360 : menu?.kind === "route" ? 320 : menu?.kind === "memo" ? 280 : 260;
  const menuPos = menu ? clampMenuPos(menu.x, menu.y, menuWidth, menuHeight) : null;

  const moveBy = (dir: -1 | 1, forceRow = false) => {
    if (!active) return;
    if (!forceRow && suggestOpen && onSuggestActiveChange) {
      if (dir === 1) {
        onSuggestActiveChange(Math.min((suggestActive ?? 0) + 1, suggestHits.length - 1));
      } else {
        onSuggestActiveChange(Math.max((suggestActive ?? 0) - 1, 0));
      }
      return;
    }
    const from =
      selectedIndex != null && selectedIndex >= 0 && selectedIndex < lines.length
        ? selectedIndex
        : 0;
    const next = from + dir;
    if (next < 0) return;
    if (next >= lines.length) {
      if (dir === 1) onArrowDownPastEnd?.();
      return;
    }
    onSelectIndex?.(next);
  };

  const selectedLine =
    selectedIndex != null && selectedIndex >= 0 ? lines[selectedIndex] : undefined;
  const anchorNameEl =
    selectedLine && nameInputRefs.current[selectedLine.id]
      ? nameInputRefs.current[selectedLine.id]
      : null;

  const menuTitle =
    menu?.kind === "memo"
      ? "\u7b26\u865f \u4ee3\u8868\u610f\u7fa9\uff08\u8a3b\uff09"
      : menu?.kind === "pay"
        ? "\u7b26\u865f \u4ee3\u8868\u610f\u7fa9\uff08\u8a08\u8cbb\uff09"
        : menu?.kind === "sig"
          ? "\u7528\u6cd5"
          : menu?.kind === "qty"
            ? "\u6578\u91cf"
            : menu?.kind === "route"
              ? "\u9014\u5f91"
              : menu?.kind === "days"
                ? "\u5929\u6578"
                : "";

  return (
    <>
      <table
        ref={tableRef}
        className="w-full border-collapse text-left text-black"
        style={{ fontFamily: HIS_FONT, fontSize: fontSizePx, tableLayout: readonly ? "fixed" : undefined }}
        onKeyDown={(e) => {
          if (!active) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            moveBy(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            moveBy(-1);
          }
        }}
      >
        <thead>
          <tr style={{ background: HIS.rxHeader }}>
            {columns.map((col) => (
              <th
                key={col.key}
                className="border px-0.5 py-0 font-bold leading-none"
                style={{
                  borderColor: HIS.chromeBorder,
                  background: HIS.rxHeader,
                  fontSize: HIS.fs.secondary,
                  maxWidth: col.widthCh ? `${col.widthCh}ch` : undefined,
                  width: isNarrowCol(col.key)
                    ? col.widthCh
                      ? `${col.widthCh}ch`
                      : "2.25rem"
                    : isPrimaryCol(col.key)
                      ? undefined
                      : col.widthCh
                        ? `${col.widthCh}ch`
                        : undefined,
                }}
                title={
                  col.key === "payMark"
                    ? "\u5de6\u9375\u5207\u63db\u8a08\u8cbb\uff1b\u53f3\u9375\u9078\u7b26\u865f"
                    : col.key === "memo"
                      ? "\u53f3\u9375\u9078\u64c7\u8a3b\u8a18\u7b26\u865f"
                      : isPickerCol(col.key)
                        ? "\u53f3\u9375\u958b\u555f\u5feb\u901f\u9078\u55ae"
                        : undefined
                }
              >
                {col.key === "payMark" ? "" : col.label}
              </th>
            ))}
            {!readonly && (onRemove || onDitto) && (
              <th
                className="w-8 border px-0.5 py-0"
                style={{ borderColor: "#A0A0A0", fontSize: HIS.fs.secondary }}
              />
            )}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, rowIdx) => {
            const sel = selectedIndex === rowIdx;
            const isDraft = !!draftIds?.has(line.id);
            return (
              <tr
                key={line.id}
                ref={(el) => {
                  rowRefs.current[line.id] = el;
                }}
                tabIndex={sel ? 0 : -1}
                className="cursor-default leading-none outline-none"
                style={{
                  background: sel ? "#E5F6E3" : rowIdx % 2 ? "#FFFFE0" : HIS.rxBg,
                  color: "#000",
                  height: 20,
                  outline: sel ? "1px solid #808000" : undefined,
                  outlineOffset: -1,
                }}
                onClick={() => {
                  if (editCell && editCell.id !== line.id) cancelOpenEdit();
                  onSelectIndex?.(rowIdx);
                }}
                onKeyDown={(e) => {
                  if (!sel || editCell?.id === line.id) return;
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    e.stopPropagation();
                    moveBy(1);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    e.stopPropagation();
                    moveBy(-1);
                    return;
                  }
                  if (e.key === "Delete") {
                    e.preventDefault();
                    e.stopPropagation();
                    onRemove?.(line.id);
                    return;
                  }
                  if (
                    e.key.length === 1 &&
                    !e.ctrlKey &&
                    !e.metaKey &&
                    !e.altKey &&
                    onChangeLine &&
                    isEditableDraftCol(focusCol)
                  ) {
                    e.preventDefault();
                    e.stopPropagation();
                    editOrigin.current = { ...line };
                    const key = focusCol;
                    if (key === "name" || key === "shortName") {
                      if (isDraft || !(line.name || "").trim()) {
                        onChangeLine(line.id, { name: e.key });
                        setEditCell({ id: line.id, key });
                        onCoverQuery?.(e.key);
                      } else {
                        setCoverOn(true);
                        setCoverText(e.key);
                        setEditCell({ id: line.id, key });
                        onCoverQuery?.(e.key);
                      }
                      return;
                    }
                    if (key === "qty") {
                      if (!/[\d.]/.test(e.key)) return;
                      setQtyDraft(e.key === "." ? "0." : e.key);
                      setCoverOn(false);
                      setEditCell({ id: line.id, key });
                      return;
                    }
                    if (key === "days") {
                      if (!/\d/.test(e.key)) return;
                      const next = daysEditRef.current === line.id ? `${daysDraftRef.current}${e.key}` : e.key;
                      daysEditRef.current = line.id;
                      daysDraftRef.current = next;
                      setDaysDraft(next);
                      setCoverOn(false);
                      setEditCell({ id: line.id, key });
                      return;
                    }
                    if (key === "sig") {
                      onChangeLine(line.id, patchWithTotal(line, { sig: e.key }, usages));
                      setCoverOn(false);
                      setEditCell({ id: line.id, key });
                      return;
                    }
                    if (key === "route") {
                      onChangeLine(line.id, { route: e.key });
                      setCoverOn(false);
                      setEditCell({ id: line.id, key });
                    }
                  }
                }}
              >
                {columns.map((col) => {
                  const primary = isPrimaryCol(col.key);
                  const narrow = isNarrowCol(col.key);
                  const pay = col.key === "payMark";
                  const memo = col.key === "memo";
                  const mark = resolvedPayMark(line);
                  const canEdit =
                    !readonly && !!onChangeLine && isEditableDraftCol(col.key);
                  const editing =
                    !!editCell && editCell.id === line.id && editCell.key === col.key;

                  const cellHot = sel && focusCol === col.key;
                  return (
                    <td
                      key={col.key}
                      className={`border px-0.5 py-0 leading-none ${
                        col.key === "nhiCode" ? "font-mono" : ""
                      }`}
                      style={{
                        borderColor: "#A0A0A0",
                        fontSize: primary ? HIS.fs.body : HIS.fs.secondary,
                        fontWeight: primary || pay ? 700 : 400,
                        maxWidth: col.widthCh ? `${col.widthCh}ch` : undefined,
                        textAlign:
                          pay || memo || narrow || col.key === "totalAmount" ? "center" : undefined,
                        background: cellHot ? "#C6EBC2" : pay && mark ? "#D0D0D0" : undefined,
                        whiteSpace: readonly ? "nowrap" : undefined,
                        overflow: readonly ? "hidden" : undefined,
                        textOverflow: readonly ? "ellipsis" : undefined,
                        cursor: canEdit ? "text" : "default",
                        minWidth: pay || memo ? "1.4rem" : undefined,
                        outline: cellHot ? "1px solid #3C8C40" : undefined,
                        outlineOffset: -2,
                      }}
                      title={
                        pay
                          ? `${mark || "\uff08\u7a7a\u767d\uff09"}\uff1d${RX_PAY_MARK_HINT[mark] ?? "\u5065\u4fdd\u7533\u5831"}`
                          : memo
                            ? `\u8a3b\uff1a${line.memo || "\uff08\u7a7a\u767d\uff09"}\uff08\u53f3\u9375\u9078\u7b26\u865f\uff09`
                            : isPickerCol(col.key)
                              ? "\u53f3\u9375\u958b\u555f\u5feb\u901f\u9078\u55ae"
                              : undefined
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (editCell && (editCell.id !== line.id || editCell.key !== col.key)) {
                          cancelOpenEdit();
                        }
                        onSelectIndex?.(rowIdx);
                        setFocusCol(col.key);
                        rowRefs.current[line.id]?.focus();
                        if (!pay || readonly || !onChangeLine || canEdit) return;
                        const next = cyclePayMark(mark);
                        onChangeLine(
                          line.id,
                          patchWithTotal(
                            line,
                            { payMark: next, selfPay: next === "\u81ea" || next === "\u6750" },
                            usages,
                          ),
                        );
                      }}
                      onDoubleClick={(e) => {
                        if (col.key === "bodySite" && !readonly && onChangeLine) {
                          e.preventDefault();
                          e.stopPropagation();
                          onSelectIndex?.(rowIdx);
                          setSiteLineId(line.id);
                          return;
                        }
                        if (!canEdit) return;
                        e.preventDefault();
                        e.stopPropagation();
                        armEdit.current = true;
                        onSelectIndex?.(rowIdx);
                        const shown = (cellValue(line, col.key, usages) || "").trim();
                        if (shown) {
                          setCoverOn(true);
                          setCoverText("");
                          editOrigin.current = { ...line };
                          setFocusCol(col.key);
                          setEditCell({ id: line.id, key: col.key });
                          onCoverQuery?.(col.key === "name" || col.key === "shortName" ? "" : null);
                          return;
                        }
                        beginEdit(line, col.key);
                      }}
                      onContextMenu={(e) => {
                        if (pay) openMenu("pay", line.id, rowIdx, e);
                        else if (memo) openMenu("memo", line.id, rowIdx, e);
                        else if (col.key === "sig") openMenu("sig", line.id, rowIdx, e);
                        else if (col.key === "qty") openMenu("qty", line.id, rowIdx, e);
                        else if (col.key === "route") openMenu("route", line.id, rowIdx, e);
                        else if (col.key === "days") openMenu("days", line.id, rowIdx, e);
                        else if (col.key === "bodySite") {
                          e.preventDefault();
                          e.stopPropagation();
                          onSelectIndex?.(rowIdx);
                          setSiteLineId(line.id);
                        } else if (col.key === "name" || col.key === "shortName") {
                          e.preventDefault();
                          e.stopPropagation();
                          onSelectIndex?.(rowIdx);
                          setDetailOpen(true);
                        }
                      }}
                    >
                      {editing ? (
                        <input
                          ref={
                            col.key === "name" || col.key === "shortName"
                              ? (el) => {
                                  nameInputRefs.current[line.id] = el;
                                }
                              : undefined
                          }
                          className="w-full border-0 bg-transparent px-0 outline-none"
                          autoFocus
                          style={{
                            height: 18,
                            fontSize: primary ? HIS.fs.body : HIS.fs.secondary,
                            fontFamily: HIS_FONT,
                            fontWeight: primary ? 700 : 400,
                            color: "#111",
                            textAlign: narrow ? "center" : "left",
                            cursor: "text",
                            background: "#C6EBC2",
                          }}
                          value={
                            coverOn
                              ? coverText
                              : col.key === "qty"
                              ? qtyDraft
                              : col.key === "days"
                                ? daysDraft
                                : col.key === "sig"
                                  ? line.sig || ""
                                  : col.key === "route"
                                    ? routeLabel(line.route)
                                    : line.name
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            if (coverOn) {
                              setCoverText(v);
                              if (col.key === "name" || col.key === "shortName") onCoverQuery?.(v);
                              return;
                            }
                            if (col.key === "qty") {
                              if (v === "" || /^\d*\.?\d*$/.test(v)) setQtyDraft(v);
                              return;
                            }
                            if (col.key === "days") {
                              if (v === "" || /^\d+$/.test(v)) {
                                daysDraftRef.current = v;
                                daysEditRef.current = line.id;
                                setDaysDraft(v);
                              }
                            } else if (col.key === "sig") {
                              onChangeLine?.(
                                line.id,
                                patchWithTotal(line, { sig: v }, usages),
                              );
                            } else if (col.key === "route") {
                              onChangeLine?.(line.id, { route: v });
                            } else {
                              onChangeLine?.(line.id, { name: v });
                              onCoverQuery?.(v);
                            }
                          }}
                          onFocus={(e) => {
                            onSelectIndex?.(rowIdx);
                            if (col.key === "qty" && !coverOn) e.currentTarget.select();
                          }}
                          onBlur={(e) => {
                            if (keepOnBlur.current) {
                              keepOnBlur.current = false;
                              return;
                            }
                            if (armEdit.current) {
                              const el = e.currentTarget;
                              requestAnimationFrame(() => {
                                armEdit.current = false;
                                if (document.contains(el) && document.activeElement !== el) el.focus();
                              });
                              return;
                            }
                            if (coverOn) {
                              if (col.key === "qty" && coverText.trim() && coverText.trim() !== ".") {
                                commitQtyEdit(line, coverText);
                              } else if (col.key === "days" && /^\d+$/.test(coverText.trim())) {
                                commitDaysEdit(line, coverText);
                              }
                              cancelCover();
                              return;
                            }
                            if (col.key === "qty") {
                              commitQtyEdit(line, qtyDraft);
                              setEditCell((cur) =>
                                cur?.id === line.id && cur.key === "qty" ? null : cur,
                              );
                              return;
                            }
                            if (col.key === "days") {
                              commitDaysEdit(line, daysDraftRef.current || daysDraft);
                              setEditCell((cur) =>
                                cur?.id === line.id && cur.key === "days" ? null : cur,
                              );
                              return;
                            }
                            discardEdit(line, col.key);
                            setEditCell((cur) =>
                              cur?.id === line.id && cur.key === col.key ? null : cur,
                            );
                          }}
                          onKeyDown={(e) => {
                            if (!active) return;
                            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                              e.preventDefault();
                              e.stopPropagation();
                              const picking =
                                (col.key === "name" || col.key === "shortName") &&
                                suggestOpen &&
                                (isDraft || coverOn);
                              if (picking) {
                                moveBy(e.key === "ArrowDown" ? 1 : -1);
                                return;
                              }
                              keepOnBlur.current = true;
                              if (coverOn) cancelCover();
                              else discardEdit(line, col.key);
                              setEditCell(null);
                              moveBy(e.key === "ArrowDown" ? 1 : -1, true);
                              return;
                            }
                            if (e.key === "Enter") {
                              e.preventDefault();
                              e.stopPropagation();
                              keepOnBlur.current = true;
                              if (coverOn) {
                                const text = coverText.trim();
                                let applied = true;
                                if (!text) applied = false;
                                else if (col.key === "name" || col.key === "shortName") {
                                  applied = onApplyCover?.(line.id, text, suggestActive) === true;
                                } else if (col.key === "qty") {
                                  commitQtyEdit(line, text);
                                } else if (col.key === "days") {
                                  commitDaysEdit(line, text);
                                } else if (col.key === "sig") {
                                  onChangeLine?.(
                                    line.id,
                                    patchWithTotal(line, { sig: text }, usages),
                                  );
                                } else if (col.key === "route") {
                                  onChangeLine?.(line.id, { route: text });
                                }
                                if (!applied && text && (col.key === "name" || col.key === "shortName")) {
                                  keepOnBlur.current = false;
                                  return;
                                }
                                cancelCover();
                                return;
                              }
                              const qtyPatch =
                                col.key === "qty" ? commitQtyEdit(line, qtyDraft) : null;
                              if (col.key === "days") commitDaysEdit(line, daysDraftRef.current || daysDraft);
                              setEditCell(null);
                              if (isDraft) onCommitDraft?.(line.id, undefined, qtyPatch ?? undefined);
                            }
                            if (e.key === "Escape") {
                              keepOnBlur.current = true;
                              if (coverOn) cancelCover();
                              else {
                                qtyCancelRef.current = true;
                                discardEdit(line, col.key);
                                setEditCell(null);
                              }
                              onSuggestActiveChange?.(0);
                            }
                          }}
                        />
                      ) : (
                        cellValue(line, col.key, usages)
                      )}
                    </td>
                  );
                })}
                {!readonly && (onRemove || onDitto) && (
                  <td
                    className="border px-0.5 py-0"
                    style={{ borderColor: "#A0A0A0", fontSize: HIS.fs.tertiary }}
                  >
                    {onRemove && (
                      <button
                        type="button"
                        className="hover:underline"
                        style={{ color: "#CC0000" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemove(line.id);
                        }}
                      >
                        {"\u522a"}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      <CatalogDropdown
        open={
          suggestOpen &&
          !!selectedLine &&
          (!!draftIds?.has(selectedLine.id) ||
            (coverOn && (editCell?.key === "name" || editCell?.key === "shortName")))
        }
        anchorEl={anchorNameEl}
        items={suggestHits.map((h, i) => ({
          key: `${h.nhiCode}-${h.drugNo ?? i}-${h.customName}`,
          primary: h.customName,
          secondary: [h.alias || h.shortName, h.nhiCode].filter(Boolean).join(" \u00b7 "),
        }))}
        activeIndex={suggestActive ?? 0}
        onActiveIndexChange={(i) => onSuggestActiveChange?.(i)}
        onPick={(i) => {
          onSuggestActiveChange?.(i);
          if (selectedLine && draftIds?.has(selectedLine.id)) {
            onCommitDraft?.(selectedLine.id, i);
          }
        }}
      />

      {menu && menuPos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="fixed z-[200] flex flex-col border-2 border-[#003C74] bg-[#ECE9D8] shadow-lg"
              style={{
                left: menuPos.x,
                top: menuPos.y,
                minWidth: menuWidth,
                maxHeight: menuPos.h,
                fontFamily: HIS_FONT,
                fontSize: 12,
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onWheel={(e) => {
                if (e.ctrlKey || e.metaKey) return;
                e.stopPropagation();
                const host = e.target instanceof Element ? e.target.closest("ul") : null;
                if (!(host instanceof HTMLElement)) {
                  e.preventDefault();
                  return;
                }
                const atTop = host.scrollTop <= 0;
                const atBottom = host.scrollTop + host.clientHeight >= host.scrollHeight - 1;
                if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) e.preventDefault();
              }}
            >
              <div
                className="border-b border-[#808080] bg-[#0A5AD6] px-2 py-0.5 font-bold text-white"
                style={{ fontSize: 11 }}
              >
                {menuTitle}
              </div>
              <ul className="min-h-0 flex-1 overflow-auto py-0.5">
                {menu.kind === "memo"
                  ? RX_MEMO_MARKS.map((item) => (
                      <li key={item.mark || "_clear"}>
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-2 py-0.5 text-left hover:bg-[#316AC5] hover:text-white"
                          onClick={() => applyMemo(item.mark)}
                        >
                          <span className="w-5 shrink-0 text-center font-mono font-bold">
                            {item.mark || "\u3000"}
                          </span>
                          <span>{item.hint}</span>
                        </button>
                      </li>
                    ))
                  : menu.kind === "pay"
                    ? RX_PAY_MARKS.map((m) => (
                        <li key={m || "_clear"}>
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 px-2 py-0.5 text-left hover:bg-[#316AC5] hover:text-white"
                            onClick={() => applyPay(m)}
                          >
                            <span className="w-5 shrink-0 text-center font-bold">
                              {m || "\u3000"}
                            </span>
                            <span>{RX_PAY_MARK_HINT[m]}</span>
                          </button>
                        </li>
                      ))
                    : menu.kind === "sig"
                      ? ((usages.length
                          ? usages.filter((u) => String(u.indexFlag || "").toUpperCase() === "Y")
                          : ["QD", "BID", "TID", "QID", "HS", "PRN", "ST"].map((code) => ({
                              code,
                              frequency: 0,
                              isTotal: "",
                            }))
                        ).map((u) => (
                          <li key={u.code}>
                            <button
                              type="button"
                              role="menuitem"
                              className="flex w-full items-center gap-2 px-2 py-0.5 text-left hover:bg-[#316AC5] hover:text-white"
                              onClick={() => applyField({ sig: u.code })}
                            >
                              <span className="w-16 shrink-0 font-mono font-bold">{u.code}</span>
                              <span className="text-[11px] opacity-90">{usageCalcLabel(u)}</span>
                            </button>
                          </li>
                        )))
                      : menu.kind === "qty"
                        ? [
                            <li key="qty-free" className="px-1 py-0.5">
                              <input
                                autoFocus
                                inputMode="decimal"
                                className="w-full border border-[#808080] bg-white px-1 font-mono text-black"
                                placeholder={"\u4efb\u610f\u6578\u91cf"}
                                value={qtyMenuText}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v === "" || /^\d*\.?\d*$/.test(v)) setQtyMenuText(v);
                                }}
                                onKeyDown={(e) => {
                                  e.stopPropagation();
                                  if (e.key === "Escape") {
                                    setMenu(null);
                                    return;
                                  }
                                  if (e.key !== "Enter") return;
                                  e.preventDefault();
                                  const raw = qtyMenuText.trim();
                                  if (raw === "" || raw === ".") return;
                                  const n = Number(raw);
                                  if (Number.isFinite(n) && n >= 0) applyField({ qty: n });
                                }}
                              />
                            </li>,
                            ...qtyPicks.map((q) => (
                              <li key={q}>
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="flex w-full px-3 py-0.5 text-left font-mono hover:bg-[#316AC5] hover:text-white"
                                  onClick={() => applyField({ qty: q })}
                                >
                                  {q.toFixed(2)}
                                </button>
                              </li>
                            )),
                          ]
                        : menu.kind === "route"
                          ? routeList.map((r) => (
                              <li key={r}>
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="flex w-full px-3 py-0.5 text-left font-mono hover:bg-[#316AC5] hover:text-white"
                                  onClick={() => applyField({ route: r })}
                                >
                                  {r}
                                </button>
                              </li>
                            ))
                          : menu.kind === "days"
                            ? dayPicks.map((d) => (
                                <li key={d}>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="flex w-full px-3 py-0.5 text-left font-mono hover:bg-[#316AC5] hover:text-white"
                                    onClick={() => applyField({ days: d })}
                                  >
                                    {d}
                                  </button>
                                </li>
                              ))
                            : null}
              </ul>
            </div>,
            document.body,
          )
        : null}
      {siteLineId && onChangeLine
        ? (
          <BodySiteDialog
            drugName={lines.find((l) => l.id === siteLineId)?.name || ""}
            value={lines.find((l) => l.id === siteLineId)?.bodySite || ""}
            onClose={() => setSiteLineId(null)}
            onApply={(next) => {
              const line = lines.find((l) => l.id === siteLineId);
              if (!line) return;
              onChangeLine(line.id, { bodySite: next });
            }}
          />
        )
        : null}
      {detailOpen ? <RxDetailSheet lines={lines} drugs={drugs} onClose={() => setDetailOpen(false)} /> : null}
    </>
  );
}
