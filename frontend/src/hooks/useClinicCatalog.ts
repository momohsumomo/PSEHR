import { useCallback, useEffect, useState } from "react";
import type { ClinicCatalog } from "@/types/clinicCatalog";
import {
  fetchCatalogOverrides,
  saveCatalogOverrides,
  type CatalogOverrides,
} from "@/api/clinicApi";

const EMPTY: ClinicCatalog = { drugs: [], diagnoses: [], packages: [], usages: [], routes: [] };

const EMPTY_OVERRIDES: CatalogOverrides = {
  drugs: [],
  diagnoses: [],
  packages: [],
  usages: [],
  ccTemplates: [],
  deletedDrugKeys: [],
  deletedDxKeys: [],
  deletedPackageKeys: [],
};

function normalizeCatalog(raw: ClinicCatalog): ClinicCatalog {
  return {
    drugs: (raw.drugs || []).map((d) => ({
      ...d,
      drugNo: (d.drugNo || "").replace(/[\x00-\x1f]/g, "").trim(),
      customName: (d.customName || "").trim() || d.shortName || "",
      alias: (d.alias || d.shortName || "").trim(),
      shortName: (d.shortName || d.alias || "").trim(),
      name: d.name || d.customName || "",
      generic: d.generic || "",
    })),
    diagnoses: (raw.diagnoses || []).map((dg) => ({
      ...dg,
      snomed: dg.snomed || "",
      nhiIcd10: dg.nhiIcd10 || "",
    })),
    packages: (raw.packages || []).map((pkg) => ({
      ...pkg,
      id: pkg.id || pkg.code || "",
      code: pkg.code || pkg.id || "",
      dxCode: pkg.dxCode || "",
      lines: pkg.lines || [],
      items: pkg.items || [],
    })),
    usages: (raw.usages || []).map((u) => ({
      ...u,
      code: String(u.code || "").trim(),
      frequency: Number(u.frequency) || 0,
      isTotal: String(u.isTotal ?? ""),
      label: String(u.label || u.eatType || ""),
      eatType: String(u.eatType || ""),
    })),
    routes: (raw.routes || []).map((r) => String(r).trim()).filter(Boolean),
  };
}

type DrugTypeRow = { alias?: string; nhiCode?: string; drugType?: string };

function attachDrugTypes(catalog: ClinicCatalog, rows: DrugTypeRow[]): ClinicCatalog {
  const byPair = new Map<string, string>();
  for (const row of rows) {
    const alias = String(row.alias || "").trim().toUpperCase();
    const nhi = String(row.nhiCode || "").trim().toUpperCase();
    const form = String(row.drugType || "").trim();
    if (!alias || !form) continue;
    byPair.set(`${alias}|${nhi}`, form);
  }
  return {
    ...catalog,
    drugs: catalog.drugs.map((drug) => {
      if (String(drug.drugType || "").trim()) return drug;
      const alias = String(drug.alias || drug.shortName || "").trim().toUpperCase();
      const nhi = String(drug.nhiCode || "").trim().toUpperCase();
      const form = byPair.get(`${alias}|${nhi}`) || "";
      return form ? { ...drug, drugType: form } : drug;
    }),
  };
}

function drugKey(d: { nhiCode?: string; drugNo?: string; name?: string; alias?: string }): string {
  // 必須用 drugNo／alias，不能用 nhiCode：同健保碼可有多筆診所自定名（如 條 vs 條涼）
  return String(d.drugNo || d.alias || d.name || d.nhiCode || "").trim();
}

function dxKey(d: { short?: string; icd10?: string; nhiIcd10?: string; text?: string; name?: string }): string {
  return String(d.short || d.icd10 || d.nhiIcd10 || d.text || d.name || "").trim();
}

function pkgKey(p: { id?: string; code?: string }): string {
  return String(p.id || p.code || "").trim();
}

