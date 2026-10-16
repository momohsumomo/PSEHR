import { useEffect, useRef, useState } from "react";
import type { CatalogDrug } from "@/types/clinicCatalog";
import type { RxLine } from "@/mocks/clinicMocks";
import { searchDrugs } from "@/utils/catalogSearch";
import { catalogDrugToRxLine } from "@/utils/catalogRx";

type Props = {
  drugs: CatalogDrug[];
  focusKey?: string | null;
  onAddLines: (lines: RxLine[]) => void;
  defaultUsages?: string[];
  placeholder?: string;
  /** 與右側清單共用的查詢字串 */
  query?: string;
  onQueryChange?: (q: string) => void;
};

/** 醫聖風格命令列 + 處置即時下拉（自定名稱優先） */
export function RxCommandLine({
  drugs,
  focusKey,
  onAddLines,
  defaultUsages = [],
  placeholder = "點此輸入藥名／健保碼；右側同步清單",
  query: controlledQuery,
  onQueryChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [innerQuery, setInnerQuery] = useState("");
  const query = controlledQuery !== undefined ? controlledQuery : innerQuery;
  const setQuery = (q: string) => {
    if (onQueryChange) onQueryChange(q);
    else setInnerQuery(q);
  };
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const parseCommand = (input: string) => {
    const parts = input.trim().split(/\s+/);
    const hashIndex = parts.findIndex((p) => p.includes("#"));
    
    if (hashIndex !== -1) {
      const drugQuery = parts.slice(0, hashIndex).join(" ");
      const qtyStr = parts[hashIndex].split("#")[0];
      const qty = parseFloat(qtyStr) || 1;
      const sig = parts.slice(hashIndex + 1).join(" ").toUpperCase() || "QD";
      return { drugQuery, qty, sig };
    }
    return null;
  };

  const parsed = parseCommand(query);
  const searchKey = parsed ? parsed.drugQuery : query;
  const results = searchDrugs(drugs, searchKey);

  useEffect(() => {
    if (focusKey) inputRef.current?.focus();
  }, [focusKey]);

  useEffect(() => {
    setActive(0);
    setOpen(query.trim().length > 0 && results.length > 0);
  }, [query, results.length]);

  const pick = (drug: CatalogDrug, parsedQty?: number, parsedSig?: string) => {
    const line = catalogDrugToRxLine(drug);
    if (parsedQty !== undefined) {
      line.qty = parsedQty;
    }
    if (parsedSig !== undefined) {
      line.sig = parsedSig;
    }
    onAddLines([line]);
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && open) {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
      return;
    }
    if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && results[active]) {
        if (parsed) {
          pick(results[active], parsed.qty, parsed.sig);
        } else {
          pick(results[active]);
        }
      }
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative mt-2">
      <div className="flex gap-2">
        <input
          ref={inputRef}
          className="flex-1 rounded border-2 border-sky-500 bg-sky-50/50 p-2 font-mono text-sm outline-none focus:ring-2 focus:ring-sky-400"
          value={query}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => query && results.length && setOpen(true)}
        />
        <div className="flex flex-col gap-1 text-[10px] text-slate-500">
          {defaultUsages.slice(0, 4).map((u) => (
            <span key={u} className="rounded bg-slate-100 px-1">{u}</span>
          ))}
        </div>
      </div>
      {open && (
        <ul
          className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded border border-slate-300 bg-white text-xs shadow-lg"
        >
          {results.map((d, i) => (
            <li key={d.nhiCode + d.drugNo}>
              <button
                type="button"
                className={`flex w-full gap-2 px-2 py-1.5 text-left hover:bg-sky-50 ${
                  i === active ? "bg-sky-100" : ""
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (parsed) {
                    pick(d, parsed.qty, parsed.sig);
                  } else {
                    pick(d);
                  }
                }}
              >
                <span className="min-w-0 flex-1 font-medium truncate">{d.customName}</span>
                <span className="font-mono text-slate-500">{d.nhiCode}</span>
                {d.selfPay && <span className="text-amber-700">自</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
