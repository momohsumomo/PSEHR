import { readLocalClinicBundle } from "@/lib/clinicProfile";
import { openPrintPreview } from "@/lib/printJob";
import { findPrintSetup, loadPrintSettings } from "@/lib/printSettings";

/** Visit cases that can release a prescription. This clinic leaves them all off. */
export const RELEASE_RX_CASES: { code: string; label: string }[] = [
  { code: "01", label: "\u897f\u91ab\u9580\u8a3a" },
  { code: "04", label: "\u897f\u91ab\u6162\u6027" },
  { code: "08", label: "\u6162\u7b8b" },
  { code: "09", label: "\u5176\u4ed6" },
  { code: "A3", label: "\u9810\u9632\u4fdd\u5065" },
  { code: "9X", label: "\u81ea\u8cbb" },
];

export type ReleaseRxDrug = {
  name: string;
  sig: string;
  days: number;
  qty: string;
  total: string;
};

export type ReleaseRxInput = {
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
  dept: string;
  visitDate: string;
  cardNo: string;
  queueNo: string;
  doctor: string;
  pharmacist: string;
  diagnoses: { code: string; text: string }[];
  drugs: ReleaseRxDrug[];
};

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

export function releaseRxWanted(caseNo: string): boolean {
  const code = String(caseNo || "").trim().toUpperCase();
  const selected = new Set(
    (readLocalClinicBundle().workflow.releaseRxCases || []).map((item) => String(item || "").trim().toUpperCase()),
  );
  if (!code || selected.size === 0) return false;
  if (selected.has(code)) return true;
  return (code === "\u81ea" || code === "9X") && (selected.has("9X") || selected.has("\u81ea"));
}

function giveDays(drugs: ReleaseRxDrug[]): string {
  const days = drugs.map((row) => Number(row.days) || 0).filter((n) => n > 0);
  if (!days.length) return "\u2014";
  return String(Math.max(...days));
}

function drugTable(rows: ReleaseRxDrug[]): string {
  const body =
    rows
      .map((row) => {
        const use = [row.sig, row.days ? `${row.days}\u5929` : ""].filter(Boolean).join(" ");
        return `<tr>
          <td style="word-break:break-all;">${esc(show(row.name))}</td>
          <td style="width:28%;">${esc(use || "\u2014")}</td>
          <td style="width:8em;text-align:right;">${esc(show(row.total || row.qty))}</td>
        </tr>`;
      })
      .join("") || `<tr><td colspan="3">\u2014</td></tr>`;
  return `<table style="width:100%;border-collapse:collapse;margin-top:1mm;">
    <tr>
      <td style="border-bottom:1px solid #000;">\u85e5\u54c1\u540d\u7a31\u898f\u683c</td>
      <td style="width:28%;border-bottom:1px solid #000;">\u7528\u91cf\u53ca\u7528\u6cd5</td>
      <td style="width:8em;text-align:right;border-bottom:1px solid #000;">\u7e3d\u91cf</td>
    </tr>
    ${body}
  </table>`;
}

function page(input: ReleaseRxInput, rows: ReleaseRxDrug[], pageIndex: number, last: boolean): string {
  const dx = input.diagnoses
    .map((row) => `${show(row.code)} ${show(row.text)}`.trim())
    .filter((line) => line && line !== "\u2014 \u2014");
  const codes = input.diagnoses.map((row) => String(row.code || "").trim()).filter(Boolean);
  const head =
    pageIndex === 0
      ? `<div style="text-align:center;font-weight:bold;font-size:16px;">\u5168\u6c11\u5065\u5eb7\u4fdd\u96aa\u9580\u8a3a\u4ea4\u4ed8\u8abf\u5291\u8655\u65b9\u7b8b\uff08\u6848\u4ef6:${esc(show(input.caseNo))}\uff09</div>
      <div>${esc(show(input.clinicName))}\u3000\u9662\u6240\u4ee3\u865f:${esc(show(input.clinicCode))}</div>
      <div>\u9662\u6240\u5730\u5740:${esc(show(input.address))}\u3000\u96fb\u8a71:${esc(show(input.phone))}</div>
      <div>\u59d3\u540d:${esc(show(input.name))}\u3000\u8eab\u5206\u8b49:${esc(show(input.idNo))}\u3000${esc(show(input.sex))}\u3000\u751f\u65e5:${esc(show(input.birthday))}\u3000\u75c5\u6b77\u865f:${esc(show(input.medicalNo))}</div>
      <div>\u79d1\u5225:${esc(show(input.dept))}\u3000\u5c31\u8a3a\u65e5:${esc(show(input.visitDate))}\u3000\u5361\u865f:${esc(show(input.cardNo))}\u3000\u770b\u8a3a\u865f:${esc(show(input.queueNo))}</div>
      <div>\u50b7\u75c5\u540d\u7a31:${esc(dx.join("\u3001") || "\u2014")}</div>
      <div>\u75be\u75c5\u4ee3\u865f:${esc(codes.join("\u3001") || "\u2014")}\uff08\u7d66\u85e5${esc(giveDays(input.drugs))}\u5929\uff09</div>`
      : `<div>${esc(show(input.name))}\u3000${esc(show(input.visitDate))}\u3000\u7e8c${pageIndex + 1}</div>`;
  const foot = last
    ? `<div style="margin-top:auto;padding-top:3mm;display:flex;justify-content:space-between;gap:6mm;">
        <div>\u91ab\u5e2b:${esc(show(input.doctor))}<br/>\u7c3d\u7ae0:</div>
        <div>\u85e5\u5e2b:${esc(show(input.pharmacist))}<br/>\u7c3d\u7ae0:</div>
        <div>\u96fb\u8a71:${esc(show(input.phone))}</div>
      </div>
      <div style="text-align:center;margin-top:2mm;">\uff0a\u8acb\u81ea\u884c\u81f3\u5065\u4fdd\u7279\u7d04\u85e5\u5c40\u9818\u85e5\uff0a</div>`
    : "";
  return `<div class="slip-page" style="padding:6mm 8mm;box-sizing:border-box;display:flex;flex-direction:column;background:#fff;color:#000;font-size:12px;line-height:1.35;">
    ${head}
    ${drugTable(rows)}
    ${foot}
  </div>`;
}

/** One landscape sheet. Extra drug lines continue on the next sheet. */
export function buildReleaseRxHtml(input: ReleaseRxInput): string {
  const rows = input.drugs.length ? input.drugs : [];
  const first = 12;
  const next = 18;
  const pages: ReleaseRxDrug[][] = [];
  if (rows.length <= first) {
    pages.push(rows);
  } else {
    pages.push(rows.slice(0, first));
    for (let index = first; index < rows.length; index += next) {
      pages.push(rows.slice(index, index + next));
    }
  }
  return pages.map((chunk, index) => page(input, chunk, index, index === pages.length - 1)).join("");
}

/** Opens the released prescription after the visit slip has been sent. No-op when this clinic left every case off. */
export async function openReleaseRxIfWanted(input: ReleaseRxInput): Promise<void> {
  if (!releaseRxWanted(input.caseNo)) return;
  findPrintSetup(loadPrintSettings(), "releaseRx");
  await openPrintPreview({
    kind: "rx",
    layout: "paged",
    setupId: "releaseRx",
    title: "\u5168\u6c11\u5065\u5eb7\u4fdd\u96aa\u9580\u8a3a\u4ea4\u4ed8\u8abf\u5291\u8655\u65b9\u7b8b",
    lines: [],
    bodyHtml: buildReleaseRxHtml(input),
  });
}
