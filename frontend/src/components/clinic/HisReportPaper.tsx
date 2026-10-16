import type { ReportResult } from "@/api/clinicApi";
import { HIS_FONT } from "@/lib/hisTheme";

type Props = {
  report: ReportResult;
  clinicName?: string;
  rangeLabel?: string;
};

function cell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return String(v);
}

/** 統計報表紙面：表頭、明細、合計列（疾病／人數／藥品／診療／申報統計共用）。 */
export function HisReportPaper({ report, clinicName, rangeLabel }: Props) {
  return (
    <div className="p-4 text-black" style={{ fontFamily: HIS_FONT, fontSize: 12 }}>
      <div className="mb-1 text-center text-[15px] font-bold">
        {clinicName ? `${clinicName}　` : ""}
        {report.title}
      </div>
      {rangeLabel && <div className="mb-2 text-center text-[12px]">看診日期：{rangeLabel}</div>}
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {report.columns.map((c) => (
              <th
                key={c.key}
                className="border-b-2 border-t-2 border-black px-1 py-0.5"
                style={{ textAlign: c.align === "right" ? "right" : "left" }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row, i) => (
            <tr key={i}>
              {report.columns.map((c) => (
                <td
                  key={c.key}
                  className="border-b border-[#ccc] px-1 py-px font-mono"
                  style={{ textAlign: c.align === "right" ? "right" : "left" }}
                >
                  {cell(row[c.key])}
                </td>
              ))}
            </tr>
          ))}
          {report.rows.length === 0 && (
            <tr>
              <td colSpan={report.columns.length} className="py-4 text-center text-[#666]">
                這段期間沒有資料
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            {report.columns.map((c) => (
              <td
                key={c.key}
                className="border-t-2 border-black px-1 py-0.5 font-bold"
                style={{ textAlign: c.align === "right" ? "right" : "left" }}
              >
                {cell(report.totals[c.key])}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
      {report.note && <p className="mt-2 text-[11px] text-[#444]">{report.note}</p>}
    </div>
  );
}

/** 存檔／轉 Excel 用的 Tab 分隔文字。 */
export function reportToExportText(report: ReportResult, rangeLabel?: string): string {
  const lines: string[] = [];
  lines.push(report.title + (rangeLabel ? `\t${rangeLabel}` : ""));
  lines.push(report.columns.map((c) => c.label).join("\t"));
  for (const row of report.rows) lines.push(report.columns.map((c) => cell(row[c.key]).replace(/,/g, "")).join("\t"));
  lines.push(report.columns.map((c) => cell(report.totals[c.key]).replace(/,/g, "")).join("\t"));
  return lines.join("\n");
}
