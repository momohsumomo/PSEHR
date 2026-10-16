import { useState } from "react";
import type { CatalogDiagnosis } from "@/types/clinicCatalog";
import type { DiagnosisRow } from "@/mocks/clinicMocks";
import { searchDiagnoses } from "@/utils/catalogSearch";

type Props = {
  catalog: CatalogDiagnosis[];
  rows: DiagnosisRow[];
  onAdd: (row: DiagnosisRow) => void;
  fontSizePx?: number;
};

/** 病名即時下拉（自定病名 + ICD-10） */
export function DiagnosisPicker({ catalog, rows, onAdd, fontSizePx = 14 }: Props) {
  const [query, setQuery] = useState("");
  const results = searchDiagnoses(catalog, query);

  const add = (d: CatalogDiagnosis) => {
    if (rows.some((r) => r.text === d.text && r.icd10 === d.icd10)) return;
    onAdd({
      icd10: d.icd10,
      nhiIcd10: d.icd10,
      text: d.text,
    });
    setQuery("");
  };

  return (
    <div className="mt-2">
      <input
        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
        placeholder="搜尋病名 / ICD-10…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) {
            e.preventDefault();
            add(results[0]);
          }
        }}
      />
      {query && results.length > 0 && (
        <ul className="mt-1 max-h-32 overflow-y-auto rounded border border-slate-200 bg-white text-xs shadow">
          {results.map((d, index) => (
            <li key={`${d.icd10}-${d.text}-${index}`}>
              <button
                type="button"
                className="flex w-full gap-2 px-2 py-1 hover:bg-slate-50"
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(d);
                }}
              >
                <span className="font-mono text-slate-500">{d.icd10}</span>
                <span className="font-medium">{d.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <table className="mt-2 w-full text-left" style={{ fontSize: fontSizePx }}>
        <thead>
          <tr className="border-b text-slate-500">
            <th className="py-0.5 pr-2">ICD-10</th>
            <th className="pr-2">病名</th>
            <th>部位</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="py-1 text-slate-400">—</td>
            </tr>
          ) : (
            rows.map((d, index) => (
              <tr key={d.id || `${d.icd10}-${d.text}-${index}`} className="border-b border-slate-50">
                <td className="py-0.5 font-mono pr-2">{d.icd10}</td>
                <td className="font-medium pr-2">{d.text}</td>
                <td>{d.site ?? "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
