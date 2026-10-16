import { useEffect, useRef, useState } from "react";
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
import { HIS, HIS_FBAR_COLORS } from "@/lib/hisTheme";
import { useEscLayer } from "@/hooks/useEscLayer";

type LineForm = { drugNo: string; qty: string; sig: string; days: string };

type PkgForm = {
  code: string;
  name: string;
  dxCode: string;
  lines: LineForm[];
};

const emptyForm = (): PkgForm => ({
  code: "",
  name: "",
  dxCode: "",
  lines: [{ drugNo: "", qty: "1", sig: "QD", days: "7" }],
});

export function DrugPackagesPage() {
  const navigate = useNavigate();
  const { catalog, loaded, notice: loadNotice, upsertPackage, removePackage } = useClinicCatalog();
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(true);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [form, setForm] = useState<PkgForm>(emptyForm());
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loaded) return;
    if (!catalog.packages.length) {
      setNotice(loadNotice || "目錄為空或載入失敗");
    } else {
      setNotice(loadNotice || `已載入 ${catalog.packages.length} 筆`);
    }
  }, [loaded, catalog.packages.length, loadNotice]);

  useEscLayer([{ open: true, close: () => navigate("/") }]);

  const filtered = catalog.packages.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.code || "").toLowerCase().includes(search.toLowerCase()) ||
      (p.id || "").toLowerCase().includes(search.toLowerCase()),
  );

  const loadPkg = (pkg: (typeof catalog.packages)[0] | null) => {
    if (!pkg) {
      setSelectedCode(null);
      setForm(emptyForm());
      return;
    }
    const lines =
      pkg.lines?.length
        ? pkg.lines.map((l) => ({
            drugNo: String(l.drugNo || ""),
            qty: String(l.qty ?? 1),
            sig: String(l.sig || "QD"),
            days: String((l as { days?: number }).days ?? 7),
          }))
        : (pkg.items || []).map((item) => ({
            drugNo: String(item.drugCode || item.drugNo || ""),
            qty: String(item.qty ?? 1),
            sig: String(item.sig || "QD"),
            days: "7",
          }));
    const code = pkg.code || pkg.id || "";
    setSelectedCode(code);
    setForm({
      code,
      name: pkg.name || "",
      dxCode: pkg.dxCode || "",
      lines: lines.length ? lines : [{ drugNo: "", qty: "1", sig: "QD", days: "7" }],
    });
  };

  useEffect(() => {
    if (!selectedCode && filtered[0]) loadPkg(filtered[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.packages.length]);

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      setNotice("\u85e5\u7d44\u4ee3\u78bc\u8207\u540d\u7a31\u5fc5\u586b");
      return;
    }
    setBusy(true);
    try {
      await upsertPackage({
        id: form.code.trim(),
        code: form.code.trim(),
        name: form.name.trim(),
        dxCode: form.dxCode.trim(),
        lines: form.lines
          .filter((l) => l.drugNo.trim())
          .map((l) => ({
            drugNo: l.drugNo.trim(),
            qty: Number(l.qty) || 1,
            sig: l.sig.trim() || "QD",
            days: Number(l.days) || 7,
          })),
      });
      setSelectedCode(form.code.trim());
      setNotice("\u85e5\u7d44\u5df2\u5b58\u6a94");
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
      await removePackage(code);
      setNotice(`\u5df2\u522a\u9664 ${code}`);
      const next = catalog.packages.find((p) => (p.code || p.id) !== code);
      loadPkg(next ?? null);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "fail");
    } finally {
      setBusy(false);
    }
  };

  const patchLine = (idx: number, patch: Partial<LineForm>) => {
    const lines = [...form.lines];
    lines[idx] = { ...lines[idx], ...patch };
    setForm({ ...form, lines });
  };

  return (
    <HisPageFrame
      title={"8 \u85e5\u7d44"}
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
                setForm(emptyForm());
                setNotice("\u65b0\u589e\u6a21\u5f0f\uff1a\u586b\u5beb\u5f8c\u6309 F9 \u5b58\u6a94");
              },
            },
            {
              key: "F3",
              label: "\u4fee\u6539",
              color: HIS_FBAR_COLORS.F3,
              onClick: () => {
                const pkg = catalog.packages.find((p) => (p.code || p.id) === selectedCode);
                if (!pkg) {
                  setNotice("\u8acb\u5148\u5728\u53f3\u5074\u9078\u4e00\u7b46");
                  return;
                }
                loadPkg(pkg);
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
        <div className="flex min-h-0 flex-col overflow-auto">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 p-1">
          <HisField label={"\u4ee3\u78bc"}>
            <input
              className={`${hisInputClass} font-mono`}
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
          </HisField>
          <HisField label={"\u75c5\u540d\u78bc"}>
            <input
              className={`${hisInputClass} font-mono`}
              value={form.dxCode}
              onChange={(e) => setForm({ ...form, dxCode: e.target.value })}
            />
          </HisField>
          <HisField label={"\u540d\u7a31"} wide>
            <input
              className={hisInputClass}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </HisField>
        </div>

        <div className="mt-1 border-t p-1" style={{ borderColor: HIS.chromeDark }}>
          <div className="mb-0.5 flex items-center justify-between">
            <span className="text-[11px] font-bold">{"\u85e5\u7d44\u660e\u7d30"}</span>
            <button
              type="button"
              className="border px-1 py-0.5 text-[11px] font-bold"
              style={{ borderColor: HIS.chromeDark, background: "#fff" }}
              onClick={() =>
                setForm({
                  ...form,
                  lines: [...form.lines, { drugNo: "", qty: "1", sig: "QD", days: "7" }],
                })
              }
            >
              + line
            </button>
          </div>
          <div
            className="grid grid-cols-[1.6fr_0.7fr_0.5fr_0.6fr_0.5fr] gap-0.5 text-[10px] font-bold"
            style={{ background: HIS.headerBg }}
          >
            <span className="px-0.5">{"\u85e5\u540d"}</span>
            <span className="px-0.5">{"\u7de8\u865f"}</span>
            <span className="px-0.5">qty</span>
            <span className="px-0.5">sig</span>
            <span className="px-0.5">days</span>
          </div>
          {form.lines.map((line, idx) => {
            const hit = catalog.drugs.find(
              (d) => d.drugNo === line.drugNo || d.nhiCode === line.drugNo,
            );
            const drugName = hit ? hit.customName || hit.name || line.drugNo : "";
            return (
            <div key={idx} className="mt-0.5 grid grid-cols-[1.6fr_0.7fr_0.5fr_0.6fr_0.5fr] gap-0.5">
              <input
                className={hisInputClass}
                readOnly
                title={line.drugNo}
                value={drugName || (line.drugNo ? line.drugNo : "")}
              />
              <input
                className={`${hisInputClass} font-mono`}
                value={line.drugNo}
                onChange={(e) => patchLine(idx, { drugNo: e.target.value })}
              />
              <input
                className={hisInputClass}
                value={line.qty}
                onChange={(e) => patchLine(idx, { qty: e.target.value })}
              />
              <input
                className={hisInputClass}
                value={line.sig}
                onChange={(e) => patchLine(idx, { sig: e.target.value })}
              />
              <input
                className={hisInputClass}
                value={line.days}
                onChange={(e) => patchLine(idx, { days: e.target.value })}
              />
            </div>
            );
          })}
        </div>

        {selectedCode && (
          <div className="mt-1 p-1">
            <button
              type="button"
              className="border px-2 py-0.5 text-[11px] font-bold"
              style={{ borderColor: HIS.chromeDark, background: HIS.tabActive }}
              onClick={() => navigate(`/clinic?package=${encodeURIComponent(selectedCode)}`)}
            >
              {"\u5e36\u5165\u770b\u8a3a"}
            </button>
          </div>
        )}
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
                { key: "code", label: "code", width: "5rem", mono: true },
                { key: "name", label: "name" },
              ]}
              rows={filtered}
              rowKey={(pkg) => pkg.code || pkg.id || ""}
              selectedKey={selectedCode}
              onSelect={loadPkg}
              cell={(pkg, key) => {
                const code = pkg.code || pkg.id || "";
                return key === "code" ? code : pkg.name;
              }}
            />
            {loaded ? (
              <p
                className="shrink-0 border-t px-1 py-0.5 font-mono text-[#404040]"
                style={{ borderColor: HIS.chromeBorder, background: HIS.chrome, fontSize: HIS.fs.tertiary }}
              >
                {`藥品 ${catalog.drugs.length} / 病名 ${catalog.diagnoses.length} / 藥組 ${catalog.packages.length}`}
              </p>
            ) : null}
          </>
        }
      />
    </HisPageFrame>
  );
}
