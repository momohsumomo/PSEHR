import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchCashBook,
  fetchEncountersInRange,
  fetchReport,
  isApiMode,
  type ApiQueueEntry,
  type ReportKind,
  type ReportResult,
} from "@/api/clinicApi";
import { HisReportPaper, reportToExportText } from "@/components/clinic/HisReportPaper";
import { HisWinTitle } from "@/components/clinic/HisPageFrame";
import { HIS, HIS_FONT } from "@/lib/hisTheme";
import { HisPrintToolShell } from "@/components/clinic/HisPrintToolShell";
import { HisRegisterBookPaper } from "@/components/clinic/HisRegisterBookPaper";
import { cashDetailPageElements } from "@/components/clinic/HisCashDetailPaper";
import {
  buildCashDetailReport,
  buildRegisterBookFromSummary,
  buildRegisterBookReport,
  cashDetailToExportCsv,
  cashDetailToExportText,
  registerBookToExportText,
  type CashDetailReport,
  type RegisterBookReport,
} from "@/lib/registerBookReport";
import {
  HisRocDateField,
  todayRoc,
  rocToIso,
  normalizeRoc,
  clampRocEnd,
  isoToRoc,
  addDaysRoc,
} from "@/components/clinic/HisRocDatePicker";
import { useEscLayer } from "@/hooks/useEscLayer";
import { loadClinicRegisterDefaults, readLocalClinicBundle } from "@/lib/clinicProfile";

/** 對醫聖「統計資料」截圖：條件對話框；現金統計依表單起迄打影子庫。 */

const chrome = HIS.chrome;
const border = HIS.chromeDark;

const inputCls =
  "border border-[#808080] bg-white px-1 py-0 leading-none outline-none focus:border-[#000080]";

const labelBlue = "font-bold";

const labelStyle: CSSProperties = {
  fontSize: HIS.fs.secondary,
  color: HIS.labelText,
  fontFamily: HIS_FONT,
};

const inputStyle: CSSProperties = {
  fontSize: HIS.fs.body,
  height: HIS.row.formField,
  fontFamily: HIS_FONT,
};

type DateMode = "create" | "visit" | "allReg" | "finished";
type StatKind =
  | "cash"
  | "claim"
  | "performance"
  | "selfPayDiff"
  | "disease"
  | "opdCount"
  | "drug"
  | "treatment";
type StatMode = "detail" | "total";
type PrintMode = "preview" | "printer" | "text" | "excel";

function Group({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset
      className={`border p-1 ${className}`}
      style={{ borderColor: "#808080", background: chrome }}
    >
      {title ? (
        <legend className="px-1 font-bold" style={labelStyle}>
          {title}
        </legend>
      ) : null}
      {children}
    </fieldset>
  );
}

function YesNo({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <span className="ml-auto flex items-center gap-2" style={{ fontSize: HIS.fs.body, fontFamily: HIS_FONT }}>
      <span className={labelBlue} style={labelStyle}>{"=> 選擇是否統計"}</span>
      <label className="flex items-center gap-0.5">
        <input type="radio" checked={value} onChange={() => onChange(true)} />
        是
      </label>
      <label className="flex items-center gap-0.5">
        <input type="radio" checked={!value} onChange={() => onChange(false)} />
        否
      </label>
    </span>
  );
}

function shiftOk(metaShift: string | undefined, selected: string): boolean {
  if (selected === "全部") return true;
  const key = selected.replace(/^\d\.\s*/, "");
  return !metaShift || String(metaShift).includes(key);
}

