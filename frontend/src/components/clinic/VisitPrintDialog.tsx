import { HIS_FONT } from "@/lib/hisTheme";

type Props = {
  open: boolean;
  patientLabel: string;
  onClose: () => void;
  onDeposit: () => void;
  onReceipt: () => void;
};

export function VisitPrintDialog({ open, patientLabel, onClose, onDeposit, onReceipt }: Props) {
  if (!open) return null;
  const btn =
    "w-full border border-[#404040] bg-[#FFFFC0] px-3 py-2 text-left text-[13px] font-bold hover:bg-[#FFF6A0]";
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40">
      <div
        className="w-[22rem] border-2 bg-[#ECE9D8] p-3 shadow-lg"
        style={{ borderColor: "#404040", fontFamily: HIS_FONT }}
      >
        <h3 className="mb-1 text-[14px] font-bold">{"F6 \u5217\u5370"}</h3>
        <p className="mb-3 text-[12px]">{patientLabel || "\u9019\u4e00\u4f4d"}</p>
        <div className="space-y-2">
          <button type="button" className={btn} onClick={onDeposit}>
            {"1. \u62bc\u91d1\u55ae"}
          </button>
          <button type="button" className={btn} onClick={onReceipt}>
            {"2. \u9019\u6b21\u770b\u8a3a\u6536\u64da"}
          </button>
          <button
            type="button"
            className="w-full border border-[#808080] bg-white px-3 py-1 text-[12px] font-bold"
            onClick={onClose}
          >
            {"\u96e2\u958b"}
          </button>
        </div>
      </div>
    </div>
  );
}
