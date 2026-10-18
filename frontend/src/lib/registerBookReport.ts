import type { ApiQueueEntry } from "@/api/clinicApi";
import { isoToRoc } from "@/components/clinic/HisRocDatePicker";

/** 掛號簿／現金帳總表一列（按日彙總）。缺欄填 0，不編造。 */
export type RegisterBookDayRow = {
  dateRoc: string;
  dateIso: string;
  people: number;
  deposit: number;
  copayAmt: number;
  cardDisc: number;
  drugDisc: number;
  regFee: number;
  selfPay: number;
  received: number;
  arrears: number;
  misc: number;
  repay: number;
  returnSlip: number;
  total: number;
};

export type RegisterBookCaseBucket = {
  code: string;
  label: string;
  firstVisit: number;
  revisit: number;
  missingCard: number;
  returnCard: number;
  repay: number;
};

export type RegisterBookReport = {
  clinicName: string;
  dateFromRoc: string;
  dateToRoc: string;
  doctor: string;
  dept: string;
  caseFilter: string;
  printedAtRoc: string;
  printedTime: string;
  reportNo: string;
  days: RegisterBookDayRow[];
  totals: Omit<RegisterBookDayRow, "dateRoc" | "dateIso">;
  cashReceivable: number;
  visitCount: number;
  caseBuckets: RegisterBookCaseBucket[];
};

const COPAY_LABEL: Record<string, string> = {
  "003": "低收入、福保",
  "004": "榮民、農保",
  "902": "三歲免部份負擔",
  D12: "一般門診",
  D24: "一般門診加藥品",
  "\u81ea\u8cbb": "\u81ea\u8cbb\u770b\u8a3a",
};

function n(v: unknown): number {
  return Number(String(v ?? "").replace(/[^\d.-]/g, "")) || 0;
}

function nowRocStamp(): { dateRoc: string; time: string } {
  const d = new Date();
  const y = d.getFullYear() - 1911;
  const dateRoc = `民國${y}年${String(d.getMonth() + 1).padStart(2, "0")}月${String(d.getDate()).padStart(2, "0")}日`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  return { dateRoc, time };
}

/** 影子庫 queueMeta → 掛號簿紙張資料（現金帳-總表排版）。 */
export type CashReturnRow = { date: string; amount: number; copayCode?: string };

