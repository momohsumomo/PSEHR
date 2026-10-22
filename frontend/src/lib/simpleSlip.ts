import type { DiagnosisRow, RxLine } from "@/mocks/clinicMocks";
import { ceilCashTen, rawSelfPay } from "@/lib/selfPayMoney";

export type SimpleSlipInput = {
  medicalNo: string;
  name: string;
  sex: string;
  idNo: string;
  birthday: string;
  age: string;
  visitDate: string;
  dept: string;
  caseNo: string;
  cardNo: string;
  doctor: string;
  pharmacist: string;
  chief: string;
  diagnoses: DiagnosisRow[];
  drugs: RxLine[];
  room: string;
  queueNo: string;
  deposit: string;
  regFee: string;
  burden: string;
  selfPay: string;
  clinicName: string;
  address: string;
  clinicCode: string;
  phone: string;
  dispenseDate: string;
  pharmacy: string;
  consultFee: string;
  drugFee: string;
  materialFee: string;
  footer: string;
  fontSizePx?: number;
  showChief?: boolean;
  showDiagnoses?: boolean;
  showMarks?: boolean;
  showLeftMoney?: boolean;
  /** 應收那一行。空白時收據仍印，取消勾選才不印。 */
  showDue?: boolean;
  showFeeTable?: boolean;
  showWarning?: boolean;
  /** 藥名表格的字級。沒填就跟處方字級一樣。 */
  drugFontSizePx?: number;
  /** Preview-only: bits to omit, such as chief, dx, warning, doctor. */
  hideBits?: string[];
  /** Preview-only: bits to outline while that setting is being changed. */
  focusBits?: string[];
  receiptTitle?: string;
};

/** Last page also holds the fee block. Earlier pages are drug lines only. */
const LAST_ROWS = 6;
const CONT_ROWS = 11;

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function show(v: string | number | undefined | null): string {
  const s = String(v ?? "").trim();
  if (!s || s === "\u2014" || s === "-") return "\u2014";
  return s;
}

