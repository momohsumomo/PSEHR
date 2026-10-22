import { useEffect, useState } from "react";
import { fetchStaff, saveReferralSlip, type ReferralSlipRow } from "@/api/clinicApi";
import { loadClinicRegisterDefaults } from "@/lib/clinicProfile";
import { doctorDisplayName, pickClinicDoctor } from "@/lib/doctorName";
import { autoDittoReplyChart, chartDittoText } from "@/lib/referralDitto";
import { readLocalClinicBundle } from "@/lib/clinicProfile";
import { HIS_FONT } from "@/lib/hisTheme";

const PLATFORM_URL = "https://medvpn.nhi.gov.tw/ipre7000/ipre7000s01.aspx?AUTO=Y";

const PROC: Array<[string, string]> = [
  ["1", "\u5df2\u4e88\u6025\u8a3a\u8655\u7f6e\u4e26\u8f49\u8a3a\u81f3\u91ab\u9662"],
  ["2", "\u5df2\u4e88\u6025\u8a3a\u8655\u7f6e\uff0c\u4e26\u4f4f\u672c\u9662\u75c5\u623f\u6cbb\u7642\u4e2d"],
  ["3", "\u5df2\u5b89\u6392\u4f4f\u672c\u9662\u75c5\u623f\u6cbb\u7642\u4e2d"],
  ["4", "\u5df2\u5b89\u6392\u672c\u9662\u9580\u8a3a\u6cbb\u7642\u4e2d"],
  ["5", "\u5df2\u4e88\u9069\u7576\u8655\u7406\u4e26\u8f49\u56de\u539f\u9662\u6240"],
  ["6", "\u5176\u4ed6"],
];

const box = "w-full border border-[#808080] bg-white px-1 py-0.5";

function rocToday(): string {
  const now = new Date();
  const y = now.getFullYear() - 1911;
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}.${m}.${d}`;
}

function rocDay(text: string): string {
  const raw = (text || "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${String(Number(iso[1]) - 1911).padStart(3, "0")}.${iso[2]}.${iso[3]}`;
  const roc = raw.match(/^(\d{1,3})[./](\d{1,2})[./](\d{1,2})/);
  if (!roc) return "";
  return `${roc[1].padStart(3, "0")}.${roc[2].padStart(2, "0")}.${roc[3].padStart(2, "0")}`;
}

