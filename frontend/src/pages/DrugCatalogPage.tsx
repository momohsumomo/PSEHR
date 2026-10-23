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
  drugNo: string;
  alias: string;
  nhiCode: string;
  tradeName: string;
  customName: string;
  generic: string;
  route: string;
  payMark: string;
  unitPrice: string;
  selfPayPrice: string;
  adapt: string;
  memo: string;
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
  drugType: string;
  dose: string;
  amount: string;
  totalPrice: string;
  purchasePrice: string;
  unitCost: string;
  stock: string;
  lowStock: string;
  allergyCode: string;
  mutual: string;
  conflict: string;
  drugChg: string;
  indexFlag: string;
  sort: string;
  typeSort: string;
  totalQty: string;
  basePoint: string;
  bagCc: string;
  patientRemind: string;
  maxMonth: string;
  expiry: string;
  warnDate: string;
  cloudCat: string;
};

function textNum(value: unknown): string {
  if (value == null || value === "") return "";
  return String(value);
}

const emptyForm = (): DrugForm => ({
  drugNo: "",
  alias: "",
  nhiCode: "",
  tradeName: "",
  customName: "",
  generic: "",
  route: "oral",
  payMark: "",
  unitPrice: "",
  selfPayPrice: "",
  adapt: "",
  memo: "",
  batchNo: "",
  control: "",
  maker: "",
  appearance: "",
  clinicCat: "",
  customCat: "",
  qty: "",
  days: "",
  unit: "",
  usage: "",
  doseForm: "",
  drugType: "",
  dose: "",
  amount: "",
  totalPrice: "",
  purchasePrice: "",
  unitCost: "",
  stock: "",
  lowStock: "",
  allergyCode: "",
  mutual: "",
  conflict: "",
  drugChg: "",
  indexFlag: "Y",
  sort: "",
  typeSort: "",
  totalQty: "",
  basePoint: "",
  bagCc: "",
  patientRemind: "",
  maxMonth: "",
  expiry: "",
  warnDate: "",
  cloudCat: "",
});