export function buildRegisterBookReport(opts: {
  rows: ApiQueueEntry[];
  clinicName: string;
  dateFromRoc: string;
  dateToRoc: string;
  doctor?: string;
  dept?: string;
  caseFilter?: string;
  cashReturns?: CashReturnRow[];
}): RegisterBookReport {
  const byDay = new Map<string, RegisterBookDayRow>();
  const caseMap = new Map<string, RegisterBookCaseBucket>();

  for (const e of opts.rows) {
    const q = e.queueMeta || {};
    const iso = String(q.encounterDate || "").slice(0, 10);
    if (!iso) continue;
    const dateRoc = isoToRoc(iso) || iso;
    let day = byDay.get(iso);
    if (!day) {
      day = {
        dateRoc,
        dateIso: iso,
        people: 0,
        deposit: 0,
        copayAmt: 0,
        cardDisc: 0,
        drugDisc: 0,
        regFee: 0,
        selfPay: 0,
        received: 0,
        arrears: 0,
        misc: 0,
        repay: 0,
        returnSlip: 0,
        total: 0,
      };
      byDay.set(iso, day);
    }
    day.people += 1;
    day.deposit += n(q.deposit);
    day.copayAmt += n(q.copayAmt);
    day.regFee += n(q.regFee);
    day.cardDisc += n(q.cardDisc);
    day.drugDisc += n(q.drugDisc);
    day.arrears += n(q.arrears);
    // REGISTER.SELF_PRICE＝自費額；RECEIPTS＝已收（已含自費，不再加一次）
    const selfPay = n(q.selfPay);
    day.selfPay += selfPay;
    const received = n(q.totalFee);
    day.received += received;

    const caseCode = identityBucket(String(q.copayCode || ""), String(q.caseNo || ""));
    let bucket = caseMap.get(caseCode);
    if (!bucket) {
      bucket = {
        code: caseCode,
        label: COPAY_LABEL[caseCode] || caseCode,
        firstVisit: 0,
        revisit: 0,
        missingCard: 0,
        returnCard: 0,
        repay: 0,
      };
      caseMap.set(caseCode, bucket);
    }
    if (isCashFirstVisit(q)) bucket.firstVisit += 1;
    else bucket.revisit += 1;
    if (isDepositHeld(q)) bucket.missingCard += 1;
  }

  for (const ret of opts.cashReturns || []) {
    const iso = String(ret.date || "").slice(0, 10);
    if (!iso) continue;
    const dateRoc = isoToRoc(iso) || iso;
    let day = byDay.get(iso);
    if (!day) {
      day = {
        dateRoc,
        dateIso: iso,
        people: 0,
        deposit: 0,
        copayAmt: 0,
        cardDisc: 0,
        drugDisc: 0,
        regFee: 0,
        selfPay: 0,
        received: 0,
        arrears: 0,
        misc: 0,
        repay: 0,
        returnSlip: 0,
        total: 0,
      };
      byDay.set(iso, day);
    }
    day.returnSlip += n(ret.amount);
    const code = identityBucket(String(ret.copayCode || ""), "");
    let bucket = caseMap.get(code);
    if (!bucket) {
      bucket = {
        code,
        label: COPAY_LABEL[code] || code,
        firstVisit: 0,
        revisit: 0,
        missingCard: 0,
        returnCard: 0,
        repay: 0,
      };
      caseMap.set(code, bucket);
    }
    bucket.returnCard += 1;
  }
  for (const day of byDay.values()) {
    day.total = day.received - day.returnSlip + day.arrears;
  }

  const days = [...byDay.values()].sort((a, b) => a.dateIso.localeCompare(b.dateIso));
  const totals = {
    people: 0,
    deposit: 0,
    copayAmt: 0,
    cardDisc: 0,
    drugDisc: 0,
    regFee: 0,
    selfPay: 0,
    received: 0,
    arrears: 0,
    misc: 0,
    repay: 0,
    returnSlip: 0,
    total: 0,
  };
  for (const d of days) {
    totals.people += d.people;
    totals.deposit += d.deposit;
    totals.copayAmt += d.copayAmt;
    totals.cardDisc += d.cardDisc;
    totals.drugDisc += d.drugDisc;
    totals.regFee += d.regFee;
    totals.selfPay += d.selfPay;
    totals.received += d.received;
    totals.arrears += d.arrears;
    totals.misc += d.misc;
    totals.repay += d.repay;
    totals.returnSlip += d.returnSlip;
    totals.total += d.total;
  }

  const stamp = nowRocStamp();
  return {
    clinicName: opts.clinicName || "",
    dateFromRoc: opts.dateFromRoc,
    dateToRoc: opts.dateToRoc,
    doctor: opts.doctor || "全部",
    dept: opts.dept || "全部",
    caseFilter: opts.caseFilter || "全部",
    printedAtRoc: stamp.dateRoc,
    printedTime: stamp.time,
    reportNo: "現金帳-總表",
    days,
    totals,
    cashReceivable: totals.total,
    visitCount: totals.people,
    caseBuckets: [...caseMap.values()].sort(byIdentityCode),
  };
}

export type CashBookSummaryDay = {
  date: string;
  people: number;
  deposit: number;
  copayAmt: number;
  cardDisc: number;
  drugDisc: number;
  regFee: number;
  selfPay: number;
  received: number;
  arrears: number;
  returnSlip: number;
  total: number;
};

export type CashBookSummaryBucket = {
  code: string;
  firstVisit: number;
  revisit: number;
  missingCard: number;
  returnCard: number;
};

