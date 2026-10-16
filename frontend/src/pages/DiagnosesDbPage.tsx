import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useClinicCatalog } from "@/hooks/useClinicCatalog";
import {
  HisCatalogFBar,
  HisCatalogSplit,
  HisDataGrid,
  HisField,
  HisPageFrame,
  hisInputClass,
} from "@/components/clinic/HisPageFrame";
import { HisPrintToolShell } from "@/components/clinic/HisPrintToolShell";
import { HIS, HIS_FBAR_COLORS } from "@/lib/hisTheme";
import { useEscLayer } from "@/hooks/useEscLayer";

type DxRow = {
  short: string;
  nameEn: string;
  nameZh: string;
  icd9: string;
  aCode: string;
  icd10: string;
  icd10From: string;
  icd10En: string;
  icd10Zh: string;
  special: string;
  category: string;
  enabled: string;
  sort: string;
  typeSort: string;
  group: string;
};

type IcdLink = { icd10: string; en: string; zh: string };

type DxFile = {
  rows: DxRow[];
  links: Record<string, IcdLink[]>;
  categories: string[];
};

const emptyRow = (): DxRow => ({
  short: "",
  nameEn: "",
  nameZh: "",
  icd9: "",
  aCode: "",
  icd10: "",
  icd10From: "",
  icd10En: "",
  icd10Zh: "",
  special: "",
  category: "",
  enabled: "Y",
  sort: "9999",
  typeSort: "",
  group: "",
});

function asRow(raw: Record<string, unknown>, fallback?: DxRow): DxRow {
  const base = fallback || emptyRow();
  const text = String(raw.text ?? "");
  return {
    short: String(raw.short ?? base.short),
    nameEn: String(raw.nameEn ?? (text || base.nameEn)),
    nameZh: String(raw.nameZh ?? base.nameZh),
    icd9: String(raw.icd9 ?? base.icd9),
    aCode: String(raw.aCode ?? base.aCode),
    icd10: String(raw.icd10 ?? base.icd10),
    icd10From: String(raw.icd10From ?? base.icd10From),
    icd10En: String(raw.icd10En ?? base.icd10En),
    icd10Zh: String(raw.icd10Zh ?? base.icd10Zh),
    special: String(raw.special ?? base.special),
    category: String(raw.category ?? base.category),
    enabled: String(raw.enabled ?? base.enabled),
    sort: String(raw.sort ?? base.sort),
    typeSort: String(raw.typeSort ?? base.typeSort),
    group: String(raw.group ?? base.group),
  };
}

