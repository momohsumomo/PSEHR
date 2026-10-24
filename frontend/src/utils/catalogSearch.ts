import type { CatalogDrug, CatalogDiagnosis } from "@/types/clinicCatalog";

export function matchQuery(text: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return text.toLowerCase().includes(q);
}

function drugMatchScore(drug: CatalogDrug, lower: string): number {
  const alias = (drug.alias || drug.shortName || "").toLowerCase();
  let score = 0;
  if (alias) {
    if (alias === lower) score += 200;
    else if (alias.startsWith(lower)) score += 120;
    else if (alias.includes(lower)) score += 40;
  }
  const fields = [drug.customName, drug.nhiCode, drug.drugNo, drug.name, drug.generic];
  for (const f of fields) {
    if (!f) continue;
    const fl = f.toLowerCase();
    if (fl === lower) score += 100;
    else if (fl.startsWith(lower)) score += 50;
    else if (fl.includes(lower)) score += 10;
  }
  return score;
}

function rankDrugs(pool: CatalogDrug[], query: string, limit: number): CatalogDrug[] {
  const q = query.trim();
  if (!q) return pool.slice(0, limit);
  const lower = q.toLowerCase();
  return pool
    .map((d) => ({ d, score: drugMatchScore(d, lower) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.d);
}

/** 右欄大項。檢驗、處置、藥品依這個順序；特材排在藥品後面。 */
export const DRUG_RAIL_SECTIONS = ["檢查", "處置", "用藥", "材料"] as const;
export type DrugRailSection = (typeof DRUG_RAIL_SECTIONS)[number];

export const DRUG_RAIL_SECTION_LABEL: Record<DrugRailSection, string> = {
  檢查: "檢驗",
  處置: "處置",
  用藥: "藥品",
  材料: "材料",
};

export function drugRailSection(drug: CatalogDrug): DrugRailSection {
  const cast = `${drug.cast || ""} ${drug.typeName || ""}`;
  const route = `${drug.route || ""} ${drug.useType || ""}`.toLowerCase();
  if (cast.includes("檢查") || route.includes("exam")) return "檢查";
  if (
    cast.includes("治療") ||
    cast.includes("手術") ||
    cast.includes("處置") ||
    route.includes("treatment")
  ) {
    return "處置";
  }
  if (cast.includes("特材") || cast.includes("材料") || route.includes("material")) return "材料";
  return "用藥";
}

export function searchDrugs(drugs: CatalogDrug[], query: string, limit = 12): CatalogDrug[] {
  const opened = drugs.filter((d) => d.clinicIndex === true);
  const pool = opened.length ? opened : drugs;
  return rankDrugs(pool, query, limit);
}

function hasCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

/** "wound finger" matches "open wound of finger". Order does not matter. */
export function textHasAllWords(text: string, query: string): boolean {
  const hay = (text || "").toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length >= 2);
  if (!hay || words.length < 2) return false;
  return words.every((word) => hay.includes(word));
}

function fieldScore(value: string | undefined, query: string): number {
  const text = (value || "").trim().toLowerCase();
  if (!text || !query) return 0;
  if (text === query) return 300;
  if (text.startsWith(query)) return 160;
  if (text.includes(query)) return 40;
  if (textHasAllWords(text, query)) return 30;
  return 0;
}

/** English unless the doctor typed Chinese. Rows with no English name stay in Chinese. */
export function diagnosisLabel(hit: CatalogDiagnosis, query = ""): string {
  const q = query.trim();
  const en = (hit.nameEn || "").trim();
  const zh = (hit.nameZh || "").trim();
  const text = (hit.text || "").trim();
  const enLabel = en && !hasCjk(en) ? en : text && !hasCjk(text) ? text : "";
  if (q && hasCjk(q)) {
    if (zh && hasCjk(zh)) return zh;
    if (hasCjk(text)) return text;
  }
  return enLabel || zh || text;
}

function sameDiagnosis(row: CatalogDiagnosis, query: string): string {
  return [
    (row.icd9 || row.aCode || "").replace(/\./g, "").trim().toUpperCase(),
    (row.icd10 || row.nhiIcd10 || "").replace(/\./g, "").trim().toUpperCase(),
    diagnosisLabel(row, query).trim().toLowerCase(),
  ].join("|");
}

function uniqueDiagnoses(rows: CatalogDiagnosis[], query: string): CatalogDiagnosis[] {
  const seen = new Set<string>();
  const out: CatalogDiagnosis[] = [];
  for (const row of rows) {
    const key = sameDiagnosis(row, query);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function searchDiagnoses(
  items: CatalogDiagnosis[],
  query: string,
  limit = 12,
  dedupe = true,
): CatalogDiagnosis[] {
  const q = query.trim();
  const opened = items.filter((d) => d.enabled !== "N");
  const pool = opened.length ? opened : items;
  if (!q) return uniqueDiagnoses(pool, "").slice(0, limit);
  const lower = q.toLowerCase();
  const cjk = hasCjk(q);
  const codeQuery = lower.replace(/\./g, "");
  const ranked = pool
    .map((d, index) => {
      const en = Math.max(fieldScore(d.nameEn, lower), fieldScore(d.text, lower));
      const zh = fieldScore(d.nameZh, lower);
      const code = Math.max(
        fieldScore(d.short, lower),
        fieldScore(d.icd9, codeQuery),
        fieldScore((d.icd10 || "").replace(/\./g, ""), codeQuery),
        fieldScore((d.nhiIcd10 || "").replace(/\./g, ""), codeQuery),
        fieldScore(d.aCode, codeQuery),
      );
      let score = Math.max(en, code);
      if (cjk) score = Math.max(score, zh + (zh >= 300 ? 20 : 0));
      else if (zh > 0) score = Math.max(score, Math.min(zh, 30));
      const typed = (d.nameEn || d.text || "").trim();
      if (!cjk && typed === q) score += 5;
      return { d, score, index };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.d);
  const list = dedupe ? uniqueDiagnoses(ranked, q) : ranked;
  return list.slice(0, limit);
}

/** 右欄瀏覽：無字顯示診所常用清單；有字再篩選 */
export function browseDiagnoses(
  items: CatalogDiagnosis[],
  query: string,
  limit = 200,
): CatalogDiagnosis[] {
  return searchDiagnoses(items, query, limit);
}

export function browseDrugs(
  drugs: CatalogDrug[],
  query: string,
  limit = 5000,
  indexedOnly = true,
): CatalogDrug[] {
  const opened = drugs.filter((d) => d.clinicIndex === true);
  const pool = indexedOnly && opened.length ? opened : drugs;
  const q = query.trim().toLowerCase();
  const rows = pool.map((d, index) => ({
    d,
    index,
    score: q ? drugMatchScore(d, q) : 0,
  }));
  const matched = q ? rows.filter((row) => row.score > 0) : rows;
  matched.sort((a, b) => {
    const section =
      DRUG_RAIL_SECTIONS.indexOf(drugRailSection(a.d)) - DRUG_RAIL_SECTIONS.indexOf(drugRailSection(b.d));
    if (section) return section;
    if (!q) {
      const common = Number(b.d.clinicIndex === true) - Number(a.d.clinicIndex === true);
      if (common) return common;
      const sortA = Number(a.d.sort ?? a.d.typeSort ?? a.index);
      const sortB = Number(b.d.sort ?? b.d.typeSort ?? b.index);
      if (sortA !== sortB) return sortA - sortB;
    } else if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.index - b.index;
  });
  return matched.slice(0, limit).map((row) => row.d);
}