/** 總計 API 已在資料庫加好，這裡只排成掛號簿紙張。 */
export function buildRegisterBookFromSummary(opts: {
  days: CashBookSummaryDay[];
  buckets: CashBookSummaryBucket[];
  clinicName: string;
  dateFromRoc: string;
  dateToRoc: string;
  doctor?: string;
  dept?: string;
  caseFilter?: string;
}): RegisterBookReport {
  const days: RegisterBookDayRow[] = opts.days.map((d) => {
    const iso = String(d.date || "").slice(0, 10);
    return {
      dateRoc: isoToRoc(iso) || iso,
      dateIso: iso,
      people: d.people || 0,
      deposit: d.deposit || 0,
      copayAmt: d.copayAmt || 0,
      cardDisc: d.cardDisc || 0,
      drugDisc: d.drugDisc || 0,
      regFee: d.regFee || 0,
      selfPay: d.selfPay || 0,
      received: d.received || 0,
      arrears: d.arrears || 0,
      misc: 0,
      repay: 0,
      returnSlip: d.returnSlip || 0,
      total: d.total || 0,
    };
  });
  const totals = {
    people: 0,
    deposit: 0,
    copayAmt: 0,
    cardDisc: 0,
    drugDisc: 0,
    regFee: 0,
    selfPay: 0,
    received: 0,
    arrears: 0,
    misc: 0,
    repay: 0,
    returnSlip: 0,
    total: 0,
  };
  for (const d of days) {
    totals.people += d.people;
    totals.deposit += d.deposit;
    totals.copayAmt += d.copayAmt;
    totals.cardDisc += d.cardDisc;
    totals.drugDisc += d.drugDisc;
    totals.regFee += d.regFee;
    totals.selfPay += d.selfPay;
    totals.received += d.received;
    totals.arrears += d.arrears;
    totals.returnSlip += d.returnSlip;
    totals.total += d.total;
  }
  const stamp = nowRocStamp();
  return {
    clinicName: opts.clinicName || "",
    dateFromRoc: opts.dateFromRoc,
    dateToRoc: opts.dateToRoc,
    doctor: opts.doctor || "全部",
    dept: opts.dept || "全部",
    caseFilter: opts.caseFilter || "全部",
    printedAtRoc: stamp.dateRoc,
    printedTime: stamp.time,
    reportNo: "現金帳-總表",
    days,
    totals,
    cashReceivable: totals.total,
    visitCount: totals.people,
    caseBuckets: opts.buckets
      .map((b) => ({
        code: b.code,
        label: COPAY_LABEL[b.code] || b.code,
        firstVisit: b.firstVisit || 0,
        revisit: b.revisit || 0,
        missingCard: b.missingCard || 0,
        returnCard: b.returnCard || 0,
        repay: 0,
      }))
      .sort(byIdentityCode),
  };
}

export function registerBookToExportText(r: RegisterBookReport): string {
  const hdr = [
    `<< 掛號簿 >> ${r.clinicName}`,
    `期間: ${r.dateFromRoc}~${r.dateToRoc}    醫師: ${r.doctor}    科別: ${r.dept}    案件: ${r.caseFilter}`,
    `列印: ${r.printedAtRoc} Time: ${r.printedTime} (報表編號: ${r.reportNo})`,
    "",
    ["日期", "人數", "押金", "部額", "卡優", "藥優", "掛費", "自費", "已收", "欠款", "雜費", "還款", "還單", "合計"].join("\t"),
  ];
  const rows = r.days.map((d) =>
    [
      d.dateRoc,
      d.people,
      d.deposit,
      d.copayAmt,
      d.cardDisc,
      d.drugDisc,
      d.regFee,
      d.selfPay,
      d.received,
      d.arrears,
      d.misc,
      d.repay,
      d.returnSlip,
      d.total,
    ].join("\t"),
  );
  const tot = r.totals;
  rows.push(
    [
      "",
      tot.people,
      tot.deposit,
      tot.copayAmt,
      tot.cardDisc,
      tot.drugDisc,
      tot.regFee,
      tot.selfPay,
      tot.received,
      tot.arrears,
      tot.misc,
      tot.repay,
      tot.returnSlip,
      tot.total,
    ].join("\t"),
  );
  const foot = [
    "",
    `應收現金 : ${tot.total.toLocaleString("zh-TW")} 元          總掛號人次 : ${tot.people} 次`,
    ...r.caseBuckets.map(
      (b) =>
        `${b.code} ${b.label}： 初診 ${b.firstVisit} 人次、複診 ${b.revisit} 人次、欠卡 ${b.missingCard} 人次、還卡 ${b.returnCard} 人次、還款 ${b.repay} 人次`,
    ),
  ];
  return [...hdr, ...rows, ...foot].join("\n");
}

