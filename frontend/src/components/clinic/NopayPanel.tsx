import { Fragment, useState } from "react";
import type { ClaimCheckRow, NopayItem, NopayReport } from "@/api/clinicApi";

const DASH = "\u2014";

function pct(value: number | null | undefined): string {
  if (value == null) return DASH;
  return `${(value * 100).toFixed(value < 0.1 ? 2 : 1)}%`;
}

function measure(item: NopayItem): string {
  if (item.kind === "rate") {
    return `${item.numerator ?? 0}/${item.denominator ?? 0} = ${pct(item.rate)}\uff08\u4e0a\u9650 ${pct(item.threshold)}\uff09`;
  }
  if (item.kind === "cap") {
    return `\u6bcf\u7d44\u4e0a\u9650 ${item.cap}\uff0c\u8d85\u904e ${item.overGroups ?? 0} \u7d44`;
  }
  if (item.kind === "rx_dup") {
    return `\u91cd\u8907 ${item.numerator ?? 0} \u4ef6\uff0f\u6709\u958b ${item.denominator ?? 0} \u4ef6`;
  }
  return `\u76f8\u95dc ${item.denominator ?? 0} \u4ef6\uff0c\u9700\u5065\u4fdd\u7f72\u8cc7\u6599\uff0c\u672c\u6a5f\u7121\u6cd5\u8a08\u7b97`;
}

function status(item: NopayItem): { text: string; cls: string } {
  if (item.external) return { text: "\u53ea\u4f9b\u53c3\u8003", cls: "text-slate-400" };
  if (!item.applies) return { text: "\u4e0d\u9069\u7528", cls: "text-slate-400" };
  if (item.over) return { text: "\u8d85\u904e", cls: "text-red-700 font-bold" };
  return { text: "\u672a\u8d85\u904e", cls: "text-emerald-700" };
}

export function NopayPanel({
  report,
  onOpen,
}: {
  report: NopayReport | null | undefined;
  onOpen: (row: ClaimCheckRow) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string>("");
  if (!report) return null;
  const items = report.items.filter((item) => showAll || item.applies || item.over);
  return (
    <div className="mb-3">
      <h2 className="text-sm font-bold text-slate-800 border-b pb-2 mb-2">
        {"\u4e0d\u652f\u4ed8\u6307\u6a19\uff08\u4f30\u7b97\uff09"}
      </h2>
      <p className="text-[11px] mb-1">
        <span className={report.overCount ? "text-red-700 font-bold" : "text-emerald-700 font-bold"}>
          {"\u8d85\u904e"} {report.overCount} {"\u9805\uff0c\u4f30\u8a08\u6838\u6263"} {report.deduction} {"\u9ede"}
        </span>
        <span className="text-slate-400">
          {"\u3000\u898f\u5247\u7248\u672c"} {report.version || DASH}
          {"\u3000\u79d1\u5225"} {report.dept || DASH}
        </span>
        <label className="ml-2 text-slate-500">
          <input type="checkbox" className="mr-1 align-middle" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          {"\u986f\u793a\u4e0d\u9069\u7528\u7684"}
        </label>
      </p>
      <p className="text-[10px] text-slate-400 mb-1">
        {"\u4f9d\u5065\u4fdd\u7f72\u516c\u544a\u7684\u898f\u5247\u5728\u672c\u6a5f\u4f30\u7b97\uff0c\u53ea\u662f\u63d0\u9192\uff0c\u4e0d\u64cb\u7522\u6a94\u3002\u5be6\u969b\u6838\u6263\u4ee5\u5065\u4fdd\u7f72\u70ba\u6e96\u3002\u898f\u5247\u5728\u66f4\u65b0\u85e5\u50f9\u6642\u4e00\u4f75\u66f4\u65b0\u3002"}
      </p>
      <div className="overflow-auto max-h-48">
        <table className="w-full text-[11px] text-left">
          <thead className="text-slate-500 border-b">
            <tr>
              <th className="py-1 pr-2">{"\u7de8\u865f"}</th>
              <th className="py-1 pr-2">{"\u6307\u6a19"}</th>
              <th className="py-1 pr-2">{"\u672c\u6708"}</th>
              <th className="py-1 pr-2">{"\u7d50\u679c"}</th>
              <th className="py-1">{"\u4f30\u6838\u6263"}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const key = `${item.month}-${item.id}-${item.part ?? ""}`;
              const st = status(item);
              const expanded = open === key;
              return (
                <Fragment key={key}>
                  <tr
                    className={`border-b border-slate-100 ${item.cases.length ? "cursor-pointer hover:bg-slate-50" : ""}`}
                    onClick={() => item.cases.length && setOpen(expanded ? "" : key)}
                    title={item.note || undefined}
                  >
                    <td className="py-1 pr-2 font-mono">
                      {item.id}
                      {item.part ? `-${item.part}` : ""}
                    </td>
                    <td className="py-1 pr-2">{item.name}</td>
                    <td className="py-1 pr-2 font-mono">{measure(item)}</td>
                    <td className={`py-1 pr-2 ${st.cls}`}>{st.text}</td>
                    <td className="py-1 font-mono">{item.over ? item.deduction : DASH}</td>
                  </tr>
                  {expanded
                    ? item.cases.map((row, idx) => (
                        <tr
                          key={`${key}-c${idx}`}
                          className="border-b border-slate-50 bg-slate-50 cursor-pointer hover:bg-amber-50"
                          title={"\u9ede\u4e00\u4e0b\u6253\u958b\u9019\u7b46\u75c5\u6b77"}
                          onClick={() => onOpen({ ...row, message: item.name })}
                        >
                          <td className="py-1 pr-2" />
                          <td className="py-1 pr-2 font-mono">{row.medicalNo || DASH}</td>
                          <td className="py-1 pr-2 font-mono">{row.encounterDate || DASH}</td>
                          <td className="py-1 pr-2 font-mono">{row.caseNo || DASH}</td>
                          <td className="py-1" />
                        </tr>
                      ))
                    : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
