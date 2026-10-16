import { useMemo, useState } from "react";
import type { CatalogDiagnosis, CatalogDrug, CatalogPackage } from "@/types/clinicCatalog";
import type { DiagnosisRow, RxLine } from "@/mocks/clinicMocks";
import { searchDiagnoses, searchDrugs } from "@/utils/catalogSearch";
import { catalogDrugToRxLine, resolvePackageLines } from "@/utils/catalogRx";

type Tab = "drug" | "dx" | "pkg";

type Props = {
  open: boolean;
  onClose: () => void;
  drugs: CatalogDrug[];
  diagnoses: CatalogDiagnosis[];
  packages: CatalogPackage[];
  onAddRx: (lines: RxLine[]) => void;
  onAddDx: (row: DiagnosisRow) => void;
};

/** 醫聖診療大選盤：藥品／病名／藥組一次挑 */
export function ClinicBigPalette({
  open,
  onClose,
  drugs,
  diagnoses,
  packages,
  onAddRx,
  onAddDx,
}: Props) {
  const [tab, setTab] = useState<Tab>("drug");
  const [query, setQuery] = useState("");

  const drugHits = useMemo(() => searchDrugs(drugs, query).slice(0, 80), [drugs, query]);
  const dxHits = useMemo(() => searchDiagnoses(diagnoses, query).slice(0, 80), [diagnoses, query]);
  const pkgHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return packages;
    return packages.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.id || "").toLowerCase().includes(q) ||
        (p.code || "").toLowerCase().includes(q),
    );
  }, [packages, query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" onClick={onClose}>
      <div
        className="flex h-[min(36rem,88vh)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-slate-400 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
          <h2 className="text-sm font-bold text-slate-900">選盤（藥品／病名／藥組）</h2>
          <button type="button" className="rounded px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100" onClick={onClose}>
            關閉 ESC
          </button>
        </div>
        <div className="flex gap-1 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
          {(
            [
              ["drug", "藥品"],
              ["dx", "病名"],
              ["pkg", "藥組"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`rounded px-2 py-1 text-xs font-bold ${
                tab === id ? "bg-sky-700 text-white" : "bg-white text-slate-700 border border-slate-300"
              }`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
          <input
            autoFocus
            className="ml-auto w-56 rounded border border-slate-300 px-2 py-1 text-xs"
            placeholder="搜尋…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {tab === "drug" &&
            drugHits.map((d) => (
              <button
                key={`${d.nhiCode}-${d.drugNo}`}
                type="button"
                className="flex w-full items-center gap-2 border-b border-slate-100 px-2 py-1.5 text-left text-xs hover:bg-sky-50"
                onClick={() => {
                  onAddRx([catalogDrugToRxLine(d)]);
                }}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{d.customName || d.name}</span>
                <span className="font-mono text-slate-500">{d.nhiCode || "—"}</span>
              </button>
            ))}
          {tab === "dx" &&
            dxHits.map((d, i) => (
              <button
                key={`${d.icd10}-${d.text}-${i}`}
                type="button"
                className="flex w-full items-center gap-2 border-b border-slate-100 px-2 py-1.5 text-left text-xs hover:bg-sky-50"
                onClick={() => {
                  onAddDx({ icd10: d.icd10, nhiIcd10: d.nhiIcd10 || d.icd10, text: d.text });
                }}
              >
                <span className="w-16 font-mono text-slate-500">{d.icd10 || "—"}</span>
                <span className="font-medium">{d.text}</span>
              </button>
            ))}
          {tab === "pkg" &&
            pkgHits.map((pkg) => {
              const n = (pkg.lines?.length || pkg.items?.length || 0);
              return (
                <button
                  key={pkg.id || pkg.code || pkg.name}
                  type="button"
                  className="flex w-full items-center justify-between border-b border-slate-100 px-2 py-1.5 text-left text-xs hover:bg-violet-50"
                  onClick={() => {
                    const lines = resolvePackageLines(pkg, drugs);
                    if (lines.length) onAddRx(lines);
                  }}
                >
                  <span className="font-medium text-violet-900">{pkg.name}</span>
                  <span className="text-slate-500">{n} 筆</span>
                </button>
              );
            })}
          {tab === "drug" && !drugHits.length ? <p className="p-3 text-xs text-slate-400">無符合藥品</p> : null}
          {tab === "dx" && !dxHits.length ? <p className="p-3 text-xs text-slate-400">無符合病名</p> : null}
          {tab === "pkg" && !pkgHits.length ? <p className="p-3 text-xs text-slate-400">無藥組</p> : null}
        </div>
      </div>
    </div>
  );
}
