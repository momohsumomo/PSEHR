import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CatalogDiagnosis } from "@/types/clinicCatalog";
import {
  crosswalkDiagnosis,
  fetchDiagnosisCodes,
  fetchDiagnosisGroups,
  searchDiagnosisCodes,
  type DiagnosisSearchHit,
} from "@/api/clinicApi";
import { useEscLayer } from "@/hooks/useEscLayer";
import { useListNav } from "@/hooks/useListNav";
import { HIS_FONT } from "@/lib/hisTheme";

export type DxChoice = { icd10: string; nhiIcd10: string; text: string; en?: string };

type Hit = {
  key: string;
  name: string;
  nameEn?: string;
  detail: string;
  choices: DxChoice[];
  note: string;
  icd9?: string;
};

type Chapter = { id: string; label: string; lo?: number; hi?: number; letter?: string };

const CHAPTERS: Chapter[] = [
  { id: "clinic", label: "\u672c\u9662\u75c5\u540d" },
  { id: "001-139", label: "\u611f\u67d3\u75c5", lo: 1, hi: 139 },
  { id: "140-239", label: "\u816b\u7624", lo: 140, hi: 239 },
  { id: "240-279", label: "\u5167\u5206\u6ccc\u3001\u71df\u990a", lo: 240, hi: 279 },
  { id: "280-289", label: "\u8840\u6db2", lo: 280, hi: 289 },
  { id: "290-319", label: "\u7cbe\u795e", lo: 290, hi: 319 },
  { id: "320-389", label: "\u795e\u7d93\u3001\u773c\u3001\u8033", lo: 320, hi: 389 },
  { id: "390-459", label: "\u5faa\u74b0", lo: 390, hi: 459 },
  { id: "460-519", label: "\u547c\u5438", lo: 460, hi: 519 },
  { id: "520-579", label: "\u6d88\u5316", lo: 520, hi: 579 },
  { id: "580-629", label: "\u6ccc\u5c3f\u3001\u751f\u6b96", lo: 580, hi: 629 },
  { id: "680-709", label: "\u76ae\u819a", lo: 680, hi: 709 },
  { id: "710-739", label: "\u9aa8\u9abc\u808c\u8089", lo: 710, hi: 739 },
  { id: "780-799", label: "\u75c7\u72c0", lo: 780, hi: 799 },
  { id: "800-999", label: "\u640d\u50b7\u3001\u4e2d\u6bd2", lo: 800, hi: 999 },
  { id: "V", label: "\u5065\u5eb7\u72c0\u614b V", letter: "V" },
  { id: "E", label: "\u610f\u5916 E", letter: "E" },
];

type Props = {
  open: boolean;
  catalog: CatalogDiagnosis[];
  initialQuery?: string;
  /** ICD-9 already resolved to two or more ICD-10 codes. */
  preset?: { note: string; items: DxChoice[] } | null;
  onClose: () => void;
  onCommit: (rows: DxChoice[], note: string) => void;
};

const T = {
  title: "\u627e\u75c5\u540d",
  presetTitle: "\u9019\u500b ICD-9 \u5c0d\u5230\u5169\u500b ICD-10",
  searchLabel: "\u4e2d\u6587\u3001\u82f1\u6587\u3001\u7c21\u7a31\u3001ICD-9\u3001ICD-10",
  placeholder: "\u4f8b\u5982\u6bdb\u56ca\u3001\u6fd5\u75b9\u3001H621\u3001704.8\u3001L73",
  empty: "\u6c92\u6709\u7b26\u5408\u7684\u75c5\u540d",
  loading: "\u641c\u5c0b\u4e2d\u2026",
  write: "\u5beb\u5165\u52fe\u9078\u7684",
  both: "\u9019\u7b46\u5169\u500b\u90fd\u5beb\u5165",
  cancel: "\u53d6\u6d88",
  keys: "\u2191\u2193 \u79fb\u52d5\u3000\u7a7a\u767d\u9375\u52fe\u9078\u3000Enter \u5beb\u5165\u3000Esc \u95dc\u9589",
  presetHint: "\u52fe\u4e00\u500b\u6216\u5169\u500b\uff0c\u518d\u5beb\u5165\u3002\u6c92\u52fe\u5230\u7684\u610f\u601d\u6703\u7559\u5728\u4e3b\u8a34\u3002",
  searchHint: "\u5de6\u908a\u5148\u9078\u5206\u985e\uff0c\u4e2d\u9593\u6703\u51fa\u73fe\u75c5\u540d\u3002\u60f3\u5f97\u8d77\u95dc\u9375\u5b57\u518d\u6253\u4e0a\u9762\u7684\u6b04\u4f4d\u3002",
  back: "\u56de\u4e0a\u4e00\u5c64",
  pickGroup: "\u9ede\u4e00\u500b\u5206\u985e\u770b\u88e1\u9762\u7684\u75c5\u540d",
  unresolved: "\u9ede\u9019\u4e00\u5217\u5e36\u51fa ICD-10\uff0c\u518d\u52fe\u9078",
};

