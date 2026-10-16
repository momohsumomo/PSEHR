import { useEffect, useState } from "react";
import { useEscLayer } from "@/hooks/useEscLayer";
import { createPortal } from "react-dom";
import {
  fetchIdCategorySettings,
  saveIdCategorySettings,
  type IdCategorySetting,
} from "@/api/clinicApi";
import { HIS_FONT } from "@/lib/hisTheme";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved?: (rows: IdCategorySetting[]) => void;
  onPick?: (code: string) => void;
};

function blankRow(): IdCategorySetting {
  return { code: "", deposit: 0, reg_fee: 0, copay: 0, is_default: 0 };
}

export function IdCategoryTableDialog({ open, onClose, onSaved, onPick }: Props) {
  const [rows, setRows] = useState<IdCategorySetting[]>([]);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEscLayer([{ open, close: onClose }]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void fetchIdCategorySettings()
      .then((list) => {
        setRows(list.length ? list.map((r) => ({ ...r })) : [blankRow()]);
        setSel(0);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "\u8b80\u4e0d\u5230\u8eab\u5206\u985e\u5225\u8868"));
  }, [open]);

  if (!open) return null;

  const patch = (idx: number, next: Partial<IdCategorySetting>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...next } : r)));
  };

  const setDefault = (idx: number, on: boolean) => {
    setRows((prev) => prev.map((r, i) => ({ ...r, is_default: on && i === idx ? 1 : 0 })));
  };

  const save = async () => {
    const cleaned = rows.map((r) => ({ ...r, code: r.code.trim() })).filter((r) => r.code);
    if (!cleaned.length) {
      setError("\u81f3\u5c11\u8981\u6709\u4e00\u500b\u8eab\u5206\u985e\u5225");
      return;
    }
    const codes = new Set<string>();
    for (const r of cleaned) {
      if (codes.has(r.code)) {
        setError("\u8eab\u5206\u985e\u5225\u91cd\u8907\uff1a" + r.code);
        return;
      }
      codes.add(r.code);
    }
    setBusy(true);
    setError(null);
    try {
      await saveIdCategorySettings(cleaned);
      onSaved?.(cleaned);
      const picked = cleaned[Math.min(sel, cleaned.length - 1)];
      if (picked && onPick) onPick(picked.code);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "\u5b58\u6a94\u5931\u6557");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/35">
      <div
        className="flex max-h-[80vh] w-[min(36rem,94vw)] flex-col border-2 bg-[#E8F8C8] shadow-xl"
        style={{ borderColor: "#404040", fontFamily: HIS_FONT }}
      >
        <header className="flex items-center justify-between bg-[#D8E8A8] px-2 py-1 text-[12px] font-bold">
          <span>身份類別（押金／掛號費／部份負擔）</span>
          <button type="button" className="px-1" onClick={onClose}>
            {"\u2715"}
          </button>
        </header>
        <p className="px-2 py-1 text-[11px] text-[#404000]">
          這三欄是要收的金額。優待是少收，不放在這裡。掛號費若和診所不同，直接改數字後按確定。
        </p>
        {error ? <p className="bg-red-100 px-2 py-1 text-[12px] text-red-800">{error}</p> : null}
        <div className="min-h-0 flex-1 overflow-auto px-2">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-[#C8D898]">
              <tr>
                <th className="border border-[#808080] px-1">身分類別</th>
                <th className="border border-[#808080] px-1">押金金額</th>
                <th className="border border-[#808080] px-1">掛號費</th>
                <th className="border border-[#808080] px-1">部份負擔</th>
                <th className="border border-[#808080] px-1">{"\u9810\u8a2d"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr
                  key={`${idx}-${r.code}`}
                  style={{ background: idx === sel ? "#FFFF80" : idx % 2 ? "#F4FFE4" : "#fff" }}
                  onClick={() => setSel(idx)}
                >
                  <td className="border border-[#A0A080] p-0">
                    <input
                      className="w-full bg-transparent px-1 py-0.5 font-bold outline-none"
                      value={r.code}
                      onChange={(e) => patch(idx, { code: e.target.value })}
                    />
                  </td>
                  {(["deposit", "reg_fee", "copay"] as const).map((key) => (
                    <td key={key} className="border border-[#A0A080] p-0">
                      <input
                        className="w-full bg-transparent px-1 py-0.5 text-right font-mono outline-none"
                        value={String(r[key] ?? 0)}
                        onChange={(e) =>
                          patch(idx, { [key]: Number(e.target.value.replace(/[^\d.-]/g, "")) || 0 })
                        }
                      />
                    </td>
                  ))}
                  <td className="border border-[#A0A080] text-center">
                    <input
                      type="checkbox"
                      checked={Boolean(r.is_default)}
                      onChange={(e) => setDefault(idx, e.target.checked)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer className="flex justify-end gap-2 px-2 py-2">
          <button
            type="button"
            className="border px-3 py-1 text-[12px] font-bold"
            style={{ borderColor: "#808080", background: "#E0E0E0" }}
            onClick={() => setRows((prev) => [...prev, blankRow()])}
          >
            {"\u65b0\u589e"}
          </button>
          <button
            type="button"
            className="border px-3 py-1 text-[12px] font-bold"
            style={{ borderColor: "#808080", background: "#E0E0E0" }}
            onClick={() => setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== sel)))}
          >
            {"\u522a\u9664"}
          </button>
          <button
            type="button"
            disabled={busy}
            className="border px-3 py-1 text-[12px] font-bold disabled:opacity-50"
            style={{ borderColor: "#808080", background: "#C8E8A0" }}
            onClick={() => void save()}
          >
            {"\u78ba\u5b9a"}
          </button>
          <button
            type="button"
            className="border px-3 py-1 text-[12px] font-bold"
            style={{ borderColor: "#808080", background: "#E0E0E0" }}
            onClick={onClose}
          >
            {"\u96e2\u958b"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