function mergeCatalog(base: ClinicCatalog, ov: CatalogOverrides): ClinicCatalog {
  const delDrug = new Set(ov.deletedDrugKeys || []);
  const delDx = new Set(ov.deletedDxKeys || []);
  const delPkg = new Set(ov.deletedPackageKeys || []);

  const drugMap = new Map<string, any>();
  for (const d of base.drugs) {
    const k = drugKey(d);
    if (k && !delDrug.has(k)) drugMap.set(k, d);
  }
  for (const d of ov.drugs || []) {
    const k = drugKey(d as any);
    if (k) drugMap.set(k, { ...(drugMap.get(k) || {}), ...d });
  }

  const dxMap = new Map<string, any>();
  for (const d of base.diagnoses) {
    const k = dxKey(d as any);
    if (k && !delDx.has(k)) dxMap.set(k, d);
  }
  for (const d of ov.diagnoses || []) {
    const k = dxKey(d as any);
    if (k) dxMap.set(k, { ...(dxMap.get(k) || {}), ...d });
  }

  const pkgMap = new Map<string, any>();
  for (const p of base.packages) {
    const k = pkgKey(p);
    if (k && !delPkg.has(k)) pkgMap.set(k, p);
  }
  for (const p of ov.packages || []) {
    const k = pkgKey(p as any);
    if (k) pkgMap.set(k, { ...(pkgMap.get(k) || {}), ...p });
  }

  const usageMap = new Map<string, any>();
  for (const u of base.usages || []) {
    if (u.code) usageMap.set(u.code, u);
  }
  for (const u of ov.usages || []) {
    const code = String(u.code || u.short || "").trim();
    if (code) usageMap.set(code, { ...(usageMap.get(code) || {}), ...u, code });
  }

  return {
    drugs: [...drugMap.values()],
    diagnoses: [...dxMap.values()],
    packages: [...pkgMap.values()],
    usages: [...usageMap.values()],
    routes: base.routes || [],
  };
}

