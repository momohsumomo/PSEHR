import { useEffect, useMemo, useState } from "react";
import { HIS, HIS_FONT } from "@/lib/hisTheme";
import { openPrintPreview } from "@/lib/printJob";
import { buildReferralSlipHtml } from "@/lib/clinicPrintDocs";
import { doctorDisplayName, pickClinicDoctor } from "@/lib/doctorName";
import { fetchStaff, saveReferralSlip } from "@/api/clinicApi";
import { readLocalClinicBundle } from "@/lib/clinicProfile";
import { HospitalLookupDialog, type NhiHospital } from "@/components/clinic/HospitalLookupDialog";
import { useEscLayer } from "@/hooks/useEscLayer";
import { formatBirthdayRoc } from "@/lib/patientSearch";

export type ReferralSeed = {
  name: string;
  sex: string;
  birthday: string;
  medicalNo: string;
  idNo: string;
  phone: string;
  address: string;
  chief: string;
  diagnoses: string;
  meds: string;
  doctorName: string;
  allergy?: string;
  exam?: string;
  examOn?: string;
  medOn?: string;
};

export type ReferralArchive = {
  destHosp: string;
  destCode: string;
  destAddr: string;
  destTel: string;
  destDeptLabel: string;
  ourDept: string;
  clinicTel: string;
  fax: string;
  email: string;
  validUntil: string;
  purpose: string;
  suggestDoctor: string;
};

const DEPTS = [
  "11 \u76ae\u819a\u79d1",
  "10 \u5bb6\u91ab\u79d1",
  "01 \u5167\u79d1",
  "02 \u5916\u79d1",
  "03 \u5c0f\u5152\u79d1",
  "04 \u5a66\u7522\u79d1",
  "06 \u5fa9\u5065\u79d1",
  "14 \u6574\u578b\u5916\u79d1",
];
const PURPOSES: Array<[string, string]> = [
  ["1", "\u6025\u8a3a\u6cbb\u7642"],
  ["2", "\u4f4f\u9662\u6cbb\u7642"],
  ["3", "\u9580\u8a3a\u6cbb\u7642"],
  ["4", "\u9032\u4e00\u6b65\u6aa2\u67e5"],
  ["5", "\u8f49\u56de\u8f49\u51fa\u6216\u9069\u7576\u4e4b\u9662\u6240\u7e7c\u7e8c"],
  ["9", "COVID-19\u500b\u6848\uff08\u542b\u7591\u4f3c\uff09\u8f49\u8a3a\u6cbb\u7642"],
  ["6", "\u5176\u4ed6\u76ee\u7684"],
  ["A", "\u8f49\u4ecb\u5176\u4ed6\u8a66\u8fa6\u8a08\u756b\u6216\u65b9\u6848"],
];

const PLATFORM_URL = "https://medvpn.nhi.gov.tw/ipre7000/ipre7000s01.aspx?AUTO=Y";
const SETTINGS_KEY = "wundadi.referralSettings.v1";

type ReferralSettings = {
  validDays: number;
  includeAllergy: boolean;
  writeDaOnSave: boolean;
  defaultDept: string;
  defaultPurpose: string;
  suggestDoctors: string[];
};

const DEFAULT_SETTINGS: ReferralSettings = {
  validDays: 14,
  includeAllergy: true,
  writeDaOnSave: false,
  defaultDept: "11",
  defaultPurpose: "4",
  suggestDoctors: [],
};

function loadReferralSettings(): ReferralSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, suggestDoctors: [] };
    const parsed = JSON.parse(raw) as Partial<ReferralSettings>;
    const days = Number(parsed.validDays);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      validDays: Number.isFinite(days) && days > 0 ? days : 14,
      includeAllergy: parsed.includeAllergy !== false,
      writeDaOnSave: parsed.writeDaOnSave === true,
      defaultDept: String(parsed.defaultDept || "11"),
      defaultPurpose: String(parsed.defaultPurpose || "4"),
      suggestDoctors: Array.isArray(parsed.suggestDoctors) ? parsed.suggestDoctors.map(String).filter(Boolean) : [],
    };
  } catch {
    return { ...DEFAULT_SETTINGS, suggestDoctors: [] };
  }
}

