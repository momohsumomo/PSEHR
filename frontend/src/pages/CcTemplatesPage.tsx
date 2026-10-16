import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDefaultUiConfig } from "@/hooks/useDefaultUiConfig";
import {
  fetchCatalogOverrides,
  saveCatalogOverrides,
  type CatalogOverrides,
} from "@/api/clinicApi";
import {
  HisCatalogFBar,
  HisCatalogSplit,
  HisDataGrid,
  HisField,
  HisPageFrame,
  hisInputClass,
  hisTextareaClass,
} from "@/components/clinic/HisPageFrame";
import { HIS, HIS_FBAR_COLORS } from "@/lib/hisTheme";
import { useEscLayer } from "@/hooks/useEscLayer";

type Row = { id: string; text: string; type: string };

const EMPTY_OV: CatalogOverrides = {
  drugs: [],
  diagnoses: [],
  packages: [],
  usages: [],
  ccTemplates: [],
  deletedDrugKeys: [],
  deletedDxKeys: [],
  deletedPackageKeys: [],
};

export function CcTemplatesPage() {
  const navigate = useNavigate();
  const { ccTemplates, ccChips } = useDefaultUiConfig();
  const [rows, setRows] = useState<Row[]>([]);
  const [ov, setOv] = useState<CatalogOverrides>(EMPTY_OV);
  const [form, setForm] = useState<Row>({ id: "", text: "", type: "" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [source, setSource] = useState<"api" | "local" | "default">("default");
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchCatalogOverrides();
        if (cancelled) return;
        const data = { ...EMPTY_OV, ...res.data };
        setOv(data);
        const fromApi = (data.ccTemplates || []).map((t) => ({
          id: String(t.id || ""),
          text: String(t.text || ""),
          type: String(t.type || ""),
        }));
        if (fromApi.length) {
          setRows(fromApi);
          setSource("api");
          setSelectedId(fromApi[0]?.id ?? null);
          setForm(fromApi[0] ?? { id: "", text: "", type: "" });
          setNotice(`已載入 ${fromApi.length} 筆`);
          return;
        }
      } catch {
        /* fall through to default_ui_config */
      }
      try {
        const raw = localStorage.getItem("wundadi-cc-templates");
        if (raw) {
          const parsed = JSON.parse(raw) as Row[];
          if (Array.isArray(parsed) && parsed.length) {
            if (!cancelled) {
              setRows(parsed);
              setSource("local");
              setSelectedId(parsed[0]?.id ?? null);
              setForm(parsed[0] ?? { id: "", text: "", type: "" });
              setNotice(`已載入 ${parsed.length} 筆`);
            }
            return;
          }
        }
      } catch {
        /* ignore */
      }
      if (cancelled) return;
      let next: Row[];
      if (ccTemplates.length) {
        next = ccTemplates.map((t) => ({ id: t.id, text: t.text, type: t.type || "" }));
      } else {
        next = ccChips.map((text, i) => ({
          id: `S${String(i + 1).padStart(3, "0")}`,
          text,
          type: "",
        }));
      }
      setRows(next);
      setSource("default");
      setSelectedId(next[0]?.id ?? null);
      setForm(next[0] ?? { id: "", text: "", type: "" });
      setNotice(`已載入 ${next.length} 筆`);
    })();
    return () => {
      cancelled = true;
    };
  }, [ccTemplates, ccChips]);

  useEscLayer([{ open: true, close: () => navigate("/") }]);

  const persist = async (next: Row[]) => {
    setRows(next);
    localStorage.setItem("wundadi-cc-templates", JSON.stringify(next));
    try {
      const nextOv = { ...ov, ccTemplates: next };
      await saveCatalogOverrides(nextOv);
      setOv(nextOv);
      setSource("api");
      setNotice("\u5df2\u5beb\u5165\u5f71\u5b50\u5eab\u4e3b\u8a34\u7bc4\u672c");
    } catch {
      setSource("local");
      setNotice("\u5f8c\u7aef\u672a\u9023\uff1a\u5df2\u5b58\u672c\u6a5f");
    }
  };

  const filtered = rows.filter(
    (r) =>
      r.text.toLowerCase().includes(search.toLowerCase()) ||
      r.id.toLowerCase().includes(search.toLowerCase()) ||
      r.type.toLowerCase().includes(search.toLowerCase()),
  );

  const loadRow = (r: Row | null) => {
    if (!r) {
      setSelectedId(null);
      setForm({ id: "", text: "", type: "" });
      return;
    }
    setSelectedId(r.id);
    setForm({ ...r });
  };

  const onNew = () => {
    const id = `S${String(rows.length + 1).padStart(3, "0")}`;
    setSelectedId(null);
    setForm({ id, text: "", type: "" });
    setNotice("\u65b0\u589e\u6a21\u5f0f\uff1a\u586b\u5beb\u5f8c\u6309 F9 \u5b58\u6a94");
  };

  const onSave = async () => {
    if (!form.id.trim() || !form.text.trim()) {
      setNotice("\u7c21\u7a31\u8207\u540d\u7a31\uff08\u5167\u6587\uff09\u5fc5\u586b");
      return;
    }
    const nextRow = { id: form.id.trim(), text: form.text.trim(), type: form.type.trim() };
    const exists = rows.some((r) => r.id === nextRow.id);
    const next = exists
      ? rows.map((r) => (r.id === nextRow.id ? nextRow : r))
      : [...rows, nextRow];
    await persist(next);
    setSelectedId(nextRow.id);
    setForm(nextRow);
  };

  const onDelete = async () => {
    const id = selectedId || form.id.trim();
    if (!id) {
      setNotice("\u8acb\u5148\u9078\u4e00\u7b46");
      return;
    }
    const next = rows.filter((x) => x.id !== id);
    await persist(next);
    loadRow(next[0] ?? null);
  };

  return (
    <HisPageFrame
      title={`5 \u4e3b\u8a34\u75c7\u72c0\uff08${source}\uff09`}
      notice={notice}
      onEsc={() => navigate("/")}
      footer={
        <HisCatalogFBar
          items={[
            { key: "F2", label: "\u65b0\u589e", color: HIS_FBAR_COLORS.F2, onClick: onNew },
            {
              key: "F3",
              label: "\u4fee\u6539",
              color: HIS_FBAR_COLORS.F3,
              onClick: () => {
                const r = rows.find((x) => x.id === selectedId);
                if (!r) {
                  setNotice("\u8acb\u5148\u5728\u53f3\u5074\u9078\u4e00\u7b46");
                  return;
                }
                loadRow(r);
                setNotice("\u4fee\u6539\u6a21\u5f0f\uff1a\u7de8\u8f2f\u5f8c\u6309 F9 \u5b58\u6a94");
              },
            },
            {
              key: "F4",
              label: "\u7be9\u9078",
              color: HIS_FBAR_COLORS.F4,
              onClick: () => {
                setFilterOpen(true);
                setTimeout(() => filterRef.current?.focus(), 0);
              },
            },
            { key: "F5", label: "\u522a\u9664", color: HIS_FBAR_COLORS.F5, onClick: () => void onDelete() },
            { key: "F9", label: "\u5b58\u6a94", color: HIS_FBAR_COLORS.F9, onClick: () => void onSave() },
            { key: "Esc", label: "\u96e2\u958b", color: HIS_FBAR_COLORS.Esc, onClick: () => navigate("/") },
          ]}
        />
      }
    >
      <HisCatalogSplit
        formWidth="65%"
        form={
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 p-1">
            <HisField label={"\u7c21\u7a31"}>
              <input
                className={`${hisInputClass} font-mono`}
                value={form.id}
                onChange={(e) => setForm({ ...form, id: e.target.value })}
              />
            </HisField>
            <HisField label={"\u985e\u5225"}>
              <input
                className={hisInputClass}
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              />
            </HisField>
            <HisField label={"\u540d\u7a31"} wide>
              <input
                className={hisInputClass}
                value={form.text.split("\n")[0] || form.text}
                onChange={(e) => setForm({ ...form, text: e.target.value })}
              />
            </HisField>
            <HisField label={"\u5167\u6587"} wide>
              <textarea
                rows={8}
                className={hisTextareaClass}
                value={form.text}
                onChange={(e) => setForm({ ...form, text: e.target.value })}
              />
            </HisField>
          </div>
        }
        list={
          <>
            {filterOpen && (
              <div
                className="flex shrink-0 items-center gap-1 border-b px-1 py-0.5"
                style={{ borderColor: HIS.chromeBorder, background: HIS.chrome }}
              >
                <span className="font-bold" style={{ fontSize: HIS.fs.secondary }}>
                  {"\u7be9\u9078"}
                </span>
                <input
                  ref={filterRef}
                  type="search"
                  className={hisInputClass}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <span className="shrink-0 font-mono" style={{ fontSize: HIS.fs.tertiary }}>
                  {filtered.length}
                </span>
              </div>
            )}
            <HisDataGrid
              columns={[
                { key: "id", label: "code", width: "5rem", mono: true },
                { key: "text", label: "name" },
              ]}
              rows={filtered}
              rowKey={(r) => r.id}
              selectedKey={selectedId}
              onSelect={loadRow}
              cell={(r, key) => (key === "id" ? r.id : r.text)}
              emptyText="(無資料)"
            />
          </>
        }
      />
    </HisPageFrame>
  );
}
