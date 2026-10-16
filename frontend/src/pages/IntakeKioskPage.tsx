import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { lookupIntake, submitIntake } from "@/api/clinicApi";

type Card = { encounterId: string; maskedName: string; idTail: string };
type Step = "id" | "where" | "what" | "when" | "done";

const PLACES: Array<[string, string]> = [
  ["facial", "\u81c9\u90e8 / \u982d\u90e8"],
  ["trunk", "\u8eab\u9ad4 / \u8ec0\u5e79"],
  ["limbs", "\u624b\u8173 / \u56db\u80a2"],
  ["other", "\u5176\u4ed6 / \u55ae\u7d14\u62ff\u85e5"],
];

const FEEL: Record<string, Array<[string, string]>> = {
  facial: [
    ["itching_erythema", "\u7662 / \u7d05\u816b\u523a\u75db"],
    ["sebum_acne", "\u51fa\u6cb9 / \u75d8\u75d8\u7c89\u523a"],
    ["scale", "\u812b\u76ae / \u4e7e\u5c51"],
    ["spot", "\u6591\u9ede / \u5176\u4ed6"],
  ],
  trunk: [
    ["itching_erythema", "\u7662 / \u7d05\u816b"],
    ["scale", "\u812b\u76ae / \u4e7e\u5c51"],
    ["spot", "\u6591\u9ede / \u75b9\u5b50"],
    ["sebum_acne", "\u75d8\u75d8 / \u7c89\u523a"],
  ],
  limbs: [
    ["itching_erythema", "\u7662 / \u7d05\u816b\u523a\u75db"],
    ["scale", "\u812b\u76ae / \u4e7e"],
    ["spot", "\u6591\u9ede / \u50b7\u53e3"],
    ["sebum_acne", "\u7532\u6e9d / \u81bf"],
  ],
  other: [
    ["refill", "\u55ae\u7d14\u62ff\u85e5"],
    ["itching_erythema", "\u7662"],
    ["spot", "\u5176\u4ed6\u72c0\u6cc1"],
    ["scale", "\u4e7e\u5c51"],
  ],
};

const WHEN: Array<[string, string]> = [
  ["within_days", "\u5e7e\u5929\u5167"],
  ["weeks", "1-2 \u9031"],
  ["chronic", "\u5f88\u4e45\u4e86 / \u53cd\u8986\u767c\u4f5c"],
];

const big = "flex min-h-24 flex-1 items-center justify-center rounded-2xl border-4 border-[#2060A0] bg-white text-2xl font-bold active:bg-[#D6E8FF]";