function saveReferralSettings(next: ReferralSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
}

type Props = {
  open: boolean;
  seed: ReferralSeed;
  onClose: () => void;
  encounterId?: string;
  slipId?: string;
  archive?: ReferralArchive | null;
  onSaved?: () => void;
};

function rocToday(): string {
  const d = new Date();
  const y = d.getFullYear() - 1911;
  return `${String(y).padStart(3, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function plusDays(roc: string, days: number): string {
  const [ys, ms, ds] = roc.split(".");
  const dt = new Date(Number(ys) + 1911, Number(ms) - 1, Number(ds));
  dt.setDate(dt.getDate() + days);
  const y = dt.getFullYear() - 1911;
  return `${String(y).padStart(3, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}.${String(dt.getDate()).padStart(2, "0")}`;
}

function deptChoice(code: string, fallback: string): string {
  const key = code.trim();
  const hit = DEPTS.find((item) => item === key || item.startsWith(key));
  return hit || (key && key !== "\u2014" ? key : fallback);
}

function markedPurpose(raw: string): string {
  const text = raw.trim();
  if (text.length >= 5 && /[YN]/.test(text)) {
    const index = text.indexOf("Y");
    if (index >= 0 && index < 5) return String(index + 1);
  }
  return PURPOSES.some(([code]) => code === text) ? text : "";
}

export function ReferralSlipDialog({ open, seed, onClose, encounterId, slipId, archive, onSaved }: Props) {
  const today = useMemo(() => rocToday(), [open]);
  const [hosp, setHosp] = useState("");
  const [hospCode, setHospCode] = useState("");
  const [hospAddr, setHospAddr] = useState("");
  const [hospTel, setHospTel] = useState("");
  const [hospPickOpen, setHospPickOpen] = useState(false);
  const [dept, setDept] = useState(DEPTS[0]);
  const [ourDept, setOurDept] = useState(DEPTS[0]);
  const [suggestDoc, setSuggestDoc] = useState("");
  const [purpose, setPurpose] = useState("4");
  const [purposeOther, setPurposeOther] = useState("");
  const [doctor, setDoctor] = useState(seed.doctorName || "");
  const [tel, setTel] = useState("06-2882555");
  const [fax, setFax] = useState("");
  const [email, setEmail] = useState("");
  const [valid, setValid] = useState("");
  const [copy1, setCopy1] = useState(true);
  const [copy2, setCopy2] = useState(true);
  const [copy3, setCopy3] = useState(false);
  const [writeDa, setWriteDa] = useState(false);
  const [note, setNote] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEscLayer([
    { open: hospPickOpen, close: () => setHospPickOpen(false) },
    { open: settingsOpen, close: () => setSettingsOpen(false) },
    { open, close: onClose },
  ]);
  const [settings, setSettings] = useState<ReferralSettings>(() => loadReferralSettings());
  const [draft, setDraft] = useState<ReferralSettings>(() => loadReferralSettings());
  const [doctorPick, setDoctorPick] = useState("");
  const [newDoctor, setNewDoctor] = useState("");
  const [localSlipId, setLocalSlipId] = useState(slipId || "");

  useEffect(() => {
    if (!open) return;
    setLocalSlipId(slipId || "");
    const saved = loadReferralSettings();
    setSettings(saved);
    const named = doctorDisplayName(seed.doctorName) || seed.doctorName || "";
    let cancel = false;
    if (named) {
      setDoctor(named);
    } else {
      void fetchStaff()
        .then((rows) => {
          if (cancel) return;
          const doc = pickClinicDoctor(rows);
          if (doc) setDoctor(doctorDisplayName(doc.name, doc.id) || doc.name);
        })
        .catch(() => undefined);
    }
    const deptHit = DEPTS.find((d) => d.startsWith(saved.defaultDept)) || DEPTS[0];
    const ours = deptChoice(archive?.ourDept || saved.defaultDept, deptHit);
    setOurDept(ours);
    setDept(archive ? deptChoice(archive.destDeptLabel, ours) : deptHit);
    const marked = archive ? markedPurpose(archive.purpose) : "";
    setPurpose(marked || saved.defaultPurpose || "4");
    setWriteDa(saved.writeDaOnSave);
    setValid(archive?.validUntil || plusDays(rocToday(), saved.validDays));
    if (archive) {
      setHosp(archive.destHosp);
      setHospCode(archive.destCode);
      setHospAddr(archive.destAddr);
      setHospTel(archive.destTel);
      if (archive.clinicTel) setTel(archive.clinicTel);
      setFax(archive.fax);
      setEmail(archive.email);
      setSuggestDoc(archive.suggestDoctor);
    }
    return () => {
      cancel = true;
    };
  }, [open, seed.doctorName, slipId, archive]);

  if (!open) return null;

  const chiefOut = settings.includeAllergy && seed.allergy
    ? `${seed.chief}\n\u904e\u654f\uff1a${seed.allergy}`
    : seed.chief;

  const openPlatform = () => {
    window.open(PLATFORM_URL, "_blank", "noopener");
    setNote("\u5df2\u958b\u555f\u5065\u4fdd\u8f49\u8a3a\u5e73\u53f0\u7db2\u9801\u3002\u8acb\u81ea\u884c\u767b\u5165\u5f8c\u4e0a\u50b3\uff0c\u9019\u88e1\u4e0d\u4ee3\u767b\u5165\u3001\u4e0d\u4ee3\u6309\u3002");
  };

  const openSettings = () => {
    setDraft(loadReferralSettings());
    setDoctorPick("");
    setNewDoctor("");
    setSettingsOpen(true);
  };

  const applySettings = () => {
    const next = {
      ...draft,
      validDays: Number.isFinite(draft.validDays) && draft.validDays > 0 ? draft.validDays : 14,
      suggestDoctors: draft.suggestDoctors.map((name) => name.trim()).filter(Boolean),
    };
    saveReferralSettings(next);
    setSettings(next);
    const deptHit = DEPTS.find((d) => d.startsWith(next.defaultDept)) || DEPTS[0];
    setOurDept(deptHit);
    setDept(deptHit);
    setPurpose(next.defaultPurpose || "4");
    setWriteDa(next.writeDaOnSave);
    setValid(plusDays(rocToday(), next.validDays));
    setSettingsOpen(false);
    setNote("\u8f49\u8a3a\u53c3\u6578\u5df2\u5b58\u5728\u9019\u53f0\u96fb\u8166\u3002\u5370\u8868\u6a5f\u4ecd\u7528\u9662\u6240\u8cc7\u6599\u7684\u5217\u5370\u8a2d\u5b9a\u3002");
  };

  const saveXml = () => {
    if (!seed.name && !encounterId) {
      setNote("\u8acb\u5148\u9078\u4e00\u4f4d\u75c5\u60a3\u3002");
      return;
    }
    const dx = seed.diagnoses.split(/\n/).map((line) => line.trim()).filter(Boolean)[0] || "";
    void saveReferralSlip({
      id: localSlipId || undefined,
      kind: "out",
      encounterId: encounterId || "",
      patientName: seed.name,
      medicalNo: seed.medicalNo,
      idNo: seed.idNo,
      destHosp: hosp,
      destCode: hospCode,
      dept,
      purpose,
      doctor,
      diagnosis: dx,
      note: chiefOut,
      validUntil: valid,
      status: "\u8349\u7a3f",
    }).then((row) => {
      setLocalSlipId(row.id);
      setNote("\u5df2\u8a18\u5165\u8f49\u51fa\u540d\u55ae\u3002\u4e0a\u50b3\u8acb\u81ea\u884c\u958b\u8f49\u8a3a\u5e73\u53f0\uff0c\u9019\u88e1\u4e0d\u4ee3\u6309\u3002\u56de\u8986\u8acb\u5230\u96fb\u5b50\u8f49\u8a3a\u7684\u56de\u8986\u3002");
      onSaved?.();
    }).catch((err: unknown) => {
      setNote(err instanceof Error ? err.message : "\u8f49\u51fa\u540d\u55ae\u5b58\u6a94\u5931\u6557");
    });
  };

  const printSlip = () => {
    const clinic = readLocalClinicBundle().profile;
    const copies: Array<[string, string]> = [];
    if (copy1) copies.push(["\u7b2c\u4e00\u806f", "\u63a5\u53d7\u8f49\u8a3a\u91ab\u9662\u3001\u8a3a\u6240\u6240\u7559\u5b58"]);
    if (copy2) copies.push(["\u7b2c\u4e8c\u806f", "\u63a5\u53d7\u8f49\u8a3a\u91ab\u9662\u3001\u8a3a\u6240\u56de\u8986\u8f49\u51fa"]);
    if (copy3) copies.push(["\u7b2c\u4e09\u806f", "\u539f\u8a3a\u7642\u91ab\u9662\u3001\u8a3a\u6240\u7559\u5b58"]);
    const pages = buildReferralSlipHtml({
      clinicName: clinic.clinicName || "",
      clinicCode: clinic.clinicCode || "",
      clinicAddress: clinic.address || "",
      clinicPhone: clinic.phone || "",
      name: seed.name || "",
      sex: seed.sex || "",
      birthday: seed.birthday || "",
      idNo: seed.idNo || "",
      phone: seed.phone || "",
      address: seed.address || "",
      chief: seed.chief || "",
      allergy: settings.includeAllergy ? (seed.allergy || "") : "",
      diagnoses: seed.diagnoses || "",
      examOn: seed.examOn || "",
      exam: seed.exam || "",
      meds: seed.meds || "",
      medOn: seed.medOn != null ? seed.medOn : today,
      purpose,
      purposeOther,
      doctor: doctor || "",
      ourDept,
      tel: tel || clinic.phone || "",
      fax: fax || "",
      email: email || "",
      opened: today,
      hosp: hosp || "",
      hospCode,
      dept,
      suggestDoc: suggestDoc || "",
      hospAddr,
      hospTel,
      valid: valid || "",
      copies,
    });
    openPrintPreview({
      kind: "report",
      layout: "paged",
      setupId: "referral",
      title: "\u5168\u6c11\u5065\u5eb7\u4fdd\u96aa\u8f49\u8a3a\u55ae",
      patientName: seed.name,
      medicalNo: seed.medicalNo,
      lines: [],
      bodyHtml: pages,
    });
  };

  const field = "border border-[#808080] bg-white px-1 py-0 text-[12px]";
  const btn = "flex min-w-0 flex-1 items-center justify-center border border-[#808080] bg-[#D4D0C8] px-1 py-1 text-[13px] font-bold";

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/40 p-2">
      <div className="flex max-h-[94vh] w-[min(68rem,98vw)] flex-col border bg-[#F0F0F0] shadow-lg" style={{ borderColor: HIS.chromeDark, fontFamily: HIS_FONT }}>
        <div className="flex shrink-0 items-center bg-[#2060A0] px-2 py-1 text-xs font-bold text-white">
          <span>{"\u8f49\u8a3a\u7cfb\u7d71"}</span>
          <button type="button" className="ml-auto px-2" onClick={onClose}>{"\u95dc\u9589"}</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2 text-[12px]">
          <div className="mb-1 grid grid-cols-2 gap-x-3 border bg-white px-2 py-1" style={{ borderColor: "#808080" }}>
            <div>{"\u59d3\u540d\uff1a"}{seed.name || "\u2014"}{"\u3000\u6027\u5225\uff1a"}{seed.sex || "\u2014"}{"\u3000\u751f\u65e5\uff1a"}{formatBirthdayRoc(seed.birthday) || "\u2014"}</div>
            <div>{"\u75c5\u6b77\u865f\u78bc\uff1a"}{seed.medicalNo || "\u2014"}</div>
            <div>{"\u8eab\u5206\u8b49\uff1a"}{seed.idNo || "\u2014"}{"\u3000\u96fb\u8a71\uff1a"}{seed.phone || "\u2014"}</div>
            <div className="truncate">{"\u5730\u5740\uff1a"}{seed.address || "\u2014"}</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="font-bold text-[#800000]">{"\u4e3b\u8a34\u53ca\u7c21\u77ed\u75c5\u4e2d"}</label>
              <textarea readOnly className="h-16 border bg-[#FFF0F8] p-1" value={chiefOut} />
              <label className="font-bold text-[#800000]">{"\u8a3a\u65b7"}</label>
              <textarea readOnly className="h-16 border bg-[#E8FFE8] p-1" value={seed.diagnoses} />
              <label className="font-bold text-[#800000]">{"\u672c\u6b21\u7528\u85e5"}</label>
              <textarea readOnly className="h-16 border bg-[#F4F4F4] p-1" value={seed.meds} />
            </div>
            <div className="flex flex-col gap-1">
              <div className="font-bold text-[#000080]">{"\u5efa\u8b70\u8f49\u8a3a\u79d1\u5225"}</div>
              <label className="flex items-center gap-1">{"\u91ab\u9662\u540d\u7a31"}
                <input className={`min-w-0 flex-1 ${field}`} value={hosp} onChange={(e) => { setHosp(e.target.value); setHospCode(""); }} />
                <button type="button" className="border border-[#808080] bg-[#D4D0C8] px-1 font-bold" title={"\u91ab\u7642\u9662\u6240\u901f\u67e5"} onClick={() => setHospPickOpen(true)}>{"\u2315"}</button>
              </label>
              {hospCode ? <div className="text-[11px] text-[#000080]">{hospCode}</div> : null}
              <label className="flex items-center gap-1">{"\u8f49\u8a3a\u79d1\u5225"}
                <select className={field} value={dept} onChange={(e) => setDept(e.target.value)}>{(DEPTS.includes(dept) ? DEPTS : [...DEPTS, dept]).map((d) => <option key={d}>{d}</option>)}</select>
              </label>
              <label className="flex items-center gap-1">{"\u5efa\u8b70\u91ab\u5e2b"}
                <input className={`min-w-0 flex-1 ${field}`} list="referral-suggest-doctors" value={suggestDoc} onChange={(e) => setSuggestDoc(e.target.value)} />
                <datalist id="referral-suggest-doctors">{settings.suggestDoctors.map((name) => <option key={name} value={name} />)}</datalist>
              </label>
              <div className="font-bold text-[#000080]">{"\u8f49\u8a3a\u76ee\u7684"}</div>
              {PURPOSES.map(([code, label]) => (
                <label key={code} className="flex items-center gap-1">
                  <input type="radio" checked={purpose === code} onChange={() => setPurpose(code)} />
                  {code + ". " + label}
                  {code === "6" && purpose === "6" ? <input className={`ml-1 w-28 ${field}`} value={purposeOther} onChange={(e) => setPurposeOther(e.target.value)} /> : null}
                </label>
              ))}
              <div className="mt-1 font-bold text-[#000080]">{"\u539f\u9662\u6240\u53ca\u8cc7\u6599"}</div>
              <label className="flex items-center gap-1">{"\u8ca0\u8cac\u91ab\u5e2b"}<input className={`w-28 ${field}`} value={doctor} onChange={(e) => setDoctor(e.target.value)} /><span>{"\u79d1\u5225 " + ourDept}</span></label>
              <label className="flex items-center gap-1">{"\u5c08\u7dda\u96fb\u8a71"}<input className={`w-28 ${field}`} value={tel} onChange={(e) => setTel(e.target.value)} />{"\u50b3\u771f"}<input className={`w-28 ${field}`} value={fax} onChange={(e) => setFax(e.target.value)} /></label>
              <label className="flex items-center gap-1">{"\u96fb\u5b50\u4fe1\u7bb1"}<input className={`min-w-0 flex-1 ${field}`} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
              <div>{"\u8f49\u8a3a\u65e5\u671f " + today + "\u3000\u6709\u6548\u65e5\u671f "}<input className={`w-24 ${field}`} value={valid} onChange={(e) => setValid(e.target.value)} /></div>
            </div>
          </div>
          <div className="mt-2 border bg-[#E8FFE8] px-2 py-1" style={{ borderColor: "#60A060" }}>
            <div className="font-bold">{"\u5b58\u6a94\u8207\u5217\u5370"}</div>
            <label className="mr-3"><input type="checkbox" checked={copy1} onChange={(e) => setCopy1(e.target.checked)} /> {"\u7b2c\u4e00\u806f\uff1a\u63a5\u53d7\u8f49\u8a3a\u91ab\u9662\u3001\u8a3a\u6240\u6240\u7559\u5b58"}</label>
            <label className="mr-3"><input type="checkbox" checked={copy2} onChange={(e) => setCopy2(e.target.checked)} /> {"\u7b2c\u4e8c\u806f\uff1a\u63a5\u53d7\u8f49\u8a3a\u91ab\u9662\u3001\u8a3a\u6240\u56de\u8986\u8f49\u51fa"}</label>
            <label className="mr-3"><input type="checkbox" checked={copy3} onChange={(e) => setCopy3(e.target.checked)} /> {"\u7b2c\u4e09\u806f\uff1a\u8f49\u51fa\u91ab\u9662\u3001\u8a3a\u6240\u6240\u7559\u5b58"}</label>
            <label><input type="checkbox" checked={writeDa} onChange={(e) => setWriteDa(e.target.checked)} /> {"\u5b58\u6a94\u6642\u5beb\u5165\u5c31\u91ab\u985e\u5225 DA \u65bcIC\u5361"}</label>
          </div>
          {note ? <p className="mt-1 text-[12px] text-[#004000]">{note}</p> : null}
        </div>
        <div className="flex shrink-0 gap-1 border-t p-1" style={{ borderColor: HIS.chromeDark }}>
          <button type="button" className={btn} onClick={openPlatform}>{"\u958b\u555f\u8f49\u8a3a\u5e73\u53f0"}</button>
          <button type="button" className={btn} onClick={openSettings}>{"\u7de8\u8f2f\u53c3\u6578\u8a2d\u5b9a"}</button>
          <button type="button" className={btn} onClick={printSlip}>{"\u5217\u5370"}</button>
          <button type="button" className="flex min-w-0 flex-1 items-center justify-center border border-[#808080] bg-[#C8F0C8] px-1 py-1 text-[13px] font-bold" onClick={saveXml}>{"F9 \u5b58\u6a94"}</button>
          <button type="button" className="flex min-w-0 flex-1 items-center justify-center border border-[#808080] bg-[#FFFF80] px-1 py-1 text-[13px] font-bold" onClick={onClose}>Esc</button>
        </div>
      </div>
      {settingsOpen ? (
        <div className="fixed inset-0 z-[96] flex items-center justify-center bg-black/30 p-2">
          <div className="w-[min(28rem,96vw)] border border-[#808080] bg-[#F6F1C8] p-3 text-[13px] shadow-lg" style={{ fontFamily: HIS_FONT }}>
            <div className="mb-2 font-bold">{"\u8f49\u8a3a\u8a2d\u5b9a\u7de8\u8f2f\u7cfb\u7d71"}</div>
            <label className="mb-1 flex items-center justify-between gap-2">
              <span>{"\u8f49\u8a3a\u55ae\u7684\u6709\u6548\u5929\u6578"}</span>
              <span className="flex items-center gap-1">
                <input className="w-16 border border-[#808080] bg-white px-1" type="number" min={1} max={365} value={draft.validDays} onChange={(e) => setDraft({ ...draft, validDays: Number(e.target.value) })} />
                <button type="button" className="border border-[#808080] bg-[#D4D0C8] px-1" onClick={() => setDraft({ ...draft, validDays: Math.min(365, (draft.validDays || 14) + 1) })}>{"\u25b2"}</button>
                <button type="button" className="border border-[#808080] bg-[#D4D0C8] px-1" onClick={() => setDraft({ ...draft, validDays: Math.max(1, (draft.validDays || 14) - 1) })}>{"\u25bc"}</button>
              </span>
            </label>
            <label className="mb-1 flex items-center justify-between gap-2">
              <span>{"\u57f7\u884c\u8f49\u8a3a\u662f\u5426\u52a0\u5165\u904e\u654f\u8a18\u8f09"}</span>
              <select className="border border-[#808080] bg-white px-1" value={draft.includeAllergy ? "Y" : "N"} onChange={(e) => setDraft({ ...draft, includeAllergy: e.target.value === "Y" })}>
                <option value="Y">Y</option>
                <option value="N">N</option>
              </select>
            </label>
            <label className="mb-1 flex items-center justify-between gap-2">
              <span>{"\u9810\u8a2d\u5b58\u6a94\u6642\u5beb\u5165\u5c31\u91ab\u91ab\u5e2b\u985e\u5225DA\u65bcIC\u5361"}</span>
              <select className="border border-[#808080] bg-white px-1" value={draft.writeDaOnSave ? "Y" : "N"} onChange={(e) => setDraft({ ...draft, writeDaOnSave: e.target.value === "Y" })}>
                <option value="Y">Y</option>
                <option value="N">N</option>
              </select>
            </label>
            <label className="mb-1 flex items-center justify-between gap-2">
              <span>{"\u8f49\u8a3a\u79d1\u5225\u9810\u8a2d"}</span>
              <select className="border border-[#808080] bg-white px-1" value={draft.defaultDept} onChange={(e) => setDraft({ ...draft, defaultDept: e.target.value })}>
                {DEPTS.map((d) => <option key={d} value={d.slice(0, 2)}>{d}</option>)}
              </select>
            </label>
            <label className="mb-2 flex items-center justify-between gap-2">
              <span>{"\u8f49\u8a3a\u76ee\u7684\u9810\u8a2d"}</span>
              <select className="max-w-[14rem] border border-[#808080] bg-white px-1" value={draft.defaultPurpose} onChange={(e) => setDraft({ ...draft, defaultPurpose: e.target.value })}>
                {PURPOSES.map(([code, label]) => <option key={code} value={code}>{code + ". " + label}</option>)}
              </select>
            </label>
            <div className="mb-1 font-bold">{"\u5efa\u8b70\u91ab\u5e2b\u9078\u55ae"}</div>
            <div className="mb-1 flex gap-1">
              <input className="min-w-0 flex-1 border border-[#808080] bg-white px-1" value={newDoctor} onChange={(e) => setNewDoctor(e.target.value)} />
              <button type="button" className="border border-[#808080] bg-[#D4D0C8] px-2" onClick={() => {
                const name = newDoctor.trim();
                if (!name || draft.suggestDoctors.includes(name)) return;
                setDraft({ ...draft, suggestDoctors: [...draft.suggestDoctors, name] });
                setNewDoctor("");
              }}>{"\u52a0\u5165"}</button>
            </div>
            <select className="mb-2 h-24 w-full border border-[#808080] bg-white" value={doctorPick} onChange={(e) => setDoctorPick(e.target.value)}>
              {draft.suggestDoctors.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <div className="flex justify-end gap-1">
              <button type="button" className="border border-[#808080] bg-[#D4D0C8] px-2 py-1" onClick={() => setDraft({ ...draft, suggestDoctors: draft.suggestDoctors.filter((name) => name !== doctorPick) })}>{"\u79fb\u9664\u8a72\u9078\u55ae\u91ab\u5e2b"}</button>
              <button type="button" className="border border-[#808080] bg-[#D4D0C8] px-2 py-1" onClick={applySettings}>{"\u5b58\u6a94"}</button>
              <button type="button" className="border border-[#808080] bg-[#D4D0C8] px-2 py-1" onClick={() => setSettingsOpen(false)}>{"\u96e2\u958b"}</button>
            </div>
          </div>
        </div>
      ) : null}
      <HospitalLookupDialog
        open={hospPickOpen}
        onClose={() => setHospPickOpen(false)}
        onPick={(row: NhiHospital) => {
          setHosp(row.name);
          setHospCode(row.code);
          setHospAddr(row.address);
          setHospTel(row.phone);
          setHospPickOpen(false);
        }}
      />
    </div>
  );
}
