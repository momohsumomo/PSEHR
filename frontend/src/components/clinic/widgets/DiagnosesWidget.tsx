import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogDiagnosis } from "@/types/clinicCatalog";
import type { DiagnosisRow } from "@/mocks/clinicMocks";
import { diagnosisLabel, searchDiagnoses } from "@/utils/catalogSearch";
import { readyIcd9 } from "@/lib/icdCrosswalk";
import { crosswalkDiagnosis, searchDiagnosisCodes } from "@/api/clinicApi";
import { CatalogDropdown } from "@/components/clinic/CatalogDropdown";
import { DiagnosisFinder, type DxChoice } from "@/components/clinic/DiagnosisFinder";
import { Icd10ConditionDialog, IcdShortcutDialog } from "@/components/clinic/IcdBrowseDialogs";
import { HIS, HIS_FONT } from "@/lib/hisTheme";

interface DiagnosesWidgetProps {
  catalog: CatalogDiagnosis[];
  displayDiagnoses: DiagnosisRow[];
  /** 申報診斷格數。滿了就不再長空白列。 */
  maxDiagnoses?: number;
  addDiagnosis: (row: DiagnosisRow) => void | boolean | string;
  onChangeDiagnosis?: (index: number, row: DiagnosisRow) => void | boolean | string;
  historyFontPx: number;
  active?: boolean;
  onActivate?: () => void;
  selectedIndex?: number;
  onSelectIndex?: (index: number) => void;
  onRemove?: (index: number) => void;
  onChiefNote?: (note: string) => void;
  /** @deprecated 右欄篩選改由右欄自己負責；保留相容 */
  query?: string;
  setQuery?: (q: string) => void;
}

type Col = 0 | 1 | 2;
const COLS: Col[] = [0, 1, 2];

function dropSideRow(prev: Record<string, string>, row: number): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(prev)) {
    const [rawRow, rawCol] = key.split(":");
    const at = Number(rawRow);
    if (at === row) continue;
    next[`${at > row ? at - 1 : at}:${rawCol}`] = value;
  }
  return next;
}

function diagnosisKey(row: { nhiIcd10?: string; icd10?: string; text?: string }): string {
  return (row.nhiIcd10 || row.icd10 || row.text || "").trim().toUpperCase();
}

function diagnosisTaken(
  rows: { nhiIcd10?: string; icd10?: string; text?: string }[],
  row: { nhiIcd10?: string; icd10?: string; text?: string },
  except?: number,
): boolean {
  const key = diagnosisKey(row);
  if (!key) return false;
  return rows.some((item, index) => index !== except && diagnosisKey(item) === key);
}

/**
 * 病名區：↑↓ 僅在本區 active 時換列；下拉選病名；最末空白列再 ↓ 才新增（有內容才加）。
 */
