type Props = {
  open: boolean;
  onClose: () => void;
  patientDisplay?: string;
  rows?: Array<{ name: string; date: string; result: string }>;
};

/** 醫聖 F6 放射科檢查。沒有影像報告就顯示 —，不編造。 */
export function RadiologyPanel({ open, onClose, patientDisplay, rows = [] }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-400 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <h2 className="text-sm font-bold text-slate-900">F6 放射科檢查</h2>
          <button type="button" className="rounded px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100" onClick={onClose}>
            關閉 ESC
          </button>
        </div>
        <div className="space-y-2 p-4 text-sm">
          <p className="text-slate-600">
            病患：<span className="font-semibold text-slate-900">{patientDisplay ?? "—"}</span>
          </p>
          {rows.length === 0 ? (
            <p className="rounded border border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-500">
              無放射檢查資料（—）。不編造報告、不上傳健保。
            </p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b text-slate-500">
                  <th className="py-1">檢查</th>
                  <th>日期</th>
                  <th>結果</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.name}-${i}`} className="border-b border-slate-100">
                    <td className="py-1">{r.name || "—"}</td>
                    <td>{r.date || "—"}</td>
                    <td>{r.result || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
