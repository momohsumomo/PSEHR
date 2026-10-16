import { useEffect, useState } from "react";
import { fetchInstalledPrinters } from "@/api/clinicApi";
import { openPrintPreview } from "@/lib/printJob";
import {
  DEFAULT_PRINT_SETUPS,
  type PrintSettings,
  type PrintSetup,
} from "@/lib/printSettings";
import { HIS_FONT } from "@/lib/hisTheme";

type Props = {
  value: PrintSettings;
  onChange: (next: PrintSettings) => void;
};

function sampleHtml(row: PrintSetup): string {
  const foot = row.footer
    ? `<p style="margin-top:8px;font-size:10px;">${row.footer}</p>`
    : "";
  if (row.id === "simple") {
    const half = "width:50%;box-sizing:border-box;padding:3px;overflow:hidden;";
    return `<div style="display:flex;height:100%;">
      <section style="${half}border-right:1px solid #000;">
        <div>\u75c5\u6b77\u865f\u3000\u59d3\u540d\uff08\u6027\u5225\uff09\u8eab\u5206\u8b49\u3000\u751f\u65e5\uff08\u5e74\u9f61\uff09</div>
        <div>\u65e5\u671f\u3000\u79d1\u5225\u3000\u6848\u4ef6\u3000\u5361\u865f</div>
        <div>\u91ab\u5e2b\u3000\u85e5\u5e2b</div>
        <div style="border:1px solid #000;min-height:22px;margin-top:2px;">\u4e3b\u8a34</div>
        <div>\u75c5\u540d</div>
        <div style="border-top:1px dashed #000;margin-top:2px;">\u85e5\u540d\u3000\u6b21\u91cf\u3000\u9014\u5f91\u3000\u7528\u6cd5\u3000\u5929\u6578\u3000\u7e3d\u91cf</div>
        <div style="margin-top:6px;">\u8a3a\u9593\u3000\u554f\u8a3a\u865f\u3000\u85e5\u90e8\u3000\u6aa2\u9a57\u90e8</div>
        <div>\u62bc\u91d1\u3000\u639b\u865f\u8cbb\u3000\u90e8\u4efd\u8ca0\u64d4\u3000\u81ea\u8cbb</div>
        <div>\u61c9\u6536</div>
      </section>
      <section style="${half}">
        <div style="text-align:center;font-weight:bold;">\u85e5\u55ae\u5167\u5bb9\u8207\u9580\u8a3a\u8cbb\u7528\u660e\u7d30</div>
        <div>\u9662\u6240\u540d\u7a31\u3000\u5730\u5740</div>
        <div>\u9662\u4ee3\u3000\u96fb\u8a71</div>
        <div>\u59d3\u540d\u3000\u8eab\u5206\u8b49\u3000\u5361\u865f</div>
        <div>\u5c31\u8a3a\u65e5\u671f\u3000\u8abf\u5291\u65e5</div>
        <div>\u85e5\u5c40\u5730\u9ede\u3000\u8abf\u5291\u8005</div>
        <div style="border-top:1px solid #000;margin-top:2px;">\u85e5\u54c1\u540d\u7a31\u8207\u5291\u91cf\u55ae\u4f4d\u3000\u9014\u5f91\u3000\u6578\u91cf\u3000\u7e3d\u91cf\u3000\u670d\u7528\u65b9\u6cd5</div>
        <div style="margin-top:4px;">\uff0a\u8b66\u8a9e\u8207\u5efa\u8b70\u6a19\u793a\u9805\u76ee\uff0a</div>
        ${foot}
        <div style="margin-top:4px;">\u57fa\u672c\u8ca0\u64d4\u3000\u85e5\u8cbb\u8ca0\u64d4\u3000\u6aa2\u9a57\u8ca0\u64d4</div>
        <div>\u8a3a\u5bdf\u8cbb\u3000\u85e5\u54c1\u8cbb\u3000\u8a3a\u7642\u8cbb</div>
        <div>\u6aa2\u9a57\u8cbb\u3000\u85e5\u4e8b\u8cbb\u3000\u5408\u8a08</div>
        <div>\u8ca0\u64d4\u5408\u8a08\u3000\u7533\u8acb\u8cbb\u7528\u3000\u639b\u865f\u8cbb</div>
        <div>\u62bc\u91d1\u8cbb\u7528\u3000\u81ea\u8cbb\u3000\u8ca0\u64d4\u512a\u5f85</div>
        <div>\u5be6\u6536</div>
      </section>
    </div>`;
  }
  if (row.id === "referral") {
    return `<div style="border:1px solid #000;padding:8px;text-align:center;">
      <div style="font-weight:bold;">\u5168\u6c11\u5065\u5eb7\u4fdd\u96aa\u8f49\u8a3a\u55ae</div>
      <div style="text-align:left;margin-top:8px;">\u59d3\u540d\u3000\u8eab\u5206\u8b49\u3000\u8a3a\u65b7\u3000\u7528\u85e5\u3000\u8f49\u8a3a\u76ee\u7684\u3000\u539f\u9662\u6240\u91ab\u5e2b</div>
      <div style="margin-top:8px;font-size:10px;">\u7248\u9762\u56fa\u5b9a\u3002\u9019\u88e1\u53ea\u78ba\u8a8d\u7d19\u5f35\u6bd4\u4f8b\u3002</div>
    </div>`;
  }
  if (row.id === "certificate") {
    return `<div style="border:1px solid #000;padding:8px;">
      <div style="text-align:center;font-weight:bold;">\u8a3a\u65b7\u8b49\u660e\u66f8</div>
      <div style="margin-top:8px;">\u59d3\u540d\u3000\u75c5\u540d\u3000\u91ab\u5e2b\u56d1\u8a00</div>
      <div style="margin-top:8px;font-size:10px;">\u7248\u9762\u56fa\u5b9a\u3002\u9019\u88e1\u53ea\u78ba\u8a8d\u7d19\u5f35\u6bd4\u4f8b\u3002</div>
    </div>`;
  }
  if (row.id === "bag") {
    return `<div style="border:1px solid #000;padding:6px;">
      <div style="font-weight:bold;">\u85e5\u888b</div>
      <div>\u59d3\u540d</div>
      <div style="margin-top:6px;">\u85e5\u540d</div>
      <div>\u7528\u6cd5\u3000\u5929\u6578</div>
      ${foot}
    </div>`;
  }
  return `<div style="border:1px solid #000;padding:8px;">
    <div style="font-weight:bold;">${row.label}</div>
    <div style="margin-top:6px;">\u75c5\u6b77\u5167\u5bb9\u4f9d\u9019\u5f35\u7d19\u7684\u9577\u5bec\u6392\u5217\u3002</div>
    ${foot}
  </div>`;
}

