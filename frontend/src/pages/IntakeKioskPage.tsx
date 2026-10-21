import { useEffect, useRef, useState, type ReactNode } from "react";
import { lookupIntake, submitIntake } from "@/api/clinicApi";
import { BodyMap, FaceZoom, HandsZoom, SITE_LABEL } from "@/components/kiosk/BodyMap";

type Card = { encounterId: string; maskedName: string; idTail: string; filled?: boolean; sex?: string; access?: string };
type Step = "id" | "again" | "aim" | "concern" | "where" | "what" | "days" | "score" | "doctor" | "prior" | "result" | "done";
type Kind = "medical" | "cosmetic";
type Side = "r" | "l";

const SYMPTOMS: Array<[string, string]> = [
  ["itch", "\u7662"],
  ["red", "\u7d05"],
  ["swell", "\u816b"],
  ["pain", "\u523a\u75db"],
  ["peel", "\u812b\u76ae"],
  ["dry", "\u4e7e\u71e5"],
  ["oil", "\u51fa\u6cb9"],
  ["acne", "\u75d8\u75d8"],
  ["comedone", "\u7c89\u523a"],
  ["spot", "\u6591"],
  ["blister", "\u6c34\u6ce1"],
  ["ooze", "\u6ef2\u6db2"],
  ["crust", "\u7d50\u75c2"],
  ["wound", "\u50b7\u53e3"],
];

const DAYS: Array<[string, string]> = [
  ["0", "\u4eca\u5929\u525b\u958b\u59cb"],
  ["1", "1\u5929"],
  ["2", "2\u5929"],
  ["3", "3\u5929"],
  ["4", "4\u5929"],
  ["5", "5\u5929"],
  ["6", "6\u5929"],
  ["7", "7\u5929"],
  ["2w", "\u8d85\u904e\u5169\u9031"],
  ["1m", "\u4e00\u500b\u6708"],
  ["months", "\u597d\u5e7e\u500b\u6708"],
  ["forgot", "\u4e0d\u8a18\u5f97\u4e86"],
];

const big = "flex min-h-16 flex-1 items-center justify-center rounded-2xl border-4 border-[#2060A0] bg-white text-2xl font-bold text-black";
const choice = "flex h-full min-h-0 items-center justify-center rounded-2xl border-4 border-[#2060A0] bg-white px-2 text-xl font-bold leading-tight text-black";
const onCls = "kiosk-pick";

function birthdayReady(text: string): boolean {
  if (text.length === 7) return true;
  if (text.length !== 6) return false;
  const month = Number(text.slice(2, 4));
  const day = Number(text.slice(4, 6));
  if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return true;
  const head = Number(text.slice(0, 3));
  const rocNow = new Date().getFullYear() - 1911;
  return !(head >= 100 && head <= rocNow);
}

function clearFingers(list: string[], side: Side): string[] {
  return list.filter((id) => !id.startsWith(`finger-${side}-`) && id !== `nail-${side}`);
}

const CONCERN_GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  { title: "\u6591\u3001\u984f\u8272", items: [["spot", "\u9664\u6591"], ["ipl", "\u8108\u885d\u5149"]] },
  { title: "\u819a\u8cea", items: [["toning", "\u6de8\u819a"], ["fraxel", "\u98db\u68ad"]] },
  { title: "\u75e3", items: [["nevus", "\u9664\u75e3"]] },
  { title: "\u7d0b\u8def", items: [["botox", "\u8089\u6bd2"]] },
  { title: "\u6bdb", items: [["hair", "\u9664\u6bdb"]] },
];

const PRIORS: Array<[string, string]> = [
  ["never", "\u6c92\u6709\uff0c\u7b2c\u4e00\u6b21"],
  ["before", "\u6709\u505a\u904e"],
];

const COURSES: Array<[string, string]> = [
  ["darker", "\u984f\u8272\u6bd4\u8f03\u6df1"],
  ["lighter", "\u6709\u6bd4\u8f03\u6de1"],
  ["same", "\u5dee\u4e0d\u591a"],
  ["unsure", "\u4e0d\u78ba\u5b9a"],
];