export function DrugCatalogPage() {
  const navigate = useNavigate();
  const { catalog, loaded, notice: loadNotice, upsertDrug, removeDrug } = useClinicCatalog();
  const [drugForms, setDrugForms] = useState<string[]>([]);
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

  useEffect(() => {
    let cancel = false;
    void fetch("/yisheng_drug_types.json")
      .then((res) => (res.ok ? res.json() : { forms: [] }))
      .then((body: { forms?: string[] }) => {
        if (!cancel) setDrugForms((body.forms || []).filter(Boolean));
      })
      .catch(() => {
        if (!cancel) setDrugForms([]);
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEscLayer([{ open: true, close: () => navigate("/") }]);

  const filtered = catalog.drugs.filter((d) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [d.alias, d.shortName, d.customName, d.name, d.nhiCode, d.generic, d.drugNo]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  const displayList = useMemo(
    () =>
      [...filtered].sort((a, b) =>
        (a.alias || a.shortName || a.drugNo).localeCompare(b.alias || b.shortName || b.drugNo, "zh-Hant"),
      ),
    [filtered],
  );

  const loadDrug = (d: any | null) => {
    if (!d) {
      setSelectedCode(null);
      setForm(emptyForm());
      return;
    }
    const key = d.drugNo || d.alias || d.nhiCode;
    setSelectedCode(key);
    setForm({
      ...emptyForm(),
      drugNo: d.drugNo || "",
      alias: d.alias || d.shortName || "",
      nhiCode: d.nhiCode || "",
      tradeName: d.name || "",
      customName: d.customName || "",
      generic: d.generic || "",
      route: d.useType || d.route || "",
      payMark: d.payMark || (d.selfPay ? "\u81ea" : ""),
      unitPrice: textNum(d.unitPrice),
      selfPayPrice: textNum(d.selfPayPrice),
      adapt: d.adapt || "",
      memo: d.memo || "",
      batchNo: d.batchNo || "",
      control: d.restrain || "",
      maker: d.company || "",
      clinicCat: d.cast || "",
      customCat: d.typeName || "",
      qty: textNum(d.qty),
      days: textNum(d.days),
      unit: d.unit || "",
      usage: d.sig || "",
      doseForm: d.dosimeter || "",
      drugType: d.drugType || "",
      appearance: d.appearance || "",
      cloudCat: d.cloudCat || "",
      maxMonth: textNum(d.maxMonth),
      expiry: d.expiry || "",
      warnDate: d.warnDate || "",
      dose: textNum(d.dose),
      amount: textNum(d.dose2),
      totalPrice: textNum(d.totalPrice),
      purchasePrice: textNum(d.cost),
      unitCost: textNum(d.unitCost),
      stock: textNum(d.stock),
      lowStock: textNum(d.lowStock),
      allergyCode: d.allergy || "",
      mutual: d.mutual || "",
      conflict: d.conflict || "",
      drugChg: d.drugChg || "",
      indexFlag: d.indexFlag || (d.clinicIndex ? "Y" : ""),
      sort: textNum(d.sort),
      typeSort: textNum(d.typeSort),
      totalQty: textNum(d.totalQty),
      basePoint: textNum(d.basePoint),
      bagCc: d.warning || "",
      patientRemind: d.patientRemind || "",
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
    const drugNo = (form.drugNo || form.alias || form.nhiCode).trim();
    if (!drugNo || !(form.alias.trim() || form.customName.trim() || form.tradeName.trim())) {
      setNotice("\u7c21\u7a31\u6216\u81ea\u5b9a\u540d\u7a31\u5fc5\u586b");
      return;
    }
    const num = (raw: string) => (raw.trim() === "" ? null : Number(raw));
    const existing =
      catalog.drugs.find((d) => (d.drugNo || d.alias || d.name || d.nhiCode) === drugNo) || {};
    setBusy(true);
    try {
      await upsertDrug({
        ...existing,
        drugNo,
        alias: form.alias.trim(),
        shortName: form.alias.trim(),
        customName: form.customName.trim(),
        name: form.tradeName.trim(),
        generic: form.generic.trim(),
        nhiCode: form.nhiCode.trim(),
        sig: form.usage.trim(),
        days: num(form.days) ?? 0,
        qty: num(form.qty) ?? 0,
        route: form.route,
        useType: form.route,
        payMark: form.payMark,
        selfPay: form.payMark === "\u81ea",
        memo: form.memo,
        unitPrice: num(form.unitPrice),
        selfPayPrice: num(form.selfPayPrice),
        batchNo: form.batchNo,
        company: form.maker,
        restrain: form.control,
        cast: form.clinicCat,
        typeName: form.customCat,
        unit: form.unit,
        dosimeter: form.doseForm,
        drugType: form.drugType.trim(),
        appearance: form.appearance,
        cloudCat: form.cloudCat.trim(),
        maxMonth: form.maxMonth.trim(),
        expiry: form.expiry.trim(),
        warnDate: form.warnDate.trim(),
        dose: num(form.dose),
        dose2: num(form.amount),
        stock: num(form.stock),
        lowStock: num(form.lowStock),
        cost: num(form.purchasePrice),
        unitCost: num(form.unitCost),
        totalPrice: num(form.totalPrice),
        totalQty: num(form.totalQty),
        basePoint: num(form.basePoint),
        drugChg: form.drugChg,
        allergy: form.allergyCode,
        mutual: form.mutual,
        conflict: form.conflict,
        sort: num(form.sort),
        typeSort: num(form.typeSort),
        indexFlag: form.indexFlag,
        clinicIndex: form.indexFlag.toUpperCase() === "Y",
        warning: form.bagCc,
        adapt: form.adapt,
        patientRemind: form.patientRemind.trim(),
      });
      setSelectedCode(drugNo);
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
      const next = catalog.drugs.find((d) => (d.drugNo || d.alias) !== code);
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
                const d = catalog.drugs.find((x) => (x.drugNo || x.alias) === selectedCode);
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
          <p className="px-1 leading-snug text-[#404040]" style={{ fontSize: HIS.fs.tertiary }}>
            {"\u9078\u7528\u586b Y \u624d\u6703\u9032\u770b\u8a3a\u958b\u85e5\u3002\u6e05\u55ae\u88e1\u5df2\u6709\u7684\uff0c\u627e\u5230\u5f8c\u6539\u6210 Y \u518d\u5b58\u6a94\u3002\u65b0\u589e\u5065\u4fdd\u85e5\uff1a\u586b\u7c21\u7a31\u3001\u81ea\u5b9a\u540d\u7a31\u3001\u5065\u4fdd\u78bc\uff0c\u81ea\u8cbb\u7559\u767d\u3002\u65b0\u589e\u81ea\u8cbb\u85e5\uff1a\u81ea\u8cbb\u586b\u300c\u81ea\u300d\u4e26\u586b\u81ea\u8cbb\u91d1\u984d\u3002"}
          </p>
          <div className="grid grid-cols-3 gap-1">
            <HisField label="簡稱">
              <input className={`${hisInputClass} font-mono`} value={form.alias} onChange={(e) => setForm({ ...form, alias: e.target.value })} />
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
              <input className={hisInputClass} value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} />
            </HisField>
            <HisField label="管制">
              <input className={hisInputClass} value={form.control} onChange={(e) => setForm({ ...form, control: e.target.value })} />
            </HisField>
            <HisField label="藥廠">
              <input className={hisInputClass} value={form.maker} onChange={(e) => setForm({ ...form, maker: e.target.value })} />
            </HisField>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <HisField label="自定名稱">
              <input className={hisInputClass} value={form.customName} onChange={(e) => setForm({ ...form, customName: e.target.value })} />
            </HisField>
            <HisField label="顏色外觀">
              <input className={hisInputClass} value={form.appearance} onChange={(e) => setForm({ ...form, appearance: e.target.value })} />
            </HisField>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <HisField label="診療類別">
              <input className={hisInputClass} value={form.clinicCat} onChange={(e) => setForm({ ...form, clinicCat: e.target.value })} />
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
              <input
                className={hisInputClass}
                list="yisheng-drug-forms"
                value={form.drugType}
                onChange={(e) => setForm({ ...form, drugType: e.target.value })}
              />
              <datalist id="yisheng-drug-forms">
                {drugForms.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </HisField>
          </div>
          <div className="grid grid-cols-4 gap-1">
            <HisField label="途徑">
              <input className={hisInputClass} value={form.route} onChange={(e) => setForm({ ...form, route: e.target.value })} />
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
            <HisField label="進貨單價">
              <input className={`${hisInputClass} font-mono`} value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} />
            </HisField>
          </div>
          <div className="grid grid-cols-4 gap-1">
            <HisField label="存量">
              <input className={`${hisInputClass} font-mono`} value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
            </HisField>
            <HisField label="危量">
              <input className={`${hisInputClass} font-mono`} value={form.lowStock} onChange={(e) => setForm({ ...form, lowStock: e.target.value })} />
            </HisField>
            <HisField label="藥量">
              <input className={hisInputClass} value={form.drugChg} onChange={(e) => setForm({ ...form, drugChg: e.target.value })} />
            </HisField>
            <HisField label="選用">
              <input className={`${hisInputClass} font-mono`} value={form.indexFlag} onChange={(e) => setForm({ ...form, indexFlag: e.target.value })} />
            </HisField>
          </div>
          <div className="grid grid-cols-4 gap-1">
            <HisField label="自費">
              <input className={hisInputClass} value={form.payMark} onChange={(e) => setForm({ ...form, payMark: e.target.value })} />
            </HisField>
            <HisField label="自費金額">
              <input className={`${hisInputClass} font-mono`} value={form.selfPayPrice} onChange={(e) => setForm({ ...form, selfPayPrice: e.target.value })} />
            </HisField>
            <HisField label="排列">
              <input className={`${hisInputClass} font-mono`} value={form.sort} onChange={(e) => setForm({ ...form, sort: e.target.value })} />
            </HisField>
            <HisField label="順序">
              <input className={`${hisInputClass} font-mono`} value={form.typeSort} onChange={(e) => setForm({ ...form, typeSort: e.target.value })} />
            </HisField>
          </div>
          <div className="grid grid-cols-[1fr_2fr] gap-1">
            <HisField label="備註">
              <input className={hisInputClass} value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
            </HisField>
            <HisField label="學名成份">
              <input className={hisInputClass} value={form.generic} onChange={(e) => setForm({ ...form, generic: e.target.value })} />
            </HisField>
          </div>
          <HisField label="適應症及備註" wide>
            <textarea rows={6} className={`${hisInputClass} bg-white`} value={form.adapt} onChange={(e) => setForm({ ...form, adapt: e.target.value })} />
          </HisField>
          <HisField label="藥帶主訴" wide>
            <textarea rows={2} className={hisTextareaClass} value={form.bagCc} onChange={(e) => setForm({ ...form, bagCc: e.target.value })} />
          </HisField>
          <HisField label="提醒病患內容" wide>
            <input
              className={hisInputClass}
              maxLength={20}
              value={form.patientRemind}
              onChange={(e) => setForm({ ...form, patientRemind: e.target.value })}
            />
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
            { key: "alias", label: "\u85e5\u54c1\u7c21\u7a31", width: "5.5rem", mono: true },
            { key: "customName", label: "\u81ea\u5b9a\u540d\u7a31" },
            { key: "indexFlag", label: "\u9078\u7528", width: "3rem", mono: true },
          ]}
          rows={displayList}
          rowKey={(d) => d.drugNo || d.alias || d.nhiCode}
          selectedKey={selectedCode}
          onSelect={loadDrug}
          cell={(d, key) =>
            key === "alias"
              ? d.alias || d.shortName || d.drugNo
              : key === "indexFlag"
                ? d.indexFlag || ""
                : d.customName || d.name
          }
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
