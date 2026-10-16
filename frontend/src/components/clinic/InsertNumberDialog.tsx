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