export function BillingPage() {
  const navigate = useNavigate();
  const apiMode = isApiMode();
  const [dateMode, setDateMode] = useState<DateMode>("visit");
  const [dateStart, setDateStart] = useState(todayRoc);
  const [dateEnd, setDateEnd] = useState(todayRoc);
  const [shift, setShift] = useState("全部");
  const [copay, setCopay] = useState("全部");
  const [birthFrom, setBirthFrom] = useState("");
  const [birthTo, setBirthTo] = useState("");
  const [medicalNo, setMedicalNo] = useState("");
  const [disease, setDisease] = useState("");
  const [doctor, setDoctor] = useState("全部");
  const [dept, setDept] = useState("全部");
  const [caseType, setCaseType] = useState("全部");
  const [roomOn, setRoomOn] = useState(false);
  const [room, setRoom] = useState("");
  const [statDoctor, setStatDoctor] = useState(true);
  const [statDept, setStatDept] = useState(true);
  const [statCase, setStatCase] = useState(true);
  const [statRoom, setStatRoom] = useState(true);
  const [maxSelfPay, setMaxSelfPay] = useState("999,999");
  const [dispense, setDispense] = useState("全部");
  const [statKind, setStatKind] = useState<StatKind>("cash");
  const [regFeeMode, setRegFeeMode] = useState("不分");
  const [drugCat, setDrugCat] = useState("全部");
  const [vendor, setVendor] = useState("全部");
  const [selfClaim, setSelfClaim] = useState("不含自費");
  const [statMode, setStatMode] = useState<StatMode>("detail");
  const [printMode, setPrintMode] = useState<PrintMode>("preview");
  const [status, setStatus] = useState("請設起迄後按確定（現金統計依影子庫區間）。");
  const [busy, setBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [registerBookReport, setRegisterBookReport] = useState<RegisterBookReport | null>(null);
  const [detailReport, setDetailReport] = useState<CashDetailReport | null>(null);
  const [bookKind, setBookKind] = useState<"total" | "detail">("total");
  const [queriedLabel, setQueriedLabel] = useState("");
  const [lastCount, setLastCount] = useState(0);
  const lastRows = useRef<ApiQueueEntry[]>([]);
  const [statReport, setStatReport] = useState<{ report: ReportResult; range: string } | null>(null);

  const applyQuickRange = (from: string, to: string) => {
    setDateStart(from);
    setDateEnd(to);
  };

  useEscLayer([
    { open: !!statReport, close: () => setStatReport(null) },
    { open: reportOpen, close: () => { setReportOpen(false); setRegisterBookReport(null); } },
    { open: true, close: () => navigate("/") },
  ]);

  const onDateStart = (v: string) => {
    setDateStart(v);
    const a = rocToIso(v);
    const b = rocToIso(dateEnd);
    if (a && b && a > b) setDateEnd(normalizeRoc(v));
  };
  const onDateEnd = (v: string) => setDateEnd(clampRocEnd(dateStart, v));

  const runOtherReport = async (kind: ReportKind) => {
    if (!apiMode) {
      setStatus("需 API 模式（影子庫）才能統計。");
      return;
    }
    const fromNorm = normalizeRoc(dateStart);
    const toNorm = clampRocEnd(fromNorm, dateEnd);
    const isoFrom = rocToIso(fromNorm);
    const isoTo = rocToIso(toNorm);
    if (!isoFrom || !isoTo) {
      setStatus("起迄日期格式錯誤（例 115.10.05）。");
      return;
    }
    setDateStart(fromNorm);
    setDateEnd(toNorm);
    setBusy(true);
    setStatus(kind === "claim" ? "申報統計計算中（每個月約要十幾秒）…" : "統計查詢中…");
    try {
      const report = await fetchReport(kind, {
        dateFrom: isoFrom,
        dateTo: isoTo,
        shift: shift === "全部" ? "" : shift.replace(/^\d\.\s*/, ""),
        finished: dateMode === "finished",
        selfPay: selfClaim === "只有自費" ? "only" : selfClaim === "全部" ? "all" : "exclude",
        name: kind === "disease" ? disease.trim() : "",
      });
      const range = `${fromNorm} ~ ${toNorm}`;
      setStatReport({ report, range });
      setStatus(
        `已查 ${range}：${report.title} ${report.rows.length} 列。` +
          (printMode === "text" || printMode === "excel" ? "用預覽上的「存檔」或「轉Excel」輸出。" : ""),
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "統計失敗");
    } finally {
      setBusy(false);
    }
  };

  const runConfirm = async () => {
    if (statKind === "performance" || statKind === "selfPayDiff") {
      setStatus(`「${statKindLabel(statKind)}」要算哪些項目還沒定，先不做。`);
      return;
    }
    if (statKind !== "cash") {
      await runOtherReport(statKind);
      return;
    }
    if (!apiMode) {
      setStatus("需 API 模式（影子庫）才能統計。");
      return;
    }
    const fromNorm = normalizeRoc(dateStart);
    const toNorm = clampRocEnd(fromNorm, dateEnd);
    setDateStart(fromNorm);
    setDateEnd(toNorm);
    const isoFrom = rocToIso(fromNorm);
    const isoTo = rocToIso(toNorm);
    if (!isoFrom || !isoTo) {
      setStatus("起迄日期格式錯誤（例 115.10.05）。");
      return;
    }

    setBusy(true);
    setStatus("統計查詢中…");
    try {
      const clinicName =
        readLocalClinicBundle().profile.clinicName?.trim() ||
        loadClinicRegisterDefaults().mainDept ||
        "";
      const narrow =
        Boolean(medicalNo.trim()) ||
        Boolean(disease.trim()) ||
        (roomOn && Boolean(room.trim()));
      if (statMode === "total" && !narrow) {
        const shiftKey = shift === "全部" ? "" : shift.replace(/^\d\.\s*/, "");
        const summary = await fetchCashBook({
          dateFrom: isoFrom,
          dateTo: isoTo,
          shift: shiftKey,
          finished: dateMode === "finished",
        });
        const qFrom = isoToRoc(summary.dateFrom) || fromNorm;
        const qTo = isoToRoc(summary.dateTo) || toNorm;
        setQueriedLabel(`${qFrom} ~ ${qTo}`);
        const people = summary.days.reduce((n, d) => n + (d.people || 0), 0);
        setLastCount(people);
        const book = buildRegisterBookFromSummary({
          days: summary.days,
          buckets: summary.buckets,
          clinicName,
          dateFromRoc: qFrom,
          dateToRoc: qTo,
          doctor,
          dept,
          caseFilter: caseType,
        });
        setBookKind("total");
        setDetailReport(null);
        setRegisterBookReport(book);
        setReportOpen(true);
        setStatus(
          printMode === "preview" || printMode === "printer"
            ? `總計 ${qFrom}～${qTo}：${book.totals.people} 人｜已收 ${book.totals.received}｜還單 ${book.totals.returnSlip}｜合計 ${book.totals.total}`
            : "已開預覽，用上方的「存檔」或「轉Excel」輸出。",
        );
        return;
      }

      const bundle = await fetchEncountersInRange({ dateFrom: isoFrom, dateTo: isoTo });
      let rows = bundle.entry;
      if (dateMode === "finished") {
        rows = rows.filter(
          (e) =>
            e.queueMeta?.queueStatus === "finished" || e.queueMeta?.fhirStatus === "finished",
        );
      }
      rows = rows.filter((e) => {
        const q = e.queueMeta || {};
        if (!shiftOk(q.shift, shift)) return false;
        if (medicalNo && !(q.medicalNo || "").includes(medicalNo)) return false;
        if (disease && !(q.diseaseName || q.reasonText || "").includes(disease)) return false;
        if (roomOn && room.trim() && !String(q.room || "").includes(room.trim())) return false;
        return true;
      });

      lastRows.current = rows;
      setLastCount(rows.length);
      const qFrom = isoToRoc(bundle.dateFrom) || fromNorm;
      const qTo = isoToRoc(bundle.dateTo) || toNorm;
      setQueriedLabel(`${qFrom} ~ ${qTo}`);

      if (statMode === "detail") {
        const shiftKey = shift === "全部" ? "" : shift.replace(/^\d\.\s*/, "");
        const detail = buildCashDetailReport({
          rows,
          cashReturns: bundle.cashReturns,
          clinicName,
          dateFromRoc: qFrom,
          dateToRoc: qTo,
          shiftLabel: shift,
          shiftKey,
          doctor,
          dept,
          caseFilter: caseType,
          medicalNo: medicalNo.trim(),
        });
        setBookKind("detail");
        setDetailReport(detail);
        setRegisterBookReport(null);
        setReportOpen(true);
        setLastCount(detail.headCount);
        setStatus(
          `明細 ${qFrom}～${qTo}：掛號 ${detail.visitCount} 人、還單 ${detail.headCount - detail.visitCount} 筆｜已收 ${detail.totals.received.toLocaleString("zh-TW")}｜應收現金 ${detail.cashReceivable.toLocaleString("zh-TW")}`,
        );
        return;
      }

      const book = buildRegisterBookReport({
        rows,
        clinicName,
        dateFromRoc: qFrom,
        dateToRoc: qTo,
        doctor,
        dept,
        caseFilter: caseType,
        cashReturns: bundle.cashReturns,
      });
      setBookKind("total");
      setDetailReport(null);
      setRegisterBookReport(book);
      setReportOpen(true);
      setStatus(
        printMode === "preview" || printMode === "printer"
          ? `總計 ${qFrom}～${qTo}：${book.totals.people} 人｜已收 ${book.totals.received}｜還單 ${book.totals.returnSlip}｜合計 ${book.totals.total}`
          : "已開預覽，用上方的「存檔」或「轉Excel」輸出。",
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "統計失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex h-screen flex-col overflow-hidden text-black"
      style={{ background: "#808080", fontFamily: HIS_FONT, fontSize: HIS.fs.body }}
    >
      {/* 模擬蓋在大廳上的統計對話框 */}
      <div
        className="mx-auto my-2 flex min-h-0 w-[min(920px,98vw)] flex-1 flex-col overflow-hidden border-2"
        style={{
          borderColor: "#404040",
          background: chrome,
          boxShadow: "4px 4px 0 rgba(0,0,0,.35)",
          fontFamily: HIS_FONT,
        }}
      >
        <HisWinTitle
          title="統計資料"
          trailing={
            <button
              type="button"
              className="border border-white/40 bg-white/15 px-1 text-[10px] font-bold hover:bg-white/25"
              onClick={() => navigate("/")}
              title="關閉"
            >
              X
            </button>
          }
        />

        <div className="min-h-0 flex-1 space-y-1 overflow-auto p-1.5">
          {/* A. 頂部日期／篩選 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {(
              [
                ["create", "建檔日期"],
                ["visit", "看診日期"],
                ["allReg", "全部掛號"],
                ["finished", "完診掛號"],
              ] as const
            ).map(([id, lab]) => (
              <label key={id} className={`flex items-center gap-1 ${labelBlue}`} style={labelStyle}>
                <input
                  type="radio"
                  checked={dateMode === id}
                  onChange={() => setDateMode(id)}
                />
                {lab}
              </label>
            ))}
          </div>

          <div className="flex flex-nowrap items-center gap-2 overflow-x-auto">
            <span className={labelBlue} style={labelStyle}>開始</span>
            <HisRocDateField className="shrink-0" value={dateStart} onChange={onDateStart} />
            <span className={labelBlue} style={labelStyle}>結束</span>
            <HisRocDateField className="shrink-0" value={dateEnd} onChange={onDateEnd} />
            <span className={labelBlue} style={labelStyle}>時段</span>
            <select className={`${inputCls} w-28 shrink-0`} style={inputStyle} value={shift} onChange={(e) => setShift(e.target.value)}>
              <option>全部</option>
              <option>1. 上午</option>
              <option>2. 下午</option>
              <option>3. 晚上</option>
            </select>
            <span className={labelBlue} style={labelStyle}>負擔</span>
            <select className={`${inputCls} w-28 shrink-0`} style={inputStyle} value={copay} onChange={(e) => setCopay(e.target.value)}>
              <option>全部</option>
              <option>免部份負擔</option>
              <option>部份負擔</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-1 text-[12px]">
            <span className={labelBlue} style={labelStyle}>快捷</span>
            <button type="button" className="border px-1.5 py-0.5 font-bold" style={{ borderColor: border, background: chrome }}
              onClick={() => { const t = todayRoc(); applyQuickRange(t, t); }}>今日</button>
            <button type="button" className="border px-1.5 py-0.5 font-bold" style={{ borderColor: border, background: chrome }}
              onClick={() => { const y = addDaysRoc(todayRoc(), -1); applyQuickRange(y, y); }}>昨日</button>
            <button type="button" className="border px-1.5 py-0.5 font-bold" style={{ borderColor: border, background: chrome }}
              onClick={() => { const y = addDaysRoc(todayRoc(), -1); applyQuickRange(y, todayRoc()); }}>昨～今</button>
            <span className="text-[11px] text-[#404040]">改完請按確定；筆數必須隨區間變（例 10/5≠10/6）</span>
          </div>

          <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-x-2 gap-y-1">
            <span className={labelBlue} style={labelStyle}>生日</span>
            <span className="flex items-center gap-1">
              <input className={`${inputCls} w-24 font-mono`} style={inputStyle} value={birthFrom} onChange={(e) => setBirthFrom(e.target.value)} placeholder="..." />
              <span>~</span>
              <input className={`${inputCls} w-24 font-mono`} style={inputStyle} value={birthTo} onChange={(e) => setBirthTo(e.target.value)} placeholder="..." />
            </span>
            <span className={labelBlue} style={labelStyle}>病歷</span>
            <input className={`${inputCls} w-36`} style={inputStyle} value={medicalNo} onChange={(e) => setMedicalNo(e.target.value)} />

            <span className={labelBlue} style={labelStyle}>病名</span>
            <span className="col-span-3 flex items-center gap-1">
              <input className={`${inputCls} min-w-0 flex-1`} style={inputStyle} value={disease} onChange={(e) => setDisease(e.target.value)} />
              <button
                type="button"
                className="border px-2 py-0.5 font-bold"
                style={{ borderColor: border, background: chrome, fontSize: HIS.fs.secondary }}
                onClick={() => setStatus("病名列出清單：請先在條件填關鍵字（殼）。")}
              >
                列出清單
              </button>
            </span>
          </div>

          {/* B. 醫生／科別／案件／診間 + 是否統計 */}
          <div className="space-y-0.5 border border-[#808080] p-1">
            <div className="flex items-center gap-2">
              <span className={`${labelBlue} w-10 text-right`} style={labelStyle}>醫生</span>
              <select className={`${inputCls} w-40`} style={inputStyle} value={doctor} onChange={(e) => setDoctor(e.target.value)}>
                <option>全部</option>
              </select>
              <YesNo value={statDoctor} onChange={setStatDoctor} />
            </div>
            <div className="flex items-center gap-2">
              <span className={`${labelBlue} w-10 text-right`} style={labelStyle}>科別</span>
              <select className={`${inputCls} w-40`} style={inputStyle} value={dept} onChange={(e) => setDept(e.target.value)}>
                <option>全部</option>
                <option>皮膚科</option>
              </select>
              <YesNo value={statDept} onChange={setStatDept} />
            </div>
            <div className="flex items-center gap-2">
              <span className={`${labelBlue} w-10 text-right`} style={labelStyle}>案件</span>
              <select className={`${inputCls} w-40`} style={inputStyle} value={caseType} onChange={(e) => setCaseType(e.target.value)}>
                <option>全部</option>
              </select>
              <YesNo value={statCase} onChange={setStatCase} />
            </div>
            <div className="flex items-center gap-2">
              <span className={`${labelBlue} w-10 text-right`} style={labelStyle}>診間</span>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={roomOn} onChange={(e) => setRoomOn(e.target.checked)} />
                <input
                  className={`${inputCls} w-32`}
                  style={inputStyle}
                  disabled={!roomOn}
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                />
              </label>
              <YesNo value={statRoom} onChange={setStatRoom} />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <span className={labelBlue} style={labelStyle}>列印自費金額的最大值</span>
              <input className={`${inputCls} w-24 font-mono`} style={inputStyle} value={maxSelfPay} onChange={(e) => setMaxSelfPay(e.target.value)} />
              <span className={labelBlue} style={labelStyle}>調劑</span>
              <select className={`${inputCls} w-28`} style={inputStyle} value={dispense} onChange={(e) => setDispense(e.target.value)}>
                <option>全部</option>
                <option>自行調劑</option>
                <option>交付調劑</option>
              </select>
            </div>
          </div>

          {/* C + D 下半：統計種類 + 右側方式 */}
          <div className="flex min-h-[11rem] gap-1">
            <div className="min-w-0 flex-1 border border-[#808080] p-1">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                {(
                  [
                    ["cash", "現金統計"],
                    ["claim", "申報統計"],
                    ["performance", "業績統計"],
                    ["selfPayDiff", "自費差異優待 (患心專用)"],
                    ["disease", "疾病統計"],
                    ["opdCount", "門診人數統計"],
                    ["drug", "藥品統計"],
                    ["treatment", "診療統計"],
                  ] as const
                ).map(([id, lab]) => {
                  const selected = statKind === id;
                  const emphasize = selected && id === "cash";
                  return (
                  <label
                    key={id}
                    className={`flex items-center gap-1 ${labelBlue}`}
                    style={{
                      ...labelStyle,
                      fontSize: emphasize ? HIS.fs.body : HIS.fs.secondary,
                      fontWeight: emphasize ? 700 : 600,
                    }}
                  >
                    <input
                      type="radio"
                      checked={selected}
                      onChange={() => setStatKind(id)}
                    />
                    {lab}
                  </label>
                  );
                })}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={labelBlue} style={labelStyle}>掛號費</span>
                <select className={`${inputCls} w-24`} style={inputStyle} value={regFeeMode} onChange={(e) => setRegFeeMode(e.target.value)}>
                  <option>不分</option>
                  <option>分開</option>
                </select>
                <button
                  type="button"
                  className="border px-2 py-0.5 font-bold"
                  style={{ borderColor: border, background: "#E8E8E8", fontSize: HIS.fs.secondary }}
                  onClick={() => setStatus("當日就診明細：請用現金統計＋明細預覽。")}
                >
                  當日就診明細
                </button>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className={labelBlue} style={labelStyle}>自申選擇</span>
                <select className={`${inputCls} w-24`} style={inputStyle} value={selfClaim} onChange={(e) => setSelfClaim(e.target.value)}>
                  <option>不含自費</option>
                  <option>只有自費</option>
                  <option>全部</option>
                </select>
                <span className={labelBlue} style={labelStyle}>藥品類別</span>
                <select className={`${inputCls} w-24`} style={inputStyle} value={drugCat} onChange={(e) => setDrugCat(e.target.value)}>
                  <option>全部</option>
                </select>
                <span className={labelBlue} style={labelStyle}>廠商</span>
                <select className={`${inputCls} w-24`} style={inputStyle} value={vendor} onChange={(e) => setVendor(e.target.value)}>
                  <option>全部</option>
                </select>
                <button
                  type="button"
                  className="border px-2 py-0.5 font-bold"
                  style={{ borderColor: border, background: chrome, fontSize: HIS.fs.secondary }}
                  onClick={() => setStatus("列出清單（殼）。")}
                >
                  列出清單
                </button>
              </div>
            </div>

            <div className="flex w-44 shrink-0 flex-col gap-2 border border-[#808080] p-1">
              <Group title="統計方式">
                <label className={`flex items-center gap-1 ${labelBlue}`} style={labelStyle}>
                  <input type="radio" checked={statMode === "detail"} onChange={() => setStatMode("detail")} />
                  1. 明細
                </label>
                <label className={`flex items-center gap-1 ${labelBlue}`} style={labelStyle}>
                  <input type="radio" checked={statMode === "total"} onChange={() => setStatMode("total")} />
                  2. 總計
                </label>
              </Group>
              <Group title="列印方式">
                {(
                  [
                    ["preview", "1. 預覽"],
                    ["printer", "2. 印表機"],
                    ["text", "3. 文字檔"],
                    ["excel", "4. 轉Excel"],
                  ] as const
                ).map(([id, lab]) => (
                  <label key={id} className={`flex items-center gap-1 ${labelBlue}`} style={labelStyle}>
                    <input
                      type="radio"
                      checked={printMode === id}
                      onChange={() => setPrintMode(id)}
                    />
                    {lab}
                  </label>
                ))}
              </Group>
              <button
                type="button"
                disabled={busy}
                className="mt-auto flex items-center justify-center gap-1 border px-2 py-2 text-[13px] font-bold disabled:opacity-50"
                style={{ borderColor: border, background: chrome }}
                onClick={() => void runConfirm()}
              >
                <span className="text-sky-700">✓</span> {busy ? "查詢中…" : "確定"}
              </button>
              <button
                type="button"
                className="flex items-center justify-center gap-1 border px-2 py-2 text-[13px] font-bold"
                style={{ borderColor: border, background: chrome }}
                onClick={() => navigate("/")}
              >
                <span className="text-red-600">✕</span> 離開
              </button>
            </div>
          </div>
        </div>

        {/* E. 底列 */}
        <div
          className="flex shrink-0 items-center gap-2 border-t px-2 py-0.5"
          style={{ borderColor: HIS.chromeBorder, background: HIS.chrome, fontSize: HIS.fs.secondary }}
        >
          <span className="min-w-0 flex-1 truncate">
            {status}
            {queriedLabel ? `｜上次 ${queriedLabel}（${lastCount} 筆）` : ""}
          </span>
          <button
            type="button"
            className="border px-2 py-0.5 font-bold"
            style={{ borderColor: HIS.chromeBorder, background: "#D4D0C8" }}
            onClick={() => setStatus("輸出欄位設定：現金帳欄位可之後接（殼）。")}
          >
            輸出欄位設定
          </button>
          <button
            type="button"
            className="border px-2 py-0.5 font-bold"
            style={{ borderColor: HIS.chromeBorder, background: "#D4D0C8" }}
            onClick={() => navigate("/")}
          >
            離開[X]
          </button>
        </div>
      </div>

      <HisPrintToolShell
        open={reportOpen && (bookKind === "detail" ? !!detailReport : !!registerBookReport)}
        title={
          bookKind === "detail" && detailReport
            ? `>> 掛號簿明細 >> ${detailReport.clinicName || "診所"}`
            : registerBookReport
              ? `>> 掛號簿 >> ${registerBookReport.clinicName || "診所"}`
              : "掛號簿"
        }
        onClose={() => {
          setReportOpen(false);
          setRegisterBookReport(null);
          setDetailReport(null);
        }}
        exportText={
          bookKind === "detail" && detailReport
            ? cashDetailToExportText(detailReport)
            : registerBookReport
              ? registerBookToExportText(registerBookReport)
              : ""
        }
        exportCsv={bookKind === "detail" && detailReport ? cashDetailToExportCsv(detailReport) : undefined}
        fileBaseName={bookKind === "detail" ? "\u639b\u865f\u7c3f_\u73fe\u91d1\u5e33_\u660e\u7d30" : "\u639b\u865f\u7c3f_\u73fe\u91d1\u5e33_\u7e3d\u8a08"}
        size="wide"
        paper="register_book"
        statusText={bookKind === "detail" ? "現金帳明細：一人一列，一頁約十一人。" : "現金帳總計：一天一列。"}
        pages={bookKind === "detail" && detailReport ? cashDetailPageElements(detailReport) : undefined}
      >
        {bookKind === "detail" ? null : registerBookReport ? (
          <HisRegisterBookPaper report={registerBookReport} />
        ) : null}
      </HisPrintToolShell>

      <HisPrintToolShell
        open={!!statReport}
        title={statReport ? `>> ${statReport.report.title}` : "統計"}
        onClose={() => setStatReport(null)}
        exportText={statReport ? reportToExportText(statReport.report, statReport.range) : ""}
        fileBaseName={statReport ? statReport.report.title.replace(/[（）()\s]/g, "_") : "統計"}
        size="wide"
        paper="a4"
      >
        {statReport ? (
          <HisReportPaper
            report={statReport.report}
            rangeLabel={statReport.range}
            clinicName={readLocalClinicBundle().profile.clinicName?.trim() || ""}
          />
        ) : null}
      </HisPrintToolShell>
    </div>
  );
}

function statKindLabel(k: StatKind): string {
  const map: Record<StatKind, string> = {
    cash: "現金統計",
    claim: "申報統計",
    performance: "業績統計",
    selfPayDiff: "自費差異優待",
    disease: "疾病統計",
    opdCount: "門診人數統計",
    drug: "藥品統計",
    treatment: "診療統計",
  };
  return map[k];
}
