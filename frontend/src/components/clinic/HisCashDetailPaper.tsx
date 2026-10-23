import type { CSSProperties, ReactElement } from "react";
import { HIS_FONT } from "@/lib/hisTheme";
import type { CashDetailReport, CashDetailRow } from "@/lib/registerBookReport";

type Props = {
  report: CashDetailReport;
  /** 這一頁的列。不傳就整份印在同一頁。 */
  rows?: CashDetailRow[];
  pageNo?: number;
  isLast?: boolean;
};

const mono: CSSProperties = {
  fontFamily: "Consolas, 'Courier New', " + HIS_FONT,
  fontSize: 24,
  color: "#000",
};

function fmt(n: number): string {
  if (!n) return "0";
  return n.toLocaleString("zh-TW");
}

const COLS = [
  "日期",
  "姓名",
  "病歷號",
  "段",
  "序號",
  "卡號",
  "身份證",
  "押金",
  "案",
  "部代",
  "部額",
  "藥優",
  "掛費",
  "已收",
  "欠款",
  "雜費",
  "還款",
  "還單",
] as const;

const NUM = new Set(["押金", "部額", "藥優", "掛費", "已收", "欠款", "雜費", "還款", "還單"]);

/** 字是原來的兩倍，紙張高度是原來的三倍。一頁約 16 人。最後一頁留合計與人次，最多 10 列。 */
const ROWS_PER_PAGE = 16;
const LAST_PAGE_MAX = 10;

type Money = {
  deposit: number;
  copayAmt: number;
  drugDisc: number;
  regFee: number;
  received: number;
  arrears: number;
  misc: number;
  repay: number;
  returnSlip: number;
};

function sumRows(rows: CashDetailRow[]): Money {
  const t: Money = {
    deposit: 0,
    copayAmt: 0,
    drugDisc: 0,
    regFee: 0,
    received: 0,
    arrears: 0,
    misc: 0,
    repay: 0,
    returnSlip: 0,
  };
  for (const row of rows) {
    t.deposit += row.deposit;
    t.copayAmt += row.copayAmt;
    t.drugDisc += row.drugDisc;
    t.regFee += row.regFee;
    t.received += row.received;
    t.arrears += row.arrears;
    t.misc += row.misc;
    t.repay += row.repay;
    t.returnSlip += row.returnSlip;
  }
  return t;
}

export function splitCashDetailRows(rows: CashDetailRow[]): CashDetailRow[][] {
  if (rows.length === 0) return [[]];
  if (rows.length <= LAST_PAGE_MAX) return [rows];
  const pages: CashDetailRow[][] = [];
  let i = 0;
  while (i < rows.length) {
    const remain = rows.length - i;
    if (remain <= LAST_PAGE_MAX) {
      pages.push(rows.slice(i));
      break;
    }
    if (remain <= ROWS_PER_PAGE) {
      const head = remain - LAST_PAGE_MAX;
      pages.push(rows.slice(i, i + head));
      pages.push(rows.slice(i + head));
      break;
    }
    pages.push(rows.slice(i, i + ROWS_PER_PAGE));
    i += ROWS_PER_PAGE;
  }
  return pages;
}

export function cashDetailPageElements(report: CashDetailReport): ReactElement[] {
  const chunks = splitCashDetailRows(report.rows);
  return chunks.map((rows, i) => (
    <HisCashDetailPaper
      key={`${report.dateFromRoc}-${i}`}
      report={report}
      rows={rows}
      pageNo={i + 1}
      isLast={i === chunks.length - 1}
    />
  ));
}

/**
 * 現金帳-明細：一人一列。多頁時每頁重印表頭，中間頁是本頁小計，最後一頁才是全部合計。
 */
