import { useEffect, useState } from "react";
import type { CatalogDiagnosis } from "@/types/clinicCatalog";

export type IcdSplit = {
  icd9: string;
  icd10: string;
  nameEn: string;
  nameZh: string;
};

type DiagnoseFileRow = {
  short?: string;
  icd9?: string;
  aCode?: string;
  icd10?: string;
  nameEn?: string;
  nameZh?: string;
  category?: string;
  special?: string;
  enabled?: string;
};

type LinkRow = { icd10?: string; en?: string; zh?: string };

function bare(code: string | undefined): string {
  return (code || "").replace(/\./g, "").trim().toUpperCase();
}

function queryMode(query: string): "icd9" | "icd10" | "name" {
  const text = query.trim().toUpperCase().replace(/\./g, "");
  if (/^\d{3,5}$/.test(text) || /^[VE]\d{3,4}$/.test(text)) return "icd9";
  if (/^[A-Z][0-9][0-9A-Z]{0,6}$/.test(text)) return "icd10";
  return "name";
}

let masterRows: CatalogDiagnosis[] = [];
let pending: Promise<Map<string, IcdSplit[]>> | null = null;

function toDiagnosis(row: DiagnoseFileRow): CatalogDiagnosis {
  const icd9 = bare(row.icd9 || row.aCode);
  const icd10 = bare(row.icd10);
  return {
    icd10,
    nhiIcd10: icd10,
    text: String(row.nameEn || row.nameZh || "").trim(),
    short: String(row.short || "").trim(),
    nameEn: String(row.nameEn || "").trim(),
    nameZh: String(row.nameZh || "").trim(),
    icd9,
    aCode: bare(row.aCode || row.icd9),
    snomed: "",
    category: String(row.category || "").trim(),
    special: String(row.special || "").trim(),
    enabled: String(row.enabled || "").trim(),
  };
}

export function loadIcdSplits(): Promise<Map<string, IcdSplit[]>> {
  if (!pending) {
    pending = fetch("/yisheng_diagnose.json")
      .then((res) => res.json())
      .then((data: { rows?: DiagnoseFileRow[]; links?: Record<string, LinkRow[]> }) => {
        masterRows = (data.rows || []).map(toDiagnosis);
        const map = new Map<string, IcdSplit[]>();
        for (const [code, list] of Object.entries(data.links || {})) {
          const icd9 = bare(code);
          if (!icd9 || !Array.isArray(list)) continue;
          map.set(
            icd9,
            list
              .map((item) => ({
                icd9,
                icd10: bare(item.icd10),
                nameEn: String(item.en || "").trim(),
                nameZh: String(item.zh || "").trim(),
              }))
              .filter((item) => item.icd10),
          );
        }
        return map;
      });
  }
  return pending;
}

export function useIcdSplits(): Map<string, IcdSplit[]> {
  const [map, setMap] = useState<Map<string, IcdSplit[]>>(() => new Map());
  useEffect(() => {
    let cancel = false;
    loadIcdSplits()
      .then((next) => {
        if (!cancel) setMap(next);
      })
      .catch(() => {
        if (!cancel) setMap(new Map());
      });
    return () => {
      cancel = true;
    };
  }, []);
  return map;
}

/**
 * Same window as the old condition search.
 * A word matches the sick name. An ICD-9 lists every sick name on that code.
 * The lower list is the separate ICD-10 table for the selected ICD-9.
 */
export function briefDiagnoses(
  items: CatalogDiagnosis[],
  query: string,
  limit: number,
  splits: Map<string, IcdSplit[]>,
): CatalogDiagnosis[] {
  void splits;
  const pool = masterRows.length ? masterRows : items;
  const q = query.trim();
  if (!q) {
    const opened = pool.filter((row) => row.enabled === "Y");
    return (opened.length ? opened : pool).slice(0, limit);
  }
  const mode = queryMode(q);
  const needle = q.toLowerCase();
  const code = q.toUpperCase().replace(/\./g, "");
  const hits = pool.filter((row) => {
    if (mode === "icd9") {
      return row.enabled === "Y" && bare(row.icd9 || row.aCode).startsWith(code);
    }
    if (mode === "icd10") {
      return row.enabled === "Y" && bare(row.icd10 || row.nhiIcd10).startsWith(code);
    }
    const en = (row.nameEn || row.text || "").toLowerCase();
    const zh = (row.nameZh || "").toLowerCase();
    return en.includes(needle) || zh.includes(needle);
  });
  return hits.slice(0, limit);
}

export function splitsFor(map: Map<string, IcdSplit[]>, icd9: string): IcdSplit[] {
  return map.get(bare(icd9)) || [];
}

export function splitToDiagnosis(row: IcdSplit): CatalogDiagnosis {
  return {
    icd10: row.icd10,
    nhiIcd10: row.icd10,
    text: row.nameEn || row.nameZh,
    nameEn: row.nameEn,
    nameZh: row.nameZh,
    icd9: row.icd9,
    aCode: row.icd9,
    snomed: "",
  };
}
