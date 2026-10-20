import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useEscLayer } from "@/hooks/useEscLayer";
import { useClinicWorkspace } from "@/hooks/useClinicWorkspace";
import {
  isApiMode,
  fetchClaimsStatistics,
  fetchClaimsPreview,
  exportClaimsXml,
  type ClaimsSubmitType,
  type ApiClaimsPreview,
} from "@/api/clinicApi";

const DASH = "\u2014";

function shownPointSum(stats: {
  totalConsultationPoints: number | null;
  totalDrugPoints: number | null;
  totalPharmacyPoints: number | null;
  totalTreatmentPoints: number | null;
  totalPoints: number | null;
}): number | null {
  const parts = [
    stats.totalConsultationPoints,
    stats.totalDrugPoints,
    stats.totalPharmacyPoints,
    stats.totalTreatmentPoints,
  ];
  let sum = 0;
  for (const n of parts) {
    if (n == null) return stats.totalPoints;
    sum += Math.round(n);
  }
  return sum;
}

type Step = "setup" | "checked" | "exported";
type ClaimJob = "check" | "build";

function defaultMonth(): string {
  const d = new Date();
  // Clinic habit: early month files previous fee month
  if (d.getDate() <= 7) {
    d.setMonth(d.getMonth() - 1);
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function ClaimsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const jobParam = searchParams.get("job");
  const { queue } = useClinicWorkspace();
  const apiMode = isApiMode();
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  const [submitType, setSubmitType] = useState<ClaimsSubmitType>("songhe");
  const [downloading, setDownloading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [step, setStep] = useState<Step>("setup");
  const job: ClaimJob | null = jobParam === "check" || jobParam === "build" ? jobParam : null;
  const [log, setLog] = useState<string[]>([]);
  const [preview, setPreview] = useState<ApiClaimsPreview | null>(null);
  const backToMenu = () => navigate("/?open=claims");
  useEscLayer([{ open: true, close: backToMenu }]);

  useEffect(() => {
    if (!job) navigate("/?open=claims", { replace: true });
  }, [job, navigate]);

  const [stats, setStats] = useState({
    finishedEncounters: 0 as number | null,
    totalConsultationPoints: null as number | null,
    totalDrugPoints: null as number | null,
    totalPharmacyPoints: null as number | null,
    totalTreatmentPoints: null as number | null,
    totalPoints: null as number | null,
  });

  const finishedFromQueue = queue.filter((e) => e.queueStatus === "finished").length;

  useEffect(() => {
    setStep("setup");
    setPreview(null);
  }, [selectedMonth, submitType]);

  useEffect(() => {
    if (!job) return;
    if (!apiMode) {
      setStats({
        finishedEncounters: finishedFromQueue,
        totalConsultationPoints: null,
        totalDrugPoints: null,
        totalPharmacyPoints: null,
        totalTreatmentPoints: null,
        totalPoints: null,
      });
      return;
    }

    let active = true;
    (async () => {
      try {
        const res = await fetchClaimsStatistics(selectedMonth);
        if (active) {
          setStats({
            finishedEncounters: res.finishedEncounters,
            totalConsultationPoints: res.totalConsultationPoints,
            totalDrugPoints: res.totalDrugPoints,
            totalPharmacyPoints: res.totalPharmacyPoints ?? null,
            totalTreatmentPoints: res.totalTreatmentPoints ?? null,
            totalPoints: res.totalPoints,
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (active) {
          setLog((prev) => [...prev, `[錯誤] 無法獲取申報統計：${message}`]);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [job, selectedMonth, apiMode, finishedFromQueue]);

  const handleCheck = async () => {
    if (!apiMode) {
      setLog((prev) => [
        ...prev,
        "尚未接影子庫組檔。不產假 XML。請開 API 模式走月申報模組。",
      ]);
      return;
    }
    setChecking(true);
    setLog((prev) => [...prev, "開始檢查申報資料…"]);
    try {
      const res = await fetchClaimsPreview(selectedMonth, submitType);
      setPreview(res);
      setStats({
        finishedEncounters: res.finishedEncounters,
        totalConsultationPoints: res.totalConsultationPoints,
        totalDrugPoints: res.totalDrugPoints,
        totalPharmacyPoints: res.totalPharmacyPoints ?? null,
        totalTreatmentPoints: res.totalTreatmentPoints ?? null,
        totalPoints: res.totalPoints,
      });
      const blocks = res.check?.blockCount ?? 0;
      const warns = res.check?.warnCount ?? 0;
      if (blocks > 0) {
        setLog((prev) => [...prev, `必要修正 ${blocks} 筆，清完才能產檔。提醒 ${warns} 筆仍可留著。`]);
      } else if (warns > 0) {
        setLog((prev) => [...prev, `沒有必要修正。提醒 ${warns} 筆，仍可產檔、仍會申報。`]);
      } else {
        setLog((prev) => [...prev, "檢查通過，可以產檔。"]);
      }
      setStep("checked");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setLog((prev) => [...prev, `檢查失敗: ${message}`]);
    } finally {
      setChecking(false);
    }
  };

  const handleExport = async () => {
    if (!apiMode) {
      setLog((prev) => [
        ...prev,
        "尚未接影子庫組檔。不產假 XML、不假裝讀取 REGISTER.DAT。請開 API 模式走月申報模組。",
      ]);
      return;
    }
    if (step === "setup") {
      setLog((prev) => [...prev, "請先按「檢查申報資料」，確認後再產檔。"]);
      return;
    }
    if (preview?.check && preview.check.canExport === false) {
      setLog((prev) => [...prev, "還有必要修正，這次不產檔。提醒不用先清完。"]);
      return;
    }

    setDownloading(true);
    const rocYear = parseInt(selectedMonth.split("-")[0], 10) - 1911;
    const month = selectedMonth.split("-")[1];
    const displayMonth = `${rocYear} 年 ${month} 月`;
    const typeLabel = submitType === "bubao" ? "補報" : "送核";
    setLog((prev) => [
      ...prev,
      `開始組 ${displayMonth} ${typeLabel}檔（署方 outpatient t/d/p，ZIP／Big5）...`,
    ]);

    try {
      const { blob, filename, format } = await exportClaimsXml(selectedMonth, submitType, {
        format: "nhi",
        packaging: "zip",
      });
      setLog((prev) => [
        ...prev,
        `影子庫完診 ${stats.finishedEncounters ?? DASH} 筆`,
        `\u8a3a\u5bdf\u9ede ${stats.totalConsultationPoints ?? DASH}\uff0f\u85e5\u8cbb\u9ede ${stats.totalDrugPoints ?? DASH}\uff0f\u85e5\u4e8b ${stats.totalPharmacyPoints ?? DASH}\uff0f\u8a3a\u7642 ${stats.totalTreatmentPoints ?? DASH}\uff0f\u5408\u8a08 ${shownPointSum(stats) ?? DASH}`,
        `格式標記：${format}`,
      ]);

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setLog((prev) => [
        ...prev,
        `已下載 ${filename}。`,
        "上傳清單：① 開診所健保 VPN ② 進入醫療費用申報網頁 ③ 上傳本 ZIP ④ 網頁確認收件（系統不代操）。",
        "之後若有同月申報檔，可拿來比對欄位。",
      ]);
      setStep("exported");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setLog((prev) => [...prev, `匯出失敗: ${message}`]);
    } finally {
      setDownloading(false);
    }
  };

  const displayRocYear = parseInt(selectedMonth.split("-")[0], 10) - 1911;
  const displayMonthStr = selectedMonth.split("-")[1];
  const pts = (n: number | null) => (n === null ? DASH : `${n} \u9ede`);
  const addedUp = shownPointSum(stats);
  const previewRows = (preview?.records ?? []).slice(0, 40);
  const jobTitle = job === "check" ? "檢查申報資料" : "製作申報格式";

  if (!job) return null;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 p-6 flex flex-col font-sans">
      <header className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={backToMenu}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition shadow-sm"
          >
            回申報選單
          </button>
          <div className="h-5 w-[1px] bg-slate-300" />
          <div>
            <h1 className="text-lg font-black tracking-wide text-slate-800">{jobTitle}</h1>
            <p className="text-[10px] text-slate-500">
              {job === "check"
                ? "只檢查這個月。要產檔請回選單，改選製作申報格式。"
                : "先檢查，通過後才組月申報檔。人自己上健保 VPN。"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              apiMode
                ? "bg-emerald-100 text-emerald-900 border border-emerald-200"
                : "bg-violet-100 text-violet-900 border border-violet-200"
            }`}
          >
            {apiMode ? "API 聯動中" : "MOCK（不產假點數）"}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0 overflow-hidden">
        <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col h-fit gap-4">
          <div className="border-b pb-2">
            <h2 className="text-sm font-bold text-slate-800">
              1. 設定（{displayRocYear}年{displayMonthStr}月）
            </h2>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 block">費用年月</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-slate-500">申報類別</span>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="radio"
                name="submitType"
                checked={submitType === "songhe"}
                onChange={() => setSubmitType("songhe")}
              />
              <span className="font-bold">送核</span>
              <span className="text-slate-400">（每月預設）</span>
            </label>
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input
                type="radio"
                name="submitType"
                className="mt-0.5"
                checked={submitType === "bubao"}
                onChange={() => setSubmitType("bubao")}
              />
              <span>
                <span className="font-bold">補報</span>
                <span className="block text-[10px] text-slate-400 mt-0.5 leading-snug">
                  僅漏報追加。核刪／申復不是這顆。補報常不暫付。
                </span>
              </span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="bg-slate-50 rounded-lg p-3">
              <span className="text-[10px] text-slate-400 block font-bold">完診人次</span>
              <span className="text-2xl font-black text-slate-900">
                {stats.finishedEncounters ?? DASH}
              </span>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <span className="text-[10px] text-slate-400 block font-bold">格式</span>
              <span className="text-xs font-black text-slate-600 block mt-2">
                {apiMode ? "nhi outpatient t/d/p" : DASH}
              </span>
            </div>
          </div>

          <div className="space-y-2 border-t pt-3 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500 font-semibold">診察費點數</span>
              <span className="font-mono font-bold">{pts(stats.totalConsultationPoints)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 font-semibold">{"\u85e5\u8cbb\u9ede\u6578"}</span>
              <span className="font-mono font-bold">{pts(stats.totalDrugPoints)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 font-semibold">{"\u85e5\u4e8b\u670d\u52d9\u8cbb\u9ede\u6578"}</span>
              <span className="font-mono font-bold">{pts(stats.totalPharmacyPoints)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 font-semibold">{"\u8a3a\u7642\u8655\u7f6e\u9ede\u6578"}</span>
              <span className="font-mono font-bold">{pts(stats.totalTreatmentPoints)}</span>
            </div>
            <div className="flex justify-between border-t pt-2 text-sm">
              <span className="text-slate-800 font-black">{"\u5408\u8a08\u9ede\u6578"}</span>
              <span className="font-mono font-black text-sky-700">{pts(addedUp)}</span>
            </div>
          </div>

          <div className="border-t pt-3 space-y-2">
            <p className="text-[10px] font-bold text-slate-500">
              {job === "check" ? "檢查這個月" : "檢查通過後製作申報格式"}
            </p>
            <button
              type="button"
              disabled={checking}
              onClick={() => void handleCheck()}
              className="w-full py-2 rounded-lg border border-sky-600 bg-sky-50 hover:bg-sky-100 font-bold text-xs text-sky-900 disabled:opacity-50"
            >
              {checking ? "檢查中…" : "檢查申報資料"}
            </button>
            {job === "build" ? (
            <button
              type="button"
              disabled={downloading || step === "setup" || preview?.check?.canExport === false}
              onClick={() => void handleExport()}
              className="w-full py-2.5 rounded-lg bg-sky-700 hover:bg-sky-800 font-bold text-xs text-white disabled:opacity-50 transition shadow-sm"
            >
              {downloading
                ? "組檔中…"
                : apiMode
                  ? `製作申報格式（${submitType === "bubao" ? "補報" : "送核"}）`
                  : "組檔（尚未接 API）"}
            </button>
            ) : (
              <p className="text-[10px] text-slate-500 leading-snug">產檔不在這裡。回選單選「製作申報格式」。</p>
            )}
            {step === "exported" ? (
              <p className="text-[10px] text-emerald-700 font-bold leading-snug">
                檔已下載。請人上診所健保 VPN 網頁上傳並自行確認。
              </p>
            ) : null}
          </div>
        </section>

        <section className="lg:col-span-2 flex flex-col gap-4 min-h-0 overflow-hidden">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm shrink-0">
            <h2 className="text-sm font-bold text-slate-800 border-b pb-2 mb-2">檢查媒體</h2>
            {!preview?.check ? (
              <p className="text-xs text-slate-400 mb-3">按「檢查申報資料」後，必要修正用紅字，提醒用一般字。提醒仍會進申報檔。</p>
            ) : (
              <div className="mb-3 space-y-2">
                <p className="text-xs font-bold">
                  必要修正 {preview.check.blockCount ?? 0}　提醒 {preview.check.warnCount ?? 0}
                  {preview.check.canExport === false ? "　現在不能產檔" : "　可以產檔"}
                </p>
                <p className="text-[10px] text-slate-500">
                  規則來自 {preview.check.settingsSource || "院所申報設定"}。
                  急性加慢性轉 09：{preview.check.acuteChronicTo09 ? "開" : "關"}。
                  病名重複天數：{preview.check.repeatDxDays ?? 0}
                  {preview.check.repeatDxMonthOnly ? "，只比對當月" : "，不限當月"}。
                </p>
                <div className="overflow-auto max-h-40">
                  <table className="w-full text-[11px] text-left">
                    <thead className="text-slate-500 border-b">
                      <tr>
                        <th className="py-1 pr-2">種類</th>
                        <th className="py-1 pr-2">病歷號</th>
                        <th className="py-1 pr-2">看診日</th>
                        <th className="py-1 pr-2">案件</th>
                        <th className="py-1">原因</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(preview.check.blocks ?? []).map((row, idx) => (
                        <tr key={`b-${idx}`} className="border-b border-slate-100 text-red-700 font-bold">
                          <td className="py-1 pr-2">必要</td>
                          <td className="py-1 pr-2 font-mono">{row.medicalNo || DASH}</td>
                          <td className="py-1 pr-2 font-mono">{row.encounterDate || DASH}</td>
                          <td className="py-1 pr-2 font-mono">{row.caseNo || DASH}</td>
                          <td className="py-1">{row.message}</td>
                        </tr>
                      ))}
                      {(preview.check.warnings ?? []).map((row, idx) => (
                        <tr key={`w-${idx}`} className="border-b border-slate-100">
                          <td className="py-1 pr-2">提醒</td>
                          <td className="py-1 pr-2 font-mono">{row.medicalNo || DASH}</td>
                          <td className="py-1 pr-2 font-mono">{row.encounterDate || DASH}</td>
                          <td className="py-1 pr-2 font-mono">{row.caseNo || DASH}</td>
                          <td className="py-1">{row.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {(preview.check.blockCount ?? 0) + (preview.check.warnCount ?? 0) > 80 ? (
                  <p className="text-[10px] text-slate-400">清單最多列 80 筆，筆數以上面的數字為準。</p>
                ) : null}
              </div>
            )}
            <h2 className="text-sm font-bold text-slate-800 border-b pb-2 mb-2">申報總表</h2>
            {!preview?.totalSheet ? (
              <p className="text-xs text-slate-400 mb-3">按「檢查申報資料」後顯示這份檔裡的總表數字。</p>
            ) : (
              <TotalSheet sheet={preview.totalSheet} submitType={submitType} />
            )}
            <h2 className="text-sm font-bold text-slate-800 border-b pb-2 mb-2 mt-3">點數清單</h2>
            {!preview ? (
              <p className="text-xs text-slate-400">一人一列，最多列 40 筆。全月筆數在總表。</p>
            ) : (
              <div className="overflow-auto max-h-48">
                <table className="w-full text-[11px] text-left">
                  <thead className="text-slate-500 border-b">
                    <tr>
                      <th className="py-1 pr-2">序</th>
                      <th className="py-1 pr-2">姓名</th>
                      <th className="py-1 pr-2">案件</th>
                      <th className="py-1 pr-2">原因</th>
                      <th className="py-1 pr-2">診察碼</th>
                      <th className="py-1 text-right">點數</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r) => (
                      <tr key={r.encounterId} className="border-b border-slate-100">
                        <td className="py-1 pr-2 font-mono">{r.queueNumber ?? DASH}</td>
                        <td className="py-1 pr-2">{r.patientName || DASH}</td>
                        <td className="py-1 pr-2 font-mono">{r.caseNo || DASH}</td>
                        <td className="py-1 pr-2 text-slate-600">{r.caseReason || DASH}</td>
                        <td className="py-1 pr-2 font-mono">{r.consultCode || DASH}</td>
                        <td className="py-1 text-right font-mono">{r.totalPoints ?? DASH}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.caseCounts ? (
                  <p className="text-[10px] text-slate-600 mt-2 font-bold">
                    案件{" "}
                    {Object.entries(preview.caseCounts)
                      .map(([k, n]) => `${k} ${n}`)
                      .join("　")}
                  </p>
                ) : null}
                {(preview.records?.length ?? 0) > 40 ? (
                  <p className="text-[10px] text-slate-400 mt-1">僅顯示前 40 筆；全數已納入組檔。</p>
                ) : null}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col overflow-hidden flex-1 min-h-[12rem]">
            <h2 className="text-sm font-bold text-slate-800 border-b pb-2 mb-3">組檔日誌</h2>
            <div className="flex-1 bg-slate-950 rounded-lg p-4 font-mono text-xs text-emerald-400 overflow-y-auto space-y-1">
              <p className="text-slate-500">不做復健／洗腎／磁片／地方補助選單。上傳不代操 VPN。</p>
              {log.map((line, idx) => (
                <p key={idx}>{line}</p>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function TotalSheet({
  sheet,
  submitType,
}: {
  sheet: NonNullable<ApiClaimsPreview["totalSheet"]>;
  submitType: ClaimsSubmitType;
}) {
  const rows: Array<[string, string, number, number, string]> = [
    ["t7 / t8", "西醫一般案件", sheet.t7, sheet.t8, "案件 01"],
    ["t9 / t10", "西醫專案案件", sheet.t9, sheet.t10, "案件 04、09"],
    ["t17 / t18", "西醫小計", sheet.t17, sheet.t18, ""],
    ["t37 / t38", "申請總計", sheet.t37, sheet.t38, "不含部分負擔"],
    ["t39 / t40", "部分負擔", sheet.t39, sheet.t40, ""],
  ];
  const kind = submitType === "bubao" ? "補報" : "送核";
  const n = (v: number) => v.toLocaleString("zh-TW");
  return (
    <div className="mb-1">
      <p className="text-[10px] text-slate-600 mb-1 leading-relaxed">
        資料格式 {sheet.t1} 門診　機構 {sheet.t2}　費用年月 {sheet.t3}　申報方式{" "}
        {sheet.t4 === "2" ? "媒體" : sheet.t4}　申報類別 {kind}　申報日期 {sheet.t6}（產檔當天）
      </p>
      <table className="w-full text-[11px] text-left">
        <thead className="text-slate-500 border-b">
          <tr>
            <th className="py-1 pr-2">欄位</th>
            <th className="py-1 pr-2">名稱</th>
            <th className="py-1 pr-2 text-right">件數</th>
            <th className="py-1 pr-2 text-right">點數</th>
            <th className="py-1">說明</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([id, name, count, points, note]) => (
            <tr key={id} className="border-b border-slate-100">
              <td className="py-1 pr-2 font-mono">{id}</td>
              <td className="py-1 pr-2 font-bold">{name}</td>
              <td className="py-1 pr-2 text-right font-mono">{n(count)}</td>
              <td className="py-1 pr-2 text-right font-mono">{n(points)}</td>
              <td className="py-1 text-slate-500">{note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
        這就是申報檔裡的總表。健保收的是這段，不用另外再上傳一張紙。洗腎、牙醫、中醫、預防保健、居家這間沒有，檔裡不填。
      </p>
    </div>
  );
}
