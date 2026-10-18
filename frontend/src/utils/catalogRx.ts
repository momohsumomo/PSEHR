import type { CatalogDrug, CatalogPackage } from "@/types/clinicCatalog";
import type { RxLine } from "@/mocks/clinicMocks";
import { withComputedTotal, type CatalogUsage } from "@/utils/rxTotal";

function pickDrugForLine(line: RxLine, drugs: CatalogDrug[]): CatalogDrug | undefined {
  const alias = String(line.shortName || "").trim().toUpperCase();
  if (alias) {
    const byAlias = drugs.find(
      (d) =>
        String(d.alias || "").trim().toUpperCase() === alias ||
        String(d.shortName || "").trim().toUpperCase() === alias ||
        String(d.drugNo || "").trim().toUpperCase() === alias,
    );
    if (byAlias) return byAlias;
  }
  const name = String(line.name || "").trim();
  if (name) {
    const exact = drugs.find((d) => String(d.customName || "").trim() === name);
    if (exact) return exact;
  }
  const nhi = String(line.nhiCode || "").trim().toUpperCase();
  if (!nhi) return undefined;
  const sameNhi = drugs.filter((d) => String(d.nhiCode || "").trim().toUpperCase() === nhi);
  if (sameNhi.length === 1) return sameNhi[0];
  if (sameNhi.length > 1 && name) {
    const contains = sameNhi.find((d) => d.customName.includes(name) || name.includes(d.customName));
    if (contains) return contains;
    // Do not overwrite clinic name with another same-NHI variant
    return undefined;
  }
  return sameNhi[0];
}

/** Map history/import drug names to clinic MEDICAL.MAKING (display only) */
export function applyClinicDrugDisplayNames(
  lines: RxLine[],
  drugs: CatalogDrug[],
  usages?: CatalogUsage[],
): RxLine[] {
  if (!lines.length) return lines;
  return lines.map((line) => {
    const hit = drugs.length ? pickDrugForLine(line, drugs) : undefined;
    const merged: RxLine = hit
      ? {
          ...line,
          name: hit.customName || line.name,
          shortName: hit.alias || hit.shortName || line.shortName,
          route: (hit.route as RxLine["route"]) || line.route,
          sig:
            line.sig && line.sig !== "\u2014" && !looksLikeFatDosage(line.sig)
              ? line.sig
              : hit.sig || stripFatDosage(line.sig) || line.sig,
        }
      : {
          ...line,
          sig: looksLikeFatDosage(line.sig) ? stripFatDosage(line.sig) : line.sig,
        };
    return withComputedTotal(merged, usages);
  });
}

function looksLikeFatDosage(sig: string | undefined): boolean {
  const s = (sig || "").trim();
  if (!s) return false;
  return /\*\s*[\d.]+\s*(d|\u5929)/i.test(s) || /qty\s*=/i.test(s) || /\u7e3d\u91cf\s*:/i.test(s);
}

function stripFatDosage(sig: string | undefined): string {
  const s = (sig || "").trim();
  if (!s) return "";
  const m = s.match(/^(.+?)\s*\*\s*[\d.]+\s*(d|\u5929)/i);
  return m ? m[1].trim() : s;
}

export function catalogDrugToRxLine(drug: CatalogDrug, usages?: CatalogUsage[]): RxLine {
  const line: RxLine = {
    id: `rx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: drug.customName,
    shortName: drug.alias || drug.shortName,
    sig: (drug.sig || "").trim(),
    days: Number(drug.days) > 0 ? Number(drug.days) : 0,
    qty: Number(drug.qty) > 0 ? Number(drug.qty) : undefined,
    nhiCode: drug.nhiCode,
    route: drug.route,
    selfPay: drug.payMark === "\u81ea" || drug.selfPay,
    payMark: drug.payMark || (drug.selfPay ? "\u81ea" : ""),
    memo: (drug.memo || "").trim(),
  };
  return withComputedTotal(line, usages);
}

function packageSourceLines(pkg: CatalogPackage): Array<{
  drugNo?: string;
  drugCode?: string;
  qty?: number;
  sig?: string;
  days?: number;
}> {
  if (pkg.lines?.length) return pkg.lines;
  return pkg.items ?? [];
}

export function resolvePackageLines(
  pkg: CatalogPackage,
  drugs: CatalogDrug[],
  usages?: CatalogUsage[],
): RxLine[] {
  const byNo = new Map(drugs.map((d) => [d.drugNo.replace(/[\x00-\x1f]/g, "").trim(), d]));
  const byNhi = new Map(drugs.map((d) => [d.nhiCode.toUpperCase(), d]));
  const lines: RxLine[] = [];
  for (const line of packageSourceLines(pkg)) {
    const rawNo = String(line.drugNo || "").replace(/[\x00-\x1f]/g, "").trim();
    const nhi = String(line.drugCode || "")
      .replace(/[\x00-\x1f]/g, "")
      .trim()
      .toUpperCase();
    const drug = (rawNo && byNo.get(rawNo)) || (nhi && byNhi.get(nhi)) || undefined;
    if (!drug) continue;
    const rx = catalogDrugToRxLine(drug, usages);
    rx.qty = line.qty ?? rx.qty;
    rx.sig = line.sig || rx.sig;
    rx.days = line.days ?? rx.days;
    lines.push(withComputedTotal(rx, usages));
  }
  return lines;
}

export function mergeRxSkipDuplicate(existing: RxLine[], incoming: RxLine[]): RxLine[] {
  const codes = new Set(existing.map((r) => r.nhiCode));
  return [...existing, ...incoming.filter((r) => !codes.has(r.nhiCode))];
}
