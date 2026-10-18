import { useEffect, useState } from "react";
import { fetchInstalledPrinters } from "@/api/clinicApi";
import { PrintFormatDialog } from "@/components/clinic/PrintFormatDialog";
import {
  DEFAULT_PRINT_SETUPS,
  paperDirectionLabel,
  paperSizeEditable,
  savePrintSettings,
  type PrintSettings,
  type PrintSetup,
  type PrintSetupId,
} from "@/lib/printSettings";
import { HIS_FONT } from "@/lib/hisTheme";

type Props = {
  value: PrintSettings;
  onChange: (next: PrintSettings) => void;
};

export function PrintSetupPanel({ value, onChange }: Props) {
  const [printers, setPrinters] = useState<string[]>([]);
  const [editId, setEditId] = useState<PrintSetupId | null>(null);
  const editing = value.setups.find((row) => row.id === editId) || null;

  const commitEdit = (patch: Partial<PrintSetup>) => {
    if (!editId) return;
    const next: PrintSettings = {
      ...value,
      setups: value.setups.map((row) => (row.id === editId ? { ...row, ...patch } : row)),
    };
    onChange(next);
    savePrintSettings(next);
  };

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

  const cell = "border border-[#808080] px-1 py-0.5 align-middle";
  const input = "w-full border border-[#808080] bg-white px-1 py-0 text-[12px]";

  return (
    <div className="space-y-2" style={{ fontFamily: HIS_FONT }}>
      <p className="text-[12px] leading-relaxed">
        {"\u9ede\u55ae\u64da\u540d\u7a31\u6216\u8a2d\u5b9a\u3002\u7c21\u5f0f\u548c\u62bc\u91d1\u55ae\u53ea\u5217\u9019\u5f35\u55ae\u771f\u6b63\u6703\u7528\u7684\u9805\u76ee\uff0c\u52fe\u4e86\u6309\u5b58\u6a94\uff0c\u4e0b\u6b21\u5370\u5c31\u8ddf\u8457\u8b8a\u3002"}
      </p>
      <table className="w-full border-collapse bg-white text-[12px]">
        <thead>
          <tr className="bg-[#ECE9D8] text-left">
            <th className={cell}>{"\u55ae\u64da"}</th>
            <th className={cell}>{"\u5bec mm"}</th>
            <th className={cell}>{"\u9577 mm"}</th>
            <th className={cell}>{"\u65b9\u5411"}</th>
            <th className={cell}>{"\u9810\u8a2d\u5370\u8868\u6a5f"}</th>
            <th className={cell}>{"\u8a2d\u5b9a"}</th>
            <th className={cell}>{"\u9810\u89bd"}</th>
          </tr>
        </thead>
        <tbody>
          {value.setups.map((row) => (
            <tr key={row.id}>
              <td className={`${cell} whitespace-nowrap`}>
                <button
                  type="button"
                  className="font-bold underline"
                  onClick={() => setEditId(row.id)}
                >
                  {row.label}
                </button>
              </td>
              <td className={cell}>
                {!paperSizeEditable(row) ? (
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
                {!paperSizeEditable(row) ? (
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
              <td className={`${cell} whitespace-nowrap font-bold`}>
                {paperDirectionLabel(row.widthMm, row.heightMm)}
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
                <button
                  type="button"
                  className="border border-[#808080] bg-[#D4D0C8] px-2 py-0 text-[12px] font-bold"
                  onClick={() => setEditId(row.id)}
                >
                  {"\u8a2d\u5b9a"}
                </button>
              </td>
              <td className={cell}>
                <button
                  type="button"
                  className="border border-[#808080] bg-[#D4D0C8] px-2 py-0 text-[12px] font-bold"
                  onClick={() => setEditId(row.id)}
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
      {editing && (
        <PrintFormatDialog
          row={editing}
          printers={printers}
          onClose={() => setEditId(null)}
          onSaved={commitEdit}
        />
      )}
    </div>
  );
}