export function PrintSetupPanel({ value, onChange }: Props) {
  const [printers, setPrinters] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = value.setups.find((row) => row.id === previewId) || null;

  useEffect(() => {
    let cancel = false;
    void fetchInstalledPrinters().then((names) => {
      if (!cancel) setPrinters(names);
    });
    return () => {
      cancel = true;
    };
  }, []);

  const patchRow = (id: PrintSetup["id"], patch: Partial<PrintSetup>) => {
    onChange({
      ...value,
      setups: value.setups.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    });
  };

  const tryPrint = (row: PrintSetup) => {
    openPrintPreview({
      kind: "report",
      setupId: row.id,
      title: `${row.label}\u9810\u89bd`,
      lines: [],
      bodyHtml: sampleHtml(row),
    });
  };

  const cell = "border border-[#808080] px-1 py-0.5 align-middle";
  const input = "w-full border border-[#808080] bg-white px-1 py-0 text-[12px]";

  return (
    <div className="space-y-2" style={{ fontFamily: HIS_FONT }}>
      <p className="text-[12px] leading-relaxed">
        {"\u6bcf\u4e00\u5217\u662f\u4e00\u7a2e\u55ae\u64da\u3002\u9577\u5bec\u7528\u6beb\u7c73\u3002\u5370\u8868\u6a5f\u540d\u7a31\u5b58\u5728\u9019\u53f0\u96fb\u8166\uff0c\u4e0d\u5b58\u5728\u8cc7\u6599\u4f3a\u670d\u5668\u3002\u6253\u958b\u9580\u8a3a\u6642\u5217\u5370\u6703\u8ddf\u8457\u8d77\u4f86\uff0c\u4e0d\u7528\u518d\u958b\u5225\u7684\u7a0b\u5f0f\u3002\u8a3a\u65b7\u8b49\u660e\u548c\u8f49\u8a3a\u55ae\u56fa\u5b9a A4 \u76f4\u5411\uff0c\u9577\u5bec\u4e0d\u80fd\u6539\uff0c\u53ea\u9078\u5370\u8868\u6a5f\u3002\u9001\u51fa\u53bb\u6642\u6703\u9396\u6210\u76f4\u5411\uff0c\u4e0d\u8ddf\u5370\u8868\u6a5f\u9810\u8a2d\u7684\u6a6b\u5411\u3002\u9019\u4e00\u5217\u6709\u9078\u5370\u8868\u6a5f\u6642\uff0c\u7531\u9019\u53f0\u96fb\u8166\u4e0a\u7684 SumatraPDF \u9001\u51fa\u53bb\u3002\u9019\u53f0\u9084\u6c92\u88dd\u6642\uff0c\u6309\u5217\u5370\u6703\u63d0\u793a\u8981\u5b89\u88dd\u3002"}
      </p>
      <table className="w-full border-collapse bg-white text-[12px]">
        <thead>
          <tr className="bg-[#ECE9D8] text-left">
            <th className={cell}>{"\u55ae\u64da"}</th>
            <th className={cell}>{"\u5bec mm"}</th>
            <th className={cell}>{"\u9577 mm"}</th>
            <th className={cell}>{"\u9810\u8a2d\u5370\u8868\u6a5f"}</th>
            <th className={cell}>{"\u8868\u5c3e"}</th>
            <th className={cell}>{"\u9810\u89bd"}</th>
          </tr>
        </thead>
        <tbody>
          {value.setups.map((row) => (
            <tr key={row.id}>
              <td className={`${cell} font-bold whitespace-nowrap`}>{row.label}</td>
              <td className={cell}>
                {row.layoutFixed ? (
                  <span className="font-mono text-[11px]">{row.widthMm}</span>
                ) : (
                  <input
                    className={input}
                    type="number"
                    min={40}
                    max={400}
                    step={0.1}
                    value={row.widthMm}
                    onChange={(e) => patchRow(row.id, { widthMm: Number(e.target.value) })}
                  />
                )}
              </td>
              <td className={cell}>
                {row.layoutFixed ? (
                  <span className="font-mono text-[11px]">{row.heightMm}</span>
                ) : (
                  <input
                    className={input}
                    type="number"
                    min={40}
                    max={500}
                    step={0.1}
                    value={row.heightMm}
                    onChange={(e) => patchRow(row.id, { heightMm: Number(e.target.value) })}
                  />
                )}
              </td>
              <td className={cell}>
                <input
                  className={input}
                  list="clinic-printers"
                  value={row.printerName}
                  placeholder={printers.length ? "\u9078\u6216\u8f38\u5165\u5370\u8868\u6a5f" : "\u8f38\u5165\u5370\u8868\u6a5f\u540d\u7a31"}
                  onChange={(e) => patchRow(row.id, { printerName: e.target.value })}
                />
              </td>
              <td className={cell}>
                {row.layoutFixed ? (
                  <span className="text-[11px] text-[#606060]">{"\u7248\u9762\u56fa\u5b9a"}</span>
                ) : (
                  <input
                    className={input}
                    value={row.footer}
                    onChange={(e) => patchRow(row.id, { footer: e.target.value })}
                  />
                )}
              </td>
              <td className={cell}>
                <button
                  type="button"
                  className="border border-[#808080] bg-[#D4D0C8] px-2 py-0 text-[12px] font-bold"
                  onClick={() => setPreviewId(row.id)}
                >
                  {"\u9810\u89bd"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <datalist id="clinic-printers">
        {printers.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <button
        type="button"
        className="text-[11px] font-bold underline"
        onClick={() =>
          onChange({
            ...value,
            setups: DEFAULT_PRINT_SETUPS.map((row) => ({ ...row })),
          })
        }
      >
        {"\u9084\u539f\u9019\u5f35\u8868\u7684\u9810\u8a2d\u9577\u5bec"}
      </button>
      {preview && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-3">
          <div
            className="flex max-h-[92vh] w-[min(52rem,96vw)] flex-col border bg-[#F0F0F0] shadow-lg"
            style={{ borderColor: "#404040" }}
          >
            <div className="flex items-center bg-[#2060A0] px-2 py-1 text-[12px] font-bold text-white">
              <span>
                {preview.label}
                {"\u3000"}
                {preview.widthMm} {"\u00d7"} {preview.heightMm} mm
                {preview.printerName
                  ? `\u3000\u5370\u8868\u6a5f ${preview.printerName}`
                  : "\u3000\u5c1a\u672a\u6307\u5b9a\u5370\u8868\u6a5f"}
              </span>
              <button type="button" className="ml-auto px-2" onClick={() => setPreviewId(null)}>
                {"\u95dc\u9589"}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <div
                className="mx-auto bg-white shadow"
                style={{
                  width: Math.min(640, preview.widthMm * 3.2),
                  height:
                    Math.min(640, preview.widthMm * 3.2) * (preview.heightMm / preview.widthMm),
                  border: "1px solid #000",
                  padding: 8,
                  boxSizing: "border-box",
                  overflow: "hidden",
                  fontSize: 11,
                }}
                dangerouslySetInnerHTML={{ __html: sampleHtml(preview) }}
              />
            </div>
            <div
              className="flex justify-end gap-2 border-t bg-[#ECE9D8] px-2 py-1"
              style={{ borderColor: "#808080" }}
            >
              <button
                type="button"
                className="border border-[#808080] bg-[#FFFFC0] px-3 py-0.5 text-[12px] font-bold"
                onClick={() => tryPrint(preview)}
              >
                {"\u7528\u9019\u500b\u5c3a\u5bf8\u8a66\u5370"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