export function IntakeKioskPage() {
  const [step, setStep] = useState<Step>("id");
  const [digits, setDigits] = useState("");
  const [toast, setToast] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [picked, setPicked] = useState<Card | null>(null);
  const [fromAgain, setFromAgain] = useState(false);
  const [face, setFace] = useState<"front" | "back">("front");
  const [kind, setKind] = useState<Kind | null>(null);
  const [concerns, setConcerns] = useState<string[]>([]);
  const [prior, setPrior] = useState("");
  const [result, setResult] = useState("");
  const [sites, setSites] = useState<string[]>([]);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [days, setDays] = useState("");
  const [score, setScore] = useState("");
  const [seenDoctor, setSeenDoctor] = useState<boolean | null>(null);
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
    setFromAgain(false);
    setFace("front");
    setKind(null);
    setConcerns([]);
    setPrior("");
    setResult("");
    setSites([]);
    setSymptoms([]);
    setDays("");
    setScore("");
    setSeenDoctor(null);
    setWarn(0);
  };

  useEffect(() => {
    const prev = document.title;
    document.title = "\u5019\u8a3a\u9810\u554f\u8a3a";
    return () => {
      document.title = prev;
    };
  }, []);

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
      }, 60000);
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
    const t = window.setTimeout(reset, 4000);
    return () => window.clearTimeout(t);
  }, [step]);

  const search = async (value: string) => {
    setBusy(true);
    setToast("");
    try {
      const found = await lookupIntake(value);
      if (!found.items.length) {
        setToast("\u67e5\u7121\u4eca\u65e5\u639b\u865f\u7d00\u9304\uff0c\u8acb\u5148\u81f3\u6ac3\u6aaf\u639b\u865f");
        setDigits("");
        return;
      }
      if (found.items.every((item) => item.access === "busy")) {
        setToast("\u76ee\u524d\u7121\u6cd5\u5b58\u53d6");
        setDigits("");
        return;
      }
      setCards(found.items);
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
    if (birthdayReady(next)) void search(next);
  };

  const toggle = (list: string[], id: string, limit: number) => {
    if (list.includes(id)) return list.filter((item) => item !== id);
    if (list.length >= limit) return list;
    return [...list, id];
  };

  const toggleSite = (id: string) => {
    const hand = id.startsWith("hand-r") ? "r" : id.startsWith("hand-l") ? "l" : "";
    setSites((prev) => {
      if (!hand) return toggle(prev, id, 24);
      if (prev.includes(id)) return clearFingers(prev.filter((item) => item !== id), hand);
      if (prev.length >= 24) return prev;
      return [...prev, id];
    });
  };

  const send = async () => {
    if (!picked || sites.length === 0) return;
    if (kind === "cosmetic") {
      if (concerns.length === 0 || !prior) return;
      if (prior === "before" && !result) return;
    } else if (symptoms.length === 0 || !days || !score || seenDoctor === null) {
      return;
    }
    setBusy(true);
    try {
      await submitIntake({
        encounterId: picked.encounterId,
        sites,
        symptoms: kind === "cosmetic" ? [] : symptoms,
        days: kind === "cosmetic" ? "" : days,
        severity: kind === "cosmetic" ? "" : score,
        seenOtherDoctor: kind === "cosmetic" ? false : seenDoctor === true,
        replace: fromAgain,
        visitKind: kind === "cosmetic" ? "cosmetic" : "medical",
        concerns: kind === "cosmetic" ? concerns : [],
        prior: kind === "cosmetic" ? prior : "",
        course: kind === "cosmetic" && prior === "before" ? result : "",
      });
      setStep("done");
    } catch (err: unknown) {
      setToast(err instanceof Error ? err.message : "\u9001\u51fa\u5931\u6557");
    } finally {
      setBusy(false);
    }
  };

  const startFromCard = () => {
    if (!picked) return;
    if (picked.filled) setStep("again");
    else {
      setFromAgain(false);
      setStep("aim");
    }
  };

  const cosmeticTotal = prior === "before" ? 5 : 4;
  const totalQ = kind === "cosmetic" ? cosmeticTotal : 6;
  const questionNo = (
    {
      aim: 1,
      concern: 2,
      where: kind === "cosmetic" ? 3 : 2,
      prior: 4,
      result: 5,
      what: 3,
      days: 4,
      score: 5,
      doctor: 6,
    } as Partial<Record<Step, number>>
  )[step];

  const goNext = () => {
    if (step === "aim") setStep(kind === "cosmetic" ? "concern" : "where");
    else if (step === "concern") setStep("where");
    else if (step === "where") setStep(kind === "cosmetic" ? "prior" : "what");
    else if (step === "prior") {
      if (prior === "never") void send();
      else setStep("result");
    } else if (step === "result") void send();
    else if (step === "what") setStep("days");
    else if (step === "days") setStep("score");
    else if (step === "score") setStep("doctor");
    else if (step === "doctor") void send();
  };

  const goBack = () => {
    if (step === "again") setStep("id");
    else if (step === "aim") setStep(fromAgain ? "again" : "id");
    else if (step === "concern") setStep("aim");
    else if (step === "where") setStep(kind === "cosmetic" ? "concern" : "aim");
    else if (step === "prior") setStep("where");
    else if (step === "result") setStep("prior");
    else if (step === "what") setStep("where");
    else if (step === "days") setStep("what");
    else if (step === "score") setStep("days");
    else if (step === "doctor") setStep("score");
  };

  const nextDisabled =
    busy ||
    (step === "aim" && !kind) ||
    (step === "concern" && concerns.length === 0) ||
    (step === "where" && sites.length === 0) ||
    (step === "prior" && !prior) ||
    (step === "result" && !result) ||
    (step === "what" && symptoms.length === 0) ||
    (step === "days" && !days) ||
    (step === "score" && !score) ||
    (step === "doctor" && seenDoctor === null);

  const wide = step === "where";
  return (
    <div
      data-surface="kiosk"
      className="flex h-screen items-center justify-center bg-[#E8F1FA] p-4 text-[#102030]"
      onPointerDown={() => setToast("")}
    >
      <div className={wide ? "flex h-full w-full min-h-0 flex-col" : "flex h-[min(40rem,100%)] w-[min(52rem,100%)] min-h-0 flex-col"}>
        {warn > 0 ? (
          <div className="mb-2 rounded-xl bg-[#FFF3C4] p-3 text-center text-xl font-bold">
            {`${warn} \u79d2\u5f8c\u56de\u5230\u9996\u9801`}
          </div>
        ) : null}
        {toast ? <div className="mb-2 rounded-xl bg-[#F8D0D0] p-3 text-center text-xl font-bold">{toast}</div> : null}

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
              <div className="flex flex-1 flex-col gap-3 overflow-auto">
                {cards.map((card) => (
                  <button
                    key={card.encounterId}
                    type="button"
                    className={`rounded-2xl border-4 p-5 text-left ${picked?.encounterId === card.encounterId ? "border-[#2060A0] bg-[#D6E8FF]" : "border-[#2060A0] bg-white"}`}
                    disabled={card.access === "busy"}
                    onClick={() => {
                      if (card.access === "busy") return;
                      setPicked(card);
                    }}
                  >
                    <div className="text-4xl font-bold">{`\u3010 ${card.maskedName} \u3011`}</div>
                    <div className="mt-2 text-2xl">{`\u8eab\u5206\u8b49\u672b 4 \u78bc\uff1a**** ${card.idTail}`}</div>
                    {card.access === "busy" ? <div className="mt-2 text-2xl font-bold text-[#8A1C1C]">{"\u76ee\u524d\u7121\u6cd5\u5b58\u53d6"}</div> : null}
                    {card.filled && card.access !== "busy" ? <div className="mt-2 text-2xl font-bold text-[#8A1C1C]">{"\u4eca\u5929\u5df2\u7d93\u586b\u904e"}</div> : null}
                  </button>
                ))}
                <div className="mt-auto grid grid-cols-2 gap-3">
                  <button type="button" className={big} onClick={() => { setCards([]); setDigits(""); setPicked(null); }}>
                    {"\u4e0d\u662f\u6211 / \u91cd\u6253"}
                  </button>
                  <button type="button" disabled={!picked} className={`${big} disabled:opacity-40`} onClick={startFromCard}>
                    {picked?.filled ? "\u4eca\u5929\u5df2\u586b\u904e\uff0c\u770b\u8981\u4e0d\u8981\u91cd\u586b" : "\u662f\u6211\u672c\u4eba / \u958b\u59cb"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {step === "again" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <h1 className="text-center text-4xl font-bold">{"\u4eca\u5929\u5df2\u7d93\u586b\u904e\u4e86"}</h1>
            <p className="text-center text-3xl">{`${picked?.maskedName || ""} \u78ba\u5b9a\u8981\u91cd\u586b\u55ce\uff1f`}</p>
            <div className="grid flex-1 grid-cols-1 gap-3">
              <button
                type="button"
                className={big}
                onClick={() => {
                  setFromAgain(true);
                  setStep("aim");
                }}
              >
                {"\u78ba\u5b9a\u91cd\u586b"}
              </button>
              <button type="button" className={big} onClick={() => setStep("id")}>
                {"\u4e0d\u8981\u91cd\u586b"}
              </button>
            </div>
          </div>
        ) : null}

        {step !== "id" && step !== "again" && step !== "done" ? (
          <div className="mb-2 text-center text-lg font-bold text-[#2060A0]">
            {typeof questionNo === "number" ? `\u7b2c ${questionNo} \u984c\uff0c\u5171 ${totalQ} \u984c` : ""}
          </div>
        ) : null}

        {step === "aim" ? (
          <Question title={"\u4eca\u5929\u4f86\u7684\u4e3b\u8981\u76ee\u7684"}>
            <button type="button" className={`${choice} ${kind === "medical" ? onCls : ""}`} onClick={() => setKind("medical")}>
              {"\u770b\u75c5"}
            </button>
            <button type="button" className={`${choice} ${kind === "cosmetic" ? onCls : ""}`} onClick={() => setKind("cosmetic")}>
              {"\u91ab\u7f8e"}
            </button>
          </Question>
        ) : null}

        {step === "where" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <h1 className="shrink-0 text-center text-2xl font-bold">
              {kind === "cosmetic" ? "\u8acb\u9ede\u60f3\u8655\u7406\u7684\u5730\u65b9\uff0c\u53ef\u4ee5\u9ede\u591a\u8655" : "\u8acb\u9ede\u4e0d\u8212\u670d\u7684\u5730\u65b9\uff0c\u53ef\u4ee5\u9ede\u591a\u8655"}
            </h1>
            <p className="shrink-0 text-center text-base">
              {face === "back"
                ? "\u9019\u662f\u80cc\u9762\uff0c\u4eba\u7684\u5de6\u908a\u5c31\u662f\u60a8\u7684\u5de6\u624b\u908a\u3002\u9ede\u5230\u7684\u5730\u65b9\u624d\u6703\u5708\u8d77\u4f86\u3002\u81c9\u4e0a\u7d30\u4f4d\u8acb\u5207\u56de\u6b63\u9762\u3002"
                : "\u9762\u5c0d\u9019\u5f35\u5716\uff0c\u4eba\u7684\u5de6\u908a\u662f\u60a8\u7684\u53f3\u624b\u908a\u3002\u9ede\u5230\u7684\u5730\u65b9\u624d\u6703\u5708\u8d77\u4f86\u4e26\u986f\u793a\u540d\u7a31\u3002"}
            </p>
            <div className="grid shrink-0 grid-cols-2 gap-2">
              <button type="button" className={`min-h-10 rounded-xl border-4 border-[#2060A0] bg-white text-lg font-bold text-black ${face === "front" ? onCls : ""}`} onClick={() => setFace("front")}>
                {"\u6b63\u9762"}
              </button>
              <button type="button" className={`min-h-10 rounded-xl border-4 border-[#2060A0] bg-white text-lg font-bold text-black ${face === "back" ? onCls : ""}`} onClick={() => setFace("back")}>
                {"\u80cc\u9762"}
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-stretch gap-2">
              <div className="flex min-h-0 w-[36%] flex-col">
                {face === "front" ? (
                  <FaceZoom selected={sites} onToggle={toggleSite} />
                ) : (
                  <p className="m-auto text-center text-xl font-bold">{"\u81c9\u4e0a\u7d30\u4f4d\u8acb\u5207\u56de\u6b63\u9762"}</p>
                )}
              </div>
              <div className="min-h-0 min-w-0 flex-1">
                <BodyMap face={face} selected={sites} onToggle={toggleSite} />
              </div>
              <div className="flex min-h-0 w-[32%] flex-col">
                <HandsZoom face={face} selected={sites} onToggle={toggleSite} />
              </div>
            </div>
            <p className="min-h-8 text-center text-xl">
              {sites.length ? `\u5df2\u9078\uff1a${sites.map((id) => SITE_LABEL[id] || id).join("\u3001")}` : "\u9084\u6c92\u9078"}
            </p>
          </div>
        ) : null}

        {step === "concern" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <h1 className="shrink-0 text-center text-2xl font-bold">{"\u4eca\u5929\u4e3b\u8981\u60f3\u505a\u54ea\u4e00\u9805\uff1f\u53ef\u4ee5\u8907\u9078"}</h1>
            <div className="grid min-h-0 flex-1 grid-cols-2 content-stretch gap-2">
              {CONCERN_GROUPS.map((group) => (
                <div key={group.title} className="flex min-h-0 flex-col gap-1">
                  <p className="shrink-0 text-center text-lg font-bold">{group.title}</p>
                  <div className={`grid min-h-0 flex-1 gap-2 ${group.items.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                    {group.items.map(([id, label]) => {
                      const on = concerns.includes(id);
                      const locked = !on && concerns.length >= 3;
                      return (
                        <button key={id} type="button" disabled={locked} className={`${choice} ${on ? onCls : ""} disabled:opacity-40`} onClick={() => setConcerns((prev) => toggle(prev, id, 3))}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {step === "prior" ? (
          <Question title={"\u4ee5\u524d\u6709\u6c92\u6709\u505a\u904e\u985e\u4f3c\u7684\uff1f"}>
            {PRIORS.map(([id, label]) => (
              <button key={id} type="button" className={`${choice} ${prior === id ? onCls : ""}`} onClick={() => setPrior(id)}>
                {label}
              </button>
            ))}
          </Question>
        ) : null}

        {step === "result" ? (
          <Question title={"\u505a\u5b8c\u4e4b\u5f8c\uff0c\u73fe\u5728\u8ddf\u539f\u4f86\u6bd4\u8d77\u4f86\uff1f"}>
            {COURSES.map(([id, label]) => (
              <button key={id} type="button" className={`${choice} ${result === id ? onCls : ""}`} onClick={() => setResult(id)}>
                {label}
              </button>
            ))}
          </Question>
        ) : null}

        {step === "what" ? (
          <Question title={"\u73fe\u5728\u600e\u9ebc\u4e0d\u8212\u670d\uff1f\u53ef\u4ee5\u8907\u9078"}>
            {SYMPTOMS.map(([id, label]) => {
              const on = symptoms.includes(id);
              const locked = !on && symptoms.length >= 5;
              return (
                <button key={id} type="button" disabled={locked} className={`${choice} ${on ? onCls : ""} disabled:opacity-40`} onClick={() => setSymptoms((prev) => toggle(prev, id, 5))}>
                  {label}
                </button>
              );
            })}
          </Question>
        ) : null}

        {step === "days" ? (
          <Question title={"\u9019\u6b21\u5927\u6982\u5e7e\u5929\u4e86\uff1f"}>
            {DAYS.map(([id, label]) => (
              <button key={id} type="button" className={`${choice} ${days === id ? onCls : ""}`} onClick={() => setDays(id)}>
                {label}
              </button>
            ))}
          </Question>
        ) : null}

        {step === "score" ? (
          <Question title={"\u6700\u56b4\u91cd\u662f 10 \u5206\uff0c\u73fe\u5728\u5927\u6982\u5e7e\u5206\uff1f"}>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map((n) => (
              <button key={n} type="button" className={`${choice} ${score === n ? onCls : ""}`} onClick={() => setScore(n)}>
                {n}
              </button>
            ))}
          </Question>
        ) : null}

        {step === "doctor" ? (
          <Question title={"\u6709\u6c92\u6709\u7d66\u5225\u7684\u91ab\u751f\u770b\u904e\uff1f"}>
            <button type="button" className={`${choice} ${seenDoctor === true ? onCls : ""}`} onClick={() => setSeenDoctor(true)}>
              {"\u6709\u770b\u904e"}
            </button>
            <button type="button" className={`${choice} ${seenDoctor === false ? onCls : ""}`} onClick={() => setSeenDoctor(false)}>
              {"\u6c92\u6709\u770b\u904e"}
            </button>
          </Question>
        ) : null}

        {step === "done" ? (
          <div className="flex flex-1 items-center justify-center text-center text-4xl font-bold">
            {"\u60a8\u5df2\u5b8c\u6210\u4eca\u65e5\u75c7\u72c0\u586b\u5beb\uff0c\u8acb\u81f3\u5019\u8a3a\u5340\u7a0d\u5019\u53eb\u865f\u3002"}
          </div>
        ) : null}

        {step !== "id" && step !== "again" && step !== "done" ? (
          <div className="mt-2 grid shrink-0 grid-cols-2 gap-2">
            <button type="button" className={big} onClick={goBack}>
              {"\u4e0a\u4e00\u984c"}
            </button>
            <button type="button" disabled={nextDisabled} className={`${big} disabled:opacity-40`} onClick={goNext}>
              {step === "doctor" || step === "result" || (step === "prior" && prior === "never") ? "\u5b8c\u6210\u9001\u51fa" : "\u4e0b\u4e00\u984c"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Question({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <h1 className="shrink-0 text-center text-2xl font-bold">{title}</h1>
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-2 overflow-hidden">{children}</div>
    </div>
  );
}