/** 現金帳明細一列：一人一筆，或一筆還單。 */
export type CashDetailRow = {
  key: string;
  dateIso: string;
  dateMd: string;
  name: string;
  chart: string;
  seg: string;
  seqText: string;
  cardNo: string;
  idNo: string;
  deposit: number;
  caseNo: string;
  copayCode: string;
  copayAmt: number;
  drugDisc: number;
  regFee: number;
  selfPay: number;
  cardDisc: number;
  doctor: string;
  received: number;
  arrears: number;
  misc: number;
  repay: number;
  returnSlip: number;
  returnLine: boolean;
};

export type CashReturnLine = {
  date: string;
  amount: number;
  copayCode?: string;
  chart?: string;
  patientName?: string;
  idNo?: string;
  seg?: string;
  treatSeq?: string;
  caseNo?: string;
};

export type CashDetailReport = {
  clinicName: string;
  dateFromRoc: string;
  dateToRoc: string;
  shiftLabel: string;
  doctor: string;
  dept: string;
  caseFilter: string;
  printedAtRoc: string;
  printedTime: string;
  reportNo: string;
  rows: CashDetailRow[];
  totals: {
    deposit: number;
    copayAmt: number;
    drugDisc: number;
    regFee: number;
    selfPay: number;
    cardDisc: number;
    received: number;
    arrears: number;
    misc: number;
    repay: number;
    returnSlip: number;
  };
  cashReceivable: number;
  headCount: number;
  visitCount: number;
  caseBuckets: RegisterBookCaseBucket[];
};

function monthDay(iso: string): string {
  const p = String(iso || "").slice(0, 10).split("-");
  if (p.length < 3 || !p[1] || !p[2]) return iso;
  return `${p[1]}.${p[2]}`;
}

function shiftSeg(shift: string | undefined): string {
  const s = String(shift || "");
  if (s.includes("下") || s === "2") return "2";
  if (s.includes("晚") || s === "3") return "3";
  if (s.includes("上") || s === "1") return "1";
  return "";
}

function byIdentityCode(a: { code: string }, b: { code: string }): number {
  const rank = (code: string) => (code === "\u81ea\u8cbb" ? "\uffff" : code);
  return rank(a.code).localeCompare(rank(b.code));
}

function emptyBucket(code: string): RegisterBookCaseBucket {
  return {
    code,
    label: COPAY_LABEL[code] || code,
    firstVisit: 0,
    revisit: 0,
    missingCard: 0,
    returnCard: 0,
    repay: 0,
  };
}

/** 掛號簿身分。案件自費，或部代空白，都算自費看診。沒有部代 0 這一列。 */
function identityBucket(copayRaw: string, caseRaw: string): string {
  const copay = copayRaw.trim();
  const caseNo = caseRaw.trim();
  if (caseNo === "\u81ea" || caseNo === "\u81ea\u8cbb") return "\u81ea\u8cbb";
  if (!copay || copay === "0") return "\u81ea\u8cbb";
  return copay;
}

/** First visit is the 4th character of the 6-byte register CC. That character is $. */
function isCashFirstVisit(q: { regCc?: string }): boolean {
  return String(q.regCc || "").charAt(3) === "$";
}

/** Owe-card is a deposit still on the visit, or a remark of exactly 押. */
function isDepositHeld(q: { deposit?: unknown; regRemark?: string }): boolean {
  if (n(q.deposit) > 0) return true;
  return String(q.regRemark || "") === "\u62bc";
}

