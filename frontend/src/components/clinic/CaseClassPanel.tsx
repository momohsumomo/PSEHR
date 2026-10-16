import { useEffect, useMemo, useState } from "react";
import { useClinicCatalog } from "@/hooks/useClinicCatalog";
import {
  applySpecialtyTemplate,
  fetchSpecialtyTemplates,
  type ChronicCaseRule,
  type OrderCaseRule,
  type SpecialtyTemplate,
} from "@/api/clinicApi";

type CaseEdit = {
  orderRules: OrderCaseRule[];
  chronicRules: ChronicCaseRule[];
  projectDrugFloor: number;
  outsideLabCodes: string[];
};

type Props = {
  lines: string[];
  minDays: number;
  officialChronic: string[];
  orderRules: OrderCaseRule[];
  chronicRules: ChronicCaseRule[];
  projectDrugFloor: number;
  outsideLabCodes: string[];
  onChange: (next: CaseEdit) => void;
};

function compact(code: string): string {
  return code.replace(/\./g, "").trim().toUpperCase();
}

function isOrderCode(code: string): boolean {
  const c = compact(code);
  return /^\d{5}[A-Z]$/.test(c) && !c.startsWith("00") && !c.startsWith("052");
}

function hitsOfficial(code: string, table: Set<string>): boolean {
  if (!code || table.size === 0) return false;
  if (table.has(code)) return true;
  if (code.length < 4) return false;
  for (const item of table) {
    if (item.length >= 4 && (item.startsWith(code) || code.startsWith(item))) return true;
  }
  return false;
}

