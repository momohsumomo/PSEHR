import { useEffect, useState } from "react";
import { DeskCardError, refreshLocalReader } from "@/lib/localCard";
import { useFlashNote } from "@/components/clinic/useFlashNote";

type Pair = {
  card6Installed?: boolean;
  card6Running?: boolean;
  fiveInstalled?: boolean;
  fiveRunning?: boolean;
  shield?: boolean;
  sixResult?: string;
  fiveResult?: string;
};

const HELPER = "http://127.0.0.1:5310";

async function callPair(action: "ensure" | "restart6" | "restart5"): Promise<Pair> {
  const res = await fetch(HELPER + "/tools/card-pair?action=" + action, {
    method: "POST",
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error("down");
  return (await res.json()) as Pair;
}

function ensureText(data: Pair): string {
  const bits: string[] = [];
  if (!data.card6Installed) {
    bits.push("\u9019\u53f0\u6c92\u6709\u5b89\u88dd\u8b80\u5361\u8edf\u9ad4 6.0\u3002\u8981\u5f9e\u5065\u4fdd\u5c08\u7db2\u5b89\u88dd\uff0c\u9019\u88e1\u4e0d\u6703\u81ea\u5df1\u4e0b\u8f09\u3002");
  }
  if (!data.fiveInstalled) {
    bits.push("\u9019\u53f0\u6c92\u6709\u5b89\u88dd\u4e0a\u50b3\u8f49\u8a3a\u8cc7\u6599\u5c08\u7528\u63a7\u5236\u7a0b\u5f0f\u3002");
  } else if (!data.shield || data.fiveResult === "shield") {
    bits.push("\u5c4f\u853d\u9084\u6c92\u88dd\u4e0a\uff0c\u6240\u4ee5\u4e0a\u50b3\u8f49\u8a3a\u7684\u63a7\u5236\u7a0b\u5f0f\u6c92\u6709\u6253\u958b\u3002");
  }
  return bits.join("");
}

function restartSixText(data: Pair): string {
  if (!data.card6Installed) {
    return "\u9019\u53f0\u6c92\u6709\u5b89\u88dd\u8b80\u5361\u8edf\u9ad4 6.0\u3002\u8981\u5f9e\u5065\u4fdd\u5c08\u7db2\u5b89\u88dd\uff0c\u9019\u88e1\u4e0d\u6703\u81ea\u5df1\u4e0b\u8f09\u3002";
  }
  if (data.card6Running || data.sixResult === "started" || data.sixResult === "running") {
    return "\u8b80\u5361\u8edf\u9ad4\u5df2\u91cd\u65b0\u958b\u555f\u3002";
  }
  return "\u8b80\u5361\u8edf\u9ad4\u6c92\u6709\u958b\u8d77\u4f86\u3002";
}

function restartFiveText(data: Pair): string {
  if (!data.fiveInstalled) {
    return "\u9019\u53f0\u6c92\u6709\u5b89\u88dd\u4e0a\u50b3\u8f49\u8a3a\u8cc7\u6599\u5c08\u7528\u63a7\u5236\u7a0b\u5f0f\u3002";
  }
  if (!data.shield || data.fiveResult === "shield") {
    return "\u5c4f\u853d\u9084\u6c92\u88dd\u4e0a\uff0c\u6c92\u6709\u958b\u555f\u4e0a\u50b3\u8f49\u8a3a\u7684\u63a7\u5236\u7a0b\u5f0f\u3002";
  }
  return "\u4e0a\u50b3\u8f49\u8a3a\u8cc7\u6599\u5c08\u7528\u63a7\u5236\u7a0b\u5f0f\u5df2\u91cd\u65b0\u958b\u555f\u3002";
}

export function CardDeskTools({ variant = "dark" }: { variant?: "dark" | "light" }) {
  const light = variant === "light";
  const [busy, setBusy] = useState("");
  const [note, setNote] = useFlashNote();
  const btn = light
    ? "rounded border border-sky-700 bg-white px-2 py-0.5 text-[12px] font-bold text-sky-950 disabled:opacity-60"
    : "rounded border border-sky-300/40 bg-sky-500/15 px-2 py-0.5 text-[12px] font-bold text-sky-100 disabled:opacity-60";
  const pop = light
    ? "border-sky-700 bg-white text-black"
    : "border-sky-300/40 bg-slate-900 text-sky-50";

  useEffect(() => {
    void callPair("ensure")
      .then((data) => {
        const text = ensureText(data);
        if (text) setNote(text);
      })
      .catch(() => {});
  }, [setNote]);

  const run = (action: "restart6" | "restart5" | "refresh") => {
    setBusy(action);
    const job = action === "refresh"
      ? refreshLocalReader().then((found) => found.note)
      : callPair(action).then((data) => (action === "restart6" ? restartSixText(data) : restartFiveText(data)));
    void job
      .then((text) => setNote(text))
      .catch((err: unknown) => {
        setNote(err instanceof DeskCardError || err instanceof Error ? err.message : "\u9019\u53f0\u7684\u9580\u8a3a\u5de5\u5177\u6c92\u6709\u56de\u61c9\u3002");
      })
      .finally(() => setBusy(""));
  };

  return (
    <div className="relative flex items-start gap-1" onClick={(event) => event.stopPropagation()}>
      <button type="button" disabled={busy !== ""} className={btn} onClick={() => run("restart5")}>
        {"\u91cd\u555f\u4e0a\u50b3\u8f49\u8a3a\u8cc7\u6599\u5c08\u7528\u63a7\u5236\u7a0b\u5f0f(\u8207\u8b80\u5361\u7121\u95dc)"}
      </button>
      <button type="button" disabled={busy !== ""} className={btn} onClick={() => run("restart6")}>
        {"\u91cd\u555f\u8b80\u5361\u8edf\u9ad4"}
      </button>
      <button type="button" disabled={busy !== ""} className={btn} onClick={() => run("refresh")}>
        {"\u91cd\u65b0\u6574\u7406\u8b80\u5361\u6a5f"}
      </button>
      {note ? (
        <div className={"absolute right-0 top-full z-50 mt-1 w-80 rounded border p-2 text-[12px] leading-snug shadow-lg " + pop}>
          {note}
        </div>
      ) : null}
    </div>
  );
}