export function HisCashDetailPaper({ report, rows, pageNo = 1, isLast = true }: Props) {
  const pageRows = rows ?? report.rows;
  const t = isLast ? report.totals : sumRows(pageRows);

  return (
    <div style={{ ...mono, minHeight: "100%" }}>
      <div style={{ textAlign: "center", fontSize: 32, fontWeight: 700, marginBottom: 6, fontFamily: HIS_FONT }}>
        {"<< 掛號簿 >>"} {report.clinicName}
      </div>
      <div style={{ textAlign: "center", marginBottom: 2, fontFamily: HIS_FONT, fontSize: 24 }}>
        期間: {report.dateFromRoc}～{report.dateToRoc}
        {"　"}時段: {report.shiftLabel}
        {"　"}醫師: {report.doctor}
        {"　"}科別: {report.dept}
        {"　"}案件: {report.caseFilter}
      </div>
      <div style={{ textAlign: "center", marginBottom: 8, fontSize: 22, fontFamily: HIS_FONT }}>
        付印:{report.printedAtRoc} Time:{report.printedTime} （報表編號: {report.reportNo}）
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 22 }}>
        <thead>
          <tr>
            {COLS.map((c) => (
              <th
                key={c}
                style={{
                  borderTop: "1px solid #000",
                  borderBottom: "1px solid #000",
                  padding: "2px 4px",
                  fontWeight: 700,
                  textAlign: NUM.has(c) ? "right" : "left",
                  fontFamily: HIS_FONT,
                  whiteSpace: "nowrap",
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row) => (
            <tr key={row.key}>
              <td style={tdLeft}>{row.dateMd}</td>
              <td style={tdLeft}>{row.name}</td>
              <td style={tdLeft}>{row.chart}</td>
              <td style={tdLeft}>{row.seg}</td>
              <td style={tdLeft}>{row.seqText}</td>
              <td style={tdLeft}>{row.cardNo}</td>
              <td style={tdLeft}>{row.idNo}</td>
              <td style={tdNum}>{fmt(row.deposit)}</td>
              <td style={tdLeft}>{row.caseNo}</td>
              <td style={tdLeft}>{row.copayCode}</td>
              <td style={tdNum}>{fmt(row.copayAmt)}</td>
              <td style={tdNum}>{fmt(row.drugDisc)}</td>
              <td style={tdNum}>{fmt(row.regFee)}</td>
              <td style={tdNum}>{fmt(row.received)}</td>
              <td style={tdNum}>{fmt(row.arrears)}</td>
              <td style={tdNum}>{fmt(row.misc)}</td>
              <td style={tdNum}>{fmt(row.repay)}</td>
              <td style={tdNum}>{fmt(row.returnSlip)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={7} style={{ borderTop: "1px solid #000" }} />
            <td style={tdSum}>{fmt(t.deposit)}</td>
            <td style={{ borderTop: "1px solid #000" }} />
            <td style={{ borderTop: "1px solid #000" }} />
            <td style={tdSum}>{fmt(t.copayAmt)}</td>
            <td style={tdSum}>{fmt(t.drugDisc)}</td>
            <td style={tdSum}>{fmt(t.regFee)}</td>
            <td style={tdSum}>{fmt(t.received)}</td>
            <td style={tdSum}>{fmt(t.arrears)}</td>
            <td style={tdSum}>{fmt(t.misc)}</td>
            <td style={tdSum}>{fmt(t.repay)}</td>
            <td style={tdSum}>{fmt(t.returnSlip)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ textAlign: "center", marginTop: 8, fontFamily: HIS_FONT, fontSize: 24 }}>Page: {pageNo}</div>

      {isLast ? (
        <div style={{ marginTop: 10, fontFamily: HIS_FONT, fontSize: 24 }}>
          <div style={{ marginBottom: 8 }}>
            應收現金 : {fmt(report.cashReceivable)} 元
            <span style={{ display: "inline-block", width: "2rem" }} />
            總人次 : {report.headCount} 次
            <span style={{ display: "inline-block", width: "2rem" }} />
            總掛號人次 : {report.visitCount} 次
          </div>
          {report.caseBuckets.map((b) => (
            <div key={b.code || b.label} style={{ whiteSpace: "nowrap", lineHeight: 1.6 }}>
              <span style={{ display: "inline-block", minWidth: "3.2em", fontFamily: "Consolas, monospace" }}>
                {b.code === "自費" ? "" : b.code}
              </span>
              <span style={{ display: "inline-block", minWidth: "9em" }}>{b.label}</span>
              初診: {String(b.firstVisit).padStart(3, " ")} 人次　複診: {String(b.revisit).padStart(4, " ")} 人次　欠卡:{" "}
              {String(b.missingCard).padStart(2, " ")} 人次　還卡: {String(b.returnCard).padStart(2, " ")} 人次　還款:{" "}
              {String(b.repay).padStart(2, " ")} 人次
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const tdLeft: CSSProperties = {
  padding: "1px 4px",
  textAlign: "left",
  fontFamily: HIS_FONT,
  whiteSpace: "nowrap",
};

const tdNum: CSSProperties = {
  padding: "1px 4px",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

const tdSum: CSSProperties = {
  ...tdNum,
  borderTop: "1px solid #000",
};
