/** 醫聖會跳出的子視窗骨架。欄位可先空（—）；不假裝已上傳／已收案／已列印。 */

export type HisStubId =
  | "receipt"
  | "deposit"
  | "label"
  | "upload"
  | "vaccineShot"
  | "referral"
  | "chgRx"
  | "schedule"
  | "vaccine"
  | "child"
  | "virtual"
  | "chronic"
  | "sale"
  | "refund"
  | "track"
  | "icCard"
  | "quickPrice"
  | "prebookParam";

type Spec = {
  title: string;
  note: string;
  fields: string[];
  table?: string[];
};

export const HIS_STUB_SPECS: Record<HisStubId, Spec> = {
  receipt: {
    title: "印收據",
    note: "RECEIPTS。未接印表機＝不送列印命令。",
    fields: ["收據抬頭", "病歷號", "姓名", "看診日", "掛號費", "藥費", "材料費", "診察費", "已收", "未收"],
  },
  deposit: {
    title: "調閱未退押資料",
    note: "SEEKNOIC。沒有記錄就顯示尚未有退押的記錄。",
    fields: ["病歷號", "姓名", "看診日", "押金", "欠卡資訊", "IC 卡序", "IC 案件"],
    table: ["看診日", "姓名", "押金", "狀態"],
  },
  label: {
    title: "列印病歷標簽",
    note: "PRNLABLE。標籤機未接＝不送列印。",
    fields: ["病歷號", "姓名", "身分證", "生日", "張數", "紙張長度(mm)"],
  },
  upload: {
    title: "日上傳",
    note: "Upload.Exe 入口。只組檔／檢查清單；不上診所 VPN、不假裝 SAM／簽章成功。",
    fields: ["上傳日期", "筆數", "案件", "組檔狀態"],
    table: ["序號", "姓名", "就醫序號", "狀態"],
  },
  vaccineShot: {
    title: "預防注射",
    note: "EX。接種紀錄未進 FHIR 則 —。",
    fields: ["疫苗名稱", "批號", "接種日", "劑次", "備註"],
    table: ["日期", "疫苗", "批號", "劑次"],
  },
  referral: {
    title: "轉診單",
    note: "OutPei／Refe.exe。正式出口＝組檔給人用診所健保 VPN；不假裝已傳送。",
    fields: ["轉出代碼", "轉入醫院", "轉入科", "病患", "診斷", "摘要", "有效天數"],
  },
  chgRx: {
    title: "更改本時段的藥師",
    note: "ChgRx。尚未寫回批價藥師。",
    fields: ["時段", "目前藥師", "更改為藥師代碼", "藥師姓名"],
  },
  schedule: {
    title: "預約名單",
    note: "SCHEDULE。",
    fields: ["預約日", "時段", "診間"],
    table: ["序號", "時間", "姓名", "病歷號", "備註"],
  },
  vaccine: {
    title: "疫苗查詢",
    note: "疫苗查詢[&V]。",
    fields: ["身分證", "姓名", "疫苗名稱"],
    table: ["接種日", "疫苗", "批號", "院所"],
  },
  child: {
    title: "兒童發展篩檢",
    note: "篩檢結果未進資源則 —。暫存≠VPN 收案。",
    fields: ["姓名", "生日", "月齡", "篩檢項目", "結果", "轉介"],
  },
  virtual: {
    title: "虛擬掛號",
    note: "虛擬掛號[&H]。不能一次選兩筆。",
    fields: ["病歷號", "姓名", "看診日", "時段", "虛擬原因"],
  },
  chronic: {
    title: "慢箋資訊",
    note: "慢箋資訊[&C]。",
    fields: ["慢箋序", "開立日", "剩餘次數", "可調日", "藥品"],
    table: ["藥名", "用量", "天數", "次數"],
  },
  sale: {
    title: "銷售",
    note: "銷售[&S]。診療作業的掛號視窗銷售功能；未接收銀。",
    fields: ["品項", "數量", "單價", "金額", "備註"],
    table: ["品項", "數量", "單價", "小計"],
  },
  refund: {
    title: "異常退押",
    note: "異常退押[&I]。",
    fields: ["病歷號", "姓名", "押金", "退押原因", "IC 狀態"],
  },
  track: {
    title: "試辦追蹤",
    note: "試辦追蹤[&K]。條件由院所確認；不保證指標、不代操 VPN 收案。",
    fields: ["計畫名稱", "收案日", "狀態", "備註"],
    table: ["病歷號", "姓名", "收案日", "狀態"],
  },
  icCard: {
    title: "IC卡內容資訊",
    note: "His4／完診 SayData：IC卡內容資訊[F8]。沒讀到卡就 —，不編造就醫序號。",
    fields: [
      "卡號",
      "姓名",
      "身分證",
      "生日",
      "性別",
      "就醫序號",
      "就醫識別碼",
      "卡片有效期",
      "重大傷病",
      "就醫日期時間",
    ],
  },
  quickPrice: {
    title: "快速批價",
    note: "完診進入批價。金額未批則 —；不寫現金帳。",
    fields: ["掛號費", "藥品費", "材料費", "診察費", "診療負擔", "已收", "未收", "藥師"],
  },
  prebookParam: {
    title: "預掛參數編輯輸入視窗",
    note: "預掛起始號碼／每次跳號。實際預掛請用底列 預掛。",
    fields: ["預掛起始號碼", "每次跳號", "預掛日", "時段"],
  },
};

