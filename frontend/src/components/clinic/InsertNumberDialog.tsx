import { useEffect } from "react";

type Props = {
  open: boolean;
  gap: number;
  onYes: () => void;
  onNo: () => void;
};

export function InsertNumberDialog({ open, gap, onYes, onNo }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        onYes();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onYes]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/45 p-3">
      <div className="w-[min(22rem,94vw)] overflow-hidden rounded border border-[#80C080] bg-[#E8F8E8] shadow-2xl">
        <header className="bg-[#004D00] px-3 py-1.5 text-xs font-black text-white">
          {"\u63d2\u5165\u5e8f\u865f"}
        </header>
        <p className="px-3 py-3 text-[13px] font-bold text-[#004D00]">
          {"\u662f\u5426\u8981\u63d2\u5165"} {gap} {"\u865f\uff1f"}
        </p>
        <p className="px-3 pb-2 text-[11px] text-[#335533]">
          {"\u6309\u300c\u662f\u300d\u63d2\u5165\u76ee\u524d\u7a7a\u865f\u6700\u5c0f\u7684\u90a3\u4e00\u865f\u3002\u6309\u300c\u5426\u300d\u6216 Esc \u5c31\u639b\u5728\u76ee\u524d\u6700\u5927\u865f\u7684\u4e0b\u4e00\u865f\u3002\u5b58\u6a94\u524d\u4ecd\u53ef\u6539\u3002"}
        </p>
        <footer className="flex gap-1 border-t border-[#80C080] bg-[#C5EBC5] px-2 py-1.5">
          <button
            type="button"
            className="rounded border border-[#004D00] bg-[#004D00] px-3 py-1 text-xs font-bold text-white"
            onClick={onYes}
          >
            {"\u662f\uff0c\u63d2\u5165"} {gap} {"\u865f"}
          </button>
          <button
            type="button"
            className="rounded border border-[#80C080] bg-white px-3 py-1 text-xs font-bold text-[#004D00]"
            onClick={onNo}
          >
            {"\u5426"}
          </button>
        </footer>
      </div>
    </div>
  );
}

export function AppointmentCheckInDialog({
  open,
  onYes,
  onNo,
}: {
  open: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      ev.stopPropagation();
      onYes();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onYes]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/45 p-3">
      <div className="w-[min(22rem,94vw)] overflow-hidden rounded border border-[#80C080] bg-[#E8F8E8] shadow-2xl">
        <header className="bg-[#004D00] px-3 py-1.5 text-xs font-black text-white">
          {"\u9810\u7d04\u5831\u5230"}
        </header>
        <p className="px-3 py-3 text-[13px] font-bold text-[#004D00]">
          {"\u9019\u4f4d\u5df2\u7d93\u6709\u9810\u7d04\u3002\u8981\u9810\u7d04\u5831\u5230\u55ce\uff1f"}
        </p>
        <p className="px-3 pb-2 text-[11px] text-[#335533]">
          {"\u6309\u300c\u662f\u300d\u6cbf\u7528\u9019\u500b\u5e8f\u865f\uff0c\u63a5\u8457\u5c31\u662f\u4e00\u822c\u639b\u865f\uff1a\u8b80\u5361\uff0c\u6216\u6c92\u5361\u5c31\u62bc\u91d1\u3001\u81ea\u8cbb\u3002\u5b58\u6a94\u5f8c\u9019\u4e00\u7b46\u9810\u7d04\u8b8a\u6210\u639b\u865f\uff0c\u865f\u78bc\u4e0d\u8b8a\u3002\u6309\u300c\u5426\u300d\u6216 Esc \u7559\u5728\u540d\u55ae\u3002"}
        </p>
        <footer className="flex gap-1 border-t border-[#80C080] bg-[#C5EBC5] px-2 py-1.5">
          <button
            type="button"
            className="rounded border border-[#004D00] bg-[#004D00] px-3 py-1 text-xs font-bold text-white"
            onClick={onYes}
          >
            {"\u662f\uff0c\u9810\u7d04\u5831\u5230"}
          </button>
          <button
            type="button"
            className="rounded border border-[#80C080] bg-white px-3 py-1 text-xs font-bold text-[#004D00]"
            onClick={onNo}
          >
            {"\u5426"}
          </button>
        </footer>
      </div>
    </div>
  );
}