export function IntakeKioskPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("id");
  const [digits, setDigits] = useState("");
  const [toast, setToast] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [picked, setPicked] = useState<Card | null>(null);
  const [place, setPlace] = useState("");
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [duration, setDuration] = useState("");
  const [prior, setPrior] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState(0);
  const idle = useRef<number>(0);
  const warnTimer = useRef<number>(0);

  const reset = () => {
    setStep("id");
    setDigits("");
    setToast("");
    setCards([]);
    setPicked(null);
    setPlace("");
    setSymptoms([]);
    setDuration("");
    setPrior(null);
    setWarn(0);
  };

  useEffect(() => {
    const arm = () => {
      window.clearTimeout(idle.current);
      window.clearInterval(warnTimer.current);
      setWarn(0);
      idle.current = window.setTimeout(() => {
        let left = 5;
        setWarn(left);
        warnTimer.current = window.setInterval(() => {
          left -= 1;
          setWarn(left);
          if (left <= 0) {
            window.clearInterval(warnTimer.current);
            reset();
          }
        }, 1000);
      }, 20000);
    };
    arm();
    window.addEventListener("pointerdown", arm);
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.clearTimeout(idle.current);
      window.clearInterval(warnTimer.current);
    };
  }, []);

  useEffect(() => {
    if (step !== "done") return;
    const t = window.setTimeout(reset, 3000);
    return () => window.clearTimeout(t);
  }, [step]);

  const search = async (value: string) => {
    setBusy(true);
    setToast("");
    try {
      const items = await lookupIntake(value);
      if (!items.length) {
        setToast("\u67e5\u7121\u4eca\u65e5\u639b\u865f\u7d00\u9304\uff0c\u8acb\u5148\u81f3\u6ac3\u6aaf\u639b\u865f");
        setDigits("");
        return;
      }
      setCards(items);
    } catch (err: unknown) {
      setToast(err instanceof Error ? err.message : "\u67e5\u4e0d\u5230");
      setDigits("");
    } finally {
      setBusy(false);
    }
  };

  const pushDigit = (n: string) => {
    if (busy || cards.length) return;
    const next = (digits + n).slice(0, 7);
    setDigits(next);
    const waitSeven = next.startsWith("10");
    if ((!waitSeven && next.length === 6) || next.length === 7) void search(next);
  };

  const toggleSymptom = (id: string) => {
    setSymptoms((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id);
      if (prev.length >= 2) return prev;
      return [...prev, id];
    });
  };

  const send = async () => {
    if (!picked || !place || !duration || prior === null || symptoms.length === 0) return;
    setBusy(true);
    try {
      await submitIntake({
        encounterId: picked.encounterId,
        location: place,
        symptoms,
        duration,
        priorTopical: prior,
      });
      setStep("done");
    } catch (err: unknown) {
      setToast(err instanceof Error ? err.message : "\u9001\u51fa\u5931\u6557");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-[#E8F1FA] p-4 text-[#102030]" onPointerDown={() => setToast("")}>
      <button type="button" className="absolute right-3 top-3 text-sm text-[#6080a0]" onClick={() => navigate("/")}>
        {"\u56de\u5927\u5ef3"}
      </button>
      {warn > 0 ? (
        <div className="mb-3 rounded-xl bg-[#FFF3C4] p-4 text-center text-xl font-bold">
          {`${warn} \u79d2\u5f8c\u56de\u5230\u9996\u9801`}
        </div>
      ) : null}
      {toast ? <div className="mb-3 rounded-xl bg-[#F8D0D0] p-4 text-center text-xl font-bold">{toast}</div> : null}
      {step === "id" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <h1 className="text-center text-3xl font-bold">{"\u8acb\u8f38\u5165\u6c11\u570b\u51fa\u751f\u5e74\u6708\u65e5\uff08\u4f8b\u5982 750808\uff09"}</h1>
          <div className="text-center text-5xl tracking-[0.4em]">{digits || "\u2014"}</div>
          {cards.length === 0 ? (
            <div className="grid flex-1 grid-cols-3 gap-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "\u6e05\u9664", "0", "\u9000\u683c"].map((key) => (
                <button
                  key={key}
                  type="button"
                  className={big}
                  onClick={() => {
                    if (key === "\u6e05\u9664") setDigits("");
                    else if (key === "\u9000\u683c") setDigits((v) => v.slice(0, -1));
                    else pushDigit(key);
                  }}
                >
                  {key}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-1 flex-col gap-3">
              {cards.map((card) => (
                <button
                  key={card.encounterId}
                  type="button"
                  className="rounded-2xl border-4 border-[#2060A0] bg-white p-6 text-left"
                  onClick={() => setPicked(card)}
                >
                  <div className="text-4xl font-bold">{`\u3010 ${card.maskedName} \u3011`}</div>
                  <div className="mt-2 text-2xl">{`\u8eab\u5206\u8b49\u672b 4 \u78bc\uff1a**** ${card.idTail}`}</div>
                </button>
              ))}
              <div className="mt-auto grid grid-cols-2 gap-3">
                <button type="button" className={big} onClick={() => { setCards([]); setDigits(""); setPicked(null); }}>
                  {"\u4e0d\u662f\u6211 / \u91cd\u6253"}
                </button>
                <button
                  type="button"
                  disabled={!picked}
                  className={`${big} disabled:opacity-40`}
                  onClick={() => picked && setStep("where")}
                >
                  {"\u662f\u6211\u672c\u4eba / \u958b\u59cb"}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
      {step === "where" ? (
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
          {PLACES.map(([id, label]) => (
            <button key={id} type="button" className={big} onClick={() => { setPlace(id); setSymptoms([]); setStep("what"); }}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {step === "what" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="grid flex-1 grid-cols-2 gap-3">
            {(FEEL[place] || []).map(([id, label]) => {
              const on = symptoms.includes(id);
              const locked = !on && symptoms.length >= 2;
              return (
                <button key={id} type="button" disabled={locked} className={`${big} ${on ? "bg-[#2060A0] text-white" : ""} disabled:opacity-40`} onClick={() => toggleSymptom(id)}>
                  {label}
                </button>
              );
            })}
          </div>
          <button type="button" disabled={symptoms.length === 0} className={`${big} disabled:opacity-40`} onClick={() => setStep("when")}>
            {"\u4e0b\u4e00\u6b65"}
          </button>
        </div>
      ) : null}
      {step === "when" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="grid grid-cols-3 gap-3">
            {WHEN.map(([id, label]) => (
              <button key={id} type="button" className={`${big} ${duration === id ? "bg-[#2060A0] text-white" : ""}`} onClick={() => setDuration(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className={`${big} ${prior === false ? "bg-[#2060A0] text-white" : ""}`} onClick={() => setPrior(false)}>
              {"\u6c92\u64e6\u904e\u85e5"}
            </button>
            <button type="button" className={`${big} ${prior === true ? "bg-[#2060A0] text-white" : ""}`} onClick={() => setPrior(true)}>
              {"\u6709\u64e6\u904e\u5bb6\u88e1\u820a\u85e5 / \u6210\u85e5"}
            </button>
          </div>
          <button type="button" disabled={busy || !duration || prior === null} className={`${big} disabled:opacity-40`} onClick={() => void send()}>
            {"\u5b8c\u6210\u9001\u51fa"}
          </button>
        </div>
      ) : null}
      {step === "done" ? (
        <div className="flex flex-1 items-center justify-center text-center text-4xl font-bold">
          {"\u60a8\u5df2\u5b8c\u6210\u4eca\u65e5\u75c7\u72c0\u586b\u5beb\uff0c\u8acb\u81f3\u5019\u8a3a\u5340\u7a0d\u5019\u53eb\u865f\u3002"}
        </div>
      ) : null}
    </div>
  );
}
