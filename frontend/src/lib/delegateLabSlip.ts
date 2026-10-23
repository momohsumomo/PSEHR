import type { RxLine } from "@/mocks/clinicMocks";
import { openPrintPreview } from "@/lib/printJob";
import { findPrintSetup, loadPrintSettings } from "@/lib/printSettings";

/** Pay marks that belong on the delegated-lab sheet. Same pair Yisheng prints. */
const LAB_MARKS = new Set(["\u4ea4", "\u8f49"]);

export type LabSlipLine = {
  mark: string;
  code: string;
  name: string;
  total: string;
};

export type LabSlipInput = {
  caseNo: string;
  clinicName: string;
  clinicCode: string;
  address: string;
  phone: string;
  name: string;
  idNo: string;
  sex: string;
  birthday: string;
  medicalNo: string;
  copayCode: string;
  dept: string;
  visitDate: string;
  cardNo: string;
  queueNo: string;
  doctorId: string;
  diagnoses: { code: string; text: string }[];
  giveDays: number;
  lines: LabSlipLine[];
};

export function labSlipLines(rows: RxLine[]): LabSlipLine[] {
  const out: LabSlipLine[] = [];
  for (const row of rows) {
    const mark = String(row.payMark || "").trim();
    if (!LAB_MARKS.has(mark)) continue;
    const code = String(row.nhiCode || "").trim();
    const name = String(row.name || "").trim();
    if (!code && !name) continue;
    const total = row.totalAmount || (row.qty != null && row.qty !== 0 ? String(row.qty) : "1");
    const shown = String(total).replace(/[^\d.]/g, "") || "1";
    out.push({ mark, code, name, total: shown });
  }
  return out;
}

export function giveDaysBesideLabs(rows: RxLine[]): number {
  const days = rows
    .filter((row) => !LAB_MARKS.has(String(row.payMark || "").trim()))
    .map((row) => Number(row.days) || 0)
    .filter((n) => n > 0);
  return days.length ? Math.max(...days) : 0;
}

function esc(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function show(value: string): string {
  const text = String(value || "").trim();
  return text || "\u2014";
}

/** 47.12.06 from an ISO date or a 7-digit ROC date. */
export function rocDots(value: string): string {
  const text = String(value || "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const year = Number(iso[1]) - 1911;
    return `${year}.${iso[2]}.${iso[3]}`;
  }
  const digits = text.replace(/\D/g, "");
  if (digits.length === 7) {
    return `${Number(digits.slice(0, 3))}.${digits.slice(3, 5)}.${digits.slice(5, 7)}`;
  }
  return text;
}

function itemLabel(row: LabSlipLine): string {
  const code = row.code || "";
  const name = row.name || "";
  if (code && name) return `${row.mark}(${code}^${name})${code}`;
  return `${row.mark}(${code || name})`;
}

/** Landscape sheet matching the clinic exam slip, page 2. */
export function buildDelegateLabHtml(input: LabSlipInput): string {
  const names = input.diagnoses.map((row) => String(row.text || "").trim()).filter(Boolean);
  const codes = input.diagnoses.map((row) => String(row.code || "").trim()).filter(Boolean);
  const days = input.giveDays > 0 ? String(input.giveDays).padStart(2, "0") : "";
  const body =
    input.lines
      .map(
        (row, index) => `<tr>
          <td style="width:2.2em;text-align:right;padding-right:0.4em;">${index + 1}</td>
          <td>${esc(itemLabel(row))}</td>
          <td style="width:4em;text-align:right;">${esc(row.total)}</td>
          <td style="width:3em;"></td>
        </tr>`,
      )
      .join("") || `<tr><td></td><td>\u2014</td><td></td><td></td></tr>`;
  return `<div class="slip-page" style="display:flex;flex-direction:row;background:#fff;color:#000;">
    <div style="width:50%;box-sizing:border-box;padding:6mm 5mm;font-size:13px;line-height:1.45;">
    <div style="text-align:center;font-weight:bold;font-size:18px;">\u5168\u6c11\u5065\u5eb7\u4fdd\u96aa\u9580\u8a3a\u4ea4\u4ed8\u6aa2\u9a57(\u67e5)\u8655\u65b9\u7b8b(\u6848\u4ef6:${esc(show(input.caseNo))})</div>
    <div>${esc(show(input.clinicName))} &lt;${esc(show(input.clinicCode))}&gt;\u9662\u6240\u5730\u5740:${esc(show(input.address))}</div>
    <div>\u59d3\u540d:${esc(show(input.name))} \u8eab\u5206\u8b49:${esc(show(input.idNo))}/${esc(show(input.sex))}  \u751f\u65e5:${esc(show(rocDots(input.birthday)))}  \u75c5\u6b77\u865f:${esc(show(input.medicalNo))}</div>
    <div>\u90e8\u865f:(${esc(show(input.copayCode))})\u79d1\u5225:${esc(show(input.dept))} \u5c31\u8a3a\u65e5:${esc(show(rocDots(input.visitDate)))} \u5361:${esc(show(input.cardNo))}\u770b\u8a3a\u865f:(${esc(show(input.queueNo))})</div>
    <div>\u50b7\u75c5\u540d\u7a31:${esc(names.join("\u3001") || "\u2014")}</div>
    <div>\u75be\u75c5\u4ee3\u865f:${esc(codes.join(",") || "\u2014")}${days ? `    (\u7d66\u85e5${esc(days)}\u5929)` : ""}</div>
    <table style="width:100%;border-collapse:collapse;margin-top:1mm;">
      <tr>
        <td style="width:2.2em;border-bottom:1px solid #000;">\u9805</td>
        <td style="border-bottom:1px solid #000;">\u6aa2\u9a57\u9805\u76ee</td>
        <td style="width:4em;text-align:right;border-bottom:1px solid #000;">\u7e3d\u91cf</td>
        <td style="width:3em;border-bottom:1px solid #000;">\u8a3b</td>
      </tr>
      ${body}
    </table>
    <div style="margin-top:6mm;display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:4mm;">
      <div>\u91ab\u5e2b\u4ee3\u865f:${esc(show(input.doctorId))}</div>
      <div>\u8655\u65b9\u9662\u6240\u6838\u7ae0</div>
      <div>\u6aa2\u9a57\u6a5f\u69cb\u6838\u7ae0</div>
      <div>\u7c3d\u3000\u3000\u7ae0:</div>
      <div>\u7c3d\u3000\u3000\u7ae0:</div>
      <div></div>
      <div>\u96fb\u3000\u3000\u8a71:${esc(show(input.phone))}</div>
      <div>\u96fb\u3000\u3000\u8a71:</div>
      <div></div>
    </div>
    </div>
    <div style="width:50%"></div>
  </div>`;
}

export async function openDelegateLabSlip(input: LabSlipInput): Promise<void> {
  if (!input.lines.length) return;
  findPrintSetup(loadPrintSettings(), "labSlip");
  await openPrintPreview({
    kind: "rx",
    layout: "paged",
    setupId: "labSlip",
    title: "\u5168\u6c11\u5065\u5eb7\u4fdd\u96aa\u9580\u8a3a\u4ea4\u4ed8\u6aa2\u9a57(\u67e5)\u8655\u65b9\u7b8b",
    lines: [],
    bodyHtml: buildDelegateLabHtml(input),
  });
}
