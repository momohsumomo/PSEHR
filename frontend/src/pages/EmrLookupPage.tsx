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
import { takeClaimsEmr } from "@/lib/claimsEmr";
import { useEscLayer } from "@/hooks/useEscLayer";
import { useListNav } from "@/hooks/useListNav";
import { compareEmrRows, type SortDir, type SortKey } from "@/lib/emrLookupSort";
import { isFirstVisit } from "@/lib/visitListMark";
import { useClinicCatalog } from "@/hooks/useClinicCatalog";
import { looseLabelHits, searchDiagnoses, searchDrugs } from "@/utils/catalogSearch";
import type { CatalogDiagnosis, CatalogDrug } from "@/types/clinicCatalog";

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

const EMR_FONT = 16;
const EMR_HINT = 14;
const EMR_FIELD_H = 34;
const EMR_ROW_H = 34;
const EMR_GAP = 8;

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
  fontSize = EMR_FONT,
}: {
  rows: DxRow[];
  fallback: string;
  fontSize?: number;
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
      <div className="border border-[#808080] bg-[#E8FFE8] text-slate-600" style={{ fontSize, padding: EMR_GAP }}>{fallback}</div>
    );
  }
  return (
    <div ref={listRef} tabIndex={0} data-list-scope="" className="border border-[#808080] bg-white outline-none" style={{ fontSize }}>
      {rows.map((d, i) => {
        const meta = d.indexMeta || {};
        const code = String(meta.icd10Code || meta.nhiIcd10Code || "");
        const text = String(meta.summaryText || "");
        const active = i === sel;
        return (
          <div
            key={i}
            data-list-row=""
            className="cursor-pointer border-b border-[#D0D0D0]"
            style={{
              background: active ? HIS.rowSelected : HIS.dxBg,
              color: "#000",
              padding: `${EMR_GAP / 2}px ${EMR_GAP}px`,
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
  fontSize = EMR_FONT,
}: {
  medList: MedRow[];
  loading: boolean;
  fontSize?: number;
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
    <table className="w-full border-collapse" style={{ fontSize }}>
      <thead style={{ background: HIS.headerBg }}>
        <tr>
          <th className="border border-[#808080] text-left" style={{ padding: EMR_GAP }}>處置名稱</th>
          <th className="border border-[#808080] text-left" style={{ padding: EMR_GAP }}>健保碼</th>
          <th className="border border-[#808080]" style={{ padding: EMR_GAP }}>數量</th>
          <th className="border border-[#808080]" style={{ padding: EMR_GAP }}>用法</th>
          <th className="border border-[#808080]" style={{ padding: EMR_GAP }}>天數</th>
        </tr>
      </thead>
      <tbody>
        {medList.length === 0 && (
          <tr>
            <td className="border border-[#D0D0A0] bg-[#FFF8C0] text-slate-500" style={{ padding: EMR_GAP }} colSpan={5}>
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
              <td className="border border-[#D0D0A0]" style={{ padding: EMR_GAP }}>{name}</td>
              <td className="border border-[#D0D0A0] font-mono" style={{ padding: EMR_GAP }}>{code}</td>
              <td className="border border-[#D0D0A0] text-center" style={{ padding: EMR_GAP }}>
                {meta.quantity ?? "—"}
              </td>
              <td className="border border-[#D0D0A0]" style={{ padding: EMR_GAP }}>{usage}</td>
              <td className="border border-[#D0D0A0] text-center" style={{ padding: EMR_GAP }}>
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
  "border border-[#808080] bg-white px-2 outline-none focus:border-[#000080]";
const lab = "font-bold";

const labStyle: CSSProperties = {
  fontSize: EMR_FONT,
  color: HIS.labelText,
  fontFamily: HIS_FONT,
  lineHeight: 1.35,
};

const inputStyle: CSSProperties = {
  fontSize: EMR_FONT,
  height: EMR_FIELD_H,
  fontFamily: HIS_FONT,
  paddingLeft: EMR_GAP,
  paddingRight: EMR_GAP,
};

const hintStyle: CSSProperties = {
  fontSize: EMR_HINT,
  lineHeight: 1.35,
};

type VisitKind = "全部" | "初診" | "複診";
type SuggestHit = { label: string; token: string };

function uniqueHits(rows: SuggestHit[], limit: number): SuggestHit[] {
  const seen = new Set<string>();
  const out: SuggestHit[] = [];
  for (const row of rows) {
    const label = row.label.trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, token: row.token });
    if (out.length >= limit) break;
  }
  return out;
}

function dxSuggest(items: CatalogDiagnosis[], query: string): SuggestHit[] {
  const q = query.trim();
  if (!q || (q.length < 2 && !/[\u3400-\u9fff]/.test(q))) return [];
  const ranked = searchDiagnoses(items, q, 8).map((d) => {
    const zh = (d.nameZh || "").trim();
    const text = (d.text || "").trim();
    const en = (d.nameEn || "").trim();
    const code = (d.nhiIcd10 || d.icd10 || "").replace(/\./g, "").toUpperCase();
    const label = zh || text || en || code;
    const token = [...new Set([code, en, text, zh].filter(Boolean))].join("|");
    return { label, token };
  });
  const hits = uniqueHits(ranked, 8);
  if (hits.length) return hits;
  const labels = items.map((d) => (d.nameZh || d.text || "").trim()).filter(Boolean);
  const byLabel = new Map(items.map((d) => [(d.nameZh || d.text || "").trim(), d]));
  return uniqueHits(
    looseLabelHits(labels, q, 8).map((label) => {
      const d = byLabel.get(label);
      const code = (d?.nhiIcd10 || d?.icd10 || "").replace(/\./g, "").toUpperCase();
      const text = (d?.text || d?.nameEn || "").trim();
      return { label, token: [...new Set([code, text, label].filter(Boolean))].join("|") };
    }),
    8,
  );
}

function drugSuggest(items: CatalogDrug[], query: string): SuggestHit[] {
  const q = query.trim();
  if (!q || (q.length < 2 && !/[\u3400-\u9fff]/.test(q))) return [];
  const ranked = searchDrugs(items, q, 8).map((d) => {
    const custom = (d.customName || "").trim();
    const trade = (d.name || "").trim();
    const short = (d.shortName || "").trim();
    const code = (d.nhiCode || "").trim().toUpperCase();
    const label = custom || trade || short || code;
    return { label, token: [...new Set([custom, trade, short, code].filter(Boolean))].join("|") };
  });
  const hits = uniqueHits(ranked, 8);
  if (hits.length) return hits;
  const labels = items.map((d) => (d.customName || d.name || "").trim()).filter(Boolean);
  const byLabel = new Map(items.map((d) => [(d.customName || d.name || "").trim(), d]));
  return uniqueHits(
    looseLabelHits(labels, q, 8).map((label) => {
      const code = (byLabel.get(label)?.nhiCode || "").trim().toUpperCase();
      return { label, token: [...new Set([label, code].filter(Boolean))].join("|") };
    }),
    8,
  );
}

function searchToken(text: string, hits: SuggestHit[]): string {
  const q = text.trim();
  if (!q) return "";
  const exact = hits.find(
    (hit) => hit.label === q || hit.token.split("|").some((part) => part.toLowerCase() === q.toLowerCase()),
  );
  if (exact) return exact.token;
  const contained = hits.filter((hit) => hit.label.includes(q));
  if (contained.length) {
    const tokens = new Set<string>([q]);
    for (const hit of contained) {
      for (const part of hit.token.split("|")) if (part) tokens.add(part);
    }
    return [...tokens].slice(0, 12).join("|");
  }
  if (hits.length === 1) return hits[0].token;
  return q;
}

function SuggestField({
  value,
  onChange,
  hits,
  style,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  hits: SuggestHit[];
  style: CSSProperties;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => setHi(0), [value]);
  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const show = open && value.trim().length > 0 && hits.length > 0;
  return (
    <div ref={boxRef} className="relative min-w-0">
      <input
        className={`${inputCls} w-full`}
        style={style}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          if (hits.length === 1 && value.trim() && value.trim() !== hits[0].label) onChange(hits[0].label);
        }}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((i) => Math.min(hits.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            onChange(hits[Math.min(hi, hits.length - 1)].label);
            setOpen(false);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          }
        }}
      />
      {show ? (
        <ul
          className="absolute left-0 right-0 z-30 overflow-auto border border-[#404040] bg-white shadow"
          style={{ top: "100%", maxHeight: EMR_ROW_H * 8 }}
        >
          {hits.map((hit, i) => (
            <li key={hit.label}>
              <button
                type="button"
                className="block w-full text-left font-bold"
                style={{
                  background: i === hi ? "#FFFF80" : "#fff",
                  fontSize: EMR_FONT,
                  padding: `${EMR_GAP / 2}px ${EMR_GAP}px`,
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(hit.label);
                  setOpen(false);
                }}
              >
                {hit.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function feeInRange(value: number, fromRaw: string, toRaw: string): boolean {
  const from = Number(fromRaw);
  const to = Number(toRaw);
  const lo = Number.isFinite(from) ? from : 0;
  const hi = Number.isFinite(to) ? to : 0;
  if (lo === 0 && hi === 0) return true;
  if (value < lo) return false;
  if (hi > 0 && value > hi) return false;
  return true;
}

function feeYmFromIso(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})/);
  if (!m) return "";
  return `${Number(m[1]) - 1911}${m[2]}`;
}

const EMR_RETURN_KEY = "wundadi.emrLookup.return";

type EmrHold = {
  dateFrom: string;
  dateTo: string;
  queriedFrom: string;
  queriedTo: string;
  shift: string;
  room: string;
  patientId: string | null;
  patientKey: string;
  patientLabel: string;
  ccText: string;
  dxText: string;
  drugText: string;
  visitKind: VisitKind;
  sameDay: boolean;
  hasImage: boolean;
  txFeeFrom: string;
  txFeeTo: string;
  drugFeeFrom: string;
  drugFeeTo: string;
  rows: ApiQueueEntry[];
  encounterId: string;
  status: string;
  sortKey: SortKey;
  sortDir: SortDir;
};

let emrHold: EmrHold | null = null;
let emrReturnEpoch = 0;
let emrReplayEpoch = 0;

export function EmrLookupPage() {
  const navigate = useNavigate();
  const apiMode = isApiMode();
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
  const [ccText, setCcText] = useState("");
  const [dxText, setDxText] = useState("");
  const [drugText, setDrugText] = useState("");
  const [visitKind, setVisitKind] = useState<VisitKind>("全部");
  const { catalog } = useClinicCatalog();
  const [status, setStatus] = useState("請設看診日起訖後按確定。");
  const [busy, setBusy] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [rows, setRows] = useState<ApiQueueEntry[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [detail, setDetail] = useState<PatientVisitEntry | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [opts, setOpts] = useState({
    sameDay: true,
    hasImage: false,
  });
  const focusReturnId = useRef<string | null>(null);
  const [claimsSeedOn, setClaimsSeedOn] = useState(false);

  useEscLayer([
    { open: finderOpen, close: () => setFinderOpen(false) },
    { open: resultOpen, close: () => setResultOpen(false) },
    { open: true, close: () => navigate("/") },
  ]);

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const n = compareEmrRows(a, b, sortKey);
      return sortDir === "asc" ? n : -n;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const chooseSort = (key: SortKey) => {
    const id = sortedRows[selectedIdx]?.resource?.id;
    if (id) focusReturnId.current = id;
    if (key === sortKey) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

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
    const epoch = raw ? Number(raw) : 0;
    const pending = epoch > 0 && epoch === emrReturnEpoch && emrHold != null;
    const replay = emrReplayEpoch === emrReturnEpoch && emrReturnEpoch !== 0 && emrHold != null;
    if (!emrHold) {
      sessionStorage.removeItem(EMR_RETURN_KEY);
      return;
    }
    if (!pending && !replay) return;
    emrReplayEpoch = emrReturnEpoch;
    sessionStorage.removeItem(EMR_RETURN_KEY);
    const hold = emrHold;
    focusReturnId.current = hold.encounterId;
    setDateFrom(hold.dateFrom);
    setDateTo(hold.dateTo);
    setQueriedFrom(hold.queriedFrom);
    setQueriedTo(hold.queriedTo);
    setShift(hold.shift || "全部");
    setRoom(hold.room || "");
    setPatientId(hold.patientId);
    setPatientKey(hold.patientKey || "");
    setPatientLabel(hold.patientLabel || "");
    setCcText(hold.ccText);
    setDxText(hold.dxText);
    setDrugText(hold.drugText);
    setVisitKind(hold.visitKind || "全部");
    setTxFeeFrom(hold.txFeeFrom);
    setTxFeeTo(hold.txFeeTo);
    setDrugFeeFrom(hold.drugFeeFrom);
    setDrugFeeTo(hold.drugFeeTo);
    setOpts({ sameDay: hold.sameDay, hasImage: hold.hasImage });
    setSortKey(hold.sortKey);
    setSortDir(hold.sortDir === "desc" ? "desc" : "asc");
    setRows(hold.rows);
    setStatus(hold.status);
    setResultOpen(true);
    const timer = window.setTimeout(() => {
      if (emrReplayEpoch === emrReturnEpoch) emrReplayEpoch = 0;
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const seed = takeClaimsEmr();
    if (!seed) return;
    const roc = isoToRoc(seed.date.slice(0, 10));
    if (!roc) return;
    focusReturnId.current = seed.encounterId || null;
    setDateFrom(roc);
    setDateTo(roc);
    setPatientId(seed.chartPatientId || null);
    setPatientKey(seed.medicalNo || "");
    setPatientLabel(seed.patientName || "");
    setClaimsSeedOn(true);
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
        sameDay: opts.sameDay,
        cc: ccText,
        dx: searchToken(dxText, dxSuggest(catalog.diagnoses, dxText)),
        drug: searchToken(drugText, drugSuggest(catalog.drugs, drugText)),
      });
      let list = bundle.entry;

      if (shift !== "全部") {
        list = list.filter((e) => (e.queueMeta?.shift || "") === shift);
      }
      if (room.trim()) {
        list = list.filter((e) => String(e.queueMeta?.room || "").includes(room.trim()));
      }
      list = list.filter((e) => {
        const meta = e.queueMeta;
        const treat = Number(meta?.consultFee || meta?.treatFee || 0);
        const drugFee = Number(meta?.drugFee || 0);
        return feeInRange(treat, txFeeFrom, txFeeTo) && feeInRange(drugFee, drugFeeFrom, drugFeeTo);
      });
      if (visitKind === "初診") list = list.filter((e) => isFirstVisit(e.queueMeta?.regCc));
      if (visitKind === "複診") list = list.filter((e) => !isFirstVisit(e.queueMeta?.regCc));

      const qFrom = isoToRoc(bundle.dateFrom) || fromNorm;
      const qTo = isoToRoc(bundle.dateTo) || toNorm;
      setQueriedFrom(qFrom);
      setQueriedTo(qTo);
      setDateFrom(qFrom);
      setDateTo(qTo);
      setRows(list);
      if (!focusReturnId.current) setSelectedIdx(0);
      setResultOpen(true);
      const clipNote = "";
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
    if (!claimsSeedOn) return;
    setClaimsSeedOn(false);
    void runConfirm();
  }, [claimsSeedOn]);

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
    emrReturnEpoch += 1;
    emrHold = {
      dateFrom,
      dateTo,
      queriedFrom,
      queriedTo,
      shift,
      room,
      patientId,
      patientKey,
      patientLabel,
      ccText,
      dxText,
      drugText,
      visitKind,
      sameDay: opts.sameDay,
      hasImage: opts.hasImage,
      txFeeFrom,
      txFeeTo,
      drugFeeFrom,
      drugFeeTo,
      rows,
      encounterId: row.resource.id,
      status,
      sortKey,
      sortDir,
    };
    sessionStorage.setItem(EMR_RETURN_KEY, String(emrReturnEpoch));
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

  useEffect(() => {
    if (!resultOpen || finderOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Enter" || ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
      const el = ev.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || el?.isContentEditable) {
        return;
      }
      if (!selected?.resource?.id) return;
      ev.preventDefault();
      enterChart();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resultOpen, finderOpen, selected, dateFrom, dateTo, queriedFrom, queriedTo, shift, room, patientId, patientKey, patientLabel, ccText, dxText, drugText, visitKind, opts.sameDay, opts.hasImage, txFeeFrom, txFeeTo, drugFeeFrom, drugFeeTo, rows, status, sortKey, sortDir, navigate]);

  const qm = selected?.queueMeta;
  const visitIso = String(qm?.encounterDate || detail?.visitDate || "");
  const dxList = detail?.diagnoses ?? [];
  const medList = detail?.medications ?? [];

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      style={{ background: "#808080", fontFamily: HIS_FONT, fontSize: EMR_FONT }}
    >
      <div
        className="relative mx-auto flex min-h-0 w-[min(1100px,98vw)] flex-1 flex-col overflow-hidden border-2"
        style={{
          margin: EMR_GAP,
          borderColor: "#404040",
          background: chrome,
          boxShadow: "4px 4px 0 rgba(0,0,0,.35)",
          fontFamily: HIS_FONT,
        }}
      >
        <HisWinTitle
          fontSize={EMR_FONT}
          title="調閱病歷系統"
          trailing={
            <button
              type="button"
              className="border border-white/40 bg-white/15 font-bold hover:bg-white/25"
              style={{ fontSize: EMR_HINT, padding: `${EMR_GAP / 2}px ${EMR_GAP}px` }}
              onClick={() => navigate("/")}
            >
              X
            </button>
          }
        />

        <div className="min-h-0 flex-1 overflow-auto" style={{ padding: EMR_GAP, display: "flex", flexDirection: "column", gap: EMR_GAP }}>
          <div className="grid grid-cols-2 lg:grid-cols-[1.4fr_1fr]" style={{ gap: EMR_GAP }}>
            <div style={{ display: "flex", flexDirection: "column", gap: EMR_GAP }}>
              <div className="grid grid-cols-[6.5rem_1fr_6.5rem_1fr] items-center" style={{ gap: EMR_GAP }}>
                <span className={lab} style={labStyle}>
                  起始日期
                </span>
                <HisRocDateField value={dateFrom} onChange={onDateFromChange} fontSize={EMR_FONT} height={EMR_FIELD_H} />
                <span className={lab} style={labStyle}>
                  截止日期
                </span>
                <HisRocDateField value={dateTo} onChange={onDateToChange} fontSize={EMR_FONT} height={EMR_FIELD_H} />
                <span className="col-span-4 text-[#404080]" style={hintStyle}>
                  預設今天；改日期後一定要再按「確定／查詢」。截止不可早於起始。
                </span>
              </div>
              <div className="flex flex-wrap items-center" style={{ gap: EMR_GAP }}>
                <button
                  type="button"
                  className="border font-bold"
                  style={{ borderColor: border, background: chrome, fontSize: EMR_HINT, padding: `${EMR_GAP / 2}px ${EMR_GAP}px` }}
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
                  className="border font-bold"
                  style={{ borderColor: border, background: chrome, fontSize: EMR_HINT, padding: `${EMR_GAP / 2}px ${EMR_GAP}px` }}
                  onClick={() => {
                    const y = addDaysRoc(todayRoc(), -1);
                    setDateFrom(y);
                    setDateTo(y);
                    setStatus("已切昨日，請再按確定／查詢");
                  }}
                >
                  昨日
                </button>
                <span className="text-[#404040]" style={hintStyle}>改日期後必須再按確定；10/5 與 10/6 筆數應不同</span>
              </div>
              <div className="grid grid-cols-[6.5rem_1fr_6.5rem_1fr] items-center" style={{ gap: EMR_GAP }}>
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

              <fieldset className="border" style={{ borderColor: border, padding: EMR_GAP }}>
                <legend className={`px-1 ${lab}`} style={labStyle}>
                  條件選擇
                </legend>
                <div className="flex items-center" style={{ gap: EMR_GAP, marginBottom: EMR_GAP }}>
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
                    className="border font-bold"
                    style={{ borderColor: border, background: "#C0C0C0", fontSize: EMR_FONT, height: EMR_FIELD_H, padding: `0 ${EMR_GAP}px` }}
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
                <div className="grid grid-cols-[6.5rem_1fr] items-center" style={{ gap: EMR_GAP, marginBottom: EMR_GAP }}>
                  <span className={lab} style={labStyle}>{"\u4e3b\u8ff0\u5167\u542b\u5b57"}</span>
                  <input className={inputCls} style={inputStyle} value={ccText} onChange={(e) => setCcText(e.target.value)} />
                  <span className={lab} style={labStyle}>{"\u8a3a\u65b7\u75c5\u540d"}</span>
                  <SuggestField
                    value={dxText}
                    onChange={setDxText}
                    hits={dxSuggest(catalog.diagnoses, dxText)}
                    style={inputStyle}
                    placeholder="打幾個字就會帶出病名"
                  />
                  <span className={lab} style={labStyle}>{"\u85e5\u54c1\u540d\u7a31"}</span>
                  <SuggestField
                    value={drugText}
                    onChange={setDrugText}
                    hits={drugSuggest(catalog.drugs, drugText)}
                    style={inputStyle}
                    placeholder="打幾個字就會帶出藥名"
                  />
                </div>
                <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center" style={{ gap: EMR_GAP }}>
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

            <div>
              <div className="grid grid-cols-[6.5rem_1fr] items-center" style={{ gap: EMR_GAP }}>
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
                  初複診
                </span>
                <select
                  className={inputCls}
                  style={inputStyle}
                  value={visitKind}
                  onChange={(e) => setVisitKind(e.target.value as VisitKind)}
                >
                  <option>全部</option>
                  <option>初診</option>
                  <option>複診</option>
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

          <fieldset className="border" style={{ borderColor: border, padding: EMR_GAP }}>
            <legend className={`px-1 ${lab}`} style={labStyle}>
              調閱選項
            </legend>
            <div className="flex flex-wrap" style={{ columnGap: EMR_GAP * 2, rowGap: EMR_GAP }}>
              {(
                [
                  ["sameDay", "含當日掛號"],
                  ["hasImage", "有建立圖像"],
                ] as const
              ).map(([k, t]) => (
                <label key={k} className={`flex items-center gap-1 ${lab}`} style={labStyle}>
                  <input
                    type="checkbox"
                    checked={opts[k]}
                    style={{ width: EMR_FONT, height: EMR_FONT }}
                    onChange={(e) => setOpts((o) => ({ ...o, [k]: e.target.checked }))}
                  />
                  {t}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex justify-end" style={{ gap: EMR_GAP }}>
            <button
              type="button"
              disabled={busy}
              className="flex min-w-[7rem] items-center justify-center border font-bold disabled:opacity-50"
              style={{ borderColor: border, background: chrome, fontSize: EMR_FONT, gap: EMR_GAP, padding: `${EMR_GAP}px ${EMR_GAP * 2}px` }}
              onClick={() => void runConfirm()}
            >
              <span className="text-sky-700">✓</span> 確定
            </button>
            <button
              type="button"
              className="flex min-w-[7rem] items-center justify-center border font-bold"
              style={{ borderColor: border, background: chrome, fontSize: EMR_FONT, gap: EMR_GAP, padding: `${EMR_GAP}px ${EMR_GAP * 2}px` }}
              onClick={() => navigate("/")}
            >
              <span className="text-red-600">✕</span> 離開
            </button>
          </div>
        </div>

        <div
          className="shrink-0 border-t"
          style={{ borderColor: HIS.chromeBorder, background: HIS.chrome, fontSize: EMR_HINT, padding: `${EMR_GAP / 2}px ${EMR_GAP}px` }}
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
            fontSize={EMR_FONT}
            title="F2 調閱病歷"
            trailing={
              <div className="flex flex-wrap items-center font-normal" style={{ gap: EMR_GAP }}>
                <span style={{ fontSize: EMR_HINT }}>
                  {queriedFrom || "—"}～{queriedTo || "—"}（{sortedRows.length}）
                </span>
                <button
                  type="button"
                  disabled={busy}
                  className="border border-white/40 bg-white/15 font-bold disabled:opacity-50"
                  style={{ fontSize: EMR_HINT, padding: `${EMR_GAP / 2}px ${EMR_GAP}px` }}
                  onClick={() => void runConfirm()}
                >
                  {busy ? "…" : "查詢"}
                </button>
                <button
                  type="button"
                  className="border border-white/40 bg-white/15 font-bold"
                  style={{ fontSize: EMR_HINT, padding: `${EMR_GAP / 2}px ${EMR_GAP}px` }}
                  onClick={() => setResultOpen(false)}
                >
                  條件
                </button>
                <button
                  type="button"
                  className="border border-white/40 bg-white/15 font-bold"
                  style={{ fontSize: EMR_HINT, padding: `${EMR_GAP / 2}px ${EMR_GAP}px` }}
                  onClick={() => navigate("/")}
                >
                  X
                </button>
              </div>
            }
          />
          <div
            className="flex shrink-0 flex-wrap items-center border-b"
            style={{ borderColor: HIS.chromeBorder, background: HIS.chrome, fontSize: EMR_FONT, gap: EMR_GAP, padding: `${EMR_GAP / 2}px ${EMR_GAP}px` }}
          >
            <span className="font-bold">起</span>
            <HisRocDateField value={dateFrom} onChange={onDateFromChange} fontSize={EMR_FONT} height={EMR_FIELD_H} />
            <span className="font-bold">迄</span>
            <HisRocDateField value={dateTo} onChange={onDateToChange} fontSize={EMR_FONT} height={EMR_FIELD_H} />
            <button
              type="button"
              className="border font-bold"
              style={{ borderColor: HIS.chromeBorder, background: "#D4D0C8", fontSize: EMR_FONT, padding: `${EMR_GAP / 2}px ${EMR_GAP}px` }}
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
            <div className="shrink-0 bg-[#FFF8C0] text-[#404000]" style={{ fontSize: EMR_HINT, padding: `${EMR_GAP / 2}px ${EMR_GAP}px` }}>
              {"\u5df2\u7be9\u75c5\u60a3\uff1a"}
              {patientLabel}
            </div>
          ) : null}
          {ccText.trim() || dxText.trim() || drugText.trim() || visitKind !== "全部" || opts.hasImage || !opts.sameDay ? (
            <div className="shrink-0 bg-[#FFF8C0] text-[#404000]" style={{ fontSize: EMR_HINT, padding: `${EMR_GAP / 2}px ${EMR_GAP}px` }}>
              {[
                visitKind !== "全部" ? visitKind : "",
                ccText.trim() ? `\u4e3b\u8ff0\u300c${ccText.trim()}\u300d` : "",
                dxText.trim() ? `\u8a3a\u65b7\u300c${dxText.trim()}\u300d` : "",
                drugText.trim() ? `\u85e5\u300c${drugText.trim()}\u300d` : "",
                opts.hasImage ? "\u6709\u5efa\u7acb\u5716\u50cf" : "",
                opts.sameDay ? "" : "\u4e0d\u542b\u7576\u65e5\u672a\u5b8c\u6210\u639b\u865f",
              ]
                .filter(Boolean)
                .join("\u3000")}
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1">
            <div
              className="flex min-h-0 w-[min(28rem,42%)] flex-col border-r"
              style={{ borderColor: HIS.chromeBorder, background: HIS.chrome }}
            >
              <div ref={resultListRef} className="min-h-0 flex-1 overflow-auto bg-white">
                <table className="w-full border-collapse" style={{ fontSize: EMR_FONT }}>
                  <thead className="sticky top-0 z-10" style={{ background: HIS.headerBg }}>
                    <tr style={{ height: EMR_ROW_H }}>
                      {(
                        [
                          ["name", "姓名", "text-left"],
                          ["date", "看診日", "text-left"],
                          ["serno", "流水", "text-right"],
                          ["case", "案卡", "text-left"],
                          ["card", "醫", "text-center"],
                          ["makeup", "補", "text-center"],
                          ["done", "完", "text-center"],
                        ] as const
                      ).map(([key, label, align]) => {
                        const active = sortKey === key;
                        return (
                          <th
                            key={key}
                            className={`cursor-pointer select-none border ${align}`}
                            style={{
                              borderColor: HIS.chromeBorder,
                              background: active ? "#C8D8F0" : undefined,
                              padding: `${EMR_GAP / 2}px ${EMR_GAP}px`,
                            }}
                            title="按一下依這個欄位排序，再按一次反過來"
                            onClick={() => chooseSort(key)}
                          >
                            {label}
                            {active ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                          </th>
                        );
                      })}
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
                            height: EMR_ROW_H,
                            background: active ? HIS.rowSelected : idx % 2 ? HIS.rowAlt : "#fff",
                            color: "#000",
                          }}
                          onClick={() => setSelectedIdx(idx)}
                          onDoubleClick={() => {
                            setSelectedIdx(idx);
                            enterChart(row);
                          }}
                        >
                          <td className="border font-bold" style={{ borderColor: "#B0B0B0", padding: `${EMR_GAP / 2}px ${EMR_GAP}px` }}>
                            {q.patientDisplay || "—"}
                          </td>
                          <td className="border border-[#A0C0D0] font-mono" style={{ padding: `${EMR_GAP / 2}px ${EMR_GAP}px` }}>
                            {isoToRoc(String(q.encounterDate || "")) || "—"}
                          </td>
                          <td className="border border-[#A0C0D0] text-right font-mono" style={{ padding: `${EMR_GAP / 2}px ${EMR_GAP}px` }}>
                            {q.queueNumber ?? "—"}
                          </td>
                          <td className="border border-[#A0C0D0] font-mono" style={{ padding: `${EMR_GAP / 2}px ${EMR_GAP}px` }}>
                            {q.caseNo || "—"}
                          </td>
                          <td className="border border-[#A0C0D0] text-center" style={{ padding: `${EMR_GAP / 2}px ${EMR_GAP}px` }}>
                            {q.cardWritten ? "✓" : ""}
                          </td>
                          <td className="border border-[#A0C0D0] text-center" style={{ padding: `${EMR_GAP / 2}px ${EMR_GAP}px` }}>
                            {String(q.afterCheck) === "2" ? "✓" : ""}
                          </td>
                          <td className="border border-[#A0C0D0] text-center" style={{ padding: `${EMR_GAP / 2}px ${EMR_GAP}px` }}>
                            {q.queueStatus === "finished" || q.fhirStatus === "finished" ? "✓" : ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!sortedRows.length && !busy && (
                  <p className="text-center text-slate-700" style={{ fontSize: EMR_FONT, padding: `${EMR_GAP * 4}px ${EMR_GAP * 2}px` }}>
                    {queriedFrom
                      ? `${queriedFrom}～${queriedTo} 無就醫。請改上方日期後按「查詢」。`
                      : "尚無結果。"}
                  </p>
                )}
              </div>
            </div>

            <div
              className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto"
              style={{ background: HIS.chrome, fontSize: EMR_FONT, padding: EMR_GAP, display: "flex", flexDirection: "column", gap: EMR_GAP }}
            >
              {!selected ? (
                <p className="p-4 text-slate-500">請由左欄選一筆。</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 border border-[#808080] bg-white md:grid-cols-3" style={{ columnGap: EMR_GAP * 2, rowGap: EMR_GAP / 2, padding: EMR_GAP }}>
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

                  <div>
                    <div className="font-bold text-[#004080]" style={{ marginBottom: EMR_GAP / 2 }}>主訴</div>
                    <pre
                      className="min-h-[4rem] whitespace-pre-wrap border border-[#C08080] bg-[#FFE8E8]"
                      style={{ fontSize: EMR_FONT, padding: EMR_GAP }}
                    >
                      {detailLoading ? "載入中…" : detail?.chiefComplaint || qm?.reasonText || "—"}
                    </pre>
                  </div>

                  <div>
                    <div className="font-bold text-[#004080]" style={{ marginBottom: EMR_GAP / 2 }}>診斷（點列選中）</div>
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
                    <div className="font-bold text-[#004080]" style={{ marginBottom: EMR_GAP / 2 }}>處方／處置（點列選中）</div>
                    <EmrRxTable loading={detailLoading} medList={medList} />
                  </div>

                  <div className="flex flex-wrap border-t border-[#808080]" style={{ gap: EMR_GAP, paddingTop: EMR_GAP }}>
                    <button
                      type="button"
                      className="border border-[#808080] bg-[#E0E0E0] font-bold"
                      style={{ fontSize: EMR_FONT, padding: `${EMR_GAP / 2}px ${EMR_GAP}px` }}
                      onClick={() => enterChart()}
                    >
                      進入病歷
                    </button>
                    <button
                      type="button"
                      className="border border-[#808080] bg-[#E0E0E0] font-bold"
                      style={{ fontSize: EMR_FONT, padding: `${EMR_GAP / 2}px ${EMR_GAP}px` }}
                      onClick={() => setResultOpen(false)}
                    >
                      條件
                    </button>
                    <button
                      type="button"
                      className="border border-[#808080] bg-[#E0E0E0] font-bold"
                      style={{ fontSize: EMR_FONT, padding: `${EMR_GAP / 2}px ${EMR_GAP}px` }}
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