export function CaseClassPanel({
  lines,
  minDays,
  officialChronic,
  orderRules,
  chronicRules,
  projectDrugFloor,
  outsideLabCodes,
  onChange,
}: Props) {
  const { catalog } = useClinicCatalog();
  const official = useMemo(() => new Set(officialChronic.map(compact)), [officialChronic]);
  const [orderQ, setOrderQ] = useState("");
  const [pickedOrder, setPickedOrder] = useState<{ code: string; name: string } | null>(null);
  const [reason, setReason] = useState("");
  const [dxQ, setDxQ] = useState("");
  const [pickedDx, setPickedDx] = useState<{ code: string; name: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [templates, setTemplates] = useState<SpecialtyTemplate[]>([]);

  useEffect(() => {
    let active = true;
    void fetchSpecialtyTemplates()
      .then((res) => {
        if (active) setTemplates(res.templates || []);
      })
      .catch(() => {
        if (active) setTemplates([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const applyTemplate = async (template: SpecialtyTemplate) => {
    const sentence =
      `套用「${template.name}」會補上還沒有的處置轉 09（${template.orderRuleCount} 項）。` +
      "已經設過的不會改。診斷、常備藥、藥組這份是空的，不會覆寫。";
    if (!window.confirm(sentence)) return;
    try {
      const saved = await applySpecialtyTemplate(template.id);
      onChange({
        orderRules: saved.data.orderRules,
        chronicRules: saved.data.chronicRules,
        projectDrugFloor: saved.data.projectDrugFloor || projectDrugFloor,
        outsideLabCodes: saved.data.outsideLabCodes || outsideLabCodes,
      });
      setNotice(saved.note || "已寫入院所案件分類。診斷、常備藥、藥組這份是空的，沒有覆寫。");
    } catch (err: unknown) {
      setNotice(err instanceof Error ? err.message : "套用失敗");
    }
  };

  const orderHits = useMemo(() => {
    const q = orderQ.trim().toLowerCase();
    if (!q) return [];
    const seen = new Set<string>();
    const out: { code: string; name: string }[] = [];
    for (const drug of catalog.drugs) {
      const code = compact(drug.nhiCode || "");
      if (!isOrderCode(code) || seen.has(code) || drug.clinicIndex === false) continue;
      const name = drug.customName || drug.name || drug.shortName || "";
      const blob = `${code} ${name}`.toLowerCase();
      if (!blob.includes(q)) continue;
      seen.add(code);
      out.push({ code, name });
      if (out.length >= 8) break;
    }
    return out;
  }, [catalog.drugs, orderQ]);

  const dxHits = useMemo(() => {
    const q = dxQ.trim().toLowerCase();
    if (!q) return [];
    const seen = new Set<string>();
    const out: { code: string; name: string }[] = [];
    for (const dx of catalog.diagnoses) {
      const code = compact(dx.icd10 || dx.nhiIcd10 || "");
      if (code.length < 3 || !/^[A-Z]/.test(code) || seen.has(code)) continue;
      const name = dx.text || "";
      const blob = `${code} ${dx.icd10} ${name}`.toLowerCase();
      if (!blob.includes(q)) continue;
      seen.add(code);
      out.push({ code, name });
      if (out.length >= 8) break;
    }
    return out;
  }, [catalog.diagnoses, dxQ]);

  const addOrder = () => {
    if (!pickedOrder) {
      setNotice("\u5148\u5f9e\u6e05\u55ae\u9078\u4e00\u500b\u8655\u7f6e\u3002");
      return;
    }
    const note = reason.trim();
    if (!note) {
      setNotice("\u8acb\u5beb\u4e0b\u70ba\u4ec0\u9ebc\u8981\u628a\u9019\u500b\u8655\u7f6e\u7533\u5831\u6210 09\u3002");
      return;
    }
    if (orderRules.some((row) => row.code === pickedOrder.code)) {
      setNotice("\u9019\u500b\u8655\u7f6e\u5df2\u7d93\u5728\u4f8b\u5916\u88e1\u3002");
      return;
    }
    const sentence =
      `\u4e4b\u5f8c\u6709 ${pickedOrder.code} ${pickedOrder.name} \u7684\u770b\u8a3a\uff0c\u6848\u4ef6\u7533\u5831\u70ba 09\u3002` +
      "\u82e5\u540c\u4e00\u7b46\u5df2\u7b26\u5408 04\uff0c\u4ecd\u7533\u5831 04\u3002";
    if (!window.confirm(sentence)) return;
    onChange({
      orderRules: [...orderRules, { code: pickedOrder.code, name: pickedOrder.name, reason: note }],
      chronicRules,
      projectDrugFloor,
      outsideLabCodes,
    });
    setOrderQ("");
    setPickedOrder(null);
    setReason("");
    setNotice(null);
  };

  const addDx = () => {
    if (!pickedDx) {
      setNotice("\u5148\u5f9e\u6e05\u55ae\u9078\u4e00\u500b\u75c5\u540d\u3002");
      return;
    }
    if (hitsOfficial(pickedDx.code, official)) {
      setNotice("\u9019\u500b\u75c5\u540d\u5df2\u5728\u516c\u544a\u6162\u6027\u75c5\u540d\u55ae\uff0c\u4e0d\u7528\u53e6\u5916\u8a2d\u5b9a\u3002");
      return;
    }
    if (chronicRules.some((row) => row.code === pickedDx.code)) {
      setNotice("\u9019\u500b\u75c5\u540d\u5df2\u7d93\u5728\u4f8b\u5916\u88e1\u3002");
      return;
    }
    onChange({
      orderRules,
      chronicRules: [...chronicRules, pickedDx],
      projectDrugFloor,
      outsideLabCodes,
    });
    setDxQ("");
    setPickedDx(null);
    setNotice(null);
  };

  return (
    <div className="border bg-white p-2 space-y-3 text-[12px]" style={{ borderColor: "#808080" }}>
      <h2 className="border-b pb-1 text-[13px] font-bold" style={{ borderColor: "#808080" }}>
        {"\u6848\u4ef6\u5206\u985e"}
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <span>科別模板</span>
        {templates.length === 0 ? (
          <span className="text-slate-500">目前沒有可下載的模板。</span>
        ) : (
          templates.map((template) => (
            <button
              key={template.id}
              type="button"
              className="border px-2 py-0.5"
              style={{ borderColor: "#808080" }}
              onClick={() => void applyTemplate(template)}
            >
              {template.name}
            </button>
          ))
        )}
      </div>
      <p className="leading-relaxed">
        {"\u6c7a\u5b9a\u6bcf\u6708\u7533\u5831\u6a94\u7684 01\uff0f04\uff0f09\u3002\u4e0a\u9762\u7167\u5065\u4fdd\u586b\u8868\u8aaa\u660e\uff0c\u4e0d\u80fd\u6539\u3002\u4e0b\u9762\u7684\u4f8b\u5916\u7531\u672c\u9662\u6240\u81ea\u8a02\u3002"}
      </p>
      <ul className="border p-2 space-y-1" style={{ borderColor: "#808080", background: "#F4F4F4" }}>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <section className="border p-2 space-y-2" style={{ borderColor: "#808080" }}>
        <h3 className="font-bold">{"\u5c08\u6848\u6279\u50f9"}</h3>
        <p>
          {"\u85e5\u50f9\u5e95\u9650\u7531\u672c\u9662\u6240\u81ea\u5df1\u8ca0\u8cac\u3002\u586b 0 \u8868\u793a\u4e0d\u7528\u3002\u586b\u4e86\u4ee5\u5f8c\uff0c\u7d66\u85e5 4 \u5230 6 \u5929\u3001\u85e5\u8cbb\u4f4e\u65bc\u9019\u500b\u6578\u5b57\u3001\u800c\u4e14\u9084\u4e0d\u662f 04 \u7684\u770b\u8a3a\uff0c\u6539\u5831 09\u3002"}
        </p>
        <label className="block">
          {"\u5c08\u6848\u6279\u50f9\u7684\u85e5\u50f9\u5e95\u9650"}
          <input
            className="mt-0.5 w-24 border px-1 py-0.5 font-mono"
            style={{ borderColor: "#808080" }}
            inputMode="numeric"
            value={String(projectDrugFloor)}
            onChange={(e) => {
              const next = Number(e.target.value.replace(/[^\d]/g, "") || "0");
              onChange({
                orderRules,
                chronicRules,
                projectDrugFloor: next > 9999 ? 9999 : next,
                outsideLabCodes,
              });
            }}
          />
        </label>
        <p>
          {"\u5916\u9001\u6aa2\u9a57\u4e0d\u7528\u53e6\u586b\u4ee3\u78bc\u3002\u85e5\u54c1\u4e3b\u6a94\u6a19\u300c\u4ea4\u300d\u7684\uff0c\u958b\u7acb\u6642\u5c31\u5e36\u9019\u500b\u8a3b\u8a18\uff0c\u7533\u5831\u6709\u5217\u51fa\u4f86\u3001\u9ede\u6578\u662f 0\u3002\u6578\u91cf\u7167\u7528\u6cd5\u8868\u3002"}
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="font-bold">{"\u672c\u9662\u6240\u4f8b\u5916"}</h3>
        {orderRules.length === 0 && chronicRules.length === 0 && (
          <p>{"\u76ee\u524d\u6c92\u6709\u4f8b\u5916\u3002\u5168\u90e8\u7167\u4e0a\u9762\u7533\u5831\u3002"}</p>
        )}
        {notice && (
          <p className="border px-2 py-1" style={{ borderColor: "#808080", background: "#FFFFCC" }}>
            {notice}
          </p>
        )}

        <div className="border p-2 space-y-1" style={{ borderColor: "#808080" }}>
          <h4 className="font-bold">{"\u6709\u9019\u500b\u8655\u7f6e\u6642\uff0c\u6539\u7533\u5831 09"}</h4>
          {orderRules.map((row) => (
            <div key={row.code} className="flex items-start justify-between gap-2 border-b py-1" style={{ borderColor: "#D0D0D0" }}>
              <p>
                {row.code} {row.name}
                {" \u2192 \u6848\u4ef6 09\u3002\u672c\u9662\u6240\u8a3b\u8a18\uff1a"}
                {row.reason}
              </p>
              <button
                type="button"
                className="shrink-0 border px-2 py-0.5"
                style={{ borderColor: "#808080", background: "#D4D0C8" }}
                onClick={() =>
                  onChange({
                    orderRules: orderRules.filter((item) => item.code !== row.code),
                    chronicRules,
                    projectDrugFloor,
                    outsideLabCodes,
                  })
                }
              >
                {"\u79fb\u9664"}
              </button>
            </div>
          ))}
          <label className="block">
            {"\u641c\u5c0b\u8655\u7f6e\u4ee3\u78bc\u6216\u540d\u7a31"}
            <input
              className="mt-0.5 w-full border px-1 py-0.5 font-mono"
              style={{ borderColor: "#808080" }}
              value={orderQ}
              onChange={(e) => {
                setOrderQ(e.target.value);
                setPickedOrder(null);
              }}
            />
          </label>
          {orderHits.length > 0 && !pickedOrder && (
            <ul className="border" style={{ borderColor: "#808080" }}>
              {orderHits.map((hit) => (
                <li key={hit.code}>
                  <button
                    type="button"
                    className="w-full px-1 py-0.5 text-left hover:bg-[#B8E0E0]"
                    onClick={() => {
                      setPickedOrder(hit);
                      setOrderQ(`${hit.code} ${hit.name}`);
                    }}
                  >
                    {hit.code} {hit.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="block">
            {"\u70ba\u4ec0\u9ebc\u8981\u628a\u9019\u500b\u8655\u7f6e\u7533\u5831\u6210 09"}
            <input
              className="mt-0.5 w-full border px-1 py-0.5"
              style={{ borderColor: "#808080" }}
              value={reason}
              maxLength={80}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="border px-2 py-0.5 font-bold"
            style={{ borderColor: "#808080", background: "#D4D0C8" }}
            onClick={addOrder}
          >
            {"\u52a0\u5165"}
          </button>
        </div>

        <div className="border p-2 space-y-1" style={{ borderColor: "#808080" }}>
          <h4 className="font-bold">{"\u9019\u500b\u75c5\u540d\uff0c\u672c\u9662\u6240\u4e5f\u7576\u6162\u6027\u75c5"}</h4>
          <p>
            {"\u7d66\u85e5\u6eff "}
            {minDays}
            {" \u5929\u624d\u6703\u8b8a\u6210 04\u3002\u4e0d\u5728\u516c\u544a\u540d\u55ae\u88e1\u7684\u624d\u9700\u8981\u52a0\u3002\u4e0d\u6703\u56e0\u6b64\u8b8a\u6210 09\u3002"}
          </p>
          {chronicRules.map((row) => (
            <div key={row.code} className="flex items-start justify-between gap-2 border-b py-1" style={{ borderColor: "#D0D0D0" }}>
              <p>
                {row.code} {row.name}
                {" \u2192 \u7d66\u85e5\u6eff "}
                {minDays}
                {" \u5929\uff0c\u6848\u4ef6 04\u3002"}
              </p>
              <button
                type="button"
                className="shrink-0 border px-2 py-0.5"
                style={{ borderColor: "#808080", background: "#D4D0C8" }}
                onClick={() =>
                  onChange({
                    orderRules,
                    chronicRules: chronicRules.filter((item) => item.code !== row.code),
                    projectDrugFloor,
                    outsideLabCodes,
                  })
                }
              >
                {"\u79fb\u9664"}
              </button>
            </div>
          ))}
          <label className="block">
            {"\u641c\u5c0b\u75c5\u540d\u6216 ICD-10"}
            <input
              className="mt-0.5 w-full border px-1 py-0.5 font-mono"
              style={{ borderColor: "#808080" }}
              value={dxQ}
              onChange={(e) => {
                setDxQ(e.target.value);
                setPickedDx(null);
              }}
            />
          </label>
          {dxHits.length > 0 && !pickedDx && (
            <ul className="border" style={{ borderColor: "#808080" }}>
              {dxHits.map((hit) => (
                <li key={hit.code}>
                  <button
                    type="button"
                    className="w-full px-1 py-0.5 text-left hover:bg-[#B8E0E0]"
                    onClick={() => {
                      setPickedDx(hit);
                      setDxQ(`${hit.code} ${hit.name}`);
                    }}
                  >
                    {hit.code} {hit.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="border px-2 py-0.5 font-bold"
            style={{ borderColor: "#808080", background: "#D4D0C8" }}
            onClick={addDx}
          >
            {"\u52a0\u5165"}
          </button>
        </div>
      </section>
      <p className="leading-relaxed">
        {"\u6309\u4e0a\u65b9\u5b58\u6a94\u5f8c\uff0c\u4e0b\u6b21\u505a\u7533\u5831\u6a94\u5c31\u7167\u9019\u4e00\u9801\u3002\u8655\u7f6e\u90a3\u4e00\u5217\u5beb\u7684\u8a3b\u8a18\uff0c\u6703\u51fa\u73fe\u5728\u7533\u5831\u6aa2\u67e5\u7684\u539f\u56e0\u6b04\u3002"}
      </p>
    </div>
  );
}