type Props = {
  stubId: HisStubId | null;
  patientDisplay?: string;
  values?: Record<string, string>;
  onClose: () => void;
};

export function HisStubDialog({ stubId, patientDisplay, values = {}, onClose }: Props) {
  if (!stubId) return null;
  const spec = HIS_STUB_SPECS[stubId];
  if (!spec) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-[min(42rem,96vw)] flex-col overflow-hidden rounded border border-[#80C080] bg-[#D4ECD4] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between bg-[#004D00] px-3 py-1.5 text-xs font-black text-white">
          <h2>{spec.title}</h2>
          <button type="button" className="rounded px-2 py-0.5 hover:bg-green-800" onClick={onClose}>
            Esc 關閉
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto bg-[#E8F8E8] p-3 text-[11px] text-[#004D00]">
          {patientDisplay ? (
            <p className="mb-2 font-bold">
              病患：<span className="font-mono">{patientDisplay}</span>
            </p>
          ) : null}
          <p className="mb-2 rounded border border-[#80C080] bg-white px-2 py-1 text-[10px] text-[#004D00]">
            {spec.note}　內部細節後續再接；缺資料顯示 —。
          </p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {spec.fields.map((label) => (
              <label key={label} className="flex items-center gap-1 font-bold">
                <span className="w-28 shrink-0">{label}</span>
                <input
                  readOnly
                  className="min-w-0 flex-1 rounded border border-[#80C080] bg-white px-1.5 py-0.5 font-mono font-normal"
                  value={values[label]?.trim() || "—"}
                />
              </label>
            ))}
          </div>
          {spec.table && (
            <table className="mt-3 w-full border-collapse bg-white text-left">
              <thead>
                <tr className="bg-[#C5EBC5]">
                  {spec.table.map((h) => (
                    <th key={h} className="border border-[#80C080] px-1.5 py-1">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {spec.table.map((h) => (
                    <td key={h} className="border border-[#C5EBC5] px-1.5 py-1 text-[#666]">
                      —
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          )}
        </div>
        <footer className="flex shrink-0 gap-1 border-t border-[#80C080] bg-[#C5EBC5] px-2 py-1.5">
          <button
            type="button"
            className="rounded border border-[#80C080] bg-white px-3 py-1 text-xs font-bold text-[#004D00]"
            onClick={onClose}
          >
            確定
          </button>
          <button
            type="button"
            className="rounded border border-[#80C080] bg-white px-3 py-1 text-xs font-bold text-[#004D00]"
            onClick={onClose}
          >
            取消[&C]
          </button>
        </footer>
      </div>
    </div>
  );
}

export const HIS_TOOL_STUB_IDS: HisStubId[] = [
  "receipt",
  "deposit",
  "label",
  "upload",
  "vaccineShot",
  "referral",
  "chgRx",
  "schedule",
  "vaccine",
  "child",
  "virtual",
  "chronic",
  "sale",
  "refund",
  "track",
];

export function isHisStubId(id: string): id is HisStubId {
  return id in HIS_STUB_SPECS;
}