export function ReferralReplyForm({
  row,
  onNote,
  onSaved,
  onClose,
}: {
  row: ReferralSlipRow;
  onNote: (text: string) => void;
  onSaved: () => void;
  onClose: () => void;
}) {
  const clinic = readLocalClinicBundle().profile;
  const [purpose, setPurpose] = useState(row.purpose || "4");
  const [serial, setSerial] = useState(row.serial || "");
  const [replyDay, setReplyDay] = useState(rocToday());
  const [dx, setDx] = useState(row.diagnosis || "");
  const [drugs, setDrugs] = useState(row.drugs || row.treatText || "");
  const [aux, setAux] = useState(row.aux || row.historyText || "");
  const [handoff, setHandoff] = useState(row.handoff || "");
  const [dept, setDept] = useState((row.dept || "11").slice(0, 2));
  const [doctor, setDoctor] = useState(row.doctor || "");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");

  useEffect(() => {
    setPurpose(row.purpose || "4");
    setSerial(row.serial || "");
    setReplyDay(rocDay(row.openedOn || "") || rocToday());
    setDx(row.diagnosis || "");
    setDrugs(row.drugs || row.treatText || "");
    setAux(row.aux || row.historyText || "");
    setHandoff(row.handoff || "");
    setDept((row.dept || "11").slice(0, 2));
    setDoctor(row.doctor || "");
    setHint("");
    const idNo = row.idNo;
    const medicalNo = row.medicalNo;
    const receivedOn = row.openedOn || "";
    const hadDrugs = Boolean((row.treatText || "").trim());
    const hadChief = Boolean((row.aux || row.historyText || "").trim());
    const hadDx = Boolean((row.diagnosis || "").trim());
    const hadDoctor = Boolean((row.doctor || "").trim());
    let cancel = false;
    void (async () => {
      try {
        const staff = await fetchStaff();
        const defaults = loadClinicRegisterDefaults();
        const chosen =
          staff.find((person) => person.id === defaults.defaultDoctorId) ||
          pickClinicDoctor(staff);
        if (cancel) return;
        if (chosen && !hadDoctor) setDoctor(doctorDisplayName(chosen.name, chosen.id) || chosen.name || "");
      } catch {
        /* doctor id is also resolved on the server */
      }
      try {
        const copied = await autoDittoReplyChart({ idNo, medicalNo, receivedOn });
        if (cancel || !copied) return;
        if (!hadDrugs && copied.drugs) setDrugs(copied.drugs);
        if (!hadChief && copied.chief) setAux(copied.chief);
        if (!hadDx && copied.diagnosis) setDx(copied.diagnosis);
        if (copied.drugs || copied.chief || copied.diagnosis) {
          setHint("\u5df2\u81ea\u52d5\u6284\u5165\u6536\u5230\u8f49\u8a3a\u5f8c\u6700\u8fd1\u7684\u4e00\u6b21\u770b\u8a3a\u3002");
        }
      } catch (err: unknown) {
        if (!cancel) setHint(err instanceof Error ? err.message : "\u6284\u770b\u8a3a\u5931\u6557");
      }
    })();
    return () => {
      cancel = true;
    };
  }, [row.id]);

  const copyChart = async (part: "drugs" | "chief") => {
    setHint("\u6b63\u5728\u6284\u9019\u6b21\u770b\u8a3a\u2026");
    try {
      const text = await chartDittoText(row.encounterId || "", part);
      if (part === "drugs") setDrugs(text);
      else setAux(text);
      setHint(part === "drugs" ? "\u5df2\u6284\u5165\u9019\u6b21\u770b\u8a3a\u7684\u91ab\u4ee4\u3002" : "\u5df2\u6284\u5165\u9019\u6b21\u770b\u8a3a\u7684\u4e3b\u8ff0\u3002");
    } catch (err: unknown) {
      setHint(err instanceof Error ? err.message : "\u6284\u770b\u8a3a\u5931\u6557");
    }
  };

  const save = async () => {
    const serialText = serial.trim();
    if (!serialText) {
      onNote("\u8acb\u586b\u8f49\u8a3a\u55ae\u5e8f\u865f\u3002");
      return;
    }
    setBusy(true);
    try {
      await saveReferralSlip({
        ...row,
        kind: "reply",
        serial: serialText,
        diagnosis: dx,
        treatText: drugs,
        historyText: aux,
        note: handoff,
        purpose,
        dept,
        doctor,
        drugs,
        aux,
        handoff,
        status: "\u5df2\u5b58\u6a94",
      });
      onSaved();
      onNote("\u56de\u8986\u5df2\u5b58\u6a94\u3002\u4e0a\u50b3\u8acb\u5230\u53e6\u4e00\u53f0\u96fb\u8166\u7528\u8f49\u8a3a\u4e0a\u50b3\u5de5\u5177\u3002");
    } catch (err: unknown) {
      onNote(err instanceof Error ? err.message : "\u56de\u8986\u6c92\u9001\u51fa");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl border border-black bg-white p-2 text-[13px]" style={{ fontFamily: HIS_FONT }}>
      <div className="mb-2 text-center text-[18px] font-bold">{"\u63a5\u53d7\u91ab\u9662\u8a3a\u7642\u6458\u8981"}</div>
      <div className="mb-2">
        {row.patientName || "\u2014"}
        {row.medicalNo ? ` ${row.medicalNo}` : ""}
        {row.idNo ? ` ${row.idNo}` : ""}
      </div>
      <div className="grid grid-cols-[7rem_1fr] gap-1">
        <div className="border border-black p-1 font-bold">{"\u8655\u7406\u60c5\u5f62"}</div>
        <div className="border border-black p-1">
          {PROC.map(([code, label]) => (
            <label key={code} className="mr-3 inline-flex items-center gap-1">
              <input type="radio" checked={purpose === code} onChange={() => setPurpose(code)} />
              {code}. {label}
            </label>
          ))}
          <div className="mt-1 flex gap-3">
            <label>
              {"\u8f49\u8a3a\u55ae\u5e8f\u865f"}
              <input className={`ml-1 w-44 ${box}`} value={serial} onChange={(e) => setSerial(e.target.value)} />
            </label>
            <label>
              {"\u56de\u8986\u65e5\u671f"}
              <input className={`ml-1 w-28 ${box}`} value={replyDay} onChange={(e) => setReplyDay(e.target.value)} />
            </label>
          </div>
        </div>
        <div className="border border-black p-1 font-bold">{"\u6cbb\u7642\u6458\u8981"}</div>
        <div className="border border-black p-1">
          <label className="mb-1 block">
            {"1. \u4e3b\u8a3a\u65b7"}
            <textarea className={`${box} mt-0.5 min-h-12`} value={dx} onChange={(e) => setDx(e.target.value)} />
          </label>
          <label className="mb-1 block">
            {"2. \u6cbb\u7642\u85e5\u7269\u6216\u624b\u8853\u540d\u7a31"}
            <div className="mt-0.5 flex gap-1">
              <textarea className={`${box} min-h-16`} value={drugs} onChange={(e) => setDrugs(e.target.value)} />
              <button type="button" className="shrink-0 border border-[#808080] bg-[#E8E8E8] px-2 text-[12px] font-bold" onClick={() => void copyChart("drugs")}>
                {"Ditto\u91ab\u4ee4"}
              </button>
            </div>
          </label>
          <label className="block">
            {"3. \u8f14\u52a9\u8a3a\u65b7\u4e4b\u6aa2\u67e5\u7d50\u679c"}
            <div className="mt-0.5 flex gap-1">
              <textarea className={`${box} min-h-16`} value={aux} onChange={(e) => setAux(e.target.value)} />
              <button type="button" className="shrink-0 border border-[#808080] bg-[#E8E8E8] px-2 text-[12px] font-bold" onClick={() => void copyChart("chief")}>
                {"Ditto\u4e3b\u8ff0"}
              </button>
            </div>
          </label>
        </div>
        {hint ? <div className="col-span-2 text-[12px] font-bold text-[#800000]">{hint}</div> : null}
        <div className="border border-black p-1">{"\u9662\u6240\u540d\u7a31"}</div>
        <div className="border border-black p-1">
          {clinic.clinicName || "\u2014"}
          <span className="ml-3">{"\u96fb\u8a71 "}{clinic.phone || "\u2014"}</span>
        </div>
        <div className="border border-black p-1">{"\u8a3a\u6cbb\u91ab\u5e2b"}</div>
        <div className="flex gap-2 border border-black p-1">
          <input className={`w-36 ${box}`} value={doctor} onChange={(e) => setDoctor(e.target.value)} />
          <label>
            {"\u79d1\u5225"}
            <input className={`ml-1 w-16 ${box}`} value={dept} onChange={(e) => setDept(e.target.value)} />
          </label>
        </div>
        <div className="border border-black p-1">{"\u91ab\u5e2b\u4ea4\u73ed\u6ce8\u610f\u4e8b\u9805"}</div>
        <div className="border border-black p-1">
          <textarea className={`${box} min-h-14`} value={handoff} onChange={(e) => setHandoff(e.target.value)} />
        </div>
      </div>
      <div className="mt-2 flex gap-1">
        <button type="button" className="border border-[#808080] bg-[#D4D0C8] px-2 py-1 font-bold" onClick={() => window.open(PLATFORM_URL, "_blank", "noopener")}>
          {"\u958b\u555f\u8f49\u8a3a\u5e73\u53f0"}
        </button>
        <button type="button" disabled={busy} className="border border-[#004d00] bg-[#C8F0C8] px-3 py-1 font-bold disabled:opacity-50" onClick={() => void save()}>
          {"F9 \u5b58\u6a94"}
        </button>
        <button type="button" className="border border-[#808080] bg-[#FFFF80] px-3 py-1 font-bold" onClick={onClose}>
          Esc
        </button>
      </div>
    </div>
  );
}
