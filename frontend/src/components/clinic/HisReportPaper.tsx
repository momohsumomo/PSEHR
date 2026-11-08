import type { ReportResult, ReportSection } from "@/api/clinicApi";
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

function hasTotals(t: ReportSection): boolean {
  return t.columns.some((c) => cell(t.totals?.[c.key]) !== "");
}

function ReportTable({ table }: { table: ReportSection }) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {table.columns.map((c) => (
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
        {table.rows.map((row, i) => (
          <tr key={i}>
            {table.columns.map((c) => (
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
        {table.rows.length === 0 && (
          <tr>
            <td colSpan={table.columns.length} className="py-4 text-center text-[#666]">
              {"\u9019\u6bb5\u671f\u9593\u6c92\u6709\u8cc7\u6599"}
            </td>
          </tr>
        )}
      </tbody>
      {hasTotals(table) && (
        <tfoot>
          <tr>
            {table.columns.map((c) => (
              <td
                key={c.key}
                className="border-t-2 border-black px-1 py-0.5 font-bold"
                style={{ textAlign: c.align === "right" ? "right" : "left" }}
              >
                {cell(table.totals[c.key])}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/** Report paper: heading, rows, totals, then any extra sections. Shared by every statistics kind. */
export function HisReportPaper({ report, clinicName, rangeLabel }: Props) {
  return (
    <div className="p-4 text-black" style={{ fontFamily: HIS_FONT, fontSize: 24 }}>
      <div className="mb-1 text-center text-[30px] font-bold">
        {clinicName ? `${clinicName}\u3000` : ""}
        {report.title}
      </div>
      {rangeLabel && <div className="mb-2 text-center text-[24px]">{"\u770b\u8a3a\u65e5\u671f\uff1a"}{rangeLabel}</div>}
      <ReportTable table={report} />
      {report.note && <p className="mt-2 text-[22px] text-[#444]">{report.note}</p>}
      {(report.sections ?? []).map((s, i) => (
        <div key={i} className="mt-6">
          <div className="mb-1 text-[26px] font-bold">{s.title}</div>
          <ReportTable table={s} />
          {s.note && <p className="mt-2 text-[22px] text-[#444]">{s.note}</p>}
        </div>
      ))}
    </div>
  );
}

function tableLines(t: ReportSection): string[] {
  const lines = [t.columns.map((c) => c.label).join("\t")];
  for (const row of t.rows) lines.push(t.columns.map((c) => cell(row[c.key]).replace(/,/g, "")).join("\t"));
  if (hasTotals(t)) lines.push(t.columns.map((c) => cell(t.totals[c.key]).replace(/,/g, "")).join("\t"));
  return lines;
}

/** Tab-separated text for save and Excel. */
export function reportToExportText(report: ReportResult, rangeLabel?: string): string {
  const lines: string[] = [];
  lines.push(report.title + (rangeLabel ? `\t${rangeLabel}` : ""));
  lines.push(...tableLines(report));
  for (const s of report.sections ?? []) {
    lines.push("", s.title, ...tableLines(s));
  }
  return lines.join("\n");
}
