import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HIS_FONT } from "@/lib/hisTheme";
import { chartDittoText } from "@/lib/referralDitto";

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

const REPLY_PROC: Array<[string, string]> = [
  ["1", "\u5df2\u4e88\u6025\u8a3a\u8655\u7f6e\u4e26\u8f49\u8a3a\u81f3\u91ab\u9662"],
  ["2", "\u5df2\u4e88\u6025\u8a3a\u8655\u7f6e\uff0c\u4e26\u4f4f\u672c\u9662\u75c5\u623f\u6cbb\u7642\u4e2d"],
  ["3", "\u5df2\u5b89\u6392\u4f4f\u672c\u9662\u75c5\u623f\u6cbb\u7642\u4e2d"],
  ["4", "\u5df2\u5b89\u6392\u672c\u9662\u9580\u8a3a\u6cbb\u7642\u4e2d"],
  ["5", "\u5df2\u4e88\u9069\u7576\u8655\u7406\u4e26\u8f49\u56de\u539f\u9662\u6240"],
];

export type ReferralReplyDraft = {
  serial: string;
  diagnosis: string;
  note: string;
  drugs: string;
  aux: string;
  purpose: string;
  upload: boolean;
};

export function ReferralReplyDialog({
  serial,
  hosp,
  patientName,
  diagnosis,
  meds,
  note,
  encounterId,
  busy,
  error,
  onSend,
  onSkip,
}: {
  serial: string;
  hosp: string;
  patientName: string;
  diagnosis: string;
  meds: string;
  note: string;
  encounterId?: string;
  busy?: boolean;
  error?: string;
  onSend: (draft: ReferralReplyDraft) => void;
  onSkip: () => void;
}) {
  const [seq, setSeq] = useState(serial);
  const [dx, setDx] = useState(diagnosis);
  const [drugs, setDrugs] = useState(meds);
  const [text, setText] = useState(note);
  const [purpose, setPurpose] = useState("4");
  const [uploadOnSave, setUploadOnSave] = useState(true);
  const [localError, setLocalError] = useState("");
  const box = "w-full border border-[#808080] bg-white px-1 py-0.5";
  const copyChart = async (part: "drugs" | "chief") => {
    const fallback = part === "drugs" ? (meds || "").trim() : (note || "").trim();
    try {
      const text = await chartDittoText(encounterId || "", part);
      if (part === "drugs") setDrugs(text);
      else setText(text);
      setLocalError(part === "drugs" ? "\u5df2\u6284\u5165\u9019\u6b21\u770b\u8a3a\u7684\u91ab\u4ee4\u3002" : "\u5df2\u6284\u5165\u9019\u6b21\u770b\u8a3a\u7684\u4e3b\u8ff0\u3002");
    } catch {
      if (!fallback) {
        setLocalError(part === "drugs" ? "\u9019\u6b21\u770b\u8a3a\u6c92\u6709\u91ab\u4ee4\u53ef\u6284\u3002" : "\u9019\u6b21\u770b\u8a3a\u6c92\u6709\u4e3b\u8ff0\u53ef\u6284\u3002");
        return;
      }
      if (part === "drugs") setDrugs(fallback);
      else setText(fallback);
      setLocalError(part === "drugs" ? "\u5df2\u6284\u5165\u9019\u6b21\u770b\u8a3a\u7684\u91ab\u4ee4\u3002" : "\u5df2\u6284\u5165\u9019\u6b21\u770b\u8a3a\u7684\u4e3b\u8ff0\u3002");
    }
  };
  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col" style={{ fontFamily: HIS_FONT, background: "#F4F1EA" }}>
      <header className="flex shrink-0 items-center justify-between bg-[#2060A0] px-3 py-1 text-white">
        <span className="font-bold">{"\u8f49\u8a3a\u56de\u8986"}</span>
        <span className="text-[13px]">{"\u9019\u6b21\u5df2\u5b58\u6a94\u3002\u586b\u5b8c\u518d\u9001\u51fa\uff0c\u6216\u7559\u5230\u4e4b\u5f8c\u518d\u56de\u3002"}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="mx-auto max-w-4xl border border-black bg-white p-2 text-[14px]">
          <div className="mb-2 text-center text-[18px] font-bold">{"\u63a5\u53d7\u91ab\u9662\u8a3a\u7642\u6458\u8981"}</div>
          <p className="mb-2">
            {patientName || "\u2014"}
            {"\u3000\u539f\u9662\u6240\uff1a"}
            {hosp || "\u2014"}
          </p>
          <label className="mb-2 block">
            {"\u8655\u7406\u60c5\u5f62"}
            <select className={`${box} mt-0.5`} value={purpose} onChange={(e) => setPurpose(e.target.value)}>
              {REPLY_PROC.map(([code, label]) => (
                <option key={code} value={code}>
                  {code}
                  {". "}
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="mb-2 block">
            {"\u8f49\u8a3a\u55ae\u5e8f\u865f"}
            <input className={`${box} mt-0.5 font-mono`} value={seq} onChange={(e) => setSeq(e.target.value)} />
          </label>
          <label className="mb-2 block">
            {"\u4e3b\u8a3a\u65b7"}
            <textarea className={`${box} mt-0.5 min-h-16`} value={dx} onChange={(e) => setDx(e.target.value)} />
          </label>
          <label className="mb-2 block">
            {"\u6cbb\u7642\u85e5\u7269\u6216\u8655\u7f6e"}
            <div className="mt-0.5 flex gap-1">
              <textarea className={`${box} min-h-16`} value={drugs} onChange={(e) => setDrugs(e.target.value)} />
              <button type="button" className="shrink-0 border border-[#808080] bg-[#E8E8E8] px-2 text-[12px] font-bold" onClick={() => void copyChart("drugs")}>
                {"Ditto\u91ab\u4ee4"}
              </button>
            </div>
          </label>
          <label className="mb-2 block">
            {"\u4e3b\u8ff0"}
            <div className="mt-0.5 flex gap-1">
              <textarea className={`${box} min-h-20`} value={text} onChange={(e) => setText(e.target.value)} />
              <button type="button" className="shrink-0 border border-[#808080] bg-[#E8E8E8] px-2 text-[12px] font-bold" onClick={() => void copyChart("chief")}>
                {"Ditto\u4e3b\u8ff0"}
              </button>
            </div>
          </label>
          <label className="mb-2 flex items-center gap-2 font-bold text-[#800000]">
            <input type="checkbox" checked={uploadOnSave} onChange={(e) => setUploadOnSave(e.target.checked)} />
            {"\u5b58\u6a94\u6642\u4e0a\u50b3\u81f3\u5065\u4fdd\u4e2d\u5fc3"}
          </label>
          {localError || error ? <p className="mb-2 text-red-800">{localError || error}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              className="border border-[#004d00] bg-[#c8f5c8] px-3 py-1 font-bold disabled:opacity-50"
              onClick={() => {
                const serialText = seq.trim();
                if (!serialText) {
                  setLocalError("\u8acb\u586b\u8f49\u8a3a\u55ae\u5e8f\u865f\u3002\u5e8f\u865f\u5f9e\u8f49\u8a3a\u5e73\u53f0\u4e0b\u8f09\uff0c\u4e0d\u5fc5\u518d\u63d2\u75c5\u60a3\u5065\u4fdd\u5361\u3002");
                  return;
                }
                setLocalError("");
                const picked = REPLY_PROC.find(([code]) => code === purpose);
                const lines = [
                  picked ? `\u8655\u7406\u60c5\u5f62\uff1a${picked[0]}. ${picked[1]}` : "",
                  drugs.trim() ? `\u6cbb\u7642\uff1a${drugs.trim()}` : "",
                  text.trim(),
                ].filter(Boolean);
                onSend({
                  serial: serialText,
                  diagnosis: dx.trim(),
                  note: lines.join("\n"),
                  drugs: drugs.trim(),
                  aux: text.trim(),
                  purpose,
                  upload: uploadOnSave,
                });
              }}
            >
              {"\u9001\u51fa\u56de\u8986"}
            </button>
            <button type="button" className="border border-[#333] bg-white px-3 py-1" onClick={onSkip}>
              {"\u7a0d\u5f8c\u518d\u56de"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
