import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchControlIndex, isApiMode } from "@/api/clinicApi";
import { useClinicCatalog } from "@/hooks/useClinicCatalog";
import { loadClinicSettings, saveClinicSettings } from "@/lib/clinicSettings";

function formatControlClass(raw: string): string {
  if (!raw || raw === "—") return "—";
  if (/^[1-4]$/.test(raw)) return `第${raw}級`;
  return raw;
}

/**
 * 醫聖 E.管制藥品。
 * 分級主檔：食藥署開放資料 → Hub Pack（與藥價同一條，不需診所 VPN）。
 * 「保險對象查詢系統」才是健保專網即時查病患，開發不連。
 */
export function DrugControlPage() {
  const navigate = useNavigate();
  const { catalog } = useClinicCatalog();
  const [form, setForm] = useState(() => loadClinicSettings().drugControl);
  const [notice, setNotice] = useState<string | null>(null);
  const [packNote, setPackNote] = useState("尚未讀 Pack。");
  const [byNhiCode, setByNhiCode] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");

  useEffect(() => {
    setForm(loadClinicSettings().drugControl);
  }, []);

  useEffect(() => {
    if (!isApiMode()) {
      setPackNote("MOCK：不連後端。清單用本機藥品目錄；管制等級沒進 Pack 就顯示 —。");
      return;
    }
    const day = new Date().toISOString().slice(0, 10);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchControlIndex(day);
        if (cancelled) return;
        setByNhiCode(res.byNhiCode ?? {});
        setPackNote(`Pack ${res.packVersion ?? "—"}：${res.note}`);
      } catch (err) {
        if (!cancelled) {
          setPackNote(
            `讀 Pack 失敗（${err instanceof Error ? err.message : String(err)}）。仍顯示本機藥品目錄，不連 VPN。`,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.drugs
      .map((d) => ({
        nhiCode: d.nhiCode,
        name: d.customName || d.name || d.shortName || "—",
        controlClass: byNhiCode[d.nhiCode] || "—",
      }))
      .filter((r) => {
        if (!q) return true;
        const label = formatControlClass(r.controlClass).toLowerCase();
        return (
          r.nhiCode.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.controlClass.toLowerCase().includes(q) ||
          label.includes(q)
        );
      });
  }, [catalog.drugs, byNhiCode, search]);

  const classed = rows.filter((r) => r.controlClass !== "—").length;

  const save = () => {
    const all = loadClinicSettings();
    saveClinicSettings({ ...all, drugControl: form });
    setNotice("已存本機統計／印表機選項。沒有連保險對象查詢主機。");
  };

  const yn = (key: keyof typeof form, label: string) => (
    <label className="flex items-center justify-between text-xs border-b border-slate-100 py-2">
      <span>{label}</span>
      <select
        className="rounded border border-slate-300 px-2 py-1 font-mono"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      >
        <option value="Y">Y</option>
        <option value="N">N</option>
      </select>
    </label>
  );

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 p-6 flex flex-col font-sans">
      <header className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold"
          >
            回主選單
          </button>
          <div>
            <h1 className="text-lg font-black tracking-wide">E 管制藥品</h1>
            <p className="text-[10px] text-slate-500">
              分級主檔＝食藥署開放資料進 Pack（跟藥價同一條）。右邊統計／印表機才是抄 [DRUGCONTROL] 存本機。跨院保險對象查詢才是那台專網主機，開發不連
            </p>
          </div>
        </div>
      </header>

      <p className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-950">
        {packNote}　本機目錄 {catalog.drugs.length} 筆，其中 Pack 標到管制等級 {classed} 筆。
      </p>

      <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
        <section className="flex-1 bg-white rounded-xl border border-slate-200 p-4 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b pb-2 mb-3">
            <h2 className="text-sm font-bold">本機藥品 × 管制分級</h2>
            <input
              type="search"
              placeholder="搜尋健保碼／藥名"
              className="rounded-lg border border-slate-300 px-3 py-1 text-xs w-56"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="px-2 py-1 text-left">健保碼</th>
                  <th className="px-2 py-1 text-left">名稱</th>
                  <th className="px-2 py-1 text-left">管制等級</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.nhiCode} className="border-t">
                    <td className="px-2 py-1.5 font-mono">{r.nhiCode || "—"}</td>
                    <td className="px-2 py-1.5">{r.name}</td>
                    <td className="px-2 py-1.5 font-mono">{formatControlClass(r.controlClass)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="w-[22rem] bg-white rounded-xl border border-slate-200 p-4 flex flex-col shrink-0 overflow-y-auto">
          <h2 className="text-sm font-bold border-b pb-2 mb-2">本機統計／列印（[DRUGCONTROL]）</h2>
          {yn("countSelfPay", "管制藥品自費是否統計")}
          {yn("countDeliver", "管制藥品交付是否統計")}
          {yn("usageAddChartNo", "用量統計是否增列病歷號")}
          <label className="flex items-center justify-between text-xs py-2 gap-2">
            <span>簡易管制處方簽印表機</span>
            <input
              className="rounded border border-slate-300 px-2 py-1 w-36"
              value={form.printerName}
              onChange={(e) => setForm({ ...form, printerName: e.target.value })}
            />
          </label>
          <button
            type="button"
            onClick={save}
            className="mt-2 w-full py-2 rounded-lg bg-sky-700 text-white text-xs font-bold"
          >
            存檔
          </button>
          {notice && <p className="mt-2 text-[11px] text-slate-600">{notice}</p>}

          <h2 className="text-sm font-bold border-b pb-2 mt-6 mb-2">保險對象即時查詢（可關）</h2>
          <p className="text-[10px] text-slate-500 mb-2 leading-relaxed">
            這段是查「這位病患在他院的管制藥紀錄」，走健保專網（常見 IP 僅院所設定，不是分級主檔來源）。藥價／分級更新走開放資料 Pack，開發也不連這台。
          </p>
          {yn("enableQuery", "是否執行保險對象查詢系統")}
          <label className="flex items-center justify-between text-xs border-b border-slate-100 py-2 gap-2">
            <span>主機 IP（院所設定）</span>
            <input
              className="rounded border border-slate-300 px-2 py-1 font-mono w-36"
              value={form.queryHost}
              onChange={(e) => setForm({ ...form, queryHost: e.target.value })}
            />
          </label>
          <label className="flex items-center justify-between text-xs py-2 gap-2">
            <span>埠號</span>
            <input
              className="rounded border border-slate-300 px-2 py-1 font-mono w-20"
              value={form.queryPort}
              onChange={(e) => setForm({ ...form, queryPort: e.target.value })}
            />
          </label>
        </section>
      </div>
    </div>
  );
}
