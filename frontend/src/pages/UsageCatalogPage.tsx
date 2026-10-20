import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDefaultUiConfig } from "@/hooks/useDefaultUiConfig";
import { useClinicCatalog } from "@/hooks/useClinicCatalog";
import type { CatalogUsage } from "@/types/clinicCatalog";
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

function doseLabel(code: string | undefined): string {
  if (code === "1") return "\u4e00\u6b21\u91cf";
  if (code === "2") return "\u4e00\u65e5\u91cf";
  if (code === "3") return "\u4e0d\u6307\u5b9a";
  return "\u7e3d\u91cf";
}

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
  const [form, setForm] = useState<CatalogUsage>({ code: "", label: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  const usages = useMemo(() => {
    const map = new Map<string, CatalogUsage>();
    for (const u of catalog.usages || []) {
      if (u.code) map.set(u.code, u);
    }
    if (!map.size) {
      for (const code of defaultUsages ?? ["QD", "BID", "TID", "QID", "HS", "PRN"]) {
        map.set(code, { code, label: "" });
      }
    }
    for (const u of overrides.usages || []) {
      const code = String(u.code || u.short || "").trim();
      if (!code) continue;
      const prev = map.get(code);
      map.set(code, {
        ...(prev || { code }),
        ...u,
        code,
        label: String(u.label || u.eatType || prev?.label || ""),
      });
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
      (u.label || u.eatType || "").toLowerCase().includes(search.toLowerCase()),
  );

  const load = (u: CatalogUsage | null) => {
    if (!u) {
      setSelectedCode(null);
      setForm({ code: "", label: "" });
      return;
    }
    setSelectedCode(u.code);
    setForm({ ...u, label: u.label || u.eatType || "" });
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
      await upsertUsage({
        ...form,
        code: form.code.trim(),
        label: (form.label || form.eatType || "").trim(),
        eatType: (form.eatType || form.label || "").trim(),
        frequency: Number(form.frequency) || 0,
      });
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
                setForm({ code: "", label: "", indexFlag: "Y" });
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
        formWidth="34%"
        form={
          <div className="grid grid-cols-2 gap-1 p-1">
            <p className="col-span-2 px-1 leading-snug text-[#404040]" style={{ fontSize: HIS.fs.tertiary }}>
              {"\u9078\u7528\u586b Y \u624d\u6703\u51fa\u73fe\u5728\u770b\u8a3a\u7684\u7528\u6cd5\u6e05\u55ae\u3002\u6c92\u6a19 Y \u7684\u4ecd\u7559\u5728\u9019\u9801\uff0c\u6539\u6210 Y \u518d\u5b58\u6a94\u5c31\u80fd\u7528\u3002"}
            </p>
            <HisField label={"\u7c21\u78bc"}>
              <input className={`${hisInputClass} font-mono`} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </HisField>
            <HisField label={"\u8aaa\u660e"}>
              <input className={hisInputClass} value={form.eatType || form.label || ""} onChange={(e) => setForm({ ...form, eatType: e.target.value, label: e.target.value })} />
            </HisField>
            <HisField label={"\u4e00\u5929\u6b21\u6578"}>
              <input className={`${hisInputClass} font-mono`} value={form.frequency ?? ""} onChange={(e) => setForm({ ...form, frequency: Number(e.target.value) || 0 })} />
            </HisField>
            <HisField label={"\u7e3d\u91cf\u7b97\u6cd5"}>
              <input className={`${hisInputClass} font-mono`} value={form.isTotal || ""} onChange={(e) => setForm({ ...form, isTotal: e.target.value })} />
            </HisField>
            <HisField label={"\u6392\u5e8f"}>
              <input className={`${hisInputClass} font-mono`} value={form.useageNo || ""} onChange={(e) => setForm({ ...form, useageNo: e.target.value })} />
            </HisField>
            <HisField label={"\u9078\u7528"}>
              <input className={`${hisInputClass} font-mono`} value={form.indexFlag || ""} onChange={(e) => setForm({ ...form, indexFlag: e.target.value })} />
            </HisField>
            <HisField label={"\u9069\u7528 1"}>
              <input className={hisInputClass} value={form.cast1 || ""} onChange={(e) => setForm({ ...form, cast1: e.target.value })} />
            </HisField>
            <HisField label={"\u9069\u7528 2"}>
              <input className={hisInputClass} value={form.cast2 || ""} onChange={(e) => setForm({ ...form, cast2: e.target.value })} />
            </HisField>
            <HisField label={"\u9069\u7528 3"}>
              <input className={hisInputClass} value={form.cast3 || ""} onChange={(e) => setForm({ ...form, cast3: e.target.value })} />
            </HisField>
            <HisField label={"\u5065\u4fdd\u7528\u6cd5"}>
              <input className={hisInputClass} value={form.nhiUsage || ""} onChange={(e) => setForm({ ...form, nhiUsage: e.target.value })} />
            </HisField>
            <HisField label={"\u5099\u8a3b"}>
              <input className={hisInputClass} value={form.remark || ""} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
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
                { key: "code", label: "\u7528\u6cd5", width: "5.2rem", mono: true },
                { key: "frequency", label: "\u6b21\u6578", width: "3rem", mono: true },
                { key: "useageNo", label: "\u4ee3\u78bc", width: "3.2rem", mono: true },
                { key: "eatType", label: "\u670d\u7528\u65b9\u6cd5", width: "8rem" },
                { key: "indexFlag", label: "\u9078\u7528", width: "3rem", mono: true },
                { key: "cast1", label: "\u85e5\u54c1\u5225\u4e00", width: "4rem" },
                { key: "cast2", label: "\u85e5\u54c1\u5225\u4e8c", width: "4rem" },
                { key: "cast3", label: "\u85e5\u54c1\u5225\u4e09", width: "4rem" },
                { key: "dose", label: "\u7528\u91cf\u8868\u793a", width: "4.5rem" },
                { key: "remark", label: "\u5099\u8a3b", width: "3rem", mono: true },
                { key: "nhi", label: "\u5065\u4fdd\u7528\u6cd5", width: "5rem" },
              ]}
              rows={filtered}
              rowKey={(u) => u.code}
              selectedKey={selectedCode}
              onSelect={load}
              cell={(u, key) => {
                if (key === "code") return u.code;
                if (key === "frequency") return u.frequency ? String(u.frequency) : "";
                if (key === "useageNo") return u.useageNo || "";
                if (key === "eatType") return u.eatType || u.label || "";
                if (key === "indexFlag") return u.indexFlag || "";
                if (key === "cast1") return u.cast1 || "";
                if (key === "cast2") return u.cast2 || "";
                if (key === "cast3") return u.cast3 || "";
                if (key === "dose") return doseLabel(u.isTotal);
                if (key === "nhi") return u.nhiUsage || "";
                return u.remark || "";
              }}
            />
          </>
        }
      />
    </HisPageFrame>
  );
}
