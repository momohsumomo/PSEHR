import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HIS_FONT } from "@/lib/hisTheme";

export type IncomingSlip = {
  serial: string;
  hospId: string;
  openDate: string;
  kind: string;
  summary: string;
};

export type IncomingChoice = {
  accept: boolean;
  serial: string;
  hospId: string;
  openDate: string;
  hospName: string;
};

export function useIncomingReferralAsk() {
  const [slips, setSlips] = useState<IncomingSlip[] | null>(null);
  const resolver = useRef<((choice: IncomingChoice | null) => void) | null>(null);

  const ask = useCallback((rows: IncomingSlip[]) => {
    if (!rows.length) return Promise.resolve(null);
    return new Promise<IncomingChoice | null>((resolve) => {
      resolver.current = resolve;
      setSlips(rows);
    });
  }, []);

  const finish = (choice: IncomingChoice | null) => {
    resolver.current?.(choice);
    resolver.current = null;
    setSlips(null);
  };

  const dialog = slips ? <IncomingReferralDialog slips={slips} onDone={finish} /> : null;
  return { ask, dialog };
}

function IncomingReferralDialog({
  slips,
  onDone,
}: {
  slips: IncomingSlip[];
  onDone: (choice: IncomingChoice | null) => void;
}) {
  const [picked, setPicked] = useState(0);
  const row = slips[Math.min(picked, slips.length - 1)];
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45" style={{ fontFamily: HIS_FONT }}>
      <div className="w-[min(36rem,94vw)] border-2 border-[#004d00] bg-[#e8ffe8] p-3 text-[16px]">
        <h2 className="mb-2 font-bold">{"\u6709\u8f49\u5165\u8cc7\u6599\uff0c\u662f\u5426\u63a5\u53d7\u8f49\u8a3a\uff1f"}</h2>
        <p className="mb-2 text-[14px]">{"\u8acb\u9078\u9019\u6b21\u662f\u54ea\u4e00\u5bb6\u9662\u6240\u8f49\u904e\u4f86\u3002\u63a5\u53d7\u4e4b\u5f8c\u6703\u5e36\u5165\u63a5\u53d7\u8f49\u8a3a\uff0c\u770b\u5b8c\u5b58\u6a94\u6642\u518d\u56de\u8986\u3002"}</p>
        <ul className="max-h-64 overflow-auto border border-[#808080] bg-white">
          {slips.map((item, i) => (
            <li key={`${item.serial}-${i}`}>
              <button
                type="button"
                className={`block w-full px-2 py-1 text-left ${i === picked ? "bg-[#000080] text-white" : ""}`}
                onClick={() => setPicked(i)}
              >
                <span className="font-mono">{item.hospId || "\u2014"}</span>
                {" "}
                {item.summary || item.serial}
                <span className="ml-2 font-mono text-[13px]">{item.openDate}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="border border-[#004d00] bg-[#c8f5c8] px-3 py-1 font-bold"
            onClick={() =>
              onDone({
                accept: true,
                serial: row?.serial || "",
                hospId: row?.hospId || "",
                openDate: row?.openDate || "",
                hospName: row?.summary || row?.hospId || "",
              })
            }
          >
            {"\u63a5\u53d7\u9019\u4e00\u5bb6"}
          </button>
          <button type="button" className="border border-[#333] bg-white px-3 py-1" onClick={() => onDone(null)}>
            {"\u4e0d\u63a5\u53d7"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ReferralReplyDialog({
  serial,
  hosp,
  busy,
  error,
  onSend,
  onSkip,
}: {
  serial: string;
  hosp: string;
  busy?: boolean;
  error?: string;
  onSend: () => void;
  onSkip: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45" style={{ fontFamily: HIS_FONT }}>
      <div className="w-[min(32rem,94vw)] border-2 border-[#004d00] bg-[#fff8dc] p-3 text-[16px]">
        <h2 className="mb-2 font-bold">{"\u8f49\u8a3a\u56de\u8986"}</h2>
        <p>{"\u5e8f\u865f "}<span className="font-mono">{serial}</span></p>
        <p className="mb-2">{"\u8f49\u51fa\u9662\u6240 "}{hosp || "\u2014"}</p>
        <p className="mb-3 text-[14px]">{"\u9019\u6b21\u5df2\u7d93\u5b58\u6a94\u3002\u9001\u51fa\u5c31\u56de\u8986\u9019\u5f35\u8f49\u8a3a\u55ae\u3002\u7565\u904e\u7684\u8a71\uff0c\u4e4b\u5f8c\u5230\u96fb\u5b50\u8f49\u8a3a\u518d\u56de\u3002"}</p>
        {error ? <p className="mb-2 text-red-800">{error}</p> : null}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            className="border border-[#004d00] bg-[#c8f5c8] px-3 py-1 font-bold disabled:opacity-50"
            onClick={onSend}
          >
            {"\u9001\u51fa\u56de\u8986"}
          </button>
          <button type="button" className="border border-[#333] bg-white px-3 py-1" onClick={onSkip}>
            {"\u7565\u904e"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
