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
  hisTextareaClass,
} from "@/components/clinic/HisPageFrame";
import { HIS, HIS_FBAR_COLORS } from "@/lib/hisTheme";
import { useEscLayer } from "@/hooks/useEscLayer";

type DrugForm = {
  nhiCode: string;
  name: string;
  generic: string;
  route: string;
  selfPay: boolean;
  unitPrice: string;
  selfPayPrice: string;
  remark: string;
  batchNo: string;
  control: string;
  maker: string;
  appearance: string;
  clinicCat: string;
  customCat: string;
  qty: string;
  days: string;
  unit: string;
  usage: string;
  doseForm: string;
  dose: string;
  amount: string;
  totalPrice: string;
  purchasePrice: string;
  allergyCode: string;
  bagCc: string;
  maxMonth: string;
  expiry: string;
  warnDate: string;
  cloudCat: string;
};

const emptyForm = (): DrugForm => ({
  nhiCode: "",
  name: "",
  generic: "",
  route: "oral",
  selfPay: false,
  unitPrice: "",
  selfPayPrice: "",
  remark: "",
  batchNo: "",
  control: "無",
  maker: "",
  appearance: "",
  clinicCat: "A. 內服",
  customCat: "",
  qty: "1",
  days: "1",
  unit: "",
  usage: "",
  doseForm: "",
  dose: "",
  amount: "",
  totalPrice: "",
  purchasePrice: "",
  allergyCode: "",
  bagCc: "",
  maxMonth: "0",
  expiry: "",
  warnDate: "",
  cloudCat: "",
});

