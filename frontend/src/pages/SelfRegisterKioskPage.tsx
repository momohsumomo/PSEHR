import { useEffect, useState } from "react";
import {
  fetchIdCategorySettings,
  fetchPatient,
  fetchPatients,
  fetchPatientVisits,
  fetchQueueForDate,
  fetchSameDayEncounters,
  fetchSeqNext,
  readCardAndRegister,
  registerEncounter,
  type PatientRegisterResponse,
} from "@/api/clinicApi";
import { ageYearsFromRoc, applyAgeFees, policyFromFees } from "@/lib/ageFee";
import { loadClinicBundle, loadClinicRegisterDefaults, readLocalClinicBundle } from "@/lib/clinicProfile";
import { cardIdentityBenefit } from "@/lib/cardIdentity";
import { identityVisitFees, matchIdCategory } from "@/lib/idCategory";
import { shiftForClock } from "@/lib/clinicSession";
import { mapApiPatientToHit, type PatientHit } from "@/lib/patientSearch";
import { shiftQueueNumbers, takeSmallestQueueNumber } from "@/lib/queueOrder";
import { AssignHcReaderButton } from "@/components/clinic/AssignHcReaderButton";
import { CardDeskTools } from "@/components/clinic/CardDeskTools";

function maskName(name: string): string {
  const chars = [...name.trim()];
  if (chars.length <= 1) return name.trim();
  if (chars.length === 2) return `${chars[0]} \u25cb`;
  if (chars.length === 3) return `${chars[0]} \u25cb ${chars[2]}`;
  return `${chars[0]} ${"\u25cb".repeat(chars.length - 2)} ${chars[chars.length - 1]}`;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nowClock(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type Mode = "home" | "kind" | "id" | "pick" | "notice" | "done";
type WalkKind = "deposit" | "selfPay";

function readableClinicName(): string {
  const name = readLocalClinicBundle().profile.clinicName?.trim() || "";
  return /[\u4e00-\u9fff]/.test(name) && !name.includes("?") ? name : "";
}

const shell =
  "relative flex min-h-0 flex-1 flex-col overflow-hidden text-[#16324a]";
const card =
  "flex min-h-0 flex-1 flex-col items-center justify-center rounded-[2rem] px-8 text-center shadow-[0_16px_36px_rgba(18,42,58,.12)] active:scale-[0.99] disabled:opacity-60";
const keyBtn =
  "flex items-center justify-center rounded-2xl bg-white text-4xl font-semibold text-[#16324a] shadow-[0_8px_18px_rgba(18,42,58,.08)] active:bg-[#e7f3f6] disabled:opacity-60";

function idTail(idNo: string): string {
  const id = idNo.replace(/\s/g, "").toUpperCase();
  if (/^[A-Z][0-9]{9}$/.test(id)) return id.slice(1);
  return id;
}

export function SelfRegisterKioskPage() {
  const [mode, setMode] = useState<Mode>("home");
  const [walk, setWalk] = useState<WalkKind>("deposit");
  const [digits, setDigits] = useState("");
  const [hits, setHits] = useState<PatientHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [number, setNumber] = useState("");
  const [who, setWho] = useState("");
  const [clinicName, setClinicName] = useState(readableClinicName);
  const [waitLabel, setWaitLabel] = useState("");

  const resetHome = () => {
    setMode("home");
    setDigits("");
    setHits([]);
    setNumber("");
    setWho("");
    setNote("");
  };

  useEffect(() => {
    const prev = document.title;
    document.title = "\u81ea\u52a9\u639b\u865f";
    return () => {
      document.title = prev;
    };
  }, []);

  useEffect(() => {
    let gone = false;
    void loadClinicBundle().then((bundle) => {
      if (gone) return;
      const name = bundle.profile.clinicName?.trim() || "";
      if (/[\u4e00-\u9fff]/.test(name) && !name.includes("?")) setClinicName(name);
    });
    return () => {
      gone = true;
    };
  }, []);

  useEffect(() => {
    let gone = false;
    const load = async () => {
      try {
        const day = todayIso();
        const board = await fetchQueueForDate(day);
        if (gone || board.resolvedDate !== day) return;
        const waiting = (board.entry || []).filter((row) => {
          const meta = row.queueMeta;
          return meta.queueStatus === "waiting" && !meta.prebook;
        }).length;
        const high = Math.ceil(waiting * 1.3);
        setWaitLabel(`\u5019\u8a3a\u4eba\u6578 ${waiting}~${high}\u4eba`);
      } catch {
        if (!gone) setWaitLabel("");
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 20000);
    return () => {
      gone = true;
      window.clearInterval(timer);
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== "done") return;
    const t = window.setTimeout(resetHome, 8000);
    return () => window.clearTimeout(t);
  }, [mode]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        if (busy) return;
        if (mode === "notice") {
          setMode("done");
          return;
        }
        if (mode === "home" || mode === "done") resetHome();
        else if (mode === "pick") setMode("id");
        else if (mode === "id") setMode("kind");
        else setMode("home");
        setNote("");
        return;
      }
      if (mode !== "id" || busy) return;
      if (ev.key === "Backspace") {
        ev.preventDefault();
        setDigits((prev) => prev.slice(0, -1));
      } else if (/^\d$/.test(ev.key)) {
        ev.preventDefault();
        setDigits((prev) => (prev + ev.key).slice(0, 9));
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        void lookup();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, busy, digits]);

  const priceVisit = async (
    patientId: string,
    birthdayRoc: string,
    kind: "ic" | WalkKind,
    identityStatus?: string,
  ) => {
    const defaults = loadClinicRegisterDefaults();
    const selfPay = kind === "selfPay";
    let hit: { reg_fee?: number; copay?: number; deposit?: number } | undefined;
    let personCopayDisc = "";
    try {
      const [patient, cats] = await Promise.all([fetchPatient(patientId), fetchIdCategorySettings()]);
      const ext =
        patient.extension?.find((item) => item.url?.includes("patient-clinic-ext"))?.extension || [];
      const cat = ext.find((item) => item.url === "idCategory")?.valueString || "";
      personCopayDisc = ext.find((item) => item.url === "copayDisc")?.valueString || "";
      hit = matchIdCategory(cats, cat);
    } catch {
      hit = undefined;
    }
    const base = identityVisitFees({
      clinicReg: Number(defaults.regFeeOutpatient) || 0,
      selfPayReg: Number(defaults.regFeeSelfPay) || 0,
      selfPay,
      depositVisit: kind === "deposit",
      clinicDeposit: defaults.depositAmount,
      hit,
      personCopayDisc,
    });
    const aged = applyAgeFees({
      age: ageYearsFromRoc(birthdayRoc),
      baseReg: Number(base.regFee) || 0,
      listReg: selfPay
        ? Number(defaults.regFeeSelfPay) || 0
        : Number(defaults.regFeeOutpatient) || 0,
      baseCopay: selfPay ? 0 : Number(base.copayAmt) || 0,
      baseDisc: selfPay ? 0 : Number(base.copayDiscAmt) || 0,
      selfPay,
      student: false,
      policy: policyFromFees(readLocalClinicBundle().fees),
    });
    const card = cardIdentityBenefit(identityStatus);
    const copayNet = card?.waiveBasic || selfPay
      ? 0
      : Math.max(0, Number(aged.copayAmt) - Number(aged.copayDiscAmt));
    return {
      regFee: aged.regFee,
      copayAmt: String(copayNet),
      deposit: base.deposit,
      copayCode: selfPay ? "" : card?.copayCode || "",
      cardIdentity: card?.mark || "",
    };
  };

  const showDone = (name: string, queueNumber: string, text: string, firstVisit = false) => {
    setWho(maskName(name));
    setNumber(queueNumber);
    setNote(text);
    setMode(firstVisit ? "notice" : "done");
  };

  const isFirstClinicVisit = async (patientId: string): Promise<boolean> => {
    try {
      const prior = await fetchPatientVisits(patientId, 1, { light: true });
      return (prior.entry || []).length === 0;
    } catch {
      return false;
    }
  };

  const alreadyToday = async (patientId: string, name: string) => {
    const day = todayIso();
    const same = await fetchSameDayEncounters(patientId, day, { includeCloud: false });
    const rows = (same.encounters || []).filter(
      (row) => row.source !== "nhi_cloud" && row.queueStatus !== "cancelled",
    );
    if (rows.some((row) => row.prebook)) {
      showDone(name, "", "\u7576\u65e5\u5df2\u6709\u9810\u7d04\uff0c\u8acb\u76f4\u63a5\u8ddf\u6ac3\u53f0\u5831\u5230");
      return true;
    }
    const open = rows.find((row) => row.queueNumber);
    if (!open?.queueNumber) return false;
    showDone(name, String(open.queueNumber), `\u60a8\u4eca\u5929\u5df2\u7d93\u639b\u904e\u865f\uff0c\u865f\u78bc\u662f${open.queueNumber}\u865f\u3002`);
    return true;
  };

  const saveVisit = async (args: {
    patientId: string;
    idNo: string;
    name: string;
    birthdayRoc: string;
    kind: "ic" | WalkKind;
    cardId?: string;
    identityStatus?: string;
    treatSeq?: string;
    treatmentNumber?: string;
    treatDateTime?: string;
    securitySign?: string;
    samId?: string;
  }) => {
    if (await alreadyToday(args.patientId, args.name)) return;
    const defaults = loadClinicRegisterDefaults();
    const selfPay = args.kind === "selfPay";
    const priced = await priceVisit(args.patientId, args.birthdayRoc, args.kind, args.identityStatus);
    const day = todayIso();
    const shift = shiftForClock();
    const board = await fetchQueueForDate(day);
    const rows = (board.resolvedDate === day ? board.entry : []).map((row) => row.queueMeta);
    const queueNumber = takeSmallestQueueNumber(shiftQueueNumbers(rows, shift));
    const firstVisit = await isFirstClinicVisit(args.patientId);
    const saved = await registerEncounter({
      patientId: args.patientId,
      queueNumber,
      patientIdNo: args.idNo,
      queueStatus: "waiting",
      icException: args.kind,
      caseNo: selfPay ? "9X" : "01",
      treatmentItem: "01",
      payType: selfPay ? "4" : undefined,
      treatSeq: args.treatSeq,
      treatmentNumber: args.treatmentNumber,
      treatDateTime: args.treatDateTime,
      securitySign: args.securitySign,
      samId: args.samId,
      hcId: args.cardId,
      hcIdNo: args.idNo,
      shift,
      doctorId: defaults.defaultDoctorId || undefined,
      encounterDate: day,
      visitClock: nowClock(),
      regFee: priced.regFee,
      copayAmt: priced.copayAmt,
      copayCode: priced.copayCode || undefined,
      cardIdentity: priced.cardIdentity || undefined,
      deposit: priced.deposit,
      dispense: defaults.dispenseType || undefined,
    });
    showDone(args.name, String(saved.queueNumber), "\u639b\u865f\u5b8c\u6210\uff0c\u8acb\u56de\u5ea7\u5019\u8a3a", firstVisit);
  };

  const finishCard = async (card: PatientRegisterResponse) => {
    const idNo = card.validation?.idNo || "";
    if (await alreadyToday(card.patientId, card.validation?.patientName || "")) return;
    const seq = await fetchSeqNext({
      icException: "ic",
      patientIdNo: idNo,
      treatmentItem: "01",
    });
    if (!seq.sequenceNumber && !seq.treatmentNumber) {
      throw new Error(seq.reason || "\u5065\u4fdd\u5c40\u6c92\u6709\u56de\u50b3\u5c31\u91ab\u5e8f\u865f");
    }
    await saveVisit({
      patientId: card.patientId,
      idNo,
      name: card.validation?.patientName || "",
      birthdayRoc: card.validation?.birthdayRoc || "",
      kind: "ic",
      identityStatus: card.validation?.identityStatus || "",
      cardId: seq.hcId || card.validation?.cardId,
      treatSeq: seq.sequenceNumber || undefined,
      treatmentNumber: seq.treatmentNumber || undefined,
      treatDateTime: seq.treatmentDateTime || undefined,
      securitySign: seq.signature || undefined,
      samId: seq.samId || undefined,
    });
  };

  const runCard = async () => {
    setBusy(true);
    setNote("");
    try {
      await finishCard(await readCardAndRegister(false));
    } catch (err: unknown) {
      setNote(err instanceof Error ? err.message : "\u639b\u865f\u5931\u6557");
      setMode("home");
    } finally {
      setBusy(false);
    }
  };

  const registerHit = async (hit: PatientHit, kind: WalkKind) => {
    setBusy(true);
    setNote("");
    try {
      await saveVisit({
        patientId: hit.id,
        idNo: hit.idNo,
        name: hit.name,
        birthdayRoc: hit.birthdayRoc,
        kind,
      });
    } catch (err: unknown) {
      setNote(err instanceof Error ? err.message : "\u639b\u865f\u5931\u6557");
      setMode("id");
    } finally {
      setBusy(false);
    }
  };

  const lookup = async () => {
    if (digits.length !== 9) {
      setNote("\u8acb\u8f38\u5165\u8eab\u5206\u8b49\u5f8c\u4e5d\u78bc");
      return;
    }
    setBusy(true);
    setNote("");
    try {
      const bundle = await fetchPatients({ idNo: digits, _count: 40 });
      const found = (bundle.entry || [])
        .map((row) => mapApiPatientToHit(row.resource))
        .filter((hit) => hit.idNo && idTail(hit.idNo) === digits);
      if (found.length === 0) {
        setHits([]);
        setNote("\u627e\u4e0d\u5230\u9019\u4f4d\u75c5\u4eba\u3002\u521d\u8a3a\u8acb\u5230\u6ac3\u53f0\u3002");
        return;
      }
      if (found.length === 1) {
        await registerHit(found[0], walk);
        return;
      }
      setHits(found.slice(0, 8));
      setMode("pick");
    } catch (err: unknown) {
      setNote(err instanceof Error ? err.message : "\u639b\u865f\u5931\u6557");
    } finally {
      setBusy(false);
    }
  };

  const pushDigit = (n: string) => {
    setNote("");
    setDigits((prev) => (prev + n).slice(0, 9));
  };

  return (
    <div
      data-surface="kiosk"
      className={shell}
      style={{
        background: "linear-gradient(165deg, #f6f3ec 0%, #e5f1f4 46%, #f3eee4 100%)",
        fontFamily: '"Microsoft JhengHei", "Segoe UI", sans-serif',
      }}
    >
      <header className="relative shrink-0 border-b border-[#d7e3e8] bg-white/70 px-8 pb-4 pt-5 text-center backdrop-blur-sm">
        <div className="absolute right-3 top-3 z-20 flex items-start gap-2">
          <CardDeskTools variant="light" registerOnly />
          <AssignHcReaderButton />
        </div>
        <p className="text-[1.7rem] font-semibold tracking-wide text-[#12324a]">{clinicName || "\u81ea\u52a9\u639b\u865f"}</p>
        <h1 className="mt-1 text-5xl font-bold tracking-[0.18em] text-[#12324a]">
          {"\u81ea\u52a9\u639b\u865f"}
          <span className="ml-4 align-middle text-2xl font-semibold tracking-normal text-[#0f4c6e]">
            {waitLabel || "\u5019\u8a3a\u4eba\u6578 \u2014"}
          </span>
        </h1>
        <div className="mx-auto mt-3 h-1 w-16 rounded-full bg-[#c4a36a]" />
      </header>
      {note && mode !== "done" && mode !== "notice" ? (
        <div className="mx-6 mt-4 rounded-2xl bg-[#f8e4e4] px-4 py-3 text-center text-xl font-bold text-[#8a3030]">{note}</div>
      ) : null}
      {mode === "home" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
          <div className="flex min-h-0 flex-1 gap-6">
          <button type="button" disabled={busy} className={`${card} bg-[#1A6FB5] text-white`} onClick={() => { setNote(""); setMode("kind"); }}>
            <span className="mb-5 h-1.5 w-14 rounded-full bg-[#d6ebf8]" />
            <span className="text-5xl font-bold">{"\u7121\u5065\u4fdd\u5361\u639b\u865f"}</span>
            <span className="mt-5 rounded-full bg-white/20 px-5 py-2 text-2xl font-semibold text-white">{"\u521d\u8a3a\u4e0d\u53ef\u4f7f\u7528"}</span>
          </button>
          <button type="button" disabled={busy} className={`${card} bg-[#8BE04A] text-[#14320c] shadow-[0_16px_40px_rgba(90,190,40,.45)]`} onClick={() => void runCard()}>
            <span className="mb-5 h-1.5 w-14 rounded-full bg-white/80" />
            <span className="text-5xl font-bold">{"\u5065\u4fdd\u5361\u639b\u865f"}</span>
            <span className="mt-5 text-2xl font-medium text-[#1d4a12]">
              {busy ? "\u8b80\u5361\u4e2d" : "\u8acb\u63d2\u5361\u518d\u6309"}
            </span>
          </button>
          </div>
        </div>
      ) : null}
      {mode === "kind" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
          <h2 className="text-center text-3xl font-semibold">{"\u7121\u5065\u4fdd\u5361\u639b\u865f"}</h2>
          <div className="flex min-h-0 flex-1 gap-6">
            <button
              type="button"
              className={`${card} border border-[#ead7b4] bg-[#fffaf3] text-[#3f3424]`}
              onClick={() => {
                setWalk("deposit");
                setDigits("");
                setNote("");
                setMode("id");
              }}
            >
              <span className="text-6xl font-bold">{"\u62bc\u91d1"}</span>
              <span className="mt-4 text-2xl text-[#8a6430]">{"\u5148\u6536\u62bc\u91d1\uff0c\u4e4b\u5f8c\u88dc\u5361"}</span>
            </button>
            <button
              type="button"
              className={`${card} bg-[#31586e] text-white`}
              onClick={() => {
                setWalk("selfPay");
                setDigits("");
                setNote("");
                setMode("id");
              }}
            >
              <span className="text-6xl font-bold">{"\u81ea\u8cbb"}</span>
              <span className="mt-4 text-2xl text-[#d5e8f2]">{"\u4e0d\u8d70\u5065\u4fdd"}</span>
            </button>
          </div>
          <button type="button" className="h-14 rounded-2xl bg-white/80 text-xl font-semibold text-[#31586e] shadow" onClick={() => setMode("home")}>
            {"\u56de\u4e0a\u4e00\u9801"}
          </button>
        </div>
      ) : null}
      {mode === "id" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
          <h2 className="text-center text-3xl font-semibold">
            {walk === "deposit" ? "\u62bc\u91d1" : "\u81ea\u8cbb"}
            {"\u3000\u8acb\u8f38\u5165\u8eab\u5206\u8b49\u5f8c\u4e5d\u78bc"}
          </h2>
          <div className="rounded-2xl bg-white py-4 text-center font-mono text-5xl tracking-[0.4em] text-[#0f4c6e] shadow-[0_8px_18px_rgba(18,42,58,.08)]">
            {digits.padEnd(9, "\u00b7")}
          </div>
          <div className="grid flex-1 grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
              <button key={n} type="button" disabled={busy} className={keyBtn} onClick={() => pushDigit(n)}>
                {n}
              </button>
            ))}
            <button type="button" className={`${keyBtn} text-2xl`} onClick={() => { setDigits(""); setNote(""); }}>
              {"\u6e05\u9664"}
            </button>
            <button type="button" disabled={busy} className={keyBtn} onClick={() => pushDigit("0")}>
              0
            </button>
            <button type="button" className={`${keyBtn} text-2xl`} onClick={() => setDigits((prev) => prev.slice(0, -1))}>
              {"\u522a\u9664"}
            </button>
          </div>
          <div className="flex gap-3">
            <button type="button" className="h-16 flex-1 rounded-2xl bg-white text-2xl font-semibold text-[#31586e] shadow" onClick={() => setMode("kind")}>
              {"\u56de\u4e0a\u4e00\u9801"}
            </button>
            <button type="button" disabled={busy} className="h-16 flex-[2] rounded-2xl bg-[#0f4c6e] text-3xl font-bold text-white" onClick={() => void lookup()}>
              {busy ? "\u67e5\u8a62\u4e2d" : "\u78ba\u5b9a"}
            </button>
          </div>
        </div>
      ) : null}
      {mode === "pick" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
          <h2 className="text-center text-3xl font-semibold">{"\u6709\u5e7e\u4f4d\u5f8c\u4e5d\u78bc\u76f8\u540c\uff0c\u8acb\u9ede\u81ea\u5df1\u7684\u540d\u5b57"}</h2>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
            {hits.map((hit) => (
              <button
                key={hit.id}
                type="button"
                disabled={busy}
                className="rounded-2xl bg-white px-6 py-5 text-left text-3xl font-bold shadow"
                onClick={() => void registerHit(hit, walk)}
              >
                {maskName(hit.name)}
                <span className="ml-4 text-2xl font-semibold text-[#3d7a96]">{hit.birthdayRoc.slice(0, 3)}</span>
              </button>
            ))}
          </div>
          <button type="button" className="h-14 rounded-2xl bg-white text-xl font-semibold text-[#31586e] shadow" onClick={() => setMode("id")}>
            {"\u56de\u4e0a\u4e00\u9801"}
          </button>
        </div>
      ) : null}
      {mode === "notice" ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="max-w-3xl rounded-[2rem] bg-white px-12 py-12 shadow-[0_16px_36px_rgba(18,42,58,.12)]">
            <p className="text-4xl font-bold leading-snug text-[#16324a]">
              {"\u521d\u8a3a\u75c5\u60a3\uff0c\u639b\u5b8c\u865f\u5f8c\u8acb\u81f3\u6ac3\u53f0\u586b\u5beb\u521d\u8a3a\u55ae"}
            </p>
            <button
              type="button"
              className="mt-10 h-20 min-w-64 rounded-2xl bg-[#0f4c6e] px-8 text-3xl font-bold text-white"
              onClick={() => setMode("done")}
            >
              {"\u6211\u77e5\u9053\u4e86"}
            </button>
          </div>
        </div>
      ) : null}
      {mode === "done" ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="rounded-[2rem] bg-white px-16 py-12 shadow-[0_16px_36px_rgba(18,42,58,.12)]">
            <div className="text-3xl font-bold">{who}</div>
            {number ? <div className="mt-4 text-7xl font-bold text-[#0f4c6e]">{number}</div> : null}
            <div className={number ? "mt-4 text-2xl" : "mt-6 text-4xl font-bold leading-snug"}>{note}</div>
          </div>
          <button type="button" className="mt-8 h-16 w-56 rounded-2xl bg-[#0f4c6e] text-2xl font-bold text-white" onClick={resetHome}>
            {"\u5b8c\u6210"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
