import { useLayoutEffect, useRef, useState } from "react";
import type { ReportColumn, ReportResult, ReportSection } from "@/api/clinicApi";
import { HIS_FONT } from "@/lib/hisTheme";

const BASE_FONT = 24;
const MIN_FONT = 14;

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

/** First column repeats in every part so each part still reads on its own. */
function splitColumns(columns: ReportColumn[], parts: number): ReportColumn[][] {
  if (parts <= 1 || columns.length < 3) return [columns];
  const [head, ...rest] = columns;
  const size = Math.ceil(rest.length / parts);
  const out: ReportColumn[][] = [];
  for (let i = 0; i < rest.length; i += size) out.push([head, ...rest.slice(i, i + size)]);
  return out;
}

/** Too wide for the paper: shrink the type first, then stack the columns in parts below. */
function ReportTable({ table }: { table: ReportSection }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [font, setFont] = useState(BASE_FONT);
  const [parts, setParts] = useState(1);
  const seen = useRef(table);
  useLayoutEffect(() => {
    if (seen.current !== table) {
      seen.current = table;
      if (font !== BASE_FONT || parts !== 1) {
        setFont(BASE_FONT);
        setParts(1);
        return;
      }
    }
    const box = boxRef.current;
    if (!box || box.scrollWidth <= box.clientWidth + 1) return;
    if (font > MIN_FONT) setFont((f) => f - 1);
    else if (parts < table.columns.length - 1) setParts((p) => p + 1);
  }, [font, parts, table]);
  return (
    <div ref={boxRef} style={{ fontSize: font }}>
      {splitColumns(table.columns, parts).map((cols, i) => (
        <div key={i} className={i ? "mt-4" : ""}>
          <PlainTable table={{ ...table, columns: cols }} />
        </div>
      ))}
    </div>
  );
}

function PlainTable({ table }: { table: ReportSection }) {
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