/** 現金帳-明細：每人一列，還單附在當天掛號後面。 */
export function buildCashDetailReport(opts: {
  rows: ApiQueueEntry[];
  cashReturns?: CashReturnLine[];
  clinicName: string;
  dateFromRoc: string;
  dateToRoc: string;
  shiftLabel?: string;
  shiftKey?: string;
  doctor?: string;
  dept?: string;
  caseFilter?: string;
  medicalNo?: string;
}): CashDetailReport {
  const caseMap = new Map<string, RegisterBookCaseBucket>();
  const wantSeg = opts.shiftKey ? shiftSeg(opts.shiftKey) : "";
  const chartQ = (opts.medicalNo || "").trim();
  const visitsByDay = new Map<string, CashDetailRow[]>();

  const touch = (code: string) => {
    let bucket = caseMap.get(code);
    if (!bucket) {
      bucket = emptyBucket(code);
      caseMap.set(code, bucket);
    }
    return bucket;
  };

  opts.rows.forEach((e, i) => {
    const q = e.queueMeta || {};
    const iso = String(q.encounterDate || "").slice(0, 10);
    if (!iso) return;
    const code = identityBucket(String(q.copayCode || ""), String(q.caseNo || ""));
    const bucket = touch(code);
    if (isCashFirstVisit(q)) bucket.firstVisit += 1;
    else bucket.revisit += 1;
    if (isDepositHeld(q)) bucket.missingCard += 1;
    const row: CashDetailRow = {
      key: `v-${e.resource?.id || i}`,
      dateIso: iso,
      dateMd: monthDay(iso),
      name: String(q.patientDisplay || q.patientName || ""),
      chart: String(q.medicalNo || ""),
      seg: shiftSeg(q.shift),
      seqText: String(q.queueNumber ?? ""),
      cardNo: String(q.treatSeq || ""),
      idNo: String(q.idNo || q.id || ""),
      deposit: n(q.deposit),
      caseNo: String(q.caseNo || ""),
      copayCode: String(q.copayCode || ""),
      copayAmt: n(q.copayAmt),
      drugDisc: n(q.drugDisc),
      regFee: n(q.regFee),
      selfPay: n(q.selfPay),
      cardDisc: n(q.cardDisc),
      doctor: String(q.doctorName || ""),
      received: n(q.totalFee),
      arrears: n(q.arrears),
      misc: 0,
      repay: 0,
      returnSlip: 0,
      returnLine: false,
    };
    const list = visitsByDay.get(iso) || [];
    list.push(row);
    visitsByDay.set(iso, list);
  });

  const returnsByDay = new Map<string, CashDetailRow[]>();
  (opts.cashReturns || []).forEach((ret, i) => {
    const iso = String(ret.date || "").slice(0, 10);
    if (!iso) return;
    const seg = String(ret.seg || "");
    if (wantSeg && seg && seg !== wantSeg) return;
    const chart = String(ret.chart || "");
    if (chartQ && !chart.includes(chartQ)) return;
    const code = identityBucket(String(ret.copayCode || ""), String(ret.caseNo || ""));
    touch(code).returnCard += 1;
    const row: CashDetailRow = {
      key: `r-${iso}-${i}`,
      dateIso: iso,
      dateMd: monthDay(iso),
      name: String(ret.patientName || ""),
      chart,
      seg,
      seqText: "還單",
      cardNo: String(ret.treatSeq || ""),
      idNo: String(ret.idNo || ""),
      deposit: 0,
      caseNo: String(ret.caseNo || ""),
      copayCode: String(ret.copayCode || ""),
      copayAmt: 0,
      drugDisc: 0,
      regFee: 0,
      selfPay: 0,
      cardDisc: 0,
      doctor: "",
      received: 0,
      arrears: 0,
      misc: 0,
      repay: 0,
      returnSlip: n(ret.amount),
      returnLine: true,
    };
    const list = returnsByDay.get(iso) || [];
    list.push(row);
    returnsByDay.set(iso, list);
  });

  const dates = [...new Set([...visitsByDay.keys(), ...returnsByDay.keys()])].sort();
  const rows: CashDetailRow[] = [];
  for (const iso of dates) {
    const visits = visitsByDay.get(iso) || [];
    visits.sort((a, b) => {
      const sa = a.seg === "1" ? 1 : a.seg === "2" ? 2 : a.seg === "3" ? 3 : 9;
      const sb = b.seg === "1" ? 1 : b.seg === "2" ? 2 : b.seg === "3" ? 3 : 9;
      if (sa !== sb) return sa - sb;
      return (Number(a.seqText) || 0) - (Number(b.seqText) || 0);
    });
    rows.push(...visits, ...(returnsByDay.get(iso) || []));
  }

  const totals = {
    deposit: 0,
    copayAmt: 0,
    drugDisc: 0,
    regFee: 0,
    selfPay: 0,
    cardDisc: 0,
    received: 0,
    arrears: 0,
    misc: 0,
    repay: 0,
    returnSlip: 0,
  };
  let visitCount = 0;
  for (const row of rows) {
    if (!row.returnLine) visitCount += 1;
    totals.deposit += row.deposit;
    totals.copayAmt += row.copayAmt;
    totals.drugDisc += row.drugDisc;
    totals.regFee += row.regFee;
    totals.selfPay += row.selfPay;
    totals.cardDisc += row.cardDisc;
    totals.received += row.received;
    totals.arrears += row.arrears;
    totals.misc += row.misc;
    totals.repay += row.repay;
    totals.returnSlip += row.returnSlip;
  }
  const stamp = nowRocStamp();
  const shiftLabel = opts.shiftLabel && opts.shiftLabel !== "全部" ? opts.shiftLabel : "4.ALL";
  return {
    clinicName: opts.clinicName || "",
    dateFromRoc: opts.dateFromRoc,
    dateToRoc: opts.dateToRoc,
    shiftLabel,
    doctor: opts.doctor || "全部",
    dept: opts.dept || "全部",
    caseFilter: opts.caseFilter || "全部",
    printedAtRoc: stamp.dateRoc,
    printedTime: stamp.time,
    reportNo: "現金帳-明細",
    rows,
    totals,
    cashReceivable: totals.received - totals.returnSlip + totals.arrears,
    headCount: rows.length,
    visitCount,
    caseBuckets: [...caseMap.values()].sort(byIdentityCode),
  };
}

function dispWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += (ch.codePointAt(0) || 0) > 255 ? 2 : 1;
  return w;
}

function fitCell(text: string, width: number, align: "L" | "R"): string {
  let s = text;
  while (dispWidth(s) > width && s.length) s = align === "R" ? s.slice(1) : s.slice(0, -1);
  const pad = " ".repeat(Math.max(0, width - dispWidth(s)));
  return align === "R" ? pad + s : s + pad;
}

function moneyCell(value: number, width: number): string {
  const shown = value ? value.toLocaleString("en-US") : value === 0 ? "0" : "";
  return fitCell(shown, width, "R");
}

const DETAIL_WIDTHS = [3, 5, 10, 6, 2, 4, 4, 10, 6, 2, 4, 8, 8, 9, 6, 8, 6, 8, 9, 4, 12, 12, 11, 12, 11, 12];
const DETAIL_ALIGN: Array<"L" | "R"> = [
  "R", "L", "L", "L", "L", "R", "L", "L", "R", "L", "L", "R", "R", "R", "R", "R", "R", "R", "R", "L", "R", "R", "L", "L", "L", "L",
];

function detailLine(cells: string[]): string {
  return cells.map((cell, i) => fitCell(cell, DETAIL_WIDTHS[i], DETAIL_ALIGN[i])).join(" ");
}

