import { useState } from "react";
import { startLocalCard6, type CardConsoleStatus } from "@/api/clinicApi";
import { DeskCardError, refreshLocalReader } from "@/lib/localCard";

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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

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
          const next = !open;
          setOpen(next);
          if (next) void load();
        }}
      >
        {label || "\u91cd\u65b0\u6574\u7406\u8b80\u5361\u6a5f"}
      </button>
      {open ? (
        <div
          className={
            "absolute z-50 mt-1 w-72 space-y-1 rounded border p-2 text-[12px] shadow-lg " +
            (align === "end" ? "right-0 " : "left-0 ") +
            (light ? "border-sky-700 bg-white text-black" : "border-sky-300/40 bg-slate-900 text-sky-50")
          }
        >
          {note ? <p className="leading-snug">{note}</p> : null}
          <div className="flex gap-1">
            <button type="button" disabled={busy} className="border bg-white px-2 py-0.5 text-black disabled:opacity-60" onClick={() => void load()}>
              {"\u518d\u6574\u7406\u4e00\u6b21"}
            </button>
            {note.indexOf("\u6c92\u6709\u56de\u61c9") >= 0 ? (
              <button
                type="button"
                className="border bg-white px-2 py-0.5 text-black"
                onClick={() => {
                  void startLocalCard6().then((msg) => setNote(msg)).catch((err: unknown) => {
                    setNote(err instanceof DeskCardError || err instanceof Error ? err.message : "\u8b80\u5361\u8edf\u9ad4\u6c92\u958b\u8d77\u4f86");
                  });
                }}
              >
                {"\u958b\u555f\u9019\u53f0\u7684\u8b80\u5361\u8edf\u9ad4"}
              </button>
            ) : null}
          </div>
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