function choiceKey(hitKey: string, icd10: string): string {
  return `${hitKey}@@${icd10}`;
}

function hasCjk(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function rankCatalog(items: CatalogDiagnosis[], query: string): CatalogDiagnosis[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const compact = q.replace(/[^a-z0-9]/g, "");
  const scored = items
    .map((item) => {
      const text = (item.text || "").toLowerCase();
      const short = (item.short || "").toLowerCase();
      const code = (item.icd10 || item.nhiIcd10 || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      let score = 0;
      if (short && short === q) score += 420;
      else if (short && short.startsWith(q)) score += 260;
      else if (short && q.length >= 2 && short.includes(q)) score += 80;
      if (compact && code === compact) score += 360;
      else if (compact && compact.length >= 2 && code.startsWith(compact)) score += 160;
      else if (compact && compact.length >= 3 && code.includes(compact)) score += 40;
      if (text === q) score += 300;
      else if (text.startsWith(q)) score += 140;
      else if (text.includes(q)) score += 70;
      return { item, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
  return scored.map((row) => row.item);
}

function fromCatalog(item: CatalogDiagnosis, index: number): Hit {
  const icd10 = item.icd10 || item.nhiIcd10;
  const nhi = item.nhiIcd10 || icd10.replace(/\./g, "");
  return {
    key: `cat-${item.short || ""}-${icd10}-${index}`,
    name: item.text || icd10,
    detail: [item.short, icd10].filter(Boolean).join("  "),
    choices: [{ icd10, nhiIcd10: nhi, text: item.text || icd10 }],
    note: "",
  };
}

function fromServer(hit: DiagnosisSearchHit, index: number): Hit {
  const primaryText = hasCjk(hit.name) ? hit.name : hit.title || hit.name || hit.icd10;
  const primary: DxChoice = {
    icd10: hit.icd10,
    nhiIcd10: hit.nhiIcd10 || hit.icd10.replace(/\./g, ""),
    text: primaryText,
    en: hit.title && hit.title !== primaryText ? hit.title : undefined,
  };
  const extra = (hit.secondary || []).map((sec) => ({
    icd10: sec.icd10,
    nhiIcd10: sec.nhiIcd10 || sec.icd10.replace(/\./g, ""),
    text: sec.title || sec.icd10,
  }));
  const codes = [hit.icd9, hit.icd10].filter(Boolean).join("  ");
  return {
    key: `srv-${hit.icd9 || hit.icd10}-${index}`,
    name: hit.name || hit.title || hit.icd10,
    nameEn: hit.nameEn && hit.nameEn !== (hit.name || hit.title) ? hit.nameEn : undefined,
    detail: codes,
    choices: [primary, ...extra].filter((item) => item.icd10),
    note: hit.chiefNote || "",
    icd9: hit.icd9 || undefined,
  };
}

function pickedRows(hits: Hit[], checked: Set<string>): { rows: DxChoice[]; note: string } {
  const rows: DxChoice[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const chosen = hit.choices.filter((item) => checked.has(choiceKey(hit.key, item.icd10)));
    if (!chosen.length) continue;
    for (const item of chosen) {
      const key = (item.nhiIcd10 || item.icd10).toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(item);
    }
    if (hit.note) notes.push(hit.note);
  }
  return { rows, note: notes.filter((note, index) => notes.indexOf(note) === index).join(" ") };
}

export function DiagnosisFinder({
  open,
  catalog,
  initialQuery = "",
  preset = null,
  onClose,
  onCommit,
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [remote, setRemote] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [chapterId, setChapterId] = useState("680-709");
  const [groups, setGroups] = useState<{ code: string; name: string; nameEn: string; count: number }[]>([]);
  const [groupCode, setGroupCode] = useState("");
  const [browseHits, setBrowseHits] = useState<Hit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const scopeRef = useRef<HTMLDivElement>(null);
  const onIndex = useCallback((next: number) => setIndex(next), []);

  const presetKey = preset ? `${preset.note}|${preset.items.map((item) => item.icd10).join(",")}` : "";
  useEscLayer([{ open, close: onClose }]);

  const localHits = useMemo(() => {
    if (preset) {
      return [
        {
          key: "preset",
          name: preset.note || T.presetTitle,
          detail: preset.items.map((item) => item.icd10).join(" / "),
          choices: preset.items,
          note: preset.note,
        },
      ];
    }
    return rankCatalog(catalog, query).map(fromCatalog);
  }, [catalog, preset, query]);

  const searching = !preset && query.trim().length > 0;
  const clinicHits = useMemo(() => {
    if (chapterId !== "clinic" || preset) return [];
    return [...catalog]
      .sort((a, b) => (a.text || "").localeCompare(b.text || "", "zh-Hant"))
      .slice(0, 400)
      .map(fromCatalog);
  }, [catalog, chapterId, preset]);
  const hits = preset
    ? localHits
    : searching
      ? [...localHits, ...remote].slice(0, 40)
      : chapterId === "clinic"
        ? clinicHits
        : browseHits;

  const showingGroups = !preset && !searching && chapterId !== "clinic" && !groupCode;
  const listLength = showingGroups ? groups.length : hits.length;

  useListNav({
    active: open && listLength > 0,
    length: listLength,
    index,
    onIndex,
    scrollerRef: listRef,
    scopeRef,
    moveWhileTyping: true,
  });

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
    setRemote([]);
    setIndex(0);
    setChecked(new Set());
    setLoading(false);
    setChapterId("680-709");
    setGroupCode("");
    setGroups([]);
    setBrowseHits([]);
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      } else {
        scopeRef.current?.focus();
      }
    });
  }, [open, initialQuery, presetKey]);

  useEffect(() => {
    if (!open || preset) return;
    const q = query.trim();
    if (q.length < 1) {
      setRemote([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void searchDiagnosisCodes(q)
        .then((rows) => {
          if (!cancelled) setRemote(rows.map(fromServer));
        })
        .catch(() => {
          if (!cancelled) setRemote([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, preset, query]);

  useEffect(() => {
    setIndex(0);
  }, [query, preset, chapterId, groupCode]);

  useEffect(() => {
    if (!open || preset || searching) return;
    setGroupCode("");
    setBrowseHits([]);
    if (chapterId === "clinic") {
      setGroups([]);
      setLoading(false);
      return;
    }
    const chapter = CHAPTERS.find((item) => item.id === chapterId);
    if (!chapter) return;
    let cancelled = false;
    setLoading(true);
    void fetchDiagnosisGroups({ lo: chapter.lo, hi: chapter.hi, letter: chapter.letter })
      .then((rows) => {
        if (!cancelled) setGroups(rows);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, preset, searching, chapterId]);

  useEffect(() => {
    if (!open || preset || searching || !groupCode) return;
    let cancelled = false;
    setLoading(true);
    void fetchDiagnosisCodes(groupCode)
      .then((rows) => {
        if (cancelled) return;
        setBrowseHits(
          rows.map((row, index) => ({
            key: `br-${row.icd9}-${index}`,
            name: row.name || row.icd9,
            nameEn: row.nameEn && row.nameEn !== row.name ? row.nameEn : undefined,
            detail: row.icd9,
            choices: [],
            note: "",
            icd9: row.icd9,
          })),
        );
        setIndex(0);
      })
      .catch(() => {
        if (!cancelled) setBrowseHits([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, preset, searching, groupCode]);

  if (!open) return null;

  const current = hits[index] ?? null;
  const bothReady = (current?.choices.length ?? 0) > 1;

  const resolveHit = async (hit: Hit): Promise<Hit> => {
    if (hit.choices.length || !hit.icd9) return hit;
    const mapped = await crosswalkDiagnosis(hit.icd9, hit.name);
    const primaryText = hasCjk(hit.name) ? hit.name : mapped.title || hit.name;
    const primary: DxChoice = {
      icd10: mapped.icd10,
      nhiIcd10: mapped.nhiIcd10 || mapped.icd10.replace(/\./g, ""),
      text: primaryText,
      en: mapped.title && mapped.title !== primaryText ? mapped.title : undefined,
    };
    const extra = (mapped.secondary || []).map((sec) => ({
      icd10: sec.icd10,
      nhiIcd10: sec.nhiIcd10 || sec.icd10.replace(/\./g, ""),
      text: sec.title || sec.icd10,
    }));
    const next: Hit = {
      ...hit,
      detail: [hit.icd9, mapped.icd10].filter(Boolean).join("  "),
      choices: [primary, ...extra].filter((item) => item.icd10),
      note: mapped.chiefNote || "",
    };
    setBrowseHits((prev) => prev.map((row) => (row.key === hit.key ? next : row)));
    return next;
  };

  const toggle = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const cycle = (hit: Hit) => {
    const keys = hit.choices.map((item) => choiceKey(hit.key, item.icd10));
    setChecked((prev) => {
      const next = new Set(prev);
      const on = keys.map((key) => prev.has(key));
      for (const key of keys) next.delete(key);
      if (keys.length <= 1) {
        if (!on[0]) next.add(keys[0]);
        return next;
      }
      if (!on[0] && !on[1]) next.add(keys[0]);
      else if (on[0] && !on[1]) {
        next.add(keys[0]);
        next.add(keys[1]);
      }
      return next;
    });
  };

  const writeChecked = async () => {
    if (showingGroups) {
      const group = groups[index];
      if (group) setGroupCode(group.code);
      return;
    }
    let list = hits;
    let hit = list[index];
    if (hit && !hit.choices.length && hit.icd9) {
      hit = await resolveHit(hit);
      list = list.map((row) => (row.key === hit.key ? hit : row));
    }
    const chosen = pickedRows(list, checked);
    if (!chosen.rows.length) {
      if (!hit?.choices[0]) return;
      onCommit([hit.choices[0]], hit.note);
      return;
    }
    onCommit(chosen.rows, chosen.note);
  };

  const writeBoth = () => {
    const hit = hits[index];
    if (!hit || hit.choices.length < 2) return;
    onCommit(hit.choices, hit.note);
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      onClose();
      return;
    }
    if (ev.key === " ") {
      if (ev.target === inputRef.current) return;
      ev.preventDefault();
      if (showingGroups) {
        const group = groups[index];
        if (group) setGroupCode(group.code);
        return;
      }
      const hit = hits[index];
      if (!hit) return;
      if (!hit.choices.length && hit.icd9) {
        void resolveHit(hit);
        return;
      }
      cycle(hit);
      return;
    }
    if (ev.key === "Enter") {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.shiftKey) writeBoth();
      else void writeChecked();
    }
    if (ev.key === "Backspace" && ev.target !== inputRef.current && groupCode && !searching) {
      ev.preventDefault();
      setGroupCode("");
      setBrowseHits([]);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/45" onKeyDown={onKeyDown}>
      <div
        ref={scopeRef}
        tabIndex={-1}
        className="flex max-h-[88%] w-[min(68rem,98%)] flex-col overflow-hidden rounded border border-[#004D00] bg-[#D4ECD4] shadow-xl"
        style={{ fontFamily: HIS_FONT }}
      >
        <header className="flex shrink-0 items-center justify-between bg-[#004D00] px-3 py-1.5 text-xs text-white">
          <span className="font-bold">{preset ? T.presetTitle : T.title}</span>
          <span className="font-normal text-lime-100">{T.keys}</span>
        </header>
        <div className="shrink-0 border-b border-[#80C080] bg-[#E8F8E8] px-3 py-2">
          <p className="text-[11px] text-[#004D00]">{preset ? T.presetHint : T.searchHint}</p>
          {!preset && (
            <label className="mt-1 block text-[10px] font-bold text-[#004D00]">
              {T.searchLabel}
              <input
                ref={inputRef}
                type="search"
                className="mt-1 w-full rounded border border-[#80C080] bg-white px-2 py-1 text-sm text-black focus:outline-none"
                value={query}
                placeholder={T.placeholder}
                onChange={(ev) => setQuery(ev.target.value)}
              />
            </label>
          )}
        </div>
        {loading && <p className="shrink-0 bg-sky-50 px-3 py-1 text-xs text-sky-900">{T.loading}</p>}
        <div className="flex min-h-[16rem] flex-1 overflow-hidden bg-white">
          {!preset && (
            <div className="w-36 shrink-0 overflow-auto border-r border-[#80C080] bg-[#E8F8E8]">
              {CHAPTERS.map((chapter) => {
                const on = chapter.id === chapterId && !searching;
                return (
                  <button
                    key={chapter.id}
                    type="button"
                    className="block w-full px-2 py-1 text-left text-[12px] text-black"
                    style={{ background: on ? "#FFFF80" : "transparent", fontWeight: on ? 700 : 400 }}
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      setQuery("");
                      setChapterId(chapter.id);
                      setGroupCode("");
                      setBrowseHits([]);
                    }}
                  >
                    {chapter.label}
                  </button>
                );
              })}
            </div>
          )}
          <div ref={listRef} className="min-h-0 flex-1 overflow-auto">
            {!searching && !preset && groupCode && (
              <button
                type="button"
                className="sticky top-0 z-[1] block w-full border-b border-[#80C080] bg-[#E8F8E8] px-2 py-1 text-left text-[12px] font-bold text-[#004D00]"
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  setGroupCode("");
                  setBrowseHits([]);
                }}
              >
                {T.back}
                {"  "}
                {groupCode}
              </button>
            )}
            {showingGroups ? (
              groups.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-slate-500">{loading ? T.loading : T.pickGroup}</p>
              ) : (
                groups.map((group, row) => (
                  <button
                    key={group.code}
                    type="button"
                    data-idx={row}
                    className="block w-full border-b border-[#D0E8D0] px-2 py-1 text-left"
                    style={{ background: row === index ? "#FFFF80" : "#fff" }}
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      setIndex(row);
                      setGroupCode(group.code);
                    }}
                  >
                    <span className="font-mono text-[13px] font-bold text-black">{group.code}</span>
                    <span className="ml-2 text-[13px] font-bold text-black">{group.name}</span>
                    {group.nameEn ? (
                      <span className="ml-2 text-[12px] font-normal text-[#222]">{group.nameEn}</span>
                    ) : null}
                  </button>
                ))
              )
            ) : hits.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-slate-500">{query.trim() ? T.empty : T.searchHint}</p>
            ) : (
              hits.map((hit, row) => {
                const active = row === index;
                return (
                  <div
                    key={hit.key}
                    data-idx={row}
                    className="border-b border-[#D0E8D0] px-2 py-1"
                    style={{ background: active ? "#FFFF80" : "#fff" }}
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      setIndex(row);
                      if (!hit.choices.length && hit.icd9) void resolveHit(hit);
                    }}
                    onDoubleClick={() => {
                      setIndex(row);
                      void (async () => {
                        const next = await resolveHit(hit);
                        if (next.choices.length === 1) onCommit([next.choices[0]], next.note);
                      })();
                    }}
                  >
                    <div className="text-[13px] text-black">
                      <span className="font-bold">{hit.name}</span>
                      {hit.nameEn ? <span className="ml-2 font-normal text-[#222]">{hit.nameEn}</span> : null}
                    </div>
                    <div className="text-[11px] text-[#004D00]">{hit.detail}</div>
                    {hit.choices.length === 0 ? (
                      <div className="text-[11px] text-slate-500">{T.unresolved}</div>
                    ) : (
                      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                        {hit.choices.map((item) => {
                          const key = choiceKey(hit.key, item.icd10);
                          return (
                            <label key={key} className="flex items-center gap-1 text-[12px] text-black">
                              <input
                                type="checkbox"
                                checked={checked.has(key)}
                                onChange={() => toggle(key)}
                              />
                              <span className="font-mono">{item.icd10}</span>
                              <span>{item.text}</span>
                              {item.en ? <span className="text-[#333]">{item.en}</span> : null}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-[#80C080] bg-[#E8F8E8] px-3 py-2">
          {bothReady && (
            <button
              type="button"
              className="rounded border border-[#004D00] bg-white px-3 py-1 text-xs font-bold text-[#004D00]"
              onClick={writeBoth}
            >
              {T.both}
            </button>
          )}
          <button
            type="button"
            className="rounded border border-[#004D00] bg-[#004D00] px-3 py-1 text-xs font-bold text-white"
            onClick={() => void writeChecked()}
          >
            {T.write}
          </button>
          <button
            type="button"
            className="rounded border border-[#808080] bg-white px-3 py-1 text-xs"
            onClick={onClose}
          >
            {T.cancel}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
