import type { CatalogDrug, CatalogPackage } from "@/types/clinicCatalog";
import type { RxLine } from "@/mocks/clinicMocks";
import { withComputedTotal, type CatalogUsage } from "@/utils/rxTotal";

export function lineSelfPayPrice(line: RxLine, drugs: CatalogDrug[]): number | null {
  const hit = drugs.length ? pickDrugForLine(line, drugs) : undefined;
  const raw = Number(hit?.selfPayPrice);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

function preferIndexed(rows: CatalogDrug[]): CatalogDrug | undefined {
  return rows.find((row) => row.clinicIndex === true);
}

export function pickDrugForLine(line: RxLine, drugs: CatalogDrug[]): CatalogDrug | undefined {
  const alias = String(line.shortName || "").trim().toUpperCase();
  if (alias) {
    const byAlias = preferIndexed(
      drugs.filter(
        (d) =>
          String(d.alias || "").trim().toUpperCase() === alias ||
          String(d.shortName || "").trim().toUpperCase() === alias ||
          String(d.drugNo || "").trim().toUpperCase() === alias,
      ),
    );
    if (byAlias) return byAlias;
  }
  const name = String(line.name || "").trim();
  if (name) {
    const exact = preferIndexed(
      drugs.filter((d) => String(d.customName || "").trim() === name),
    );
    if (exact) return exact;
  }
  const nhi = String(line.nhiCode || "").trim().toUpperCase();
  if (!nhi) return undefined;
  const indexed = drugs.filter(
    (d) => d.clinicIndex === true && String(d.nhiCode || "").trim().toUpperCase() === nhi,
  );
  if (indexed.length === 1) return indexed[0];
  if (indexed.length > 1 && name) {
    const contains = indexed.find((d) => d.customName.includes(name) || name.includes(d.customName));
    if (contains) return contains;
  }
  return undefined;
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
          tradeName: (hit.name || "").trim() || line.tradeName,
          shortName: hit.alias || hit.shortName || line.shortName,
          unit: (hit.unit || line.unit || "").trim(),
          route: (hit.route as RxLine["route"]) || line.route,
          cast: (hit.cast || "").trim() || line.cast,
          typeName: (hit.typeName || "").trim() || line.typeName,
          patientRemind: (hit.patientRemind || "").trim() || line.patientRemind,
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

const CLINIC_CODE = /^[A-Z0-9]{1,16}$/;

/** Code stored on the chart. A short alias such as PP, or the drug number when the alias has punctuation or Chinese. */
function clinicSaveCode(drug: CatalogDrug): string {
  const nhi = String(drug.nhiCode || "").trim().toUpperCase();
  if (CLINIC_CODE.test(nhi)) return nhi;
  const alias = String(drug.alias || drug.shortName || "").trim().toUpperCase();
  if (CLINIC_CODE.test(alias)) return alias;
  const no = String(drug.drugNo || "").replace(/[\x00-\x1f]/g, "").trim().toUpperCase();
  if (CLINIC_CODE.test(no)) return no;
  return "";
}

export function catalogDrugToRxLine(drug: CatalogDrug, usages?: CatalogUsage[]): RxLine {
  const price = Number(drug.unitPrice);
  const line: RxLine = {
    id: `rx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: drug.customName,
    tradeName: (drug.name || "").trim(),
    shortName: drug.alias || drug.shortName,
    sig: (drug.sig || "").trim(),
    days: Number(drug.days) > 0 ? Number(drug.days) : 0,
    qty: Number(drug.qty) > 0 ? Number(drug.qty) : undefined,
    nhiCode: clinicSaveCode(drug),
    unitPrice: Number.isFinite(price) && price > 0 ? price : undefined,
    route: drug.route,
    cast: (drug.cast || "").trim(),
    typeName: (drug.typeName || "").trim(),
    unit: (drug.unit || "").trim(),
    selfPay: drug.payMark === "\u81ea" || drug.selfPay,
    payMark: drug.payMark || (drug.selfPay ? "\u81ea" : ""),
    memo: (drug.memo || "").trim(),
  };
  return withComputedTotal(line, usages);
}

type RxIdentity = {
  name?: string;
  shortName?: string;
  nhiCode?: string;
};

function normDrugToken(value: string | undefined): string {
  return String(value || "").replace(/\s+/g, " ").trim().toUpperCase();
}

/** 藥品主檔選用欄註記 N：這筆已經不開放再開。 */
export function drugMarkedStopped(drug: CatalogDrug): boolean {
  return String(drug.indexFlag || "").trim().toUpperCase() === "N";
}

function productKeys(drug: CatalogDrug): string[] {
  return [drug.customName, drug.name, drug.alias, drug.shortName, drug.drugNo]
    .map((value) => normDrugToken(value))
    .filter(Boolean);
}

function lineMatchesProduct(line: RxIdentity, drug: CatalogDrug): boolean {
  const keys = productKeys(drug);
  const alias = normDrugToken(line.shortName);
  const name = normDrugToken(line.name);
  if (alias && keys.includes(alias)) return true;
  if (name && (keys.includes(name) || normDrugToken(drug.nhiCode) === name)) return true;
  return false;
}

function lineMatchesCode(line: RxIdentity, drug: CatalogDrug): boolean {
  const code = normDrugToken(line.nhiCode);
  if (!code) return false;
  return normDrugToken(drug.nhiCode) === code || productKeys(drug).includes(code);
}

function drugStillOpen(drug: CatalogDrug): boolean {
  if (drugMarkedStopped(drug)) return false;
  const flag = String(drug.indexFlag || "").trim().toUpperCase();
  return flag === "Y" || drug.clinicIndex === true;
}

/**
 * 歷史處方裡，名稱或快碼對到「選用 N」而且沒有另一筆還在用的同名藥。
 * 同健保碼、不同品名的新廠牌不算同一筆，避免把已停用的舊藥悄悄換成新藥。
 */
export function splitStoppedRxLines<T extends RxIdentity>(
  lines: T[],
  drugs: CatalogDrug[],
): { kept: T[]; stopped: T[] } {
  const stoppedDrugs = drugs.filter(drugMarkedStopped);
  if (!lines.length || !stoppedDrugs.length) return { kept: lines.slice(), stopped: [] };
  const openDrugs = drugs.filter(drugStillOpen);
  const kept: T[] = [];
  const stopped: T[] = [];
  for (const line of lines) {
    const hitStopped = stoppedDrugs.some(
      (drug) => lineMatchesProduct(line, drug) || lineMatchesCode(line, drug),
    );
    const hitOpen = openDrugs.some((drug) => lineMatchesProduct(line, drug));
    if (hitStopped && !hitOpen) stopped.push(line);
    else kept.push(line);
  }
  return { kept, stopped };
}

export function stoppedRxLabels(lines: RxIdentity[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const line of lines) {
    const label = String(line.name || line.shortName || line.nhiCode || "").trim() || "未命名藥品";
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
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
  const byNo = new Map<string, CatalogDrug>();
  const byNhi = new Map<string, CatalogDrug>();
  for (const drug of drugs) {
    const no = drug.drugNo.replace(/[\x00-\x1f]/g, "").trim();
    const nhi = String(drug.nhiCode || "").trim().toUpperCase();
    const keep = (prev: CatalogDrug | undefined) =>
      !prev || (drug.clinicIndex === true && prev.clinicIndex !== true);
    if (no && keep(byNo.get(no))) byNo.set(no, drug);
    if (nhi && keep(byNhi.get(nhi))) byNhi.set(nhi, drug);
  }
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
