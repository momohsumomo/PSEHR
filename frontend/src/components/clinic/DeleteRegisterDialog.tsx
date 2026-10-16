import { useEffect } from "react";

type Props = {
  open: boolean;
  busy?: boolean;
  error?: string | null;
  patientDisplay?: string;
  hasTreatSeq?: boolean;
  onClose: () => void;
  onDelete: (mode: "local" | "ic" | "both") => Promise<void>;
};

/**
 * 醫聖刪除掛號：刪除 / 退IC / 刪除+退IC / 取消。
 */
export function DeleteRegisterDialog({
  open,
  busy,
  error,
  patientDisplay,
  hasTreatSeq,
  onClose,
  onDelete,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const btn =
    "border px-2 py-0.5 text-[11px] font-bold disabled:opacity-50";

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40">
      <div
        className="w-[min(28rem,94%)] overflow-hidden border text-[12px] shadow"
        style={{ borderColor: "#808080", background: "#D4D0C8" }}
      >
        <header
          className="border-b px-2 py-0.5 text-[12px] font-bold"
          style={{ borderColor: "#808080", background: "#ECE9D8" }}
        >
          {"\u522a\u9664\u639b\u865f"}
        </header>
        <div className="space-y-1 p-2 text-[12px]">
          <p>
            {"\u522a\u9664"}{" "}
            <span className="font-bold">{patientDisplay || "\u6240\u9078\u75c5\u60a3"}</span>{" "}
            {"\u9019\u4e00\u7b46\u639b\u865f\uff1f"}
          </p>
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-[#404040]">
            <li>
              <b>{"\u522a\u9664"}</b>
              {"\uff1a\u53ea\u6e05\u672c\u6a5f\u7576\u5929\u6e05\u55ae\uff08\u75c5\u6b77\u6a19\u6210\u5df2\u53d6\u6d88\uff0c\u4e0d\u6703\u780d\u75c5\u6b77\uff0f\u76f8\u7247\uff09\u3002"}
            </li>
            <li>
              <b>{"\u9000IC"}</b>
              {"\uff1a\u53ea\u5411\u5065\u4fdd\u5c40\u9000\u639b\u5c31\u91ab\u5e8f\u865f\uff0c\u6e05\u55ae\u9084\u5728\u3002"}
            </li>
            <li>
              <b>{"\u522a\u9664+\u9000IC"}</b>
              {"\uff1a\u5169\u500b\u4e00\u8d77\u505a\uff1b\u9000\u639b\u5931\u6557\u5247\u672c\u6a5f\u4e5f\u4e0d\u522a\u3002"}
            </li>
          </ul>
          <p className="border border-[#808080] bg-[#FFFFCC] px-1 py-0.5 text-[11px]">
            {"\u5982\u679c\u6b64\u4eba\u5df2\u7d93\u639b\u5169\u79d1\u4ee5\u4e0a\u4e14\u4e4b\u524d\u5df2\u9000\u639b IC\uff0c\u672c\u6b21\u4e0d\u8981\u518d\u9078\u9000 IC\u3002"}
          </p>
          {!hasTreatSeq && (
            <p className="text-[11px] text-[#800000]">
              {"\u672c\u7b46\u6c92\u6709\u5c31\u91ab\u5e8f\u865f\uff0c\u9000 IC \u6703\u5931\u6557\u3002\u82e5\u53ea\u662f\u8981\u6e05\u6e05\u55ae\uff0c\u8acb\u6309\u300c\u522a\u9664\u300d\u3002"}
            </p>
          )}
          {error && <p className="text-[#800000]">{error}</p>}
        </div>
        <footer
          className="flex items-center gap-1 border-t px-1 py-1"
          style={{ borderColor: "#808080", background: "#D4D0C8" }}
        >
          <button
            type="button"
            disabled={busy}
            className={btn}
            style={{ borderColor: "#808080", background: "#FF6B6B" }}
            onClick={() => void onDelete("local")}
          >
            {"\u522a\u9664"}
          </button>
          <button
            type="button"
            disabled={busy}
            className={btn}
            style={{ borderColor: "#808080", background: "#FFFF80" }}
            onClick={() => void onDelete("ic")}
          >
            {"\u9000IC"}
          </button>
          <button
            type="button"
            disabled={busy}
            className={btn}
            style={{ borderColor: "#808080", background: "#DDA0DD" }}
            onClick={() => void onDelete("both")}
          >
            {"\u522a\u9664+\u9000IC"}
          </button>
          <button
            type="button"
            disabled={busy}
            className={btn}
            style={{ borderColor: "#808080", background: "#fff" }}
            onClick={onClose}
          >
            <span className="font-mono text-[10px]">Esc</span> {"\u53d6\u6d88"}
          </button>
        </footer>
      </div>
    </div>
  );
}
