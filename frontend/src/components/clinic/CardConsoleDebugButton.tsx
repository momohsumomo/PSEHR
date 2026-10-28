import { useState } from "react";
import { type CardConsoleStatus } from "@/api/clinicApi";
import { refreshLocalReader } from "@/lib/localCard";
import { useFlashNote } from "@/components/clinic/useFlashNote";

type Props = {
  onFixed?: (status: CardConsoleStatus | null, message: string) => void;
  compact?: boolean;
  variant?: "dark" | "light";
  label?: string;
  scope?: "host" | "local";
  align?: "start" | "end";
};

export function CardConsoleDebugButton({
  onFixed,
  compact = false,
  variant = "dark",
  label,
  align = "start",
}: Props) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useFlashNote();

  const light = variant === "light";
  const btnClass = light
    ? "rounded border border-sky-700 bg-white px-2 py-0.5 text-[12px] font-bold text-sky-950"
    : "rounded border border-sky-300/40 bg-sky-500/15 px-2 py-0.5 text-[12px] font-bold text-sky-100";

  const load = async () => {
    setBusy(true);
    setNote("\u6b63\u5728\u653e\u958b\u8b80\u5361\u6a5f\uff0c\u8acb\u7a0d\u5019\u3002");
    try {
      const found = await refreshLocalReader();
      setNote(found.note);
      onFixed?.(null, found.note);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "\u8b80\u5361\u6a5f\u6e05\u55ae\u5931\u6557");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={compact ? "relative" : "relative mt-2"} onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        disabled={busy}
        className={btnClass + " disabled:opacity-60"}
        onClick={() => {
          void load();
        }}
      >
        {label || "\u91cd\u65b0\u6574\u7406\u8b80\u5361\u6a5f"}
      </button>
      {note ? (
        <div
          className={
            "absolute z-50 mt-1 w-72 rounded border p-2 text-[12px] leading-snug shadow-lg " +
            (align === "end" ? "right-0 " : "left-0 ") +
            (light ? "border-sky-700 bg-white text-black" : "border-sky-300/40 bg-slate-900 text-sky-50")
          }
        >
          {note}
        </div>
      ) : null}
    </div>
  );
}

function cardStatusLabel(status: CardConsoleStatus | null): string {
  if (status == null) return "\u8b80\u53d6\u4e2d";
  if (status.reachable) return "\u6b63\u5e38";
  return "\u672a\u9023\u7dda";
}

export { cardStatusLabel };
