import { buildXlsx, utf8 } from "./xlsxLite";

/**
 * Cash-detail workbook the daily reader already opens.
 * Sheet name, headers (including the two headings that omit "("),
 * text-versus-number cells, and padding follow that file.
 * Two heading cells are "\u6536\u8cbb\u4eba\u54e1\u4e09)" and "\u6536\u8cbb\u65b9\u5f0f\u4e09)".
 */

export type CashExcelInput = {
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
  regFee: number;
  received: number;
  arrears: number;
  misc: number;
  repay: number;
  returnSlip: number;
  selfPay: number;
  doctorId: string;
};

const HEADERS = [
  "\u65e5\u671f",
  "\u59d3\u540d",
  "\u75c5\u6b77\u865f",
  "\u6bb5",
  "\u5e8f\u865f",
  "\u5361\u865f",
  "\u8eab\u4efd\u8b49",
  "\u62bc\u91d1",
  "\u6848",
  "\u90e8\u4ee3",
  "\u90e8\u984d",
  "\u639b\u8cbb",
  "\u5df2\u6536",
  "\u6b20\u6b3e",
  "\u96dc\u8cbb",
  "\u9084\u6b3e",
  "\u9084\u55ae",
  "\u81ea\u8cbb",
  "\u91ab\u5e2b",
  "\u6536\u8cbb\u91d1\u984d(\u4e09)",
  "\u6536\u8cbb\u91d1\u984d(\u56db)",
  "\u6536\u8cbb\u4eba\u54e1\u4e09)",
  "\u6536\u8cbb\u4eba\u54e1(\u56db)",
  "\u6536\u8cbb\u65b9\u5f0f\u4e09)",
  "\u6536\u8cbb\u65b9\u5f0f(\u56db)",
];

const NUMBER_COLS = new Set([8, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21]);

const COL_WIDTHS: Record<number, number> = {
  1: 6,
  2: 10.5,
  3: 9.5,
  4: 3.875,
  5: 6,
  7: 12.125,
  8: 6,
  9: 3.875,
  10: 6,
  11: 6,
  19: 6,
  20: 14.25,
  22: 13.375,
  23: 14.25,
  24: 13.375,
  25: 14.25,
};

function dispWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += (ch.codePointAt(0) || 0) > 255 ? 2 : 1;
  return w;
}

function padDisplay(text: string, width: number): string {
  const gap = width - dispWidth(text);
  return gap > 0 ? text + " ".repeat(gap) : text;
}

function padEnd(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function money(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

/** \u91ab\u8056 doctor serial is two digits. This clinic's cash file uses 01. */
export function cashDoctorCode(doctorId: string): string {
  const tail = String(doctorId || "").match(/(\d+)$/);
  if (tail) return tail[1].padStart(2, "0").slice(-2);
  return "01";
}

function rowCells(row: CashExcelInput): Array<string | number> {
  return [
    padEnd(plain(String(row.dateMd || "")), 5),
    padDisplay(plain(String(row.name || "").trim()), 10),
    padEnd(plain(String(row.chart || "").trim()), 10),
    plain(String(row.seg || "")),
    plain(String(row.seqText || "")),
    padEnd(plain(String(row.cardNo || "")), 4),
    plain(String(row.idNo || "")),
    money(row.deposit),
    String(row.caseNo || ""),
    padEnd(String(row.copayCode || ""), 3),
    money(row.copayAmt),
    money(row.regFee),
    money(row.received),
    money(row.arrears),
    money(row.misc),
    money(row.repay),
    money(row.returnSlip),
    money(row.selfPay),
    cashDoctorCode(row.doctorId),
    0,
    0,
    "  ",
    "  ",
    "  ",
    "  ",
  ];
}

function colName(index: number): string {
  let n = index;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** A null from a card name makes the whole workbook illegal, and Excel opens a blank file. */
function plain(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
}

function xmlText(value: string): string {
  return plain(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cellXml(col: number, row: number, value: string | number, header: boolean): string {
  const ref = `${colName(col)}${row}`;
  const numeric = NUMBER_COLS.has(col);
  const style = header ? (numeric ? 2 : 1) : numeric ? 4 : 3;
  if (numeric && !header) return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  const text = xmlText(String(value));
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${text}</t></is></c>`;
}

function sheetXml(rows: CashExcelInput[]): string {
  const cols = Object.entries(COL_WIDTHS)
    .map(([col, width]) => `<col min="${col}" max="${col}" width="${width}" customWidth="1"/>`)
    .join("");
  const lines = [`<row r="1">${HEADERS.map((header, i) => cellXml(i + 1, 1, header, true)).join("")}</row>`];
  rows.forEach((row, index) => {
    const r = index + 2;
    const cells = rowCells(row);
    lines.push(`<row r="${r}">${cells.map((value, i) => cellXml(i + 1, r, value, false)).join("")}</row>`);
  });
  const last = rows.length + 1;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:Y${last}"/>
<cols>${cols}</cols>
<sheetData>${lines.join("")}</sheetData>
</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2">
<font><sz val="12"/><name val="\u65b0\u7d30\u660e\u9ad4"/><charset val="136"/></font>
<font><b/><sz val="12"/><name val="\u65b0\u7d30\u660e\u9ad4"/><charset val="136"/></font>
</fonts>
<fills count="2">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="\u5de5\u4f5c\u88681" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

export function cashDetailToXlsx(rows: CashExcelInput[]): Uint8Array {
  return buildXlsx([
    { name: "[Content_Types].xml", data: utf8(CONTENT_TYPES) },
    { name: "_rels/.rels", data: utf8(ROOT_RELS) },
    { name: "xl/workbook.xml", data: utf8(WORKBOOK) },
    { name: "xl/_rels/workbook.xml.rels", data: utf8(WORKBOOK_RELS) },
    { name: "xl/styles.xml", data: utf8(STYLES) },
    { name: "xl/worksheets/sheet1.xml", data: utf8(sheetXml(rows)) },
  ]);
}

/** 115.10.18 -> 1151018, the name the daily folder already uses. */
export function cashDetailFileStem(dateFromRoc: string, dateToRoc: string): string {
  const compact = (roc: string) => String(roc || "").replace(/\D/g, "");
  const from = compact(dateFromRoc);
  const to = compact(dateToRoc);
  if (from && from === to) return from;
  if (from && to) return `${from}-${to}`;
  return "cash-detail";
}
