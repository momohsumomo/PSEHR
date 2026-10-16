import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { searchIcd10Book, type Icd10BookHit } from "@/api/clinicApi";
import type { CatalogDiagnosis } from "@/types/clinicCatalog";
import { useEscLayer } from "@/hooks/useEscLayer";
import { HIS_FONT } from "@/lib/hisTheme";

type Props = {
  query: string;
  onClose: () => void;
  onPick: (row: CatalogDiagnosis, query?: string) => void | string;
};

function showCode(code: string): string {
  const bare = (code || "").replace(/\./g, "").toUpperCase();
  if (bare.length <= 3) return bare;
  return bare.slice(0, 3) + "." + bare.slice(3);
}

function toCatalog(hit: Icd10BookHit): CatalogDiagnosis {
  const code = (hit.nhiIcd10 || hit.icd10 || "").replace(/\./g, "").toUpperCase();
  return {
    icd10: code,
    nhiIcd10: code,
    text: hit.nameEn || hit.nameZh || hit.icd10,
    nameEn: hit.nameEn || "",
    nameZh: hit.nameZh || "",
    icd9: hit.icd9 || "",
    aCode: hit.icd9 || "",
    snomed: "",
  };
}

export function FullIcdSearchDialog({ query, onClose, onPick }: Props) {
  const [text, setText] = useState(query);
  const [rows, setRows] = useState<Icd10BookHit[]>([]);
  const [index, setIndex] = useState(0);
  const [note, setNote] = useState("");
  const [pickError, setPickError] = useState("");
  const current = rows[index] ?? null;
  useEscLayer([{ open: true, close: onClose }]);

  useEffect(() => {
    setIndex(0);
  }, [text]);

  useEffect(() => {
    const q = text.trim();
    const short = q.length < 2 && !/[\u4e00-\u9fff]/.test(q);
    if (short) {
      setRows([]);
      setNote("\u82f1\u6587\u6216\u4ee3\u78bc\u81f3\u5c11\u5169\u500b\u5b57\uff0c\u4e2d\u6587\u4e00\u500b\u5b57\u4e5f\u53ef\u4ee5");
      return;
    }
    let cancel = false;
    setNote("\u641c\u5c0b\u4e2d\u2026");
    const timer = window.setTimeout(() => {
      searchIcd10Book(q)
        .then((hits) => {
          if (cancel) return;
          setRows(hits);
          setNote(hits.length ? "" : "\u5b8c\u6574\u78bc\u8868\u88e1\u6c92\u6709\u9019\u500b");
        })
        .catch(() => {
          if (!cancel) setNote("\u5b8c\u6574\u78bc\u8868\u8b80\u4e0d\u5230");
        });
    }, 200);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [text]);

  const pick = (hit: Icd10BookHit) => {
    const msg = onPick(toCatalog(hit), text);
    setPickError(typeof msg === "string" ? msg : "");
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        ev.stopPropagation();
        setIndex((i) => Math.min(i + 1, Math.max(rows.length - 1, 0)));
      }
      if (ev.key === "ArrowUp") {
        ev.preventDefault();
        ev.stopPropagation();
        setIndex((i) => Math.max(i - 1, 0));
      }
      if (ev.key === "Enter" && current) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        pick(current);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [current, onPick, rows.length]);

  return createPortal(
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-black/45"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        className="flex h-[min(34rem,88vh)] w-[min(68rem,96vw)] flex-col border-2 border-[#003C74] bg-[#F4F4F4] shadow-lg"
        style={{ fontFamily: HIS_FONT }}
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <div className="bg-[#003C74] px-2 py-1 text-[12px] font-bold text-white">{"\u5b8c\u6574\u78bc\u8868"}</div>
        <div className="border-b border-[#A0A0A0] px-2 py-1 text-[12px]">
          <label className="flex items-center gap-2">
            <span>{"ICD-10\u3001\u82f1\u6587\u75c5\u540d\u3001\u4e2d\u6587"}</span>
            <input
              autoFocus
              className="flex-1 border border-[#7F9DB9] bg-white px-1 font-mono"
              value={text}
              onChange={(ev) => setText(ev.target.value)}
            />
            <span className="text-[11px] text-slate-600">{rows.length}{" \u7b46"}</span>
          </label>
          <div className="mt-1 text-[11px] text-slate-600">
            {"\u4e0d\u9650\u8a3a\u6240\u5e38\u7528\u3002\u4f8b\u5982 W26\u3001knife\u3002\u4e2d\u6587\u6703\u5148\u5c0d ICD-9 \u75c5\u540d\uff0c\u518d\u5e36\u51fa ICD-10\u3002"}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-[12px]">
            <thead className="sticky top-0 bg-[#D8D4C8]">
              <tr>
                <th className="border border-[#A0A0A0] px-1">ICD-10</th>
                <th className="border border-[#A0A0A0] px-1">{"\u82f1\u6587"}</th>
                <th className="border border-[#A0A0A0] px-1">{"\u4e2d\u6587"}</th>
                <th className="border border-[#A0A0A0] px-1">ICD-9</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={`${row.nhiIcd10}-${i}`}
                  className={i === index ? "bg-[#316AC5] text-white" : "bg-white"}
                  onMouseDown={(ev) => {
                    ev.stopPropagation();
                    setIndex(i);
                  }}
                  onDoubleClick={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    pick(row);
                  }}
                >
                  <td className="border border-[#E0E0E0] px-1 font-mono">{showCode(row.nhiIcd10 || row.icd10)}</td>
                  <td className="border border-[#E0E0E0] px-1">{row.nameEn}</td>
                  <td className="border border-[#E0E0E0] px-1">{row.nameZh}</td>
                  <td className="border border-[#E0E0E0] px-1 font-mono">{row.icd9}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {note ? <div className="px-2 py-2 text-[12px] text-slate-600">{note}</div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#A0A0A0] p-2">
          {pickError ? <span className="mr-auto self-center text-[12px] text-red-700">{pickError}</span> : null}
          <button type="button" className="border border-[#003C74] bg-[#C8F7C8] px-3 py-1 text-[12px] font-bold" onClick={() => current && pick(current)}>
            {"\u5beb\u5165"}
          </button>
          <button type="button" className="border border-[#003C74] bg-white px-3 py-1 text-[12px]" onClick={onClose}>
            {"\u96e2\u958b"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