export function DrugCatalogPage() {
  const navigate = useNavigate();
  const { catalog, loaded, notice: loadNotice, upsertDrug, removeDrug } = useClinicCatalog();
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(true);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [form, setForm] = useState<DrugForm>(emptyForm());
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loaded) return;
    if (!catalog.drugs.length) {
      setNotice(loadNotice || "目錄為空或載入失敗");
    } else {
      setNotice(loadNotice || `已載入 ${catalog.drugs.length} 筆`);
    }
  }, [loaded, catalog.drugs.length, loadNotice]);

  useEscLayer([{ open: true, close: () => navigate("/") }]);

  const filtered = catalog.drugs.filter(
    (d) =>
      d.name.includes(search) ||
      d.nhiCode.toUpperCase().includes(search.toUpperCase()) ||
      d.generic?.toLowerCase().includes(search.toLowerCase()),
  );

  const displayList = useMemo(() => [...filtered], [filtered]);

  const loadDrug = (d: any | null) => {
    if (!d) {
      setSelectedCode(null);
      setForm(emptyForm());
      return;
    }
    setSelectedCode(d.nhiCode);
    setForm({
      ...emptyForm(),
      nhiCode: d.nhiCode || "",
      name: d.name || "",
      generic: d.generic || "",
      route: d.route || "oral",
      selfPay: Boolean(d.selfPay),
      unitPrice: d.unitPrice != null ? String(d.unitPrice) : "",
      selfPayPrice: d.selfPayPrice != null ? String(d.selfPayPrice) : "",
      clinicCat: d.route === "topical" ? "B. 外用" : "A. 內服",
    });
  };

  useEffect(() => {
    if (!selectedCode && displayList[0]) {
      loadDrug(displayList[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.drugs.length]);

  const onNew = () => {
    setSelectedCode(null);
    setForm(emptyForm());
    setNotice("\u65b0\u589e\u6a21\u5f0f\uff1a\u586b\u5beb\u5f8c\u6309 F9 \u5b58\u6a94");
  };

  const onFilter = () => {
    setFilterOpen(true);
    setTimeout(() => filterRef.current?.focus(), 0);
  };

  const saveEdit = async () => {
    if (!form.nhiCode.trim() || !form.name.trim()) {
      setNotice("\u5065\u4fdd\u78bc\u8207\u7c21\u7a31\u5fc5\u586b");
      return;
    }
    setBusy(true);
    try {
      await upsertDrug({
        nhiCode: form.nhiCode.trim(),
        drugNo: form.nhiCode.trim(),
        name: form.name.trim(),
        generic: form.generic.trim(),
        route: form.route,
        selfPay: form.selfPay,
        unitPrice: form.unitPrice ? Number(form.unitPrice) : undefined,
        selfPayPrice: form.selfPayPrice ? Number(form.selfPayPrice) : undefined,
      });
      setSelectedCode(form.nhiCode.trim());
      setNotice("\u85e5\u54c1\u5df2\u5b58\u5165\u9662\u6240\u76ee\u9304\u8986\u5beb\uff08\u5f71\u5b50\u5eab\uff09\u3002");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "\u5b58\u6a94\u5931\u6557");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    const code = selectedCode || form.nhiCode.trim();
    if (!code) {
      setNotice("\u8acb\u5148\u9078\u64c7\u85e5\u54c1");
      return;
    }
    if (!window.confirm(`\u78ba\u5b9a\u5f9e\u9662\u6240\u76ee\u9304\u96b1\u85cf\uff0f\u522a\u9664 ${code}\uff1f`)) return;
    setBusy(true);
    try {
      await removeDrug(code);
      setNotice(`\u5df2\u522a\u9664\uff0f\u96b1\u85cf ${code}`);
      const next = catalog.drugs.find((d) => d.nhiCode !== code);
      loadDrug(next ?? null);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "\u522a\u9664\u5931\u6557");
    } finally {
      setBusy(false);
    }
  };

  return (
    <HisPageFrame
      title={"4 \u85e5\u54c1\u8cc7\u6599"}
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
                const d = catalog.drugs.find((x) => x.nhiCode === selectedCode);
                if (!d) {
                  setNotice("\u8acb\u5148\u5728\u53f3\u5074\u9078\u4e00\u7b46");
                  return;
                }
                loadDrug(d);
                setNotice("\u4fee\u6539\u6a21\u5f0f\uff1a\u7de8\u8f2f\u5f8c\u6309 F9 \u5b58\u6a94");
              },
            },
            { key: "F4", label: "\u7be9\u9078", color: HIS_FBAR_COLORS.F4, onClick: onFilter },
            { key: "F5", label: "\u522a\u9664", color: HIS_FBAR_COLORS.F5, onClick: () => void onDelete(), disabled: busy },
            { key: "F9", label: "\u5b58\u6a94", color: HIS_FBAR_COLORS.F9, onClick: () => void saveEdit(), disabled: busy },
            { key: "Esc", label: "\u96e2\u958b", color: HIS_FBAR_COLORS.Esc, onClick: () => navigate("/") },
          ]}
        />
      }
    >
      <HisCatalogSplit
        formWidth="65%"
        form={
        <div className="flex min-h-0 flex-col overflow-auto">
        <div className="flex flex-col gap-0.5 p-0.5">
          <div className="grid grid-cols-3 gap-1">
            <HisField label="簡稱">
              <input className={hisInputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </HisField>
            <HisField label="健保碼">
              <input className={`${hisInputClass} font-mono`} value={form.nhiCode} onChange={(e) => setForm({ ...form, nhiCode: e.target.value })} />
            </HisField>
            <HisField label="批號">
              <input className={hisInputClass} value={form.batchNo} onChange={(e) => setForm({ ...form, batchNo: e.target.value })} />
            </HisField>
          </div>
          <div className="grid grid-cols-[2fr_1fr_1fr] gap-1">
            <HisField label="商品名稱">
              <input className={hisInputClass} value={form.generic} onChange={(e) => setForm({ ...form, generic: e.target.value })} />
            </HisField>
            <HisField label="管制">
              <select className={hisInputClass} value={form.control} onChange={(e) => setForm({ ...form, control: e.target.value })}>
                <option>無</option>
                <option>1～4級</option>
              </select>
            </HisField>
            <HisField label="藥廠">
              <input className={hisInputClass} value={form.maker} onChange={(e) => setForm({ ...form, maker: e.target.value })} />
            </HisField>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <HisField label="自定名稱">
              <input className={hisInputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </HisField>
            <HisField label="顏色外觀">
              <input className={hisInputClass} value={form.appearance} onChange={(e) => setForm({ ...form, appearance: e.target.value })} />
            </HisField>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <HisField label="診療類別">
              <select
                className={hisInputClass}
                value={form.clinicCat}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm({
                    ...form,
                    clinicCat: v,
                    route: v.includes("外") ? "topical" : "oral",
                  });
                }}
              >
                <option>A. 內服</option>
                <option>B. 外用</option>
                <option>C. 注射</option>
                <option>D. 處置</option>
              </select>
            </HisField>
            <HisField label="自定分類">
              <input className={hisInputClass} value={form.customCat} onChange={(e) => setForm({ ...form, customCat: e.target.value })} />
            </HisField>
          </div>
          <div className="grid grid-cols-5 gap-1">
            <HisField label="數量">
              <input className={`${hisInputClass} font-mono`} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
            </HisField>
            <HisField label="天數">
              <input className={`${hisInputClass} font-mono`} value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
            </HisField>
            <HisField label="單位">
              <input className={hisInputClass} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            </HisField>
            <HisField label="用法">
              <input className={hisInputClass} value={form.usage} onChange={(e) => setForm({ ...form, usage: e.target.value })} />
            </HisField>
            <HisField label="劑型">
              <input className={hisInputClass} value={form.doseForm} onChange={(e) => setForm({ ...form, doseForm: e.target.value })} />
            </HisField>
          </div>
          <div className="grid grid-cols-4 gap-1">
            <HisField label="途徑">
              <select className={hisInputClass} value={form.route} onChange={(e) => setForm({ ...form, route: e.target.value })}>
                <option value="oral">內服</option>
                <option value="topical">外用</option>
                <option value="injection">注射</option>
                <option value="treatment">治療</option>
                <option value="exam">檢查</option>
                <option value="material">特材</option>
              </select>
            </HisField>
            <HisField label="劑量">
              <input className={`${hisInputClass} font-mono`} value={form.dose} onChange={(e) => setForm({ ...form, dose: e.target.value })} />
            </HisField>
            <HisField label="用量">
              <input className={`${hisInputClass} font-mono`} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </HisField>
            <HisField label="敏碼">
              <input className={hisInputClass} value={form.allergyCode} onChange={(e) => setForm({ ...form, allergyCode: e.target.value })} />
            </HisField>
          </div>
          <div className="grid grid-cols-4 gap-1">
            <HisField label="總價">
              <input className={`${hisInputClass} font-mono`} value={form.totalPrice} onChange={(e) => setForm({ ...form, totalPrice: e.target.value })} />
            </HisField>
            <HisField label="單價">
              <input className={`${hisInputClass} font-mono`} value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} />
            </HisField>
            <HisField label="進價">
              <input className={`${hisInputClass} font-mono`} value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} />
            </HisField>
            <HisField label="自費金額">
              <span className="flex items-center gap-1">
                <input type="checkbox" checked={form.selfPay} onChange={(e) => setForm({ ...form, selfPay: e.target.checked })} />
                <input className={`${hisInputClass} font-mono`} value={form.selfPayPrice} onChange={(e) => setForm({ ...form, selfPayPrice: e.target.value })} />
              </span>
            </HisField>
          </div>
          <HisField label="適應症及備註" wide>
            <textarea rows={3} className={`${hisInputClass} bg-white`} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
          </HisField>
          <HisField label="藥帶主訴" wide>
            <textarea rows={2} className={hisTextareaClass} value={form.bagCc} onChange={(e) => setForm({ ...form, bagCc: e.target.value })} />
          </HisField>
        </div>
        </div>
        }
        list={
          <>
        {filterOpen && (
          <div
            className="flex shrink-0 items-center gap-1 border-b px-1 py-0.5"
            style={{ borderColor: HIS.chromeBorder, background: HIS.chrome }}
          >
            <span className="font-bold" style={{ fontSize: HIS.fs.secondary }}>{"\u7be9\u9078"}</span>
            <input
              ref={filterRef}
              type="search"
              className={hisInputClass}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={"\u85e5\u540d / \u5065\u4fdd\u78bc / \u5546\u54c1\u540d"}
            />
            <span className="shrink-0 font-mono text-[#404040]" style={{ fontSize: HIS.fs.tertiary }}>{displayList.length}</span>
          </div>
        )}
        <HisDataGrid
          columns={[
            { key: "name", label: "\u85e5\u54c1\u7c21\u7a31" },
            { key: "generic", label: "\u81ea\u5b9a\u540d\u7a31" },
          ]}
          rows={displayList}
          rowKey={(d) => d.nhiCode}
          selectedKey={selectedCode}
          onSelect={loadDrug}
          cell={(d, key) => (key === "name" ? d.name : d.generic || d.nhiCode)}
        />
        <div className="shrink-0 space-y-0.5 border-t p-1" style={{ borderColor: HIS.chromeBorder, background: HIS.chrome }}>
          <HisField label="雲端查詢類別">
            <input className={hisInputClass} value={form.cloudCat} onChange={(e) => setForm({ ...form, cloudCat: e.target.value })} />
          </HisField>
          <HisField label="當月最大用量">
            <input className={`${hisInputClass} font-mono`} value={form.maxMonth} onChange={(e) => setForm({ ...form, maxMonth: e.target.value })} />
          </HisField>
          <div className="grid grid-cols-2 gap-1">
            <HisField label="有效日">
              <input className={hisInputClass} value={form.expiry} onChange={(e) => setForm({ ...form, expiry: e.target.value })} />
            </HisField>
            <HisField label="警告日">
              <input className={hisInputClass} value={form.warnDate} onChange={(e) => setForm({ ...form, warnDate: e.target.value })} />
            </HisField>
          </div>
          {loaded ? (
            <p className="pt-0.5 font-mono text-[10px] text-[#404040]">
              {`藥品 ${catalog.drugs.length} / 病名 ${catalog.diagnoses.length} / 藥組 ${catalog.packages.length}`}
            </p>
          ) : null}
        </div>
          </>
        }
      />
    </HisPageFrame>
  );
}
