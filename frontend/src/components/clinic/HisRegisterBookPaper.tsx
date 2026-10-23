import type { CSSProperties } from "react";
import { HIS_FONT } from "@/lib/hisTheme";
import type { RegisterBookReport } from "@/lib/registerBookReport";

type Props = {
  report: RegisterBookReport;
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
  "人數",
  "押金",
  "部額",
  "卡優",
  "藥優",
  "掛費",
  "自費",
  "已收",
  "欠款",
  "雜費",
  "還款",
  "還單",
  "合計",
] as const;

/**
 * 醫聖現金帳「掛號簿」紙張排版（對截圖：橫式寬表，非 A4 直向）。
 * 工具列／紙張比例由 HisPrintToolShell + paper="register_book" 提供。
 */
export function HisRegisterBookPaper({ report }: Props) {
  const t = report.totals;
  return (
    <div style={{ ...mono, minHeight: "100%" }}>
      <div style={{ textAlign: "center", fontSize: 32, fontWeight: 700, marginBottom: 6, fontFamily: HIS_FONT }}>
        {"<< 掛號簿 >>"} {report.clinicName}
      </div>
      <div style={{ textAlign: "center", marginBottom: 4, fontFamily: HIS_FONT }}>
        期間: {report.dateFromRoc}~{report.dateToRoc}
        {"　　"}醫師: {report.doctor}
        {"　　"}科別: {report.dept}
        {"　　"}案件: {report.caseFilter}
      </div>
      <div style={{ textAlign: "right", marginBottom: 8, fontSize: 22, fontFamily: HIS_FONT }}>
        列印: {report.printedAtRoc} Time: {report.printedTime} （報表編號: {report.reportNo}）
      </div>

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 22,
          tableLayout: "fixed",
        }}
      >
        <colgroup>
          <col style={{ width: "12%" }} />
          {COLS.slice(1).map((c) => (
            <col key={c} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {COLS.map((c) => (
              <th
                key={c}
                style={{
                  borderTop: "1px solid #000",
                  borderBottom: "1px solid #000",
                  padding: "2px 3px",
                  fontWeight: 700,
                  textAlign: c === "日期" ? "left" : "right",
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
          {report.days.map((d) => (
            <tr key={d.dateIso}>
              <td style={tdLeft}>{d.dateRoc}</td>
              <td style={tdNum}>{fmt(d.people)}</td>
              <td style={tdNum}>{fmt(d.deposit)}</td>
              <td style={tdNum}>{fmt(d.copayAmt)}</td>
              <td style={tdNum}>{fmt(d.cardDisc)}</td>
              <td style={tdNum}>{fmt(d.drugDisc)}</td>
              <td style={tdNum}>{fmt(d.regFee)}</td>
              <td style={tdNum}>{fmt(d.selfPay)}</td>
              <td style={tdNum}>{fmt(d.received)}</td>
              <td style={tdNum}>{fmt(d.arrears)}</td>
              <td style={tdNum}>{fmt(d.misc)}</td>
              <td style={tdNum}>{fmt(d.repay)}</td>
              <td style={tdNum}>{fmt(d.returnSlip)}</td>
              <td style={tdNum}>{fmt(d.total)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...tdLeft, borderTop: "1px solid #000" }} />
            <td style={{ ...tdNum, borderTop: "1px solid #000" }}>{fmt(t.people)}</td>
            <td style={{ ...tdNum, borderTop: "1px solid #000" }}>{fmt(t.deposit)}</td>
            <td style={{ ...tdNum, borderTop: "1px solid #000" }}>{fmt(t.copayAmt)}</td>
            <td style={{ ...tdNum, borderTop: "1px solid #000" }}>{fmt(t.cardDisc)}</td>
            <td style={{ ...tdNum, borderTop: "1px solid #000" }}>{fmt(t.drugDisc)}</td>
            <td style={{ ...tdNum, borderTop: "1px solid #000" }}>{fmt(t.regFee)}</td>
            <td style={{ ...tdNum, borderTop: "1px solid #000" }}>{fmt(t.selfPay)}</td>
            <td style={{ ...tdNum, borderTop: "1px solid #000" }}>{fmt(t.received)}</td>
            <td style={{ ...tdNum, borderTop: "1px solid #000" }}>{fmt(t.arrears)}</td>
            <td style={{ ...tdNum, borderTop: "1px solid #000" }}>{fmt(t.misc)}</td>
            <td style={{ ...tdNum, borderTop: "1px solid #000" }}>{fmt(t.repay)}</td>
            <td style={{ ...tdNum, borderTop: "1px solid #000" }}>{fmt(t.returnSlip)}</td>
            <td style={{ ...tdNum, borderTop: "1px solid #000" }}>{fmt(t.total)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: 14, fontFamily: HIS_FONT, fontSize: 24 }}>
        <div style={{ marginBottom: 8 }}>
          應收現金 : {fmt(report.cashReceivable)} 元
          <span style={{ display: "inline-block", width: "4rem" }} />
          總掛號人次 : {report.visitCount} 次
        </div>
        <table
          style={{
            borderCollapse: "collapse",
            fontFamily: HIS_FONT,
            fontSize: 24,
            marginTop: 4,
          }}
        >
          <thead>
            <tr>
              {["身分", "說明", "初診", "複診", "總人數", "欠卡", "還卡", "還款"].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: h === "身分" || h === "說明" ? "left" : "right",
                    padding: "0 8px 2px 0",
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.caseBuckets.map((b) => (
              <tr key={b.code}>
                <td style={bucketCode}>{b.code === "\u81ea\u8cbb" ? "" : b.code}</td>
                <td style={bucketLabel}>{b.label}</td>
                <td style={bucketNum}>{b.firstVisit}</td>
                <td style={bucketNum}>{b.revisit}</td>
                <td style={bucketNum}>{b.firstVisit + b.revisit}</td>
                <td style={bucketNum}>{b.missingCard}</td>
                <td style={bucketNum}>{b.returnCard}</td>
                <td style={bucketNum}>{b.repay}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ textAlign: "center", marginTop: 24, fontSize: 22, fontFamily: HIS_FONT }}>Page: 1</div>
    </div>
  );
}

const tdLeft: CSSProperties = {
  padding: "1px 2px",
  textAlign: "left",
  fontFamily: HIS_FONT,
};
const tdNum: CSSProperties = {
  padding: "1px 3px",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};
const bucketCode: CSSProperties = {
  padding: "1px 8px 1px 0",
  whiteSpace: "nowrap",
  fontFamily: "Consolas, 'Courier New', monospace",
};
const bucketLabel: CSSProperties = {
  padding: "1px 12px 1px 0",
  whiteSpace: "nowrap",
  minWidth: "8em",
};
const bucketNum: CSSProperties = {
  padding: "1px 8px 1px 0",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
  minWidth: "3.2em",
};
