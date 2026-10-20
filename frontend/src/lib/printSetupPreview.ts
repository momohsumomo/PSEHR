import type { SciniRow } from "@/api/clinicApi";
import { depositFlagsFromDraft, flagState, isCheckbox, rowKey, simpleFlagOn, simplePatchFromFlags } from "@/lib/printFormatOptions";
import { buildSimpleSlipHtml } from "@/lib/simpleSlip";
import {
  buildAuditSheetHtml,
  buildCertificateHtml,
  buildDepositSlipHtml,
  buildReferralSlipHtml,
} from "@/lib/clinicPrintDocs";
import { SIMPLE_PRINT_PARTS, type PrintSetupId } from "@/lib/printSettings";

export type PreviewClinic = {
  name: string;
  address: string;
  phone: string;
  code: string;
};

export type PreviewPage = {
  html: string;
  padTopMm: number;
  padLeftMm: number;
};

const BIT_WORDS: Array<[string, string]> = [
  ["\u4e3b\u8ff0", "chief"],
  ["\u4e3b\u8a34", "chief"],
  ["\u75c5\u540d", "dx"],
  ["\u8b66\u8a9e", "warning"],
  ["\u91ab\u5e2b\u59d3\u540d", "doctor"],
  ["\u91ab\u5e2b", "doctor"],
  ["\u85e5\u5e2b", "pharmacist"],
  ["\u751f\u65e5", "birthday"],
  ["\u75c5\u6b77\u865f", "chart"],
  ["\u6536\u8cbb\u9805\u76ee", "fees"],
  ["\u61c9\u6536", "due"],
  ["\u90e8\u4f4d", "site"],
  ["\u82f1\u6587", "english"],
  ["\u9662\u9577", "dean"],
  ["\u5730\u5740", "address"],
  ["\u96fb\u8a71", "phone"],
  ["\u689d\u78bc", "barcode"],
  ["\u9801\u78bc", "page"],
  ["\u81ea\u8cbb", "self"],
  ["(\u81ea)", "self"],
  ["\u62bc\u91d1", "deposit"],
  ["\u9000\u62bc", "days"],
  ["\u55ae\u908a", "side"],
  ["\u4f8b\u5047\u65e5", "holiday"],
  ["\u8eab\u5206\u8b49", "idno"],
  ["\u75c5\u60a3ID", "idno"],
  ["ID", "idno"],
];

const PART_BIT: Record<string, string> = {
  chief: "chief",
  diagnoses: "dx",
  marks: "self",
  leftMoney: "due",
  feeTable: "fees",
  warning: "warning",
};

export function focusBits(entry: string): string[] {
  const bits: string[] = [];
  for (const [word, bit] of BIT_WORDS) {
    if (entry.includes(word) && !bits.includes(bit)) bits.push(bit);
  }
  return bits;
}

export function settingMovesPreview(entry: string): boolean {
  if (focusBits(entry).length > 0) return true;
  return /\u5b57\u5f62|\u5b57\u578b\u5927\u5c0f|\u62ac\u982d|\u8868\u5c3e|\u908a\u754c|\u6709\u6548\u5929\u6578|\u9000\u62bc\u671f\u9650|\u7d19\u5f35/.test(entry);
}

function hiddenBits(items: SciniRow[], draft: Record<string, string>, id: PrintSetupId): string[] {
  const hidden: string[] = [];
  const add = (bit: string) => {
    if (bit && !hidden.includes(bit)) hidden.push(bit);
  };
  for (const item of items) {
    const value = draft[rowKey(item)] ?? "";
    const on = flagState(value);
    if (on === null) continue;
    const entry = item.entry || "";
    if (!/\u5217\u5370|\u52a0\u5370|\u52a0\u5217|\u4e0d\u5370/.test(entry)) continue;
    const suppress = entry.includes("\u4e0d\u5370") ? on : !on;
    if (!suppress) continue;
    for (const bit of focusBits(entry)) add(bit);
  }
  if (id === "simple") {
    const patch = simplePatchFromFlags(
      {
        id: "simple",
        label: "",
        widthMm: 114,
        heightMm: 101.6,
        printerName: "",
        footer: "",
        layoutFixed: false,
        parts: SIMPLE_PRINT_PARTS.map((part) => ({ ...part })),
      },
      draft,
      items,
    );
    for (const part of patch.parts || []) {
      if (part.on === false) add(PART_BIT[part.id] || "");
    }
  }
  return hidden;
}

