export type QueueRegisterForm = {
  idNo: string;
  birthday: string;
  sex: string;
  patientName: string;
  reasonText: string;
};

type Props = {
  searchQuery: string;
  onSearchChange: (query: string) => void;
};

/** 醫聖清單上方只留搜尋；IC讀卡／掛號／刪除走底列同一套鈕。 */
export function QueueRegisterStrip({ searchQuery, onSearchChange }: Props) {
  return (
    <div id="clinic-f2-register" className="border-b border-slate-300 bg-slate-50 px-2 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-bold text-slate-800">當天掛號</span>
        <input
          type="search"
          placeholder="搜尋姓名 / 病歷 / 主述…"
          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-0.5 text-xs"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
    </div>
  );
}