export function useClinicCatalog() {
  const [base, setBase] = useState<ClinicCatalog>(EMPTY);
  const [overrides, setOverrides] = useState<CatalogOverrides>(EMPTY_OVERRIDES);
  const [catalog, setCatalog] = useState<ClinicCatalog>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    let baseCat = EMPTY;
    let baseOk = false;
    try {
      const res = await fetch("/yisheng_clinic_catalog.json");
      if (res.ok) {
        baseCat = normalizeCatalog((await res.json()) as ClinicCatalog);
        baseOk = true;
      } else {
        setNotice(`載入目錄失敗（HTTP ${res.status}）`);
      }
    } catch (e) {
      setNotice(e instanceof Error ? `載入目錄失敗：${e.message}` : "載入目錄失敗");
    }
    try {
      const extra = await fetch("/yisheng_drug_types.json");
      if (extra.ok) {
        const body = (await extra.json()) as { rows?: DrugTypeRow[] };
        baseCat = attachDrugTypes(baseCat, body.rows || []);
      }
    } catch {
      /* 劑型清單沒載到時，藥品其他欄位仍可用 */
    }
    let ov = EMPTY_OVERRIDES;
    try {
      const r = await fetchCatalogOverrides();
      ov = { ...EMPTY_OVERRIDES, ...r.data };
    } catch {
      /* overrides optional when offline */
    }
    const merged = mergeCatalog(baseCat, ov);
    console.info(
      "[useClinicCatalog]",
      `drugs=${merged.drugs.length}`,
      `diagnoses=${merged.diagnoses.length}`,
      `packages=${merged.packages.length}`,
      `baseOk=${baseOk}`,
    );
    setBase(baseCat);
    setOverrides(ov);
    setCatalog(merged);
    if (baseOk) {
      setNotice(
        `藥品 ${merged.drugs.length} / 病名 ${merged.diagnoses.length} / 藥組 ${merged.packages.length}`,
      );
    } else if (!merged.drugs.length && !merged.diagnoses.length && !merged.packages.length) {
      setNotice((prev) => prev || "目錄為空或載入失敗");
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const persistOverrides = useCallback(
    async (next: CatalogOverrides) => {
      setOverrides(next);
      setCatalog(mergeCatalog(base, next));
      await saveCatalogOverrides(next);
    },
    [base],
  );

  const upsertDrug = useCallback(
    async (drug: Record<string, unknown>) => {
      const k = drugKey(drug as any);
      if (!k) throw new Error("藥品需有健保代碼或藥碼");
      const drugs = [
        ...(overrides.drugs || []).filter((d) => drugKey(d as any) !== k),
        drug,
      ];
      const deletedDrugKeys = (overrides.deletedDrugKeys || []).filter((x) => x !== k);
      await persistOverrides({ ...overrides, drugs, deletedDrugKeys });
    },
    [overrides, persistOverrides],
  );

  const removeDrug = useCallback(
    async (key: string) => {
      const drugs = (overrides.drugs || []).filter((d) => drugKey(d as any) !== key);
      const deletedDrugKeys = Array.from(new Set([...(overrides.deletedDrugKeys || []), key]));
      await persistOverrides({ ...overrides, drugs, deletedDrugKeys });
    },
    [overrides, persistOverrides],
  );

  const upsertDiagnosis = useCallback(
    async (dx: Record<string, unknown>) => {
      const k = dxKey(dx as any);
      if (!k) throw new Error("病名需有 ICD 或名稱");
      const diagnoses = [
        ...(overrides.diagnoses || []).filter((d) => dxKey(d as any) !== k),
        dx,
      ];
      const deletedDxKeys = (overrides.deletedDxKeys || []).filter((x) => x !== k);
      await persistOverrides({ ...overrides, diagnoses, deletedDxKeys });
    },
    [overrides, persistOverrides],
  );

  const removeDiagnosis = useCallback(
    async (key: string) => {
      const diagnoses = (overrides.diagnoses || []).filter((d) => dxKey(d as any) !== key);
      const deletedDxKeys = Array.from(new Set([...(overrides.deletedDxKeys || []), key]));
      await persistOverrides({ ...overrides, diagnoses, deletedDxKeys });
    },
    [overrides, persistOverrides],
  );

  const upsertPackage = useCallback(
    async (pkg: Record<string, unknown>) => {
      const k = pkgKey(pkg as any);
      if (!k) throw new Error("藥組需有代碼");
      const packages = [
        ...(overrides.packages || []).filter((p) => pkgKey(p as any) !== k),
        pkg,
      ];
      const deletedPackageKeys = (overrides.deletedPackageKeys || []).filter((x) => x !== k);
      await persistOverrides({ ...overrides, packages, deletedPackageKeys });
    },
    [overrides, persistOverrides],
  );

  const removePackage = useCallback(
    async (key: string) => {
      const packages = (overrides.packages || []).filter((p) => pkgKey(p as any) !== key);
      const deletedPackageKeys = Array.from(
        new Set([...(overrides.deletedPackageKeys || []), key]),
      );
      await persistOverrides({ ...overrides, packages, deletedPackageKeys });
    },
    [overrides, persistOverrides],
  );

  const upsertUsage = useCallback(
    async (usage: Record<string, unknown>) => {
      const code = String(usage.code || usage.short || "").trim();
      if (!code) throw new Error("用法需有簡碼");
      const usages = [
        ...(overrides.usages || []).filter(
          (u) => String(u.code || u.short || "").trim() !== code,
        ),
        usage,
      ];
      await persistOverrides({ ...overrides, usages });
    },
    [overrides, persistOverrides],
  );

  const removeUsage = useCallback(
    async (code: string) => {
      const usages = (overrides.usages || []).filter(
        (u) => String(u.code || u.short || "").trim() !== code,
      );
      await persistOverrides({ ...overrides, usages });
    },
    [overrides, persistOverrides],
  );

  return {
    catalog,
    loaded,
    notice,
    overrides,
    reload,
    upsertDrug,
    removeDrug,
    upsertDiagnosis,
    removeDiagnosis,
    upsertPackage,
    removePackage,
    upsertUsage,
    removeUsage,
  };
}
