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

async function callPair(action: "ensure" | "ensure6" | "restart6" | "restart5"): Promise<Pair> {
  const res = await fetch(HELPER + "/tools/card-pair?action=" + action, {
    method: "POST",
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error("down");
  return (await res.json()) as Pair;
}

function shieldText(data: Pair): string {
  if (data.fiveResult === "shield-nopack") {
    return "\u9019\u53f0\u7684\u958b\u555f\u9580\u8a3a\u8cc7\u6599\u593e\u88e1\u6c92\u6709\u5c4f\u853d\u6a94\uff0c\u6240\u4ee5\u6c92\u6709\u81ea\u52d5\u88dd\u4e0a\u3002\u8acb\u628a\u6574\u4efd\u5ba2\u6236\u7aef\u653e\u5230\u9019\u53f0\uff0c\u88e1\u9762\u8981\u6709 reader-block\uff0c\u518d\u91cd\u65b0\u6253\u958b\u9580\u8a3a\u3002";
  }
  if (data.fiveResult === "shield-copy" || data.fiveResult === "shield-nobin") {
    return "\u5c4f\u853d\u6c92\u5beb\u9032 C:\\NHI\\BIN\u3002\u5148\u95dc\u6389\u4e0a\u50b3\u8f49\u8a3a\u7684\u63a7\u5236\u7a0b\u5f0f\uff0c\u518d\u91cd\u65b0\u6253\u958b\u9580\u8a3a\u3002\u82e5\u9084\u662f\u9019\u53e5\uff0c\u7528\u7cfb\u7d71\u7ba1\u7406\u54e1\u958b\u4e00\u6b21\u3002";
  }
  if (!data.shield || (data.fiveResult || "").startsWith("shield")) {
    return "\u5c4f\u853d\u6c92\u6709\u88ab\u63a7\u5236\u7a0b\u5f0f\u8f09\u5165\uff0c\u6240\u4ee5\u6c92\u6709\u6253\u958b\u4e0a\u50b3\u8f49\u8a3a\u7684\u63a7\u5236\u7a0b\u5f0f\u3002\u5148\u95dc\u6389\u90a3\u500b\u7a0b\u5f0f\uff0c\u518d\u91cd\u65b0\u6253\u958b\u9580\u8a3a\u3002";
  }
  return "";
}

function ensureText(data: Pair): string {
  const bits: string[] = [];
  if (!data.card6Installed) {
    bits.push("\u9019\u53f0\u6c92\u6709\u5b89\u88dd\u8b80\u5361\u8edf\u9ad4 6.0\u3002\u8981\u5f9e\u5065\u4fdd\u5c08\u7db2\u5b89\u88dd\uff0c\u9019\u88e1\u4e0d\u6703\u81ea\u5df1\u4e0b\u8f09\u3002");
  }
  if (!data.fiveInstalled) {
    bits.push("\u9019\u53f0\u6c92\u6709\u5b89\u88dd\u4e0a\u50b3\u8f49\u8a3a\u8cc7\u6599\u5c08\u7528\u63a7\u5236\u7a0b\u5f0f\u3002");
  } else {
    const shield = shieldText(data);
    if (shield) bits.push(shield);
  }
  return bits.join("");
}

function ensureSixText(data: Pair): string {
  if (!data.card6Installed) {
    return "\u9019\u53f0\u6c92\u6709\u5b89\u88dd\u8b80\u5361\u8edf\u9ad4 6.0\u3002\u8981\u5f9e\u5065\u4fdd\u5c08\u7db2\u5b89\u88dd\uff0c\u9019\u88e1\u4e0d\u6703\u81ea\u5df1\u4e0b\u8f09\u3002";
  }
  return "";
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
  const blocked = shieldText(data);
  if (blocked) return blocked;
  return "\u4e0a\u50b3\u8f49\u8a3a\u8cc7\u6599\u5c08\u7528\u63a7\u5236\u7a0b\u5f0f\u5df2\u91cd\u65b0\u958b\u555f\u3002";
}

export function CardDeskTools({ variant = "dark", registerOnly = false }: { variant?: "dark" | "light"; registerOnly?: boolean }) {
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
    void callPair(registerOnly ? "ensure6" : "ensure")
      .then((data) => {
        const text = registerOnly ? ensureSixText(data) : ensureText(data);
        if (text) setNote(text);
      })
      .catch(() => {});
  }, [registerOnly, setNote]);

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
      {registerOnly ? (
        <button type="button" disabled={busy !== ""} className={btn} onClick={() => run("refresh")}>
          {"\u91cd\u65b0\u6574\u7406\u8b80\u5361\u6a5f"}
        </button>
      ) : (
        <button type="button" disabled={busy !== ""} className={btn} onClick={() => run("restart5")}>
          {"\u91cd\u555f\u4e0a\u50b3\u8f49\u8a3a\u8cc7\u6599\u5c08\u7528\u63a7\u5236\u7a0b\u5f0f(\u8207\u8b80\u5361\u7121\u95dc)"}
        </button>
      )}
      <button type="button" disabled={busy !== ""} className={btn} onClick={() => run("restart6")}>
        {"\u91cd\u555f\u8b80\u5361\u8edf\u9ad4"}
      </button>
      {registerOnly ? null : (
        <button type="button" disabled={busy !== ""} className={btn} onClick={() => run("refresh")}>
          {"\u91cd\u65b0\u6574\u7406\u8b80\u5361\u6a5f"}
        </button>
      )}
      {note ? (
        <div className={"absolute right-0 top-full z-50 mt-1 w-80 rounded border p-2 text-[12px] leading-snug shadow-lg " + pop}>
          {note}
        </div>
      ) : null}
    </div>
  );
}