export function cashDetailToExportText(r: CashDetailReport): string {
  const titles = [
    "No.", "\u65e5\u671f", "\u59d3\u540d", "\u75c5\u6b77\u865f", "\u6bb5", "\u5e8f\u865f", "\u5361\u865f", "\u8eab\u5206\u8b49",
    "\u62bc\u91d1", "\u6848", "\u90e8\u4ee3", "\u90e8\u984d", "\u639b\u8cbb", "\u5df2\u6536", "\u6b20\u6b3e", "\u96dc\u8cbb",
    "\u9084\u6b3e", "\u9084\u55ae", "\u81ea\u8cbb", "\u91ab\u5e2b",
    "\u6536\u8cbb\u91d1\u984d(\u4e09)", "\u6536\u8cbb\u91d1\u984d(\u56db)",
    "\u6536\u8cbb\u4eba\u54e1(\u4e09)", "\u6536\u8cbb\u4eba\u54e1(\u56db)",
    "\u6536\u8cbb\u65b9\u5f0f(\u4e09)", "\u6536\u8cbb\u65b9\u5f0f(\u56db)",
  ];
  const bar = DETAIL_WIDTHS.map((w) => "=".repeat(w)).join(" ");
  const body = r.rows.map((row, index) =>
    detailLine([
      String(index + 1),
      row.dateMd,
      row.name,
      row.chart,
      row.seg,
      row.seqText,
      row.cardNo,
      row.idNo,
      moneyCell(row.deposit, DETAIL_WIDTHS[8]),
      row.caseNo,
      row.copayCode,
      moneyCell(row.copayAmt, DETAIL_WIDTHS[11]),
      moneyCell(row.regFee, DETAIL_WIDTHS[12]),
      moneyCell(row.received, DETAIL_WIDTHS[13]),
      moneyCell(row.arrears, DETAIL_WIDTHS[14]),
      moneyCell(row.misc, DETAIL_WIDTHS[15]),
      moneyCell(row.repay, DETAIL_WIDTHS[16]),
      moneyCell(row.returnSlip, DETAIL_WIDTHS[17]),
      moneyCell(row.selfPay, DETAIL_WIDTHS[18]),
      row.doctor,
      "", "", "", "", "", "",
    ]),
  );
  const t = r.totals;
  body.push(
    detailLine([
      "", "", "", "", "", "", "", "",
      moneyCell(t.deposit, DETAIL_WIDTHS[8]),
      "", "",
      moneyCell(t.copayAmt, DETAIL_WIDTHS[11]),
      moneyCell(t.regFee, DETAIL_WIDTHS[12]),
      moneyCell(t.received, DETAIL_WIDTHS[13]),
      moneyCell(t.arrears, DETAIL_WIDTHS[14]),
      moneyCell(t.misc, DETAIL_WIDTHS[15]),
      moneyCell(t.repay, DETAIL_WIDTHS[16]),
      moneyCell(t.returnSlip, DETAIL_WIDTHS[17]),
      moneyCell(t.selfPay, DETAIL_WIDTHS[18]),
      "", "", "", "", "", "", "",
    ]),
  );
  return [
    `<< \u639b \u865f \u7c3f >> ${r.clinicName}`,
    detailLine(titles),
    bar,
    ...body,
    "",
  ].join("\n");
}

function csvCell(value: string | number): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function cashDetailToExportCsv(r: CashDetailReport): string {
  const header = [
    "\u65e5\u671f", "\u59d3\u540d", "\u75c5\u6b77\u865f", "\u6bb5", "\u5e8f\u865f", "\u6848\u4ef6", "\u5361\u865f", "\u62bc\u91d1",
    "\u90e8\u4ee3", "\u90e8\u984d", "\u5361\u512a", "\u85e5\u512a", "\u639b\u8cbb", "\u81ea\u8cbb", "\u5df2\u6536", "\u6b20\u6b3e",
    "\u96dc\u8cbb", "\u9084\u6b3e", "\u9084\u55ae", "\u91ab\u5e2b",
  ];
  const lines = r.rows.map((row) =>
    [
      row.dateMd, row.name, row.chart, row.seg, row.seqText, row.caseNo, row.cardNo, row.deposit,
      row.copayCode, row.copayAmt, row.cardDisc, row.drugDisc, row.regFee, row.selfPay, row.received,
      row.arrears, row.misc, row.repay, row.returnSlip, row.doctor,
    ].map(csvCell).join(","),
  );
  return [header.join(","), ...lines].join("\n");
}
