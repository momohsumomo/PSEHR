import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDefaultUiConfig } from "@/hooks/useDefaultUiConfig";
import { useClinicCatalog } from "@/hooks/useClinicCatalog";
import {
  HisCatalogFBar,
  HisCatalogSplit,
  HisDataGrid,
  HisField,
  HisPageFrame,
  hisInputClass,
} from "@/components/clinic/HisPageFrame";
import { HIS, HIS_FBAR_COLORS } from "@/lib/hisTheme";
import { useEscLayer } from "@/hooks/useEscLayer";

export function UsageCatalogPage() {
  const navigate = useNavigate();
  const { defaultUsages } = useDefaultUiConfig();
  const {
    catalog,
    overrides,
    loaded,
    notice: loadNotice,
    upsertUsage,
    removeUsage,
  } = useClinicCatalog();
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(true);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [form, setForm] = useState<{ code: string; label: string }>({ code: "", label: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  const usages = useMemo(() => {
    const map = new Map<string, { code: string; label: string }>();
    for (const u of catalog.usages || []) {
      if (u.code) map.set(u.code, { code: u.code, label: String(u.label || u.eatType || "") });
    }
    if (!map.size) {
      for (const code of defaultUsages ?? ["QD", "BID", "TID", "QID", "HS", "PRN"]) {
        map.set(code, { code, label: "" });
      }
    }
    for (const u of overrides.usages || []) {
      const code = String(u.code || u.short || "").trim();
      if (!code) continue;
      map.set(code, { code, label: String(u.label || u.name || "") });
    }
    return [...map.values()];
  }, [catalog.usages, defaultUsages, overrides.usages]);

  useEffect(() => {
    if (!loaded && !(defaultUsages?.length)) return;
    if (!usages.length) {
      setNotice(loadNotice || "用法目錄為空或載入失敗");
    } else {
      setNotice(`已載入 ${usages.length} 筆`);
    }
  }, [loaded, usages.length, defaultUsages?.length, loadNotice]);

  useEscLayer([{ open: true, close: () => navigate("/") }]);

  const filtered = usages.filter(
    (u) =>
      u.code.toLowerCase().includes(search.toLowerCase()) ||
      u.label.toLowerCase().includes(search.toLowerCase()),
  );

  const load = (u: { code: string; label: string } | null) => {
    if (!u) {
      setSelectedCode(null);
      setForm({ code: "", label: "" });
      return;
    }
    setSelectedCode(u.code);
    setForm({ code: u.code, label: u.label });
  };

  useEffect(() => {
    if (!selectedCode && filtered[0]) load(filtered[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usages.length]);

  const save = async () => {
    if (!form.code.trim()) {
      setNotice("\u7c21\u78bc\u5fc5\u586b");
      return;
    }
    setBusy(true);
    try {
      await upsertUsage({ code: form.code.trim(), label: form.label.trim() });
      setSelectedCode(form.code.trim());
      setNotice("\u5df2\u5b58\u6a94");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "fail");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    const code = selectedCode || form.code.trim();
    if (!code) {
      setNotice("\u8acb\u5148\u9078\u4e00\u7b46");
      return;
    }
    setBusy(true);
    try {
      await removeUsage(code);
      setNotice(`\u5df2\u522a\u9664 ${code}`);
      const next = usages.find((u) => u.code !== code);
      load(next ?? null);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "fail");
    } finally {
      setBusy(false);
    }
  };

  return (
    <HisPageFrame
      title={"7 \u7528\u6cd5\u8cc7\u6599"}
      notice={notice}
      onEsc={() => navigate("/")}
      footer={
        <HisCatalogFBar
          items={[
            {
              key: "F2",
              label: "\u65b0\u589e",
              color: HIS_FBAR_COLORS.F2,
              onClick: () => {
                setSelectedCode(null);
                setForm({ code: "", label: "" });
                setNotice("\u65b0\u589e\u6a21\u5f0f\uff1a\u586b\u5beb\u5f8c\u6309 F9 \u5b58\u6a94");
              },
            },
            {
              key: "F3",
              label: "\u4fee\u6539",
              color: HIS_FBAR_COLORS.F3,
              onClick: () => {
                const u = usages.find((x) => x.code === selectedCode);
                if (!u) {
                  setNotice("\u8acb\u5148\u5728\u53f3\u5074\u9078\u4e00\u7b46");
                  return;
                }
                load(u);
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
            { key: "F5", label: "\u522a\u9664", color: HIS_FBAR_COLORS.F5, onClick: () => void onDelete(), disabled: busy },
            { key: "F9", label: "\u5b58\u6a94", color: HIS_FBAR_COLORS.F9, onClick: () => void save(), disabled: busy },
            { key: "Esc", label: "\u96e2\u958b", color: HIS_FBAR_COLORS.Esc, onClick: () => navigate("/") },
          ]}
        />
      }
    >
      <HisCatalogSplit
        formWidth="65%"
        form={
          <div className="grid grid-cols-1 gap-y-1 p-1">
            <HisField label={"\u7c21\u78bc"}>
              <input
                className={`${hisInputClass} font-mono`}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </HisField>
            <HisField label={"\u8aaa\u660e"}>
              <input
                className={hisInputClass}
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
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
                { key: "code", label: "\u7c21\u78bc", width: "5rem", mono: true },
                { key: "label", label: "\u8aaa\u660e" },
              ]}
              rows={filtered}
              rowKey={(u) => u.code}
              selectedKey={selectedCode}
              onSelect={load}
              cell={(u, key) => (key === "code" ? u.code : u.label || "\u2014")}
            />
          </>
        }
      />
    </HisPageFrame>
  );
}