function textOf(items: SciniRow[], draft: Record<string, string>, test: (entry: string) => boolean): string {
  for (const item of items) {
    const value = (draft[rowKey(item)] ?? "").trim();
    if (!value || isCheckbox(item, value)) continue;
    if (test(item.entry || "")) return value;
  }
  return "";
}

function proseOf(items: SciniRow[], draft: Record<string, string>, test: (entry: string) => boolean): string {
  const value = textOf(items, draft, test);
  if (/^-?\d+(\.\d+)?$/.test(value)) return "";
  return value;
}

function fontPx(items: SciniRow[], draft: Record<string, string>, fallback: number): number {
  for (const item of items) {
    if (!/\u5b57\u5f62\u5927\u5c0f|\u5b57\u578b\u5927\u5c0f/.test(item.entry || "")) continue;
    const n = Math.abs(Number.parseFloat(draft[rowKey(item)] || ""));
    if (Number.isFinite(n) && n >= 7 && n <= 22) return n;
  }
  return fallback;
}

function margins(items: SciniRow[], draft: Record<string, string>): { top: number; left: number } {
  let top = 0;
  let left = 0;
  for (const item of items) {
    const entry = item.entry || "";
    const value = draft[rowKey(item)] ?? "";
    if (isCheckbox(item, value)) continue;
    const n = Math.abs(Number.parseFloat(value));
    if (!Number.isFinite(n) || n <= 0) continue;
    let mm = n;
    if (/cm/i.test(entry)) mm = n * 10;
    else if (/\(in\)/.test(entry)) mm = n * 25.4;
    mm = Math.min(mm, 12);
    if (entry.includes("\u4e0a\u908a\u754c")) top = mm;
    if (entry.includes("\u5de6\u908a\u754c")) left = mm;
  }
  return { top, left };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function glow(bits: string[], bit: string): string {
  return bits.includes(bit) ? "outline:2px solid #E6A800;background:#FFF6CC;" : "";
}

type Face = {
  hide: string[];
  focus: string[];
  font: number;
  title: string;
  footer: string;
  days: string;
  clinic: PreviewClinic;
  padTopMm: number;
  padLeftMm: number;
};

function faceOf(
  id: PrintSetupId,
  items: SciniRow[],
  draft: Record<string, string>,
  footer: string,
  focusEntry: string,
  clinic: PreviewClinic,
): Face {
  const pad = margins(items, draft);
  const title = proseOf(
    items,
    draft,
    (entry) =>
      entry.includes("\u62ac\u982d") &&
      !/\u6578\u91cf|\u7528\u6cd5|\u85e5\u54c1|\u90e8\u4f4d|\u9014\u5f91|\u8ca0\u64d4|\u8cbb\u7528\u540d\u7a31|\u4f4d\u55ae|\u8b66\u8a9e\u7684\u62ac\u982d|\u81ea\u8cbb\u8a3a\u7642/.test(
        entry,
      ),
  );
  const tail =
    proseOf(
      items,
      draft,
      (entry) => entry.includes("\u8868\u5c3e") && !/\u9ad8\u5ea6|\u908a\u754c|\u9577\u5ea6|\u884c\u8ddd/.test(entry),
    ) || footer;
  const days =
    textOf(items, draft, (entry) => entry.includes("\u6709\u6548\u5929\u6578") || entry.includes("\u9000\u62bc\u671f\u9650")) ||
    "";
  return {
    hide: hiddenBits(items, draft, id),
    focus: focusEntry ? focusBits(focusEntry) : [],
    font: fontPx(items, draft, id === "simple" ? 9 : 12),
    title,
    footer: tail,
    days,
    clinic,
    padTopMm: pad.top,
    padLeftMm: pad.left,
  };
}

function simplePages(
  face: Face,
  items: SciniRow[],
  draft: Record<string, string>,
  drugFont?: number,
  rxFont?: number,
): string[] {
  const html = buildSimpleSlipHtml({
    medicalNo: "000000",
    name: "\u7bc4\u4f8b",
    sex: "\u5973",
    idNo: "A000000000",
    birthday: "0800101",
    age: "45",
    visitDate: "1151018",
    dept: "\u76ae\u819a\u79d1",
    caseNo: "09",
    cardNo: "0000",
    doctor: "\u7bc4\u4f8b\u91ab\u5e2b",
    pharmacist: "\u7bc4\u4f8b\u85e5\u5e2b",
    chief: "\u76ae\u819a\u7662\u4e09\u5929",
    diagnoses: [{ icd10: "L30.9", text: "\u76ae\u819a\u708e" }],
    drugs: [
      { id: "1", name: "\u6b62\u75db\u85e5 500mg", sig: "TID", days: 3, qty: 3, nhiCode: "", route: "oral", totalAmount: "9" },
      {
        id: "2",
        name: "\u5916\u7528\u85e5\u818f",
        sig: "BID",
        days: 7,
        qty: 1,
        nhiCode: "",
        route: "topical",
        payMark: "\u81ea",
        memo: "[",
        unitPrice: 10,
        totalAmount: "10",
        bodySite: "\u53f3\u624b",
      },
      { id: "3", name: "\u80c3\u85e5", sig: "QD", days: 7, qty: 1, nhiCode: "", route: "oral", totalAmount: "10" },
    ],
    room: "1",
    queueNo: "3",
    deposit: "10",
    regFee: "10",
    burden: "10",
    selfPay: "10",
    clinicName: face.clinic.name,
    address: face.clinic.address,
    clinicCode: face.clinic.code,
    phone: face.clinic.phone,
    dispenseDate: "1151018",
    pharmacy: "\u9662\u5167",
    consultFee: "",
    drugFee: "",
    materialFee: "",
    footer: face.footer,
    fontSizePx: rxFont ?? face.font,
    drugFontSizePx: drugFont,
    showChief: simpleFlagOn(items, draft, "chief"),
    showDiagnoses: simpleFlagOn(items, draft, "diagnoses"),
    showMarks: simpleFlagOn(items, draft, "marks"),
    showLeftMoney: simpleFlagOn(items, draft, "leftMoney"),
    showDue: simpleFlagOn(items, draft, "due"),
    showFeeTable: simpleFlagOn(items, draft, "feeTable"),
    showWarning: simpleFlagOn(items, draft, "warning"),
    hideBits: [],
    focusBits: face.focus,
    receiptTitle: face.title,
  });
  const parts = html.split(/(?=<(?:div|section) class="slip-page")/).map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : [html];
}

function line(face: Face, bit: string, text: string): string {
  if (face.hide.includes(bit)) return "";
  return `<div style="${glow(face.focus, bit)}">${esc(text)}</div>`;
}

function otherPage(id: PrintSetupId, face: Face): string {
  const font = `font-size:${face.font}px;line-height:1.35;color:#111;`;
  const head = face.title || face.clinic.name;
  if (id === "bag") {
    return `<div style="${font}padding:2mm;">
      <div style="text-align:center;font-weight:bold;${glow(face.focus, "title")}">${esc(head)}</div>
      ${line(face, "chart", "\u7bc4\u4f8b\u3000000000")}
      ${line(face, "doctor", "\u91ab\u5e2b \u7bc4\u4f8b\u91ab\u5e2b")}
      <div style="margin-top:2mm;border-top:1px solid #000;padding-top:1mm;">
        <div>\u5916\u7528\u85e5\u818f</div>
        <div>\u4e00\u6b21\u9069\u91cf\u3000\u4e00\u65e5\u5169\u6b21\u3000\u5171 1 \u689d</div>
      </div>
      ${line(face, "warning", face.footer || "\u8b66\u8a9e\uff1a\u7f6e\u65bc\u9670\u6dbc\u8655\uff0c\u907f\u5149")}
    </div>`;
  }
  if (id === "formal") {
    return `<div style="${font}padding:4mm;">
      <div style="text-align:center;font-weight:bold;">${esc(head || "\u4ea4\u4ed8\u8655\u65b9\u7c3d")}</div>
      <div>${esc(face.clinic.name)}</div>
      ${line(face, "chart", "\u75c5\u6b77\u865f 000000\u3000\u7bc4\u4f8b")}
      ${line(face, "dx", "\u75c5\u540d L30.9 \u76ae\u819a\u708e")}
      <div style="margin-top:2mm;">\u6b62\u75db\u85e5 500mg\u3000\u6210\u4efd \u5c0d\u4e59\u9170\u6c28\u57fa\u915a</div>
      ${line(face, "self", "\u81ea \u5916\u7528\u85e5\u818f")}
      ${line(face, "barcode", "\u689d\u78bc\uff1a\u7bc4\u4f8b")}
      ${line(face, "warning", face.footer || "\u8868\u5c3e\u5099\u8a3b")}
    </div>`;
  }
  return "";
}

function definedPages(
  id: PrintSetupId,
  face: Face,
  items: SciniRow[],
  draft: Record<string, string>,
): string[] | null {
  if (id === "certificate") {
    return [buildCertificateHtml({
      clinicCode: face.clinic.code,
      clinicName: face.clinic.name,
      licenseNo: "",
      clinicAddress: face.clinic.address,
      docNo: "",
      name: "\u7bc4\u4f8b",
      sex: "\u5973",
      medicalNo: "000000",
      age: "40",
      birthday: "0800101",
      idNo: "A000000000",
      address: "\u7bc4\u4f8b\u5730\u5740",
      visitDate: "115.10.18",
      dept: "\u76ae\u819a\u79d1",
      diagnosis: "L30.9 \u76ae\u819a\u708e",
      order: "\u5b9c\u4f11\u606f\u4e09\u65e5",
      doctor: "\u7bc4\u4f8b\u91ab\u5e2b",
      printDate: "115.10.18",
      english: false,
    })];
  }
  if (id === "deposit") {
    const flags = depositFlagsFromDraft(items, draft, face.footer);
    return [buildDepositSlipHtml({
      clinicName: face.clinic.name,
      patientName: "\u7bc4\u4f8b",
      medicalNo: "000000",
      date: "2026-10-18",
      deposit: "10",
      idNo: "A000000000",
      birthday: "0800101",
      days: flags.days,
      showIdBirthday: flags.showIdBirthday,
      excludeHoliday: flags.excludeHoliday,
      singleSide: flags.singleSide,
      warning: flags.warning || face.footer,
      focusBits: face.focus,
    })];
  }
  if (id === "audit") {
    return [buildAuditSheetHtml({
      clinicName: face.clinic.name,
      clinicCode: face.clinic.code,
      name: "\u7bc4\u4f8b",
      medicalNo: "000000",
      sex: "\u5973",
      birthday: "0800101",
      visitDate: "115.10.18",
      doctor: "\u7bc4\u4f8b\u91ab\u5e2b",
      chief: "\u76ae\u819a\u7662\u4e09\u5929",
      diagnoses: "L30.9 \u76ae\u819a\u708e",
      orders: "1. \u6b62\u75db\u85e5 500mg TID 3 \u5929",
      regFee: "10",
      burden: "10",
      selfPay: "10",
    })];
  }
  if (id === "referral") {
    const html = buildReferralSlipHtml({
      clinicName: face.clinic.name,
      clinicCode: face.clinic.code,
      clinicAddress: face.clinic.address,
      clinicPhone: face.clinic.phone,
      name: "\u7bc4\u4f8b",
      sex: "\u5973",
      birthday: "0800101",
      idNo: "A000000000",
      medicalNo: "000000",
      phone: "",
      address: "\u7bc4\u4f8b\u5730\u5740",
      chief: "\u76ae\u819a\u7662\u4e09\u5929",
      allergy: "",
      diagnoses: "L30.9 \u76ae\u819a\u708e",
      examOn: "",
      exam: "",
      meds: "\u6b62\u75db\u85e5 500mg",
      medOn: "115.10.18",
      purpose: "4",
      purposeOther: "",
      doctor: "\u7bc4\u4f8b\u91ab\u5e2b",
      ourDept: "\u76ae\u819a\u79d1",
      tel: face.clinic.phone,
      fax: "",
      email: "",
      opened: "115.10.18",
      hosp: "\u7bc4\u4f8b\u91ab\u9662",
      hospCode: "",
      dept: "\u76ae\u819a\u79d1",
      suggestDoc: "",
      hospAddr: "",
      hospTel: "",
      valid: "115.11.01",
      copies: [["\u7b2c\u4e00\u806f\uff1a\u63a5\u53d7\u8f49\u8a3a\u91ab\u9662\u3001\u8a3a\u6240\u7559\u5b58\uff08\u85cd\u8272\uff09", ""]],
    });
    const parts = html.split(/(?=<section class="slip-page")/).map((part) => part.trim()).filter(Boolean);
    return parts.length ? parts : [html];
  }
  return null;
}

export function buildSetupPreviewPages(args: {
  id: PrintSetupId;
  items: SciniRow[];
  draft: Record<string, string>;
  footer: string;
  focusEntry: string;
  drugFontSizePx?: number;
  fontSizePx?: number;
  clinic: PreviewClinic;
}): PreviewPage[] {
  const face = faceOf(args.id, args.items, args.draft, args.footer, args.focusEntry, args.clinic);
  const defined = definedPages(args.id, face, args.items, args.draft);
  const htmls =
    args.id === "simple"
      ? simplePages(face, args.items, args.draft, args.drugFontSizePx, args.fontSizePx)
      : defined || [otherPage(args.id, face)];
  return htmls.map((html) => ({ html, padTopMm: face.padTopMm, padLeftMm: face.padLeftMm }));
}
