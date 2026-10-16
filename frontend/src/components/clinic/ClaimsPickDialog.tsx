import { HisXpDialog } from "@/components/clinic/HisPageFrame";

type Props = {
  open: boolean;
  onClose: () => void;
  onDaily: () => void;
  onCheck: () => void;
  onBuild: () => void;
};

function Choice({
  index,
  title,
  onClick,
}: {
  index: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 border px-2 py-1.5 text-left hover:bg-white"
      style={{ borderColor: "#808080", background: "#f4f1e6" }}
      onClick={onClick}
    >
      <span className="w-4 font-bold">{index}</span>
      <span className="font-bold">{title}</span>
    </button>
  );
}

/** 申報三選一，蓋在主畫面上，不換頁。 */
export function ClaimsPickDialog({ open, onClose, onDaily, onCheck, onBuild }: Props) {
  return (
    <HisXpDialog open={open} title="申報作業" onClose={onClose} width={320}>
      <div className="flex flex-col gap-1.5 text-[13px] text-black">
        <Choice index="1" title="每日上傳資料" onClick={onDaily} />
        <Choice index="2" title="檢查申報資料" onClick={onCheck} />
        <Choice index="3" title="製作申報格式" onClick={onBuild} />
      </div>
    </HisXpDialog>
  );
}
