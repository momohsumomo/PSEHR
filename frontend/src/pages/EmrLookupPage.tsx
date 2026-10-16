import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import {
  isApiMode,
  fetchEncountersInRange,
  fetchPatientVisitDetail,
  fetchPatients,
  type ApiQueueEntry,
  type PatientVisitEntry,
} from "@/api/clinicApi";
import { mapApiPatientToHit } from "@/lib/patientSearch";
import { PatientFinderDialog } from "@/components/clinic/PatientFinderDialog";
import { HisRocDateField, rocToIso, todayRoc, normalizeRoc, clampRocEnd, isoToRoc, addDaysRoc } from "@/components/clinic/HisRocDatePicker";
import { HisWinTitle } from "@/components/clinic/HisPageFrame";
import { HIS, HIS_FONT } from "@/lib/hisTheme";
import type { PatientHit } from "@/lib/patientSearch";
import { useEscLayer } from "@/hooks/useEscLayer";
import { useListNav } from "@/hooks/useListNav";

/**
 * 對醫聖「調閱病歷系統」：
 * 條件對話框（民國日期／找人）→ 確定後左右視窗結果（左清單、右當次明細）。
 */

function shiftFromSlot(slot: string | undefined): string {
  const hour = String(slot || "").includes(":") ? parseInt(String(slot).split(":")[0], 10) : NaN;
  if (!Number.isFinite(hour)) return "";
  if (hour < 12) return "上午";
  if (hour < 18) return "下午";
  return "晚上";
}

type DxRow = { indexMeta?: Record<string, unknown> };
type MedRow = {
  resource?: {
    medicationCodeableConcept?: { text?: string; coding?: Array<{ code?: string }> };
    dosageInstruction?: Array<{ text?: string }>;
  };
  indexMeta?: { drugText?: string; nhiCode?: string; daysSupply?: number; quantity?: number };
};

function EmrDxList({
  rows,
  fallback,
}: {
  rows: DxRow[];
  fallback: string;
}) {
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useListNav({
    active: rows.length > 0,
    length: rows.length,
    index: sel,
    onIndex: setSel,
    scrollerRef: listRef,
    scopeRef: listRef,
  });
  if (!rows.length) {
    return (
      <div className="border border-[#808080] bg-[#E8FFE8] px-2 py-1 text-slate-600">{fallback}</div>
    );
  }
  return (
    <div ref={listRef} tabIndex={0} data-list-scope="" className="border border-[#808080] bg-white outline-none">
      {rows.map((d, i) => {
        const meta = d.indexMeta || {};
        const code = String(meta.icd10Code || meta.nhiIcd10Code || "");
        const text = String(meta.summaryText || "");
        const active = i === sel;
        return (
          <div
            key={i}
            data-list-row=""
            className="cursor-pointer border-b border-[#D0D0D0] px-2 py-0.5"
            style={{
              background: active ? HIS.rowSelected : HIS.dxBg,
              color: "#000",
            }}
            onClick={() => setSel(i)}
          >
            <span className="font-mono">{code}</span> {text}
          </div>
        );
      })}
    </div>
  );
}