function asNumber(v: string | number | undefined | null): number | null {
  const raw = String(v ?? "").trim();
  if (!raw || raw === "\u2014" || raw === "-") return null;
  const n = Number(raw.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function payPrefix(row: RxLine): string {
  const mark = (row.payMark || (row.selfPay ? "\u81ea" : "")).trim();
  return mark;
}

function memoMark(row: RxLine): string {
  return (row.memo || "").trim();
}

function resolvedSelfPay(input: SimpleSlipInput): string {
  const stored = asNumber(input.selfPay);
  const base = stored != null && stored > 0 ? stored : rawSelfPay(input.drugs);
  const amount = ceilCashTen(base);
  if (amount <= 0) return "\u2014";
  return String(amount);
}

function payable(regFee: string, burden: string, deposit: string, selfPay: string): string {
  const parts = [regFee, burden, deposit, selfPay].map(asNumber);
  if (parts.every((n) => n == null)) return "\u2014";
  const sum = parts.reduce((s, n) => s + (n ?? 0), 0);
  return String(Math.round(sum));
}

function feeText(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s || s === "\u2014" || s === "-") return "";
  return s;
}

/** A saved self-pay amount. Zero and a blank draft do not count. */
export function storedSelfPayText(...values: unknown[]): string {
  for (const value of values) {
    const s = String(value ?? "").trim();
    if (!s || s === "\u2014" || s === "-") continue;
    const n = Number(s.replace(/[^\d.-]/g, ""));
    if (Number.isFinite(n) && n > 0) return String(Math.round(n));
  }
  return "";
}

/** Cash parts stored on the visit. Zero is a real amount. */
export function visitCashParts(
  entry: { regFee?: string; copayAmt?: string; burdenFee?: string; deposit?: string } | null | undefined,
): { regFee: string; burden: string; deposit: string } {
  return {
    regFee: feeText(entry?.regFee),
    burden: feeText(entry?.copayAmt) || feeText(entry?.burdenFee),
    deposit: feeText(entry?.deposit),
  };
}

function paginate<T>(rows: T[]): T[][] {
  if (rows.length === 0) return [[]];
  const pages: T[][] = [];
  let index = 0;
  while (index < rows.length) {
    const remain = rows.length - index;
    if (remain <= LAST_ROWS) {
      pages.push(rows.slice(index));
      break;
    }
    if (remain <= CONT_ROWS + LAST_ROWS) {
      const last = Math.min(LAST_ROWS, Math.ceil(remain / 2));
      const take = remain - last;
      pages.push(rows.slice(index, index + take));
      index += take;
      continue;
    }
    pages.push(rows.slice(index, index + CONT_ROWS));
    index += CONT_ROWS;
  }
  return pages;
}

function leftTable(rows: RxLine[], fontPx: number): string {
  const body =
    rows
      .map((row) => {
        const sig = show(row.sig) === "\u2014" ? "" : show(row.sig);
        const qty = row.qty == null ? "" : String(row.qty);
        const days = row.days ? String(row.days) : "";
        const total = show(row.totalAmount) === "\u2014" ? "" : show(row.totalAmount);
        const site = (row.bodySite || "").trim();
        const clip = "display:block;overflow:hidden;white-space:nowrap;";
        const cell = "overflow:hidden;vertical-align:top;";
        return `<tr>
          <td style="${cell}width:4%;">${esc(payPrefix(row))}</td>
          <td style="${cell}width:46%;"><div style="${clip}">${esc(show(row.name))}</div></td>
          <td style="${cell}width:3%;">${esc(memoMark(row))}</td>
          <td style="${cell}width:7%;text-align:right;">${esc(qty)}</td>
          <td style="${cell}width:11%;"><div style="${clip}">${esc(sig)}</div></td>
          <td style="${cell}width:6%;text-align:right;">${esc(days)}</td>
          <td style="${cell}width:9%;text-align:right;">${esc(total)}</td>
          <td style="${cell}width:14%;"><div style="${clip}">${esc(site)}</div></td>
        </tr>`;
      })
      .join("") || `<tr><td colspan="8">\u2014</td></tr>`;
  return `<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:${fontPx}px;line-height:1.15;">${body}</table>`;
}

function rightTable(rows: RxLine[], fontPx: number): string {
  const body =
    rows
      .map((row) => {
        const qty = esc(row.qty == null ? "\u2014" : String(row.qty));
        const total = esc(show(row.totalAmount));
        const use = esc(
          [show(row.sig), row.days ? row.days + "\u5929" : "", (row.bodySite || "").trim()]
            .filter((x) => x && x !== "\u2014")
            .join(" "),
        );
        const clip = "display:block;overflow:hidden;white-space:nowrap;max-height:1.15em;";
        const cell = "overflow:hidden;vertical-align:top;height:1.15em;";
        return `<tr><td style="${cell}"><div style="${clip}">${esc(show(row.name))}</div></td><td style="${cell}width:2.6em;text-align:right;">${qty}</td><td style="${cell}width:3.4em;text-align:right;">${total}</td><td style="${cell}width:38%;"><div style="${clip}">${use || "\u2014"}</div></td></tr>`;
      })
      .join("") || `<tr><td colspan="4">\u2014</td></tr>`;
  return `<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:${fontPx}px;line-height:1.15;">
    <tr><td style="overflow:hidden;height:1.15em;white-space:nowrap;">\u85e5\u54c1\u540d\u7a31</td><td style="width:2.6em;text-align:right;overflow:hidden;height:1.15em;white-space:nowrap;">\u6578\u91cf</td><td style="width:3.4em;text-align:right;overflow:hidden;height:1.15em;white-space:nowrap;">\u7e3d\u91cf</td><td style="width:38%;overflow:hidden;height:1.15em;white-space:nowrap;">\u670d\u7528\u65b9\u6cd5</td></tr>
    ${body}
  </table>`;
}

function added(values: string[]): string {
  const nums = values.map(asNumber).filter((n): n is number => n != null);
  if (!nums.length) return "\u2014";
  return String(Math.round(nums.reduce((sum, n) => sum + n, 0)));
}

function feeTable(input: SimpleSlipInput, due: string, selfText: string, fontPx: number): string {
  const cell = `width:25%;padding:0 1px;vertical-align:top;font-size:${fontPx}px;line-height:1.15;`;
  const items: Array<[string, string]> = [
    ["\u57fa\u672c\u8ca0\u64d4", show(input.burden)],
    ["\u85e5\u8cbb\u8ca0\u64d4", "\u2014"],
    ["\u6aa2\u9a57\u8ca0\u64d4", "\u2014"],
    ["\u8a3a\u5bdf\u8cbb\u7528", show(input.consultFee)],
    ["\u85e5\u54c1\u8cbb\u7528", show(input.drugFee)],
    ["\u8a3a\u7642\u8cbb\u7528", "\u2014"],
    ["\u6aa2\u9a57\u8cbb\u7528", show(input.materialFee)],
    ["\u85e5\u4e8b\u8cbb\u7528", "\u2014"],
    ["\u5408\u8a08", added([input.regFee, input.burden, input.deposit, selfText])],
    ["\u8ca0\u64d4\u5408\u8a08", show(input.burden)],
    ["\u7533\u8acb\u8cbb\u7528", "\u2014"],
    ["\u639b\u865f\u8cbb\u7528", show(input.regFee)],
    ["\u62bc\u91d1\u8cbb\u7528", show(input.deposit)],
    ["\u81ea\u8cbb", show(selfText)],
    ["\u8ca0\u64d4\u512a\u5f85", "\u2014"],
    ["\u5be6\u6536", show(due)],
  ];
  let html = "";
  for (let i = 0; i < items.length; i += 4) {
    html += `<tr>${items
      .slice(i, i + 4)
      .map(([label, value]) => `<td style="${cell}">${esc(label)}:${esc(value)}</td>`)
      .join("")}</tr>`;
  }
  return `<table style="width:100%;border-collapse:collapse;border-top:1px solid #222;">${html}</table>`;
}

function pageHtml(
  input: SimpleSlipInput,
  rows: RxLine[],
  pageIndex: number,
  last: boolean,
  due: string,
  selfText: string,
): string {
  const font = input.fontSizePx && input.fontSizePx > 0 ? input.fontSizePx : 9;
  const drugFont = input.drugFontSizePx && input.drugFontSizePx > 0 ? input.drugFontSizePx : font;
  const hide = (bit: string) => (input.hideBits || []).includes(bit);
  const glow = (bit: string) =>
    (input.focusBits || []).includes(bit) ? "outline:2px solid #E6A800;background:#FFF6CC;" : "";
  const showChief = input.showChief !== false && !hide("chief");
  const showDx = input.showDiagnoses !== false && !hide("dx");
  const showMarks = input.showMarks !== false && !hide("self");
  const showMoney = input.showLeftMoney !== false;
  const showDue = input.showDue !== false && !hide("due");
  const showFees = input.showFeeTable !== false && !hide("fees");
  const showWarn = input.showWarning !== false && !hide("warning");
  const view = (showMarks ? rows : rows.map((row) => ({ ...row, payMark: "" as const, memo: "", selfPay: false }))).map(
    (row) => (hide("site") ? { ...row, bodySite: "" } : row),
  );
  const col = "flex:1 1 0;min-width:0;min-height:0;display:flex;flex-direction:column;";
  const dx = showDx
    ? input.diagnoses
        .map((d) => esc(`${show(d.icd10 || d.nhiIcd10)}:${show(d.text)}`))
        .join("<br/>")
    : "";
  const chart = hide("chart") ? "" : `${esc(show(input.medicalNo))}:`;
  const idPart = hide("idno") ? "" : esc(show(input.idNo));
  const birth = hide("birthday") ? "" : `\u751f\u65e5${esc(show(input.birthday))}(${esc(show(input.age))})`;
  const who = `${chart}${esc(show(input.name))}`;
  const doctorBit = hide("doctor") ? "" : `\u91ab\u5e2b:${esc(show(input.doctor))}`;
  const pharmacistBit = hide("pharmacist") ? "" : `\u85e5\u5e2b:${esc(show(input.pharmacist))}`;
  const whoLine = [doctorBit, pharmacistBit].filter(Boolean).join("\u3000");
  const leftHead =
    pageIndex === 0
      ? `<div style="${glow("chart")}${glow("idno")}${glow("birthday")}">${who}(${esc(show(input.sex))})${idPart}${birth}</div>
      <div>&lt;${esc(show(input.visitDate))}&gt;\u79d1\u5225:${esc(show(input.dept))}\u6848\u4ef6:${esc(show(input.caseNo))}\u5361\u865f:${esc(show(input.cardNo))}</div>
      <div style="${glow("doctor")}${glow("pharmacist")}">${whoLine}</div>
      <div style="border:${showChief ? "1px solid #000" : "0"};min-height:12px;margin-top:1px;padding:1px;${glow("chief")}">${showChief ? esc(show(input.chief)) : ""}</div>
      <div style="${glow("dx")}">${showDx ? dx || "\u2014" : ""}</div>`
      : `<div>${who}\u3000${esc(show(input.visitDate))}\u3000\u7e8c${pageIndex + 1}</div>`;
  const depositBit = hide("deposit") ? "" : `\u62bc\u91d1:${esc(show(input.deposit))}\u3000`;
  const selfBit = hide("self") ? "" : `\u81ea\u8cbb:${esc(show(selfText))}`;
  const leftMoney = last && showMoney
    ? `<div style="flex:0 0 auto;${glow("due")}">
        <div>\u8a3a\u9593:${esc(show(input.room))}\u3000\u554f\u8a3a\u865f:${esc(show(input.queueNo))}\u3000\u85e5\u90e8:\u2014\u3000\u6aa2\u9a57\u90e8:\u2014</div>
        <div>${depositBit}\u639b\u865f\u8cbb:${esc(show(input.regFee))}\u3000\u90e8\u4efd\u8ca0\u64d4:${esc(show(input.burden))}\u3000${selfBit}</div>
        ${showDue ? `<div style="${glow("due")}">\u61c9\u6536:${esc(due)}</div>` : ""}
      </div>`
    : "";
  const title = esc((input.receiptTitle || "").trim() || "\u85e5\u55ae\u5167\u5bb9\u8207\u9580\u8a3a\u8cbb\u7528\u660e\u7d30");
  const addressBit = hide("address") ? "" : ` (${esc(show(input.address))})`;
  const phoneBit = hide("phone") ? "" : `\u3000\u96fb\u8a71:${esc(show(input.phone))}`;
  const rightId = hide("idno") ? "" : `\u3000\u8eab\u5206\u8b49:${esc(show(input.idNo))}`;
  const rightHead =
    pageIndex === 0
      ? `<div style="text-align:center;font-weight:bold;${glow("title")}">${title}</div>
      <div style="${glow("address")}">${esc(show(input.clinicName))}${addressBit}</div>
      <div>\u9662\u4ee3:${esc(show(input.clinicCode))}${phoneBit}</div>
      <div style="${glow("idno")}">\u59d3\u540d:${esc(show(input.name))}${rightId}</div>
      <div>\u5c31\u8a3a\u65e5\u671f:${esc(show(input.visitDate))}\u3000\u8abf\u5291\u65e5:${esc(show(input.dispenseDate))}</div>
      <div style="${glow("pharmacist")}">\u85e5\u5c40\u5730\u9ede:${esc(show(input.pharmacy))}${hide("pharmacist") ? "" : `\u3000\u8abf\u5291\u8005:${esc(show(input.pharmacist))}`}</div>`
      : `<div>${esc(show(input.name))}\u3000${esc(show(input.visitDate))}\u3000\u7e8c${pageIndex + 1}</div>`;
  const rightTail = last && (showWarn || showFees)
    ? `<div style="flex:0 0 auto;font-size:${font}px;line-height:1.2;">
        ${showWarn ? `<div style="${glow("warning")}">\uff0a\u8b66\u8a9e\u8207\u5efa\u8b70\u6a19\u793a\u9805\u76ee\uff0a</div><div>${esc(show(input.footer))}</div>` : ""}
        ${showFees ? `<div style="${glow("fees")}">${feeTable(input, due, selfText, font)}</div>` : ""}
      </div>`
    : "";
  return `<div class="slip-page" style="padding:1.5mm 2mm;box-sizing:border-box;display:flex;flex-direction:column;background:#fff;color:#000;">
    <div style="display:flex;flex:1;min-height:0;width:100%;align-items:stretch;font-size:${font}px;line-height:1.2;color:#111;">
      <section style="${col}border-right:1px solid #222;padding-right:1.5mm;">
        <div style="flex:0 0 auto;">${leftHead}</div>
        <div style="flex:1 1 auto;min-height:6mm;border-top:1px dashed #000;margin-top:2px;padding-top:1px;">${leftTable(view, drugFont)}</div>
        ${leftMoney}
      </section>
      <section style="${col}padding-left:1.5mm;font-size:${font}px;line-height:1.2;">
        <div style="flex:0 0 auto;">${rightHead}</div>
        <div style="flex:1 1 auto;min-height:6mm;border-top:1px solid #000;margin-top:1px;">${rightTable(view, drugFont)}</div>
        ${rightTail}
      </section>
    </div>
  </div>`;
}

/** Left order slip and right receipt. Extra drug lines continue on the next sheet. */
export function buildSimpleSlipHtml(input: SimpleSlipInput): string {
  const selfText = resolvedSelfPay(input);
  const due = payable(input.regFee, input.burden, input.deposit, selfText);
  const pages = paginate(input.drugs);
  return pages
    .map((rows, index) => pageHtml(input, rows, index, index === pages.length - 1, due, selfText))
    .join("");
}
