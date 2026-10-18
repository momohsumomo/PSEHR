/** 醫聖掛號作業底列：圖示列 11 + 文字列 11。未接的先留位置，不准假裝成功。 */

const BTN =
  "min-w-0 flex-1 rounded border border-[#80C080] bg-white px-1 py-1 text-center text-[11px] font-bold leading-tight text-[#004D00] hover:bg-[#E8F8E8] disabled:cursor-not-allowed disabled:opacity-40";

type Tool = {
  id: string;
  label: string;
};

/** 對 SC32：RECEIPTS / DELREG / SEEKNOIC / READER / PRNLABLE / SWAP / UPLOAD / EX / OutPei / ChgRx / SCHEDULE */
const ICON_TOOLS: Tool[] = [
  { id: "receipt", label: "印收據" },
  { id: "delete", label: "刪除掛號" },
  { id: "deposit", label: "未退押" },
  { id: "reader", label: "讀卡認證" },
  { id: "label", label: "病歷標簽" },
  { id: "swap", label: "完診/未完診" },
  { id: "upload", label: "日上傳" },
  { id: "vaccineShot", label: "預防注射" },
  { id: "referral", label: "轉診" },
  { id: "chgRx", label: "改藥師" },
  { id: "schedule", label: "預約名單" },
];

const TEXT_TOOLS: Tool[] = [
  { id: "vaccine", label: "疫苗查詢[&V]" },
  { id: "child", label: "兒童發展篩檢" },
  { id: "virtual", label: "虛擬掛號[&H]" },
  { id: "chronic", label: "慢箋資訊[&C]" },
  { id: "prebook", label: "預掛[&F]" },
  { id: "addPatient", label: "病患新增[&A]" },
  { id: "editPatient", label: "病患修改[&E]" },
  { id: "sale", label: "銷售[&S]" },
  { id: "refund", label: "異常退押[&I]" },
  { id: "track", label: "試辦追蹤[&K]" },
  { id: "cancel", label: "取消[&X]" },
];

type Props = {
  onTool: (id: string) => void;
  /** 診療作業多一顆掛號：進門已選藥師，直接開掛號編輯 */
  leadingIcons?: Tool[];
};

export function HisRegisterToolBar({ onTool, leadingIcons = [] }: Props) {
  const icons = [...leadingIcons, ...ICON_TOOLS];
  return (
    <div className="shrink-0 border-t border-[#80C080] bg-[#C5EBC5] px-1 py-1">
      <div className="flex gap-0.5">
        {icons.map((b) => (
          <button
            key={b.id}
            type="button"
            title={b.id === "reader" ? "IC讀卡／取號" : undefined}
            className={BTN}
            onClick={() => onTool(b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>
      <div className="mt-0.5 flex gap-0.5">
        {TEXT_TOOLS.map((b) => (
          <button
            key={b.id}
            type="button"
            className={BTN}
            onClick={() => onTool(b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export const QUEUE_FILTERS = [
  { id: "all", label: "全部病歷" },
  { id: "finished", label: "完診病歷" },
  { id: "hold", label: "暫診病歷" },
  { id: "er", label: "急診病歷" },
  { id: "waiting", label: "待診病歷" },
] as const;

export type QueueFilterId = (typeof QUEUE_FILTERS)[number]["id"];

/** 掛號清單欄（對齊醫聖掛號作業 default） */
export const REGI_COLUMNS: { key: string; label: string }[] = [
  { key: "doneMark", label: "\u5b8c" },
  { key: "deptSlot", label: "部" },
  { key: "queueNumber", label: "序號" },
  { key: "slotTime", label: "時間" },
  { key: "medicalNo", label: "病歷號" },
  { key: "patientDisplay", label: "姓名" },
  { key: "sex", label: "性別" },
  { key: "shift", label: "時段" },
  { key: "dept", label: "科別" },
  { key: "room", label: "診間" },
  { key: "note", label: "註" },
  { key: "preVisit", label: "預" },
  { key: "caseNo", label: "案" },
  { key: "paperCard", label: "紙卡" },
  { key: "copayCode", label: "部(代)" },
  { key: "copay", label: "自付" },
  { key: "deposit", label: "押金" },
  { key: "regFee", label: "掛號" },
  { key: "drugFee", label: "藥優" },
  { key: "collected", label: "已收調劑" },
];