function EmrRxTable({
  medList,
  loading,
}: {
  medList: MedRow[];
  loading: boolean;
}) {
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useListNav({
    active: medList.length > 0,
    length: medList.length,
    index: sel,
    onIndex: setSel,
    scrollerRef: listRef,
    scopeRef: listRef,
  });
  return (
    <div ref={listRef} tabIndex={0} data-list-scope="" className="outline-none">
    <table className="w-full border-collapse text-[11px]">
      <thead style={{ background: HIS.headerBg }}>
        <tr>
          <th className="border border-[#808080] px-1 text-left">處置名稱</th>
          <th className="border border-[#808080] px-1 text-left">健保碼</th>
          <th className="border border-[#808080] px-1">數量</th>
          <th className="border border-[#808080] px-1">用法</th>
          <th className="border border-[#808080] px-1">天數</th>
        </tr>
      </thead>
      <tbody>
        {medList.length === 0 && (
          <tr>
            <td className="border border-[#D0D0A0] bg-[#FFF8C0] px-2 py-2 text-slate-500" colSpan={5}>
              {loading ? "載入中…" : "— 無處方明細"}
            </td>
          </tr>
        )}
        {medList.map((m, i) => {
          const res = m.resource;
          const meta = m.indexMeta || {};
          const name = meta.drugText || res?.medicationCodeableConcept?.text || "—";
          const code =
            meta.nhiCode || res?.medicationCodeableConcept?.coding?.[0]?.code || "—";
          const usage = res?.dosageInstruction?.[0]?.text || "—";
          const active = i === sel;
          return (
            <tr
              key={i}
              data-list-row=""
              className="cursor-pointer"
              style={{
                background: active ? HIS.rowSelected : i % 2 ? HIS.rowAlt : HIS.rxBg,
                color: "#000",
              }}
              onClick={() => setSel(i)}
            >
              <td className="border border-[#D0D0A0] px-1">{name}</td>
              <td className="border border-[#D0D0A0] px-1 font-mono">{code}</td>
              <td className="border border-[#D0D0A0] px-1 text-center">
                {meta.quantity ?? "—"}
              </td>
              <td className="border border-[#D0D0A0] px-1">{usage}</td>
              <td className="border border-[#D0D0A0] px-1 text-center">
                {meta.daysSupply ?? "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

const chrome = HIS.chrome;
const border = HIS.chromeDark;
const inputCls =
  "border border-[#808080] bg-white px-1 py-0 leading-none outline-none focus:border-[#000080]";
const lab = "font-bold";

const labStyle: CSSProperties = {
  fontSize: HIS.fs.secondary,
  color: HIS.labelText,
  fontFamily: HIS_FONT,
};

const inputStyle: CSSProperties = {
  fontSize: HIS.fs.body,
  height: HIS.row.formField,
  fontFamily: HIS_FONT,
};

type ViewStyle = "lr" | "tb" | "emr";
type SortKey = "name" | "date" | "serno" | "case";

function feeYmFromIso(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})/);
  if (!m) return "";
  return `${Number(m[1]) - 1911}${m[2]}`;
}

const EMR_RETURN_KEY = "wundadi.emrLookup.return";

type EmrReturnSnap = {
  dateFrom: string;
  dateTo: string;
  shift: string;
  room: string;
  patientId: string | null;
  patientKey: string;
  patientLabel: string;
  hasImage: boolean;
  encounterId: string;
};

export function EmrLookupPage() {
  const navigate = useNavigate();
  const apiMode = isApiMode();
  const [viewStyle, setViewStyle] = useState<ViewStyle>("lr");
  /** 預設：起訖都是今天；改日期才看得出清單變。防呆只擋截止早於起始。 */
  const [dateFrom, setDateFrom] = useState(todayRoc);
  const [dateTo, setDateTo] = useState(todayRoc);
  /** 實際已查過的區間（避免畫面日期改了但清單還是舊的） */
  const [queriedFrom, setQueriedFrom] = useState("");
  const [queriedTo, setQueriedTo] = useState("");
  const [feeYm, setFeeYm] = useState("");
  const [room, setRoom] = useState("");
  const [dept, setDept] = useState("全部");
  const [doctor, setDoctor] = useState("全部");
  const [copay, setCopay] = useState("全部");
  const [dispense, setDispense] = useState("全部");
  const [shift, setShift] = useState("全部");
  const [specCode, setSpecCode] = useState("全部");
  const [patientKey, setPatientKey] = useState("");
  const [patientLabel, setPatientLabel] = useState("");
  const [patientId, setPatientId] = useState<string | null>(null);
  const [finderOpen, setFinderOpen] = useState(false);
  const [txFeeFrom, setTxFeeFrom] = useState("0");
  const [txFeeTo, setTxFeeTo] = useState("0");
  const [drugFeeFrom, setDrugFeeFrom] = useState("0");
  const [drugFeeTo, setDrugFeeTo] = useState("0");
  const [status, setStatus] = useState("請設看診日起訖後按確定。");
  const [busy, setBusy] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [rows, setRows] = useState<ApiQueueEntry[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [detail, setDetail] = useState<PatientVisitEntry | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [opts, setOpts] = useState({
    cert: false,
    antibiotic: false,
    sameDay: true,
    ctrl: false,
    inject: false,
    hasImage: false,
  });
  const [trials, setTrials] = useState({
    dm: false,
    bcHep: false,
    dialysis: false,
  });
  const pendingReturn = useRef<EmrReturnSnap | null>(null);
  const focusReturnId = useRef<string | null>(null);

  useEscLayer([
    { open: finderOpen, close: () => setFinderOpen(false) },
    { open: resultOpen, close: () => setResultOpen(false) },
    { open: true, close: () => navigate("/") },
  ]);

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const qa = a.queueMeta || {};
      const qb = b.queueMeta || {};
      if (sortKey === "name") {
        return String(qa.patientDisplay || "").localeCompare(String(qb.patientDisplay || ""), "zh-Hant");
      }
      if (sortKey === "serno") {
        const byDate = String(qa.encounterDate || "").localeCompare(String(qb.encounterDate || ""));
        if (byDate !== 0) return byDate;
        return Number(qa.queueNumber || 0) - Number(qb.queueNumber || 0);
      }
      if (sortKey === "case") {
        return String(qa.caseNo || "").localeCompare(String(qb.caseNo || ""));
      }
      // date（預設）：看診日 → 流水
      const byDate = String(qa.encounterDate || "").localeCompare(String(qb.encounterDate || ""));
      if (byDate !== 0) return byDate;
      return Number(qa.queueNumber || 0) - Number(qb.queueNumber || 0);
    });
    return copy;
  }, [rows, sortKey]);

  const resultListRef = useRef<HTMLDivElement>(null);
  const onResultIndex = useCallback((i: number) => setSelectedIdx(i), []);
  useListNav({
    active: resultOpen && !finderOpen,
    length: sortedRows.length,
    index: selectedIdx,
    onIndex: onResultIndex,
    scrollerRef: resultListRef,
  });

  const selected = sortedRows[selectedIdx] ?? null;

  useEffect(() => {
    const raw = sessionStorage.getItem(EMR_RETURN_KEY);
    if (!raw) return;
    sessionStorage.removeItem(EMR_RETURN_KEY);
    try {
      const snap = JSON.parse(raw) as EmrReturnSnap;
      pendingReturn.current = snap;
      focusReturnId.current = snap.encounterId;
      setDateFrom(snap.dateFrom);
      setDateTo(snap.dateTo);
      setShift(snap.shift || "全部");
      setRoom(snap.room || "");
      setPatientId(snap.patientId);
      setPatientKey(snap.patientKey || "");
      setPatientLabel(snap.patientLabel || "");
      setOpts((prev) => ({ ...prev, hasImage: Boolean(snap.hasImage) }));
    } catch {
      pendingReturn.current = null;
    }
  }, []);

  useEffect(() => {
    const id = focusReturnId.current;
    if (!id || !rows.length) return;
    const idx = sortedRows.findIndex((e) => e.resource?.id === id);
    if (idx >= 0) {
      setSelectedIdx(idx);
      focusReturnId.current = null;
    }
  }, [rows, sortedRows]);

  const onDateFromChange = (v: string) => {
    setDateFrom(v);
    const a = rocToIso(v);
    const b = rocToIso(dateTo);
    if (a && b && a > b) setDateTo(normalizeRoc(v));
    if (queriedFrom) setStatus("日期已改，請再按確定／查詢。");
  };

  const onDateToChange = (v: string) => {
    setDateTo(clampRocEnd(dateFrom, v));
    if (queriedFrom) setStatus("日期已改，請再按確定／查詢。");
  };

  const onPick = (hit: PatientHit) => {
    setFinderOpen(false);
    setPatientId(hit.id);
    setPatientKey(hit.idNo || hit.medicalNo || hit.name);
    setPatientLabel(`${hit.name} ${hit.idNo || ""}`.trim());
  };

  const runConfirm = async () => {
    if (busy) return;
    const fromNorm = normalizeRoc(dateFrom);
    const toNorm = clampRocEnd(fromNorm, dateTo);
    if (toNorm !== dateTo) setDateTo(toNorm);
    if (fromNorm !== dateFrom) setDateFrom(fromNorm);

    const isoFrom = rocToIso(fromNorm);
    const isoTo = rocToIso(toNorm);
    if (!isoFrom || !isoTo) {
      setStatus("起始／截止日期格式錯誤（例 115.10.05）。");
      return;
    }
    if (isoTo < isoFrom) {
      setStatus("截止日期不可早於起始日期。");
      return;
    }
    if (!apiMode) {
      setStatus("需 API 模式（影子庫）才能調閱。");
      return;
    }

    // 先清舊清單並解鎖 busy：細節載入不可卡住「查詢」按鈕（否則改日再查永遠還是舊結果）
    setBusy(true);
    setStatus(`查詢中 ${fromNorm}～${toNorm}…`);
    setRows([]);
    setSelectedIdx(0);
    setDetail(null);
    try {
      const bundle = await fetchEncountersInRange({
        dateFrom: isoFrom,
        dateTo: isoTo,
        patientId,
        hasImage: opts.hasImage,
      });
      let list = bundle.entry;

      if (shift !== "全部") {
        list = list.filter((e) => (e.queueMeta?.shift || "") === shift);
      }
      if (room.trim()) {
        list = list.filter((e) => String(e.queueMeta?.room || "").includes(room.trim()));
      }

      const qFrom = isoToRoc(bundle.dateFrom) || fromNorm;
      const qTo = isoToRoc(bundle.dateTo) || toNorm;
      setQueriedFrom(qFrom);
      setQueriedTo(qTo);
      setDateFrom(qFrom);
      setDateTo(qTo);
      setRows(list);
      if (!focusReturnId.current) setSelectedIdx(0);
      setResultOpen(true);
      const clipNote = bundle.clipped
        ? "未指定病患，區間較長，已改查截止日前約三個月。"
        : "";
      const imageNote =
        opts.hasImage && bundle.imageFolderReady === false
          ? "相片資料夾讀不到，有建立圖像沒有篩到人。"
          : opts.hasImage
            ? "已套用有建立圖像。"
            : "";
      setStatus(
        `已查 ${qFrom}～${qTo}：${list.length} 筆（伺服器 total=${bundle.total}）${clipNote ? " " + clipNote : ""}${imageNote ? " " + imageNote : ""}`,
      );
      setBusy(false);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "調閱失敗");
      setBusy(false);
    }
  };

  useEffect(() => {
    const snap = pendingReturn.current;
    if (!snap) return;
    if (dateFrom !== snap.dateFrom || dateTo !== snap.dateTo) return;
    if ((shift || "\u5168\u90e8") !== (snap.shift || "\u5168\u90e8")) return;
    if ((room || "") !== (snap.room || "")) return;
    if ((patientId || null) !== (snap.patientId || null)) return;
    if (Boolean(opts.hasImage) !== Boolean(snap.hasImage)) return;
    pendingReturn.current = null;
    void runConfirm();
  }, [dateFrom, dateTo, shift, room, patientId, opts.hasImage]);

  useEffect(() => {
    if (!resultOpen || !apiMode) return;
    const pid = selected?.queueMeta?.patientId;
    const eid = selected?.resource?.id;
    if (!pid || !eid) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void fetchPatientVisitDetail(pid, eid)
      .then((hit) => {
        if (!cancelled) setDetail(hit);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resultOpen, apiMode, selected?.queueMeta?.patientId, selected?.resource?.id]);

  const enterChart = (entry?: ApiQueueEntry | null) => {
    const row = entry ?? selected;
    if (!row?.resource?.id) return;
    const snap: EmrReturnSnap = {
      dateFrom,
      dateTo,
      shift,
      room,
      patientId,
      patientKey,
      patientLabel,
      hasImage: opts.hasImage,
      encounterId: row.resource.id,
    };
    sessionStorage.setItem(EMR_RETURN_KEY, JSON.stringify(snap));
    const q = row.queueMeta || {};
    const params = new URLSearchParams({
      encounter: row.resource.id,
      tab: "chart",
      from: "emr",
    });
    const date = String(q.encounterDate || "").slice(0, 10);
    if (date) params.set("date", date);
    const visitShift = q.shift || shiftFromSlot(q.slotTime);
    if (visitShift) params.set("shift", visitShift);
    if (q.pharmacist) params.set("pharmacist", q.pharmacist);
    navigate(`/clinic?${params.toString()}`);
  };

  const qm = selected?.queueMeta;
  const visitIso = String(qm?.encounterDate || detail?.visitDate || "");
  const dxList = detail?.diagnoses ?? [];
  const medList = detail?.medications ?? [];

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      style={{ background: "#808080", fontFamily: HIS_FONT, fontSize: HIS.fs.body }}
    >
      <div
        className="relative mx-auto my-2 flex min-h-0 w-[min(960px,98vw)] flex-1 flex-col overflow-hidden border-2"
        style={{
          borderColor: "#404040",
          background: chrome,
          boxShadow: "4px 4px 0 rgba(0,0,0,.35)",
          fontFamily: HIS_FONT,
        }}
      >
        <HisWinTitle
          title="調閱病歷系統"
          trailing={
            <button
              type="button"
              className="border border-white/40 bg-white/15 px-1 text-[10px] font-bold hover:bg-white/25"
              onClick={() => navigate("/")}
            >
              X
            </button>
          }
        />

        <div className="min-h-0 flex-1 space-y-1 overflow-auto p-1.5">
          <div className="flex flex-wrap items-center gap-3">
            {(
              [
                ["lr", "傳統式左右視窗"],
                ["tb", "進階式上下視窗"],
                ["emr", "轉電子病歷"],
              ] as const
            ).map(([id, t]) => (
              <label key={id} className={`flex items-center gap-1 ${lab}`} style={labStyle}>
                <input type="radio" checked={viewStyle === id} onChange={() => setViewStyle(id)} />
                {t}
              </label>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-[1.4fr_1fr]">
            <div className="space-y-1">
              <div className="grid grid-cols-[5rem_1fr_5rem_1fr] items-center gap-1">
                <span className={lab} style={labStyle}>
                  起始日期
                </span>
                <HisRocDateField value={dateFrom} onChange={onDateFromChange} />
                <span className={lab} style={labStyle}>
                  截止日期
                </span>
                <HisRocDateField value={dateTo} onChange={onDateToChange} />
                <span className="col-span-4 text-[10px] text-[#404080]">
                  預設今天；改日期後一定要再按「確定／查詢」。截止不可早於起始。
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  className="border px-1.5 py-0.5 text-[11px] font-bold"
                  style={{ borderColor: border, background: chrome }}
                  onClick={() => {
                    const d = todayRoc();
                    setDateFrom(d);
                    setDateTo(d);
                    setStatus("已切今日，請再按確定／查詢");
                  }}
                >
                  今日
                </button>
                <button
                  type="button"
                  className="border px-1.5 py-0.5 text-[11px] font-bold"
                  style={{ borderColor: border, background: chrome }}
                  onClick={() => {
                    const y = addDaysRoc(todayRoc(), -1);
                    setDateFrom(y);
                    setDateTo(y);
                    setStatus("已切昨日，請再按確定／查詢");
                  }}
                >
                  昨日
                </button>
                <span className="text-[11px] text-[#404040]">改日期後必須再按確定；10/5 與 10/6 筆數應不同</span>
              </div>
              <div className="grid grid-cols-[5rem_1fr_5rem_1fr] items-center gap-1">
                <span className={lab} style={labStyle}>
                  費用年月
                </span>
                <input
                  className={inputCls}
                  style={inputStyle}
                  value={feeYm}
                  onChange={(e) => setFeeYm(e.target.value)}
                  placeholder="YYYMM"
                />
                <span className={lab} style={labStyle}>
                  指定診間
                </span>
                <input className={inputCls} style={inputStyle} value={room} onChange={(e) => setRoom(e.target.value)} />
              </div>

              <fieldset className="border p-1" style={{ borderColor: border }}>
                <legend className={`px-1 ${lab}`} style={labStyle}>
                  條件選擇
                </legend>
                <div className="mb-1 flex items-center gap-1">
                  <span className={lab} style={labStyle}>
                    病歷號生日
                  </span>
                  <input
                    className={`${inputCls} min-w-0 flex-1 bg-[#D0E8FF]`}
                    style={inputStyle}
                    value={patientKey}
                    onChange={(e) => {
                      setPatientKey(e.target.value);
                      setPatientId(null);
                      setPatientLabel("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      const q = patientKey.trim();
                      if (!q) return;
                      void (async () => {
                        if (!apiMode) {
                          setStatus("找人需 API 模式");
                          return;
                        }
                        try {
                          const res = await fetchPatients({ q, match: "typed", _count: 20 });
                          const hits = (res.entry ?? []).map((row) => mapApiPatientToHit(row.resource));
                          if (hits.length === 1) {
                            const hit = hits[0];
                            setPatientId(hit.id);
                            setPatientKey(hit.idNo || hit.medicalNo || hit.name);
                            setPatientLabel(`${hit.name}　病歷 ${hit.medicalNo || "—"}`);
                            setStatus("已帶入這一位。可再改日期或其他條件，然後按確定。");
                            return;
                          }
                          if (hits.length === 0) {
                            setPatientId(null);
                            setPatientLabel("");
                            setStatus("查無符合的病患");
                            return;
                          }
                          setFinderOpen(true);
                          setStatus(`找到 ${hits.length} 位，請在視窗裡選一位。選好後再按確定才查病歷。`);
                        } catch (err) {
                          setStatus(err instanceof Error ? err.message : "找人失敗");
                        }
                      })();
                    }}
                    placeholder="輸入後按 Enter 找人（不會立刻查病歷）"
                  />
                  <button
                    type="button"
                    className="border px-1 font-bold"
                    style={{ borderColor: border, background: "#C0C0C0", fontSize: HIS.fs.secondary }}
                    onClick={() => setFinderOpen(true)}
                    title="找人"
                  >
                    →
                  </button>
                  <input
                    className={`${inputCls} w-40`}
                    style={inputStyle}
                    readOnly
                    value={patientLabel}
                    placeholder="選定病患（可略）"
                  />
                </div>
                <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-1">
                  <span className={lab} style={labStyle}>
                    診療費
                  </span>
                  <span className="flex items-center gap-1">
                    <input
                      className={`${inputCls} w-16 font-mono`}
                      style={inputStyle}
                      value={txFeeFrom}
                      onChange={(e) => setTxFeeFrom(e.target.value)}
                    />
                    <span>~</span>
                    <input
                      className={`${inputCls} w-16 font-mono`}
                      style={inputStyle}
                      value={txFeeTo}
                      onChange={(e) => setTxFeeTo(e.target.value)}
                    />
                    <span>點</span>
                  </span>
                  <span className={lab} style={labStyle}>
                    藥費
                  </span>
                  <span className="flex items-center gap-1">
                    <input
                      className={`${inputCls} w-16 font-mono`}
                      style={inputStyle}
                      value={drugFeeFrom}
                      onChange={(e) => setDrugFeeFrom(e.target.value)}
                    />
                    <span>~</span>
                    <input
                      className={`${inputCls} w-16 font-mono`}
                      style={inputStyle}
                      value={drugFeeTo}
                      onChange={(e) => setDrugFeeTo(e.target.value)}
                    />
                    <span>點</span>
                  </span>
                </div>
              </fieldset>
            </div>

            <div className="space-y-1">
              <div className="grid grid-cols-[5rem_1fr] gap-1">
                <span className={lab} style={labStyle}>
                  就醫科別
                </span>
                <select className={inputCls} style={inputStyle} value={dept} onChange={(e) => setDept(e.target.value)}>
                  <option>全部</option>
                  <option>皮膚科</option>
                </select>
                <span className={lab} style={labStyle}>
                  醫師姓名
                </span>
                <select
                  className={inputCls}
                  style={inputStyle}
                  value={doctor}
                  onChange={(e) => setDoctor(e.target.value)}
                >
                  <option>全部</option>
                </select>
                <span className={lab} style={labStyle}>
                  部份負擔
                </span>
                <select
                  className={inputCls}
                  style={inputStyle}
                  value={copay}
                  onChange={(e) => setCopay(e.target.value)}
                >
                  <option>全部</option>
                </select>
                <span className={lab} style={labStyle}>
                  調劑方式
                </span>
                <select
                  className={inputCls}
                  style={inputStyle}
                  value={dispense}
                  onChange={(e) => setDispense(e.target.value)}
                >
                  <option>全部</option>
                </select>
                <span className={lab} style={labStyle}>
                  時段
                </span>
                <select
                  className={inputCls}
                  style={inputStyle}
                  value={shift}
                  onChange={(e) => setShift(e.target.value)}
                >
                  <option>全部</option>
                  <option>上午</option>
                  <option>下午</option>
                  <option>晚上</option>
                </select>
                <span className={lab} style={labStyle}>
                  特定代碼
                </span>
                <select
                  className={inputCls}
                  style={inputStyle}
                  value={specCode}
                  onChange={(e) => setSpecCode(e.target.value)}
                >
                  <option>全部</option>
                </select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            <fieldset className="border p-1" style={{ borderColor: border }}>
              <legend className={`px-1 ${lab}`} style={labStyle}>
                調閱選項
              </legend>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                {(
                  [
                    ["cert", "調已開立診斷證明書"],
                    ["antibiotic", "調抗生素"],
                    ["sameDay", "含當日掛號"],
                    ["ctrl", "管制藥"],
                    ["inject", "注射劑"],
                    ["hasImage", "有建立圖像"],
                  ] as const
                ).map(([k, t]) => (
                  <label key={k} className={`flex items-center gap-1 ${lab}`} style={labStyle}>
                    <input
                      type="checkbox"
                      checked={opts[k]}
                      onChange={(e) => setOpts((o) => ({ ...o, [k]: e.target.checked }))}
                    />
                    {t}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="border p-1" style={{ borderColor: border }}>
              <legend className={`px-1 ${lab}`} style={labStyle}>
                試辦計畫
              </legend>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                {(
                  [
                    ["dm", "調糖尿照護"],
                    ["bcHep", "BC肝試辦計畫"],
                    ["dialysis", "洗腎 PRE_ESRD"],
                  ] as const
                ).map(([k, t]) => (
                  <label key={k} className={`flex items-center gap-1 ${lab}`} style={labStyle}>
                    <input
                      type="checkbox"
                      checked={trials[k]}
                      onChange={(e) => setTrials((o) => ({ ...o, [k]: e.target.checked }))}
                    />
                    {t}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              className="flex min-w-[6rem] items-center justify-center gap-1 border px-3 py-2 text-[13px] font-bold disabled:opacity-50"
              style={{ borderColor: border, background: chrome }}
              onClick={() => void runConfirm()}
            >
              <span className="text-sky-700">✓</span> 確定
            </button>
            <button
              type="button"
              className="flex min-w-[6rem] items-center justify-center gap-1 border px-3 py-2 text-[13px] font-bold"
              style={{ borderColor: border, background: chrome }}
              onClick={() => navigate("/")}
            >
              <span className="text-red-600">✕</span> 離開
            </button>
          </div>
        </div>

        <div
          className="shrink-0 border-t px-2 py-0.5"
          style={{ borderColor: HIS.chromeBorder, background: HIS.chrome, fontSize: HIS.fs.secondary }}
        >
          {status}
        </div>
      </div>

      {resultOpen && (
        <div
          className="fixed inset-0 z-[80] flex flex-col border-2"
          style={{ fontFamily: HIS_FONT, background: HIS.chrome, borderColor: "#404040" }}
        >
          <HisWinTitle
            title="F2 調閱病歷"
            trailing={
              <div className="flex flex-wrap items-center gap-1 font-normal">
                <span style={{ fontSize: HIS.fs.tertiary }}>
                  {queriedFrom || "—"}～{queriedTo || "—"}（{sortedRows.length}）
                </span>
                <button
                  type="button"
                  disabled={busy}
                  className="border border-white/40 bg-white/15 px-1 text-[10px] font-bold disabled:opacity-50"
                  onClick={() => void runConfirm()}
                >
                  {busy ? "…" : "查詢"}
                </button>
                <button
                  type="button"
                  className="border border-white/40 bg-white/15 px-1 text-[10px] font-bold"
                  onClick={() => setResultOpen(false)}
                >
                  條件
                </button>
                <button
                  type="button"
                  className="border border-white/40 bg-white/15 px-1 text-[10px] font-bold"
                  onClick={() => navigate("/")}
                >
                  X
                </button>
              </div>
            }
          />
          <div
            className="flex shrink-0 flex-wrap items-center gap-2 border-b px-2 py-0.5"
            style={{ borderColor: HIS.chromeBorder, background: HIS.chrome, fontSize: HIS.fs.secondary }}
          >
            <span className="font-bold">起</span>
            <HisRocDateField value={dateFrom} onChange={onDateFromChange} />
            <span className="font-bold">迄</span>
            <HisRocDateField value={dateTo} onChange={onDateToChange} />
            <button
              type="button"
              className="border px-1.5 py-0.5 font-bold"
              style={{ borderColor: HIS.chromeBorder, background: "#D4D0C8" }}
              onClick={() => {
                setPatientId(null);
                setPatientKey("");
                setPatientLabel("");
              }}
            >
              清病患
            </button>
          </div>

          {patientLabel ? (
            <div className="shrink-0 bg-[#FFF8C0] px-2 py-0.5 text-[11px] text-[#404000]">
              已篩病患：{patientLabel}（「清病患」後再查＝全院該日）
            </div>
          ) : null}

          <div className={`min-h-0 flex-1 ${viewStyle === "tb" ? "flex flex-col" : "flex"}`}>
            <div
              className={`flex min-h-0 flex-col border-r ${
                viewStyle === "tb" ? "h-[38%]" : "w-[min(22rem,38%)]"
              }`}
              style={{ borderColor: HIS.chromeBorder, background: HIS.chrome }}
            >
              <div ref={resultListRef} className="min-h-0 flex-1 overflow-auto bg-white">
                <table className="w-full border-collapse" style={{ fontSize: HIS.fs.secondary }}>
                  <thead className="sticky top-0 z-10" style={{ background: HIS.headerBg }}>
                    <tr style={{ height: HIS.row.listHeader }}>
                      <th className="border px-1 py-0.5 text-left" style={{ borderColor: HIS.chromeBorder }}>姓名</th>
                      <th className="border px-1 py-0.5 text-left" style={{ borderColor: HIS.chromeBorder }}>看診日</th>
                      <th className="border px-1 py-0.5 text-right" style={{ borderColor: HIS.chromeBorder }}>流水</th>
                      <th className="border px-1 py-0.5 text-left" style={{ borderColor: HIS.chromeBorder }}>案卡</th>
                      <th className="border px-1 py-0.5" style={{ borderColor: HIS.chromeBorder }}>醫</th>
                      <th className="border px-1 py-0.5" style={{ borderColor: HIS.chromeBorder }}>補</th>
                      <th className="border px-1 py-0.5" style={{ borderColor: HIS.chromeBorder }}>完</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row, idx) => {
                      const q = row.queueMeta || {};
                      const active = idx === selectedIdx;
                      return (
                        <tr
                          key={`${row.resource.id}-${idx}`}
                          data-list-row=""
                          className="cursor-pointer"
                          style={{
                            height: HIS.row.list,
                            background: active ? HIS.rowSelected : idx % 2 ? HIS.rowAlt : "#fff",
                            color: "#000",
                          }}
                          onClick={() => setSelectedIdx(idx)}
                          onDoubleClick={() => {
                            setSelectedIdx(idx);
                            enterChart(row);
                          }}
                        >
                          <td className="border px-1 py-0.5 font-bold" style={{ borderColor: "#B0B0B0" }}>
                            {q.patientDisplay || "—"}
                          </td>
                          <td className="border border-[#A0C0D0] px-1 py-0.5 font-mono">
                            {isoToRoc(String(q.encounterDate || "")) || "—"}
                          </td>
                          <td className="border border-[#A0C0D0] px-1 py-0.5 text-right font-mono">
                            {q.queueNumber ?? "—"}
                          </td>
                          <td className="border border-[#A0C0D0] px-1 py-0.5 font-mono">
                            {q.caseNo || "—"}
                          </td>
                          <td className="border border-[#A0C0D0] px-1 py-0.5 text-center">
                            {q.cardWritten ? "✓" : ""}
                          </td>
                          <td className="border border-[#A0C0D0] px-1 py-0.5 text-center" />
                          <td className="border border-[#A0C0D0] px-1 py-0.5 text-center">
                            {q.queueStatus === "finished" || q.fhirStatus === "finished" ? "✓" : ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!sortedRows.length && !busy && (
                  <p className="px-3 py-8 text-center text-xs text-slate-700">
                    {queriedFrom
                      ? `${queriedFrom}～${queriedTo} 無就醫。請改上方日期後按「查詢」。`
                      : "尚無結果。"}
                  </p>
                )}
              </div>
              <div
                className="flex shrink-0 flex-wrap gap-3 border-t px-2 py-1"
                style={{ borderColor: HIS.chromeBorder, background: HIS.chrome, fontSize: HIS.fs.secondary }}
              >
                {(
                  [
                    ["date", "看診日"],
                    ["name", "姓名"],
                    ["serno", "流水"],
                    ["case", "案"],
                  ] as const
                ).map(([k, t]) => (
                  <label key={k} className="flex items-center gap-1 font-bold">
                    <input type="radio" checked={sortKey === k} onChange={() => setSortKey(k)} />
                    {t}
                  </label>
                ))}
              </div>
            </div>

            <div
              className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto p-1.5"
              style={{ background: HIS.chrome, fontSize: HIS.fs.body }}
            >
              {!selected ? (
                <p className="p-4 text-slate-500">請由左欄選一筆。</p>
              ) : (
                <>
                  <div className="mb-1 grid grid-cols-2 gap-x-3 gap-y-0.5 border border-[#808080] bg-white p-1 md:grid-cols-3">
                    <div>
                      費用年月：
                      <b className="font-mono">{feeYm || feeYmFromIso(visitIso) || "—"}</b>
                    </div>
                    <div>
                      日期：
                      <b className="font-mono">{isoToRoc(visitIso) || "—"}</b>
                      {"　"}時間：
                      <b className="font-mono">{qm?.slotTime || "—"}</b>
                    </div>
                    <div>
                      費用：
                      <b className="font-mono">{String(qm?.totalFee ?? "—")}</b> 元
                    </div>
                    <div>
                      病歷號碼：
                      <b className="font-mono">{qm?.medicalNo || "—"}</b>
                    </div>
                    <div>
                      藥價：
                      <b className="font-mono">{String(qm?.drugFee ?? "—")}</b>
                      {"　"}天數：
                      <b className="font-mono">{detail?.rxDays || qm?.rxDays || "—"}</b>
                    </div>
                    <div>
                      年齡：
                      <b className="font-mono">{qm?.ageSex || qm?.age || "—"}</b>
                    </div>
                  </div>

                  <div className="mb-1">
                    <div className="font-bold text-[#004080]">主訴</div>
                    <pre
                      className="min-h-[3rem] whitespace-pre-wrap border border-[#C08080] bg-[#FFE8E8] p-1 text-[12px]"
                    >
                      {detailLoading ? "載入中…" : detail?.chiefComplaint || qm?.reasonText || "—"}
                    </pre>
                  </div>

                  <div className="mb-1">
                    <div className="font-bold text-[#004080]">診斷（點列選中）</div>
                    <EmrDxList
                      fallback={
                        qm?.icdCode && qm.icdCode !== "—"
                          ? `${qm.icdCode} ${qm.diseaseName || ""}`
                          : "—"
                      }
                      rows={dxList}
                    />
                  </div>

                  <div className="min-h-0 flex-1">
                    <div className="font-bold text-[#004080]">處方／處置（點列選中）</div>
                    <EmrRxTable loading={detailLoading} medList={medList} />
                  </div>

                  <div className="mt-1 flex flex-wrap gap-1 border-t border-[#808080] pt-1">
                    <button
                      type="button"
                      className="border border-[#808080] bg-[#E0E0E0] px-2 py-0.5 font-bold"
                      onClick={() => enterChart()}
                    >
                      進入病歷
                    </button>
                    <button
                      type="button"
                      className="border border-[#808080] bg-[#E0E0E0] px-2 py-0.5 font-bold"
                      onClick={() => setResultOpen(false)}
                    >
                      條件
                    </button>
                    <button
                      type="button"
                      className="border border-[#808080] bg-[#E0E0E0] px-2 py-0.5 font-bold"
                      onClick={() => navigate("/")}
                    >
                      離開
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <PatientFinderDialog
        open={finderOpen}
        initialQuery={patientKey}
        onClose={() => setFinderOpen(false)}
        onSelect={onPick}
      />
    </div>
  );
}
