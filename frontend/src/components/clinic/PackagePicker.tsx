import type { CatalogDrug, CatalogPackage } from "@/types/clinicCatalog";
import type { RxLine } from "@/mocks/clinicMocks";
import { resolvePackageLines } from "@/utils/catalogRx";

type Props = {
  packages: CatalogPackage[];
  drugs: CatalogDrug[];
  onApply: (lines: RxLine[]) => void;
};

/** 醫聖藥組（MEDISET）一鍵帶入 */
export function PackagePicker({ packages, drugs, onApply }: Props) {
  if (!packages.length) return null;

  const apply = (pkg: CatalogPackage) => {
    const resolved = resolvePackageLines(pkg, drugs);
    if (!resolved.length) return;
    onApply(resolved);
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-bold text-violet-800">藥組</span>
      {packages.map((pkg) => {
        const n = pkg.lines?.length || pkg.items?.length || 0;
        return (
          <button
            key={pkg.id || pkg.code || pkg.name}
            type="button"
            className="rounded border border-violet-300 bg-violet-50 px-2 py-1 text-[11px] font-medium text-violet-900 hover:bg-violet-100"
            onClick={() => apply(pkg)}
          >
            {pkg.name} ({n})
          </button>
        );
      })}
    </div>
  );
}
