import { useState } from "react";
import { fixCardConsole, type CardConsoleStatus } from "@/api/clinicApi";

type Props = {
  onFixed?: (status: CardConsoleStatus | null, message: string) => void;
  compact?: boolean;
  variant?: "dark" | "light";
  label?: string;
};

export function CardConsoleDebugButton({ onFixed, compact = false, variant = "dark", label }: Props) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const runFix = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await fixCardConsole();
      const msg = result.message || (result.ok ? "\u8b80\u5361\u8edf\u9ad4\u5df2\u5c31\u7dd2\u3002" : "\u9664\u932f\u672a\u5b8c\u6210\u3002");
      setNote(msg);
      onFixed?.(result.status ?? null, msg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "\u9664\u932f\u5931\u6557";
      setNote(msg);
      onFixed?.(null, msg);
    } finally {
      setBusy(false);
    }
  };

  const btnClass =
    variant === "light"
      ? compact
        ? "px-2 py-0.5 text-[10px] border-sky-600/30 bg-white text-sky-900 hover:bg-sky-50"
        : "w-full px-2.5 py-1.5 text-[11px] border-sky-600/30 bg-white text-sky-900 hover:bg-sky-50"
      : compact
        ? "px-2 py-0.5 text-[10px] border-sky-400/50 bg-sky-500/15 text-sky-100 hover:bg-sky-500/25"
        : "w-full px-2.5 py-1.5 text-[11px] border-sky-400/40 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20";

  return (
    <div className={compact ? "mt-1.5" : "mt-2"} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={runFix}
        disabled={busy}
        className={"rounded-lg border font-bold transition active:scale-[0.98] disabled:opacity-60 " + btnClass}
      >
        {busy ? "\u9664\u932f\u4e2d\u2026" : label || "\u9664\u932f\uff08\u81ea\u52d5\u555f\u52d5\uff0f\u91cd\u555f\uff09"}
      </button>
      {note ? (
        <p
          className={"mt-1 text-[10px] leading-snug " + (variant === "light" ? "text-sky-900/80" : "text-sky-100/90")}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}

function cardStatusLabel(status: CardConsoleStatus | null): string {
  if (status == null) return "\u8b80\u53d6\u4e2d";
  if (status.reachable) return "\u6b63\u5e38";
  const action = status.fault?.deskAction;
  if (action === "start_software") return "\u672a\u555f\u52d5";
  if (action === "restart_software") return "\u9700\u91cd\u555f";
  return "\u672a\u9023\u7dda";
}

export { cardStatusLabel };