export function DiagnosesDbPage() {
  const navigate = useNavigate();
  const { overrides, upsertDiagnosis, removeDiagnosis } = useClinicCatalog();
  const [file, setFile] = useState<DxFile | null>(null);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [selectedShort, setSelectedShort] = useState<string | null>(null);
  const [form, setForm] = useState<DxRow>(emptyRow());
  const [enRole, setEnRole] = useState<"show" | "print">("show");
  const [zhRole, setZhRole] = useState<"show" | "print">("show");
  const [quickAdd, setQuickAdd] = useState(true);
  const [linkPick, setLinkPick] = useState(0);
  const [notice, setNotice] = useState<string | null>("讀取病名檔…");
  const [busy, setBusy] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);
  const shortRef = useRef<HTMLInputElement>(null);

  useEscLayer([
    { open: printOpen, close: () => setPrintOpen(false) },
    { open: true, close: () => navigate("/") },
  ]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/yisheng_diagnose.json")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<DxFile>;
      })
      .then((data) => {
        if (cancelled) return;
        setFile({
          rows: data.rows || [],
          links: data.links || {},
          categories: data.categories || [],
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "病名檔載入失敗");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    const base = file?.rows || [];
    const deleted = new Set(overrides.deletedDxKeys || []);
    const byShort = new Map<string, Record<string, unknown>>();
    for (const raw of overrides.diagnoses || []) {
      const rec = raw as Record<string, unknown>;
      const key = String(rec.short || "").trim();
      if (key) byShort.set(key, rec);
    }
    const merged = base
      .filter((row) => !deleted.has(row.short) && !deleted.has(row.icd10))
      .map((row) => {
        const ov = byShort.get(row.short);
        return ov ? asRow(ov, row) : row;
      });
    const known = new Set(merged.map((row) => row.short));
    for (const [key, ov] of byShort) {
      if (!known.has(key) && !deleted.has(key)) merged.push(asRow(ov));
    }
    return merged;
  }, [file, overrides.deletedDxKeys, overrides.diagnoses]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (q) {
      const exact = rows.filter((row) => row.short.toUpperCase() === q);
      if (exact.length) return exact;
    }
    return rows.filter((row) => {
      if (!q) return showAll || row.enabled === "Y";
      const name = `${row.nameEn} ${row.nameZh} ${row.category}`.toUpperCase();
      const code = (value: string) => {
        const v = value.toUpperCase();
        return v === q || v.startsWith(q);
      };
      return name.includes(q) || code(row.short) || code(row.icd9) || code(row.aCode) || code(row.icd10);
    });
  }, [rows, search, showAll]);

  const links = file?.links[form.icd9] || [];
  const categories = file?.categories || [];

  useEffect(() => {
    if (!file) {
      if (loadError) setNotice(loadError);
      return;
    }
    const enabled = file.rows.filter((row) => row.enabled === "Y");
    const added = enabled.filter((row) => row.icd10From && row.icd10From !== "file").length;
    setNotice(`病名檔 ${file.rows.length} 筆，選用 ${enabled.length} 筆。原本沒寫 ICD-10 的選用病名已補 ${added} 筆。`);
  }, [file, loadError]);

  const load = (row: DxRow | null) => {
    if (!row) {
      setSelectedShort(null);
      setForm(emptyRow());
      setLinkPick(0);
      return;
    }
    setSelectedShort(row.short);
    setForm(row);
    setEnRole("show");
    setZhRole("show");
    setLinkPick(0);
  };

  useEffect(() => {
    if (!filtered.length) return;
    if (selectedShort && filtered.some((row) => row.short === selectedShort)) return;
    load(filtered[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, search, showAll, filtered.length]);

  const patch = (part: Partial<DxRow>) => setForm((prev) => ({ ...prev, ...part }));

  const applyLink = (link: IcdLink) => {
    patch({
      icd10: link.icd10,
      icd10En: link.en,
      icd10Zh: link.zh,
      icd10From: "file",
    });
  };

  const save = async () => {
    const short = form.short.trim().toUpperCase();
    if (!short || (!form.nameEn.trim() && !form.nameZh.trim())) {
      setNotice("診斷簡稱和名稱要填。");
      return;
    }
    if (!form.icd9.trim() && !form.icd10.trim()) {
      setNotice("ICD-9 或 ICD-10 至少要有一個。");
      return;
    }
    setBusy(true);
    try {
      const next = { ...form, short };
      await upsertDiagnosis({
        ...next,
        text: next.nameEn || next.nameZh,
        nhiIcd10: next.icd10,
        snomed: "",
      });
      setForm(next);
      setSelectedShort(short);
      setNotice(quickAdd ? `${short} 已存檔。` : `${short} 已存檔。`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "存檔失敗");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    const key = selectedShort || form.short.trim();
    if (!key) {
      setNotice("請先選一筆。");
      return;
    }
    setBusy(true);
    try {
      await removeDiagnosis(key);
      setNotice(`已刪除 ${key}`);
      load(filtered.find((row) => row.short !== key) ?? null);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "刪除失敗");
    } finally {
      setBusy(false);
    }
  };

  const title = form.icd10En
    ? `英文名稱：${form.icd10En}${form.icd10Zh ? `(${form.icd10Zh})` : ""}`
    : "診斷資料";

  const exportText = filtered
    .map((row) => [row.short, row.icd9, row.icd10, row.nameEn, row.nameZh].join("\t"))
    .join("\n");

  return (
    <HisPageFrame
      title={title}
      notice={notice}
      onEsc={() => navigate("/")}
      footer={
        <HisCatalogFBar
          items={[
            {
              key: "F2",
              label: "新增",
              color: HIS_FBAR_COLORS.F2,
              onClick: () => {
                load(null);
                setForm(emptyRow());
                setNotice("新增：填好後按存檔。");
                setTimeout(() => shortRef.current?.focus(), 0);
              },
            },
            {
              key: "F3",
              label: "修改",
              color: HIS_FBAR_COLORS.F3,
              onClick: () => setNotice("修改：改完按存檔。"),
            },
            {
              key: "F4",
              label: "篩選",
              color: HIS_FBAR_COLORS.F4,
              onClick: () => filterRef.current?.focus(),
            },
            { key: "F5", label: "刪除", color: HIS_FBAR_COLORS.F5, onClick: () => void onDelete(), disabled: busy },
            {
              key: "F6",
              label: "診斷帶藥",
              color: HIS_FBAR_COLORS.F6,
              onClick: () => setNotice("這間診所的診斷帶藥檔是空的，沒有可帶的藥。"),
            },
            {
              key: "F7",
              label: "禁忌藥品",
              color: HIS_FBAR_COLORS.F7,
              onClick: () => setNotice("這間沒有另存的禁忌藥品清單。"),
            },
            { key: "F9", label: "存檔", color: HIS_FBAR_COLORS.F9, onClick: () => void save(), disabled: busy },
            {
              key: "F8",
              label: "列印",
              color: HIS_FBAR_COLORS.F8,
              onClick: () => setPrintOpen(true),
            },
            { key: "Esc", label: "離開", color: HIS_FBAR_COLORS.Esc, onClick: () => navigate("/") },
          ]}
        />
      }
    >
      <HisCatalogSplit
        formWidth="46%"
        form={
          <div className="flex flex-col gap-1 p-1">
            <HisField label="診斷簡稱">
              <input
                ref={shortRef}
                className={`${hisInputClass} font-mono`}
                value={form.short}
                onChange={(e) => patch({ short: e.target.value.toUpperCase() })}
              />
            </HisField>
            <NameRow
              label="名稱(英)"
              value={form.nameEn}
              onChange={(nameEn) => patch({ nameEn })}
              role={enRole}
              onRole={setEnRole}
              show="顯示A"
              print="列印B"
            />
            <NameRow
              label="名稱(中)"
              value={form.nameZh}
              onChange={(nameZh) => patch({ nameZh })}
              role={zhRole}
              onRole={setZhRole}
              show="顯示C"
              print="列印D"
            />
            <HisField label="ICD-10名稱">
              <input className={hisInputClass} readOnly value={form.icd10En} />
            </HisField>
            <div className="grid grid-cols-2 gap-1">
              <HisField label="ICD-9">
                <input
                  className={`${hisInputClass} font-mono`}
                  value={form.icd9}
                  onChange={(e) => patch({ icd9: e.target.value.toUpperCase() })}
                />
              </HisField>
              <HisField label="A-CODE">
                <input
                  className={`${hisInputClass} font-mono`}
                  value={form.aCode}
                  onChange={(e) => patch({ aCode: e.target.value.toUpperCase() })}
                />
              </HisField>
              <HisField label="ICD-10">
                <input
                  className={`${hisInputClass} font-mono`}
                  value={form.icd10}
                  onChange={(e) => {
                    const icd10 = e.target.value.toUpperCase().replace(/\./g, "");
                    const hit = links.find((item) => item.icd10 === icd10);
                    patch({
                      icd10,
                      icd10From: "file",
                      icd10En: hit?.en || form.icd10En,
                      icd10Zh: hit?.zh || form.icd10Zh,
                    });
                  }}
                />
              </HisField>
              <HisField label="特診代號">
                <input
                  className={`${hisInputClass} font-mono`}
                  value={form.special}
                  onChange={(e) => patch({ special: e.target.value })}
                />
              </HisField>
              <HisField label="醫師群組">
                <select className={hisInputClass} value={form.group} onChange={(e) => patch({ group: e.target.value })}>
                  <option value="">{form.group ? "" : ""}</option>
                  {form.group ? <option value={form.group}>{form.group}</option> : null}
                </select>
              </HisField>
              <HisField label="選用">
                <select className={hisInputClass} value={form.enabled} onChange={(e) => patch({ enabled: e.target.value })}>
                  <option value="Y">Y</option>
                  <option value="N">N</option>
                  <option value="">未標</option>
                </select>
              </HisField>
            </div>
            <HisField label="自定分類">
              <select className={hisInputClass} value={form.category} onChange={(e) => patch({ category: e.target.value })}>
                <option value="" />
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
                {form.category && !categories.includes(form.category) ? (
                  <option value={form.category}>{form.category}</option>
                ) : null}
              </select>
            </HisField>
            <HisField label="批價類別">
              <select className={hisInputClass} value="" disabled>
                <option value="" />
              </select>
            </HisField>
            <div className="grid grid-cols-2 gap-1">
              <HisField label="常用排序">
                <input className={hisInputClass} value={form.sort} onChange={(e) => patch({ sort: e.target.value })} />
              </HisField>
              <HisField label="類別排序">
                <input
                  className={hisInputClass}
                  value={form.typeSort}
                  onChange={(e) => patch({ typeSort: e.target.value })}
                />
              </HisField>
            </div>
            <label className="flex items-center gap-1 px-1 text-[12px]">
              <input type="checkbox" checked={quickAdd} onChange={(e) => setQuickAdd(e.target.checked)} />
              選項式快速新增
            </label>
          </div>
        }
        list={
          <div className="flex min-h-0 flex-1 flex-col">
            <div
              className="flex shrink-0 items-center gap-1 border-b px-1 py-0.5"
              style={{ borderColor: HIS.chromeBorder, background: HIS.chrome }}
            >
              <span className="font-bold" style={{ fontSize: HIS.fs.secondary }}>
                篩選
              </span>
              <input
                ref={filterRef}
                type="search"
                className={hisInputClass}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <label className="flex shrink-0 items-center gap-0.5" style={{ fontSize: HIS.fs.tertiary }}>
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
                全部
              </label>
              <span className="shrink-0 font-mono" style={{ fontSize: HIS.fs.tertiary }}>
                {filtered.length}
              </span>
            </div>
            <HisDataGrid
              columns={[
                { key: "short", label: "病名檔", width: "4.2rem", mono: true },
                { key: "icd9", label: "Acode", width: "4.2rem", mono: true },
                { key: "nameEn", label: "名稱[英]" },
              ]}
              rows={filtered}
              rowKey={(row) => row.short}
              selectedKey={selectedShort}
              onSelect={load}
              cell={(row, key) => (key === "short" ? row.short : key === "icd9" ? row.icd9 : row.nameEn)}
            />
            <div className="flex min-h-0 flex-[0_0_42%] flex-col border-t" style={{ borderColor: HIS.chromeBorder }}>
              <div
                className="flex shrink-0 items-center gap-1 border-b px-1 py-0.5"
                style={{ borderColor: HIS.chromeBorder, background: "#F7F3C8" }}
              >
                <span className="font-bold" style={{ fontSize: HIS.fs.secondary }}>
                  ICD-9 對應 ICD-10
                </span>
                <button
                  type="button"
                  className="border px-1"
                  style={{ borderColor: HIS.chromeBorder, background: "#fff", fontSize: HIS.fs.tertiary }}
                  onClick={() => {
                    const link = links[linkPick];
                    if (!link) {
                      setNotice("這筆 ICD-9 沒有對應的 ICD-10。");
                      return;
                    }
                    applyLink(link);
                    setNotice(`已把 ${link.icd10} 放到 ICD-10，按存檔才會寫入。`);
                  }}
                >
                  複製ICD-10碼至DATA
                </button>
              </div>
              <div className="min-h-0 flex-1" style={{ background: "#FFF8C6" }}>
                <HisDataGrid
                  columns={[
                    { key: "icd10", label: "ICD-10", width: "4.5rem", mono: true },
                    { key: "en", label: "ICD-10 英文名稱" },
                    { key: "zh", label: "10 中文", width: "7rem" },
                  ]}
                  rows={links}
                  rowKey={(row, index) => `${row.icd10}-${index}`}
                  selectedKey={links[linkPick] ? `${links[linkPick].icd10}-${linkPick}` : null}
                  onSelect={(_row, _index) => {
                    const index = links.indexOf(_row);
                    if (index >= 0) setLinkPick(index);
                  }}
                  cell={(row, key) => (key === "icd10" ? row.icd10 : key === "en" ? row.en : row.zh)}
                />
              </div>
            </div>
          </div>
        }
      />
      <HisPrintToolShell
        open={printOpen}
        title="診斷資料"
        onClose={() => setPrintOpen(false)}
        exportText={["病名檔\tICD-9\tICD-10\t英文\t中文", exportText].join("\n")}
        fileBaseName="診斷資料"
        paper="a4"
        statusText={`${filtered.length} 筆`}
      >
        <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 12 }}>{exportText}</pre>
      </HisPrintToolShell>
    </HisPageFrame>
  );
}

function NameRow({
  label,
  value,
  onChange,
  role,
  onRole,
  show,
  print,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  role: "show" | "print";
  onRole: (role: "show" | "print") => void;
  show: string;
  print: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2 px-1" style={{ fontSize: HIS.fs.secondary }}>
        <span className="font-bold">{label}</span>
        <label className="flex items-center gap-0.5">
          <input type="radio" name={label} checked={role === "show"} onChange={() => onRole("show")} />
          {show}
        </label>
        <label className="flex items-center gap-0.5">
          <input type="radio" name={label} checked={role === "print"} onChange={() => onRole("print")} />
          {print}
        </label>
      </div>
      <input className={hisInputClass} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