export function DiagnosesWidget({
  catalog,
  displayDiagnoses,
  maxDiagnoses = 5,
  addDiagnosis,
  onChangeDiagnosis,
  historyFontPx: _historyFontPx,
  active = false,
  onActivate,
  selectedIndex,
  onSelectIndex,
  onRemove,
  onChiefNote,
  setQuery: _setQuery,
}: DiagnosesWidgetProps) {
  void _historyFontPx;
  void _setQuery;
  const tableRef = useRef<HTMLTableElement>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const [localIdx, setLocalIdx] = useState(0);
  const [focusCol, setFocusCol] = useState<Col>(1);
  const [drafts, setDrafts] = useState<string[]>(() => [""]);
  const [sideDrafts, setSideDrafts] = useState<Record<string, string>>({});
  const [pickIdx, setPickIdx] = useState(0);
  const [handPicked, setHandPicked] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** 只有使用者打字後才開下拉（點選空白列不彈） */
  const [typedInRow, setTypedInRow] = useState<number | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [cover, setCover] = useState<{ row: number; col: Col; text: string } | null>(null);
  const editBackup = useRef<{ key: string; text: string; dx: DiagnosisRow | null } | null>(null);
  const [combo, setCombo] = useState<{
    row: number;
    note: string;
    items: DxChoice[];
  } | null>(null);
  const [finder, setFinder] = useState<{ row: number; query: string } | null>(null);
  const [icd9Open, setIcd9Open] = useState<{ row: number; field: "icd9" | "name"; query: string } | null>(null);
  const [icd10Open, setIcd10Open] = useState<{ row: number; query: string } | null>(null);
  const byCode = useMemo(() => {
    const map = new Map<string, CatalogDiagnosis>();
    for (const item of catalog) {
      for (const key of [item.icd10, item.nhiIcd10, item.short]) {
        const norm = (key || "").replace(/\./g, "").trim().toUpperCase();
        if (norm && !map.has(norm)) map.set(norm, item);
      }
    }
    return map;
  }, [catalog]);
  const icd9For = (row: DiagnosisRow | null): string => {
    if (!row) return "";
    if ((row.icd9 || "").trim()) return row.icd9 || "";
    const key = (row.nhiIcd10 || row.icd10 || "").replace(/\./g, "").trim().toUpperCase();
    const hit = key ? byCode.get(key) : undefined;
    return hit?.icd9 || hit?.aCode || "";
  };
  const writeCatalog = (rowIndex: number, hit: CatalogDiagnosis, query = ""): string => {
    const icd10 = String(hit.icd10 || "").trim();
    const text = diagnosisLabel(hit, query);
    const payload: DiagnosisRow = {
      icd10,
      nhiIcd10: String(hit.nhiIcd10 || icd10).replace(/\./g, ""),
      text,
      icd9: String(hit.icd9 || hit.aCode || "").trim(),
    };
    if (!icd10 && !text) return "這筆沒有可寫入的病名";
    const result =
      rowIndex < displayDiagnoses.length
        ? onChangeDiagnosis?.(rowIndex, payload)
        : addDiagnosis(payload);
    if (typeof result === "string" && result) return result;
    if (result === false) return "沒有寫進病名";
    const nine = String(hit.icd9 || hit.aCode || "").trim();
    if (readyIcd9(nine)) {
      const picked = icd10.replace(/\./g, "").toUpperCase();
      void crosswalkDiagnosis(nine, text)
        .then((mapped) => {
          const mappedCode = (mapped.nhiIcd10 || mapped.icd10 || "").replace(/\./g, "").toUpperCase();
          if (mapped.chiefNote && picked === mappedCode) onChiefNote?.(mapped.chiefNote);
        })
        .catch(() => undefined);
    }
    if (rowIndex >= displayDiagnoses.length) {
      const di = rowIndex - displayDiagnoses.length;
      setDrafts((d) => {
        const next = d.filter((_, i) => i !== di);
        return next.length ? next : [""];
      });
      setSideDrafts((prev) => dropSideRow(prev, rowIndex));
    }
    setIcd9Open(null);
    setIcd10Open(null);
    setEditingKey(null);
    editBackup.current = null;
    setSelectedIdx(rowIndex);
    requestAnimationFrame(() => focusCell(rowIndex, 1));
    return "";
  };

  const selectedIdx = selectedIndex ?? localIdx;
  const setSelectedIdx = (index: number) => {
    if (onSelectIndex) onSelectIndex(index);
    else setLocalIdx(index);
  };

  const totalRows = displayDiagnoses.length + drafts.length;
  const editingDraft = selectedIdx >= displayDiagnoses.length;
  const draftText = editingDraft
    ? drafts[selectedIdx - displayDiagnoses.length] ?? ""
    : "";
  const coverText = cover && cover.row === selectedIdx ? cover.text : "";
  const sideQuery = focusCol === 1 ? "" : sideDrafts[`${selectedIdx}:${focusCol}`] || "";
  const hits = useMemo(() => {
    const q =
      cover && cover.row === selectedIdx && cover.col !== 1
        ? cover.text
        : sideQuery
          ? sideQuery
          : editingDraft
            ? draftText
            : coverText;
    return q.trim() ? searchDiagnoses(catalog, q, 12) : [];
  }, [catalog, cover, coverText, draftText, editingDraft, selectedIdx, sideQuery]);

  useEffect(() => {
    if (displayDiagnoses.length >= maxDiagnoses) {
      setDrafts([]);
      return;
    }
    setDrafts((prev) => (prev.length === 0 ? [""] : prev));
  }, [displayDiagnoses.length, maxDiagnoses]);

  useEffect(() => {
    if (!cover) return;
    const onDown = (ev: MouseEvent) => {
      const t = ev.target;
      if (t instanceof Node && tableRef.current?.contains(t)) return;
      if (t instanceof Element && t.closest("[role='listbox']")) return;
      setCover(null);
      setEditingKey(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [cover]);

  useEffect(() => {
    setPickIdx(0);
    setHandPicked(false);
    const allow =
      hits.length > 0 &&
      ((editingDraft && typedInRow === selectedIdx && (draftText.trim().length > 0 || sideQuery.trim().length > 0)) ||
        coverText.trim().length > 0);
    setMenuOpen(allow);
  }, [draftText, hits.length, editingDraft, typedInRow, selectedIdx, coverText, sideQuery]);

  useEffect(() => {
    // 換列時關掉下拉，等再打字
    setTypedInRow(null);
    setMenuOpen(false);
  }, [selectedIdx]);

  useEffect(() => {
    if (!active) {
      setMenuOpen(false);
      setEditingKey(null);
      return;
    }
    const id = requestAnimationFrame(() => focusCell(selectedIdx, focusCol));
    return () => cancelAnimationFrame(id);
  }, [active, selectedIdx, focusCol, displayDiagnoses.length, drafts.length]);

  const focusCell = (row: number, col: Col) => {
    const el = tableRef.current?.querySelector<HTMLInputElement>(
      `input[data-dx-row="${row}"][data-dx-col="${col}"]`,
    );
    el?.focus();
    if (col === 1 && el) nameInputRef.current = el;
  };

  const appendBlankIfNeeded = () => {
    if (displayDiagnoses.length >= maxDiagnoses) {
      return Math.max(displayDiagnoses.length - 1, 0);
    }
    const last = drafts[drafts.length - 1] ?? "";
    if (last.trim()) {
      setDrafts((d) => [...d, ""]);
      return displayDiagnoses.length + drafts.length;
    }
    return displayDiagnoses.length + drafts.length - 1;
  };

  const commitPlain = (payload: DiagnosisRow, row: number, note?: string) => {
    if (!(payload.icd10 || payload.nhiIcd10 || "").trim()) {
      setMenuOpen(false);
      setFinder({ row, query: payload.text || "" });
      return;
    }
    if (note) onChiefNote?.(note);
    if (diagnosisTaken(displayDiagnoses, payload, row < displayDiagnoses.length ? row : undefined)) {
      setCombo(null);
      if (row < displayDiagnoses.length) onChangeDiagnosis?.(row, payload);
      else addDiagnosis(payload);
      return;
    }
    if (row < displayDiagnoses.length) {
      onChangeDiagnosis?.(row, payload);
    } else {
      addDiagnosis(payload);
      const di = row - displayDiagnoses.length;
      setDrafts((d) => {
        const next = d.filter((_, i) => i !== di);
        return next.length ? next : [""];
      });
      setSideDrafts((prev) => dropSideRow(prev, row));
    }
    setMenuOpen(false);
    setCombo(null);
    setEditingKey(null);
    setCover(null);
    editBackup.current = null;
    const adding = row >= displayDiagnoses.length;
    const roomForNext = displayDiagnoses.length + 1 < maxDiagnoses;
    const nextRow = adding
      ? roomForNext
        ? row + 1
        : row
      : Math.min(row + 1, Math.max(totalRows - 1, 0));
    if (adding) setFocusCol(1);
    setSelectedIdx(nextRow);
    requestAnimationFrame(() => focusCell(nextRow, adding ? 1 : focusCol));
  };

  const askIcd10 = (row: number, query: string) => {
    setMenuOpen(false);
    setFinder({ row, query });
  };

  const commitMapped = (payload: DiagnosisRow, row: number) => {
    const ten = (payload.icd10 || payload.nhiIcd10 || "").trim();
    const nine = (payload.icd9 || "").trim();
    const asNine = readyIcd9(ten) ? ten : readyIcd9(nine) ? nine : "";
    if (ten && !asNine) {
      commitPlain(payload, row);
      return;
    }
    void (async () => {
      try {
        if (!asNine) {
          const found = await searchDiagnosisCodes(payload.text || "");
          const top = found[0];
          const items = (top
            ? [
                { icd10: top.icd10, nhiIcd10: top.nhiIcd10, text: top.title || top.name || payload.text || top.icd10 },
                ...(top.secondary || []).map((sec) => ({
                  icd10: sec.icd10,
                  nhiIcd10: sec.nhiIcd10,
                  text: sec.title || sec.icd10,
                })),
              ]
            : []
          ).filter((item) => item.icd10);
          const unique = items.filter((item, index) => items.findIndex((prev) => prev.icd10 === item.icd10) === index);
          if (unique.length > 1) {
            setMenuOpen(false);
            setFinder(null);
            setCombo({ row, note: "", items: unique });
            return;
          }
          if (unique.length === 1) {
            commitPlain(
              {
                icd10: unique[0].icd10,
                nhiIcd10: unique[0].nhiIcd10 || unique[0].icd10.replace(/\./g, ""),
                text: payload.text?.trim() || unique[0].text,
                icd9: found[0]?.icd9 || nine,
              },
              row,
            );
            return;
          }
          askIcd10(row, payload.text || "");
          return;
        }
        const mapped = await crosswalkDiagnosis(asNine, payload.text);
        const items = [
          {
            icd10: mapped.icd10,
            nhiIcd10: mapped.nhiIcd10,
            text: payload.text?.trim() || mapped.title || mapped.icd10,
          },
          ...(mapped.secondary || []).map((sec) => ({
            icd10: sec.icd10,
            nhiIcd10: sec.nhiIcd10,
            text: sec.title || sec.icd10,
          })),
        ].filter((item) => item.icd10);
        if (items.length > 1) {
          setMenuOpen(false);
          setFinder(null);
          setCombo({ row, note: mapped.chiefNote || "", items });
          return;
        }
        const one = items[0];
        if (!one) {
          askIcd10(row, payload.text || asNine);
          return;
        }
        commitPlain(
          {
            icd10: one.icd10,
            nhiIcd10: one.nhiIcd10 || one.icd10.replace(/\./g, ""),
            text: one.text,
            icd9: nine || asNine,
          },
          row,
          mapped.chiefNote || "",
        );
      } catch {
        askIcd10(row, payload.text || asNine);
      }
    })();
  };

  const commitMany = (payloads: DxChoice[], row: number, note?: string) => {
    const unique: DxChoice[] = [];
    for (const item of payloads) {
      if (!item.icd10) continue;
      if (unique.some((prev) => diagnosisKey(prev) === diagnosisKey(item))) continue;
      unique.push(item);
    }
    if (!unique.length) {
      setCombo(null);
      setFinder(null);
      return;
    }
    const [first, ...rest] = unique;
    commitPlain(
      {
        icd10: first.icd10,
        nhiIcd10: first.nhiIcd10 || first.icd10.replace(/\./g, ""),
        text: first.text,
      },
      row,
      note,
    );
    for (const extra of rest) {
      addDiagnosis({
        icd10: extra.icd10,
        nhiIcd10: extra.nhiIcd10 || extra.icd10.replace(/\./g, ""),
        text: extra.text,
      });
    }
    setFinder(null);
  };

  const commitHit = (hit: CatalogDiagnosis, row: number, query = "") => {
    commitMapped(
      {
        icd10: hit.icd10,
        nhiIcd10: hit.nhiIcd10 || hit.icd10,
        text: diagnosisLabel(hit, query),
        icd9: hit.icd9 || hit.aCode || "",
      },
      row,
    );
  };

  const moveRow = (from: number, dir: -1 | 1, ignoreMenu = false) => {
    if (!active) return;
    if (combo || finder) return;
    if (
      !ignoreMenu &&
      menuOpen &&
      hits.length > 0 &&
      (editingDraft || !!cover) &&
      (focusCol === 1 || cover?.col === focusCol)
    ) {
      if (dir === 1) setPickIdx((i) => Math.min(i + 1, hits.length - 1));
      else setPickIdx((i) => Math.max(i - 1, 0));
      setHandPicked(true);
      return;
    }
    const next = from + dir;
    if (next < 0) return;
    if (next >= totalRows) {
      if (dir !== 1) return;
      if (displayDiagnoses.length >= maxDiagnoses) return;
      const lastDraft = drafts[drafts.length - 1] ?? "";
      if (!lastDraft.trim() && from === totalRows - 1) {
        setSelectedIdx(totalRows - 1);
        focusCell(totalRows - 1, focusCol);
        return;
      }
      const ni = appendBlankIfNeeded();
      setSelectedIdx(ni);
      requestAnimationFrame(() => focusCell(ni, focusCol));
      return;
    }
    setSelectedIdx(next);
    focusCell(next, focusCol);
  };

  const onNav = (e: React.KeyboardEvent<HTMLInputElement>, row: number, col: Col) => {
    if (!active && (e.key === "ArrowUp" || e.key === "ArrowDown")) return;
    const key = e.key;
    if (key === "Escape") {
      setMenuOpen(false);
      return;
    }
    if (key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      moveRow(row, 1);
      return;
    }
    if (key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      moveRow(row, -1);
      return;
    }
    if (key === "ArrowRight" || (key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      if (col < 2) {
        setFocusCol((col + 1) as Col);
        focusCell(row, (col + 1) as Col);
      } else if (row + 1 < totalRows) {
        setSelectedIdx(row + 1);
        setFocusCol(0);
        focusCell(row + 1, 0);
      }
      return;
    }
    if (key === "ArrowLeft" || (key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      if (col > 0) {
        setFocusCol((col - 1) as Col);
        focusCell(row, (col - 1) as Col);
      } else if (row > 0) {
        setSelectedIdx(row - 1);
        setFocusCol(2);
        focusCell(row - 1, 2);
      }
      return;
    }
    if (key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (combo || finder) return;
      const typed =
        cover && cover.row === row
          ? cover.text
          : col !== 1 && sideDrafts[`${row}:${col}`]
            ? sideDrafts[`${row}:${col}`]
            : editingDraft
            ? draftText
            : row < displayDiagnoses.length
              ? col === 0
                ? displayDiagnoses[row]?.icd9 || ""
                : col === 2
                  ? displayDiagnoses[row]?.icd10 || displayDiagnoses[row]?.nhiIcd10 || ""
                  : displayDiagnoses[row]?.text || ""
              : drafts[row - displayDiagnoses.length] || "";
      const query = typed.trim();
      if (handPicked && hits[pickIdx] && (editingDraft || (cover && cover.row === row))) {
        commitHit(hits[pickIdx], row, query);
        setCover(null);
        return;
      }
      if (query) {
        setMenuOpen(false);
        setCover(null);
        if (col === 2) setIcd10Open({ row, query });
        else setIcd9Open({ row, field: col === 0 ? "icd9" : "name", query });
        return;
      }
      if (!readyIcd9(query)) {
        if (row < displayDiagnoses.length) {
          setEditingKey(null);
          editBackup.current = null;
          const next = Math.min(row + 1, Math.max(totalRows - 1, 0));
          setSelectedIdx(next);
          requestAnimationFrame(() => focusCell(next, col));
        }
      }
    }
  };

  const ddItems = hits.map((h, i) => ({
    key: `${h.icd10}-${i}-${h.text}`,
    primary: diagnosisLabel(h, editingDraft ? draftText : coverText),
    secondary: h.icd10 || h.short || "",
  }));

  return (
    <section
      className="flex h-full flex-col overflow-hidden border p-0"
      style={{
        background: HIS.dxBg,
        borderColor: HIS.chromeBorder,
        borderWidth: 1,
        outline: active ? "1px solid #006600" : undefined,
        outlineOffset: -1,
        fontFamily: HIS_FONT,
      }}
      onMouseDown={(e) => {
        onActivate?.();
        if (!cover) return;
        const t = e.target;
        if (t instanceof Node && tableRef.current?.contains(t)) return;
        setCover(null);
        setEditingKey(null);
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table
          ref={tableRef}
          className="w-full border-collapse text-left leading-none"
          style={{ fontFamily: HIS_FONT, fontSize: 11 }}
        >
          <thead>
            <tr style={{ background: "#D8D4C8" }}>
              <th
                className="border py-0 px-0.5 font-bold"
                style={{ borderColor: "#A0A0A0", width: "3.5rem", fontSize: 11 }}
                title={"\u96d9\u64ca\u627e\u75c5\u540d"}
                onDoubleClick={() => setIcd9Open({ row: selectedIdx, field: "icd9", query: "" })}
              >
                ICD-9
              </th>
              <th
                className="border py-0 px-0.5 font-bold"
                style={{ borderColor: "#A0A0A0", fontSize: 11 }}
                title={"\u96d9\u64ca\u627e\u75c5\u540d"}
                onDoubleClick={() => setIcd9Open({ row: selectedIdx, field: "name", query: "" })}
              >
                {"\u75c5\u540d"}
              </th>
              <th
                className="border py-0 px-0.5 font-bold"
                style={{ borderColor: "#A0A0A0", width: "3.5rem", fontSize: 11 }}
                onDoubleClick={() => setIcd10Open({ row: selectedIdx, query: "" })}
              >
                icd10
              </th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: totalRows }, (_, row) => {
              const isCommitted = row < displayDiagnoses.length;
              const d = isCommitted ? displayDiagnoses[row] : null;
              const draftVal = !isCommitted ? drafts[row - displayDiagnoses.length] ?? "" : "";
              const sel = row === selectedIdx;
              const cellBg = sel ? "#E5F6E3" : HIS.dxBg;
              const preview = !isCommitted && draftVal && sel && hits[pickIdx] ? hits[pickIdx] : null;
              const side9 = sideDrafts[`${row}:0`] || "";
              const side10 = sideDrafts[`${row}:2`] || "";
              const values = isCommitted
                ? [icd9For(d), d?.text || "", d?.icd10 || d?.nhiIcd10 || ""]
                : [side9 || preview?.icd9 || preview?.aCode || "", draftVal, side10 || preview?.icd10 || ""];

              return (
                <tr
                  key={isCommitted ? d?.id || `dx-${row}` : `blank-${row}`}
                  style={{ background: cellBg, color: "#000" }}
                >
                  {COLS.map((col) => {
                    return (
                      <td
                        key={col}
                        className="border py-0 px-0.5"
                        style={{
                          borderColor: "#A0A0A0",
                          fontSize: col === 1 ? 12 : 11,
                          background: sel && focusCol === col ? "#C6EBC2" : undefined,
                          outline: sel && focusCol === col ? "1px solid #3C8C40" : undefined,
                          outlineOffset: -2,
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          onActivate?.();
                          const key = `${row}:${col}`;
                          if (cover && (cover.row !== row || cover.col !== col)) {
                            setCover(null);
                            setEditingKey(null);
                          } else if (editingKey && editingKey !== key) {
                            const bak = editBackup.current;
                            if (bak && !bak.dx) {
                              const from = Number(bak.key.split(":")[0]);
                              const di = from - displayDiagnoses.length;
                              if (di >= 0) {
                                setDrafts((prev) => {
                                  const next = [...prev];
                                  next[di] = bak.text;
                                  return next;
                                });
                              }
                            } else if (bak?.dx) {
                              const from = Number(bak.key.split(":")[0]);
                              onChangeDiagnosis?.(from, bak.dx);
                            }
                            editBackup.current = null;
                            setEditingKey(null);
                          }
                          setSelectedIdx(row);
                          setFocusCol(col);
                        }}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedIdx(row);
                          setFocusCol(col);
                          setMenuOpen(false);
                          const shown = (
                            cover && cover.row === row && cover.col === col
                              ? cover.text
                              : String(values[col] || "")
                          ).trim();
                          if (col === 2) {
                            setIcd10Open({ row, query: shown });
                            return;
                          }
                          setIcd9Open({ row, field: col === 0 ? "icd9" : "name", query: shown });
                        }}
                      >
                        <input
                          ref={
                            col === 1 && sel
                              ? (el) => {
                                  nameInputRef.current = el;
                                }
                              : undefined
                          }
                          data-dx-row={row}
                          data-dx-col={col}
                          className="w-full border-0 bg-transparent px-0.5 py-0 outline-none"
                          style={{
                            fontSize: col === 1 ? 12 : 11,
                            height: 18,
                            fontFamily: HIS_FONT,
                            fontWeight: col === 1 ? 700 : 400,
                            background: sel && focusCol === col ? "#C6EBC2" : "transparent",
                            color: sel && focusCol === col ? "#111" : HIS.inputBlue,
                            cursor: editingKey === `${row}:${col}` ? "text" : "default",
                            caretColor: editingKey === `${row}:${col}` ? undefined : "transparent",
                          }}
                          value={
                            cover && cover.row === row && cover.col === col ? cover.text : values[col]
                          }
                          readOnly={editingKey !== `${row}:${col}`}
                          onFocus={() => {
                            setSelectedIdx(row);
                            setFocusCol(col);
                          }}
                          onKeyDown={(e) => {
                            const editing = editingKey === `${row}:${col}`;
                            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                              e.preventDefault();
                              e.stopPropagation();
                              const picking =
                                editing &&
                                menuOpen &&
                                hits.length > 0 &&
                                (col === 1 || (cover?.row === row && cover.col === col));
                              if (picking) {
                                moveRow(row, e.key === "ArrowDown" ? 1 : -1);
                                return;
                              }
                              if (cover && cover.row === row && cover.col === col) {
                                setCover(null);
                                setEditingKey(null);
                                setMenuOpen(false);
                                moveRow(row, e.key === "ArrowDown" ? 1 : -1, true);
                                return;
                              }
                              if (editing) {
                                const bak = editBackup.current;
                                if (bak && bak.key === `${row}:${col}`) {
                                  if (isCommitted && bak.dx) onChangeDiagnosis?.(row, bak.dx);
                                  else if (!isCommitted) {
                                    const di = row - displayDiagnoses.length;
                                    const text = bak.text;
                                    setDrafts((prev) => {
                                      const next = [...prev];
                                      next[di] = text;
                                      return next;
                                    });
                                  }
                                }
                                editBackup.current = null;
                                setEditingKey(null);
                                setMenuOpen(false);
                              }
                              moveRow(row, e.key === "ArrowDown" ? 1 : -1, true);
                              return;
                            }
                            if (!editing && e.key === "Delete") {
                              e.preventDefault();
                              e.stopPropagation();
                              if (isCommitted) {
                                onRemove?.(row);
                                const remain = Math.max(0, displayDiagnoses.length - 1 + drafts.length);
                                const next = Math.min(row, Math.max(0, remain - 1));
                                setSelectedIdx(next);
                                requestAnimationFrame(() => focusCell(next, col));
                              } else {
                                const di = row - displayDiagnoses.length;
                                const nextCount = Math.max(1, drafts.length - 1);
                                const remain = displayDiagnoses.length + nextCount;
                                const next = Math.min(row, Math.max(0, remain - 1));
                                setDrafts((prev) => {
                                  const nextRows = prev.filter((_, i) => i !== di);
                                  return nextRows.length ? nextRows : [""];
                                });
                                setSideDrafts((prev) => dropSideRow(prev, row));
                                setSelectedIdx(next);
                              }
                              return;
                            }
                            if (
                              !editing &&
                              e.key.length === 1 &&
                              !e.ctrlKey &&
                              !e.metaKey &&
                              !e.altKey
                            ) {
                              e.preventDefault();
                              const key = `${row}:${col}`;
                              const shown = String(values[col] || "");
                              if (editBackup.current?.key !== key) {
                                editBackup.current = {
                                  key,
                                  text: isCommitted ? shown : drafts[row - displayDiagnoses.length] ?? "",
                                  dx: isCommitted && d ? { ...d } : null,
                                };
                              }
                              setEditingKey(key);
                              setTypedInRow(row);
                              const v = e.key;
                              if (shown.trim()) {
                                setCover({ row, col, text: v });
                                return;
                              }
                              if (!isCommitted && col !== 1) {
                                setSideDrafts((prev) => ({ ...prev, [`${row}:${col}`]: v }));
                                return;
                              }
                              if (isCommitted && d) {
                                if (col === 0) onChangeDiagnosis?.(row, { ...d, icd9: v });
                                else if (col === 1) onChangeDiagnosis?.(row, { ...d, text: v });
                                else onChangeDiagnosis?.(row, { ...d, icd10: v });
                                return;
                              }
                              const di = row - displayDiagnoses.length;
                              setDrafts((prev) => {
                                const next = [...prev];
                                next[di] = v;
                                return next;
                              });
                              return;
                            }
                            if (editing) onNav(e, row, col);
                          }}
                          onChange={(e) => {
                            if (editingKey !== `${row}:${col}`) return;
                            const v = e.target.value;
                            if (cover && cover.row === row && cover.col === col) {
                              setCover({ row, col, text: v });
                              setTypedInRow(row);
                              return;
                            }
                            setTypedInRow(row);
                            if (!isCommitted && col !== 1) {
                              setSideDrafts((prev) => ({ ...prev, [`${row}:${col}`]: v }));
                              return;
                            }
                            if (isCommitted) {
                              if (col === 1) {
                                onChangeDiagnosis?.(row, { ...d!, text: v });
                              } else if (col === 0) {
                                onChangeDiagnosis?.(row, { ...d!, icd9: v });
                              } else {
                                onChangeDiagnosis?.(row, { ...d!, icd10: v });
                              }
                              return;
                            }
                            const di = row - displayDiagnoses.length;
                            setDrafts((prev) => {
                              const next = [...prev];
                              next[di] = v;
                              return next;
                            });
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {icd9Open ? (
        <IcdShortcutDialog
          catalog={catalog}
          field={icd9Open.field}
          query={icd9Open.query}
          onClose={() => setIcd9Open(null)}
          onPick={(hit, query) => writeCatalog(icd9Open.row, hit, query)}
          onBrowseChapters={() => {
            const row = icd9Open.row;
            setIcd9Open(null);
            setFinder({ row, query: "" });
          }}
        />
      ) : null}
      {icd10Open ? (
        <Icd10ConditionDialog
          catalog={catalog}
          query={icd10Open.query}
          onClose={() => setIcd10Open(null)}
          onPick={(hit, query) => writeCatalog(icd10Open.row, hit, query)}
        />
      ) : null}
      <DiagnosisFinder
        open={combo != null || finder != null}
        catalog={catalog}
        initialQuery={finder?.query || ""}
        preset={combo ? { note: combo.note, items: combo.items } : null}
        onClose={() => {
          setCombo(null);
          setFinder(null);
        }}
        onCommit={(rows, note) => {
          const row = combo?.row ?? finder?.row ?? selectedIdx;
          commitMany(rows, row, note);
          setCombo(null);
        }}
      />
      <CatalogDropdown
        open={active && menuOpen && editingDraft && combo == null && finder == null}
        anchorEl={nameInputRef.current}
        items={ddItems}
        activeIndex={pickIdx}
        onActiveIndexChange={setPickIdx}
        onPick={(i) => {
          if (hits[i]) commitHit(hits[i], selectedIdx, draftText);
        }}
      />
    </section>
  );
}
