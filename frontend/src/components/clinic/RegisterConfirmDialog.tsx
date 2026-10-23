import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  fetchPatient,
  fetchPatientConditions,
  fetchPatientEncounters,
  fetchStaff,
  fetchIdCategorySettings,
  fetchSameDayEncounters,
  type ApiStaffRecord,
  type CardFaultReport,
} from "@/api/clinicApi";
import { CardFaultPanel } from "@/components/clinic/CardFaultPanel";
import { doctorDisplayName, pickClinicDoctor } from "@/lib/doctorName";
import {
  type IcException,
  type RegisterEditForm,
} from "@/components/clinic/RegisterEditDialog";
import { applyAgeFees, ageYearsFromRoc, policyFromFees } from "@/lib/ageFee";
import { formatBirthdayRoc } from "@/lib/patientSearch";
import { readLocalClinicBundle } from "@/lib/clinicProfile";
import { loadClinicRegisterDefaults, mapApiPatientToHit } from "@/lib/patientSearch";
import { cardIdentityBenefit } from "@/lib/cardIdentity";
import { canonicalIdCategory, matchIdCategory } from "@/lib/idCategory";
import { visitNeedsFeeSchedule } from "@/lib/visitFees";
import { NHI_NOCARD_REASONS, needsNhiNoCardReason } from "@/lib/registerModes";
import { IdCategoryTableDialog } from "@/components/clinic/IdCategoryTableDialog";
import { HospitalLookupDialog } from "@/components/clinic/HospitalLookupDialog";
import { BAD_CARD_REASON } from "@/lib/nocardClaim";
import { HisFixedClockInput } from "@/components/clinic/HisFixedClockInput";
import { normalizeClock } from "@/lib/queueOrder";
import { lastClinicDept, loadClinicSession } from "@/lib/clinicSession";
import { roomNumber } from "@/lib/roomMark";

type Props = {
  open: boolean;
  encounterDate: string;
  busy?: boolean;
  seqBusy?: boolean;
  seqNote?: string | null;
  error?: string | null;
  diagnose?: CardFaultReport | null;
  form: RegisterEditForm;
  onChange: (patch: Partial<RegisterEditForm>) => void;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  onReadCard?: () => Promise<void>;
  /** 目前這個頁面的時段。新掛號固定掛在這裡，不跟時鐘改。 */
  lockedShift?: string;
  /** Check-in only. Blank or zero reg and copay take the normal schedule. */
  priceBlankFees?: boolean;
};

type HistRow = {
  date: string;
  dept: string;
  code: string;
  dx: string;
  doctor: string;
};

/** 醫聖掛號確認窗右側快捷案件格（對應案件／就醫類別／讀卡例外）。 */
const QUICK_CASES: {
  label: string;
  caseNo: string;
  treatmentItem: string;
  icException?: IcException;
  copayCode?: string;
  kind?: "selfPay" | "appointment";
}[] = [
  { label: "01 西醫門診", caseNo: "01", treatmentItem: "01" },
  { label: "04 西醫慢性", caseNo: "04", treatmentItem: "01" },
  { label: "轉診", caseNo: "轉", treatmentItem: "01", copayCode: "D30" },
  { label: "08 慢箋領藥", caseNo: "08", treatmentItem: "01" },
  { label: "09 預防保健", caseNo: "A3", treatmentItem: "08" },
  { label: "急診", caseNo: "02", treatmentItem: "04" },
  { label: "自費", caseNo: "9X", treatmentItem: "01", icException: "selfPay", kind: "selfPay" as const },
  { label: "預約", caseNo: "01", treatmentItem: "01", kind: "appointment" as const },
  { label: "無卡例外", caseNo: "01", treatmentItem: "01", icException: "noCard" },
  { label: "補卡", caseNo: "01", treatmentItem: "01", icException: "afterCheck" },
  { label: "紙卡", caseNo: "01", treatmentItem: "01", icException: "paper" },
  { label: "流感疫苗", caseNo: "A3", treatmentItem: "08", copayCode: "" },
  { label: "職傷", caseNo: "01", treatmentItem: "01", copayCode: "" },
  { label: "複診", caseNo: "01", treatmentItem: "01" },
];

function isoToRocDots(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return iso || "—";
  const y = Number(m[1]) - 1911;
  return `${String(y).padStart(3, "0")}.${m[2]}.${m[3]}`;
}

function rocDotsFrom7(roc: string): string {
  return formatBirthdayRoc(roc) || "\u2014";
}

function ageFromRoc(roc: string): string {
  const d = roc.replace(/\D/g, "");
  if (d.length < 7) return "—";
  const y = Number(d.slice(0, 3)) + 1911;
  const mo = Number(d.slice(3, 5));
  const day = Number(d.slice(5, 7));
  if (!y || !mo || !day) return "—";
  const today = new Date();
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < day)) age -= 1;
  return age >= 0 ? String(age) : "—";
}

const COPAY_FIXED = "50";

function identityFeePatch(
  code: string,
  hit: { deposit?: number; reg_fee?: number; copay?: number } | undefined,
  clinicReg: string,
  keepDeposit: boolean,
  personDisc?: string,
): { note: string; patch: Partial<RegisterEditForm> } {
  const id = canonicalIdCategory(code) || code.trim();
  const base = Number(clinicReg) || 0;
  const discount = hit?.reg_fee != null ? Math.max(0, Number(hit.reg_fee) || 0) : 0;
  const reg = String(Math.max(0, base - discount));
  const waive = personDisc === "2" || Number(hit?.copay) > 0;
  const disc = waive ? COPAY_FIXED : "0";
  const patch: Partial<RegisterEditForm> = {
    regFee: reg,
    copayAmt: COPAY_FIXED,
    copayDiscAmt: disc,
  };
  if (keepDeposit && hit?.deposit != null) patch.deposit = String(hit.deposit);
  const depositNote = patch.deposit != null ? `\u3000\u62bc\u91d1 ${patch.deposit}` : "";
  const waiveNote = waive ? `\u3000\u90e8\u5206\u8ca0\u64d4\u512a\u5f85` : "";
  return {
    note: `\u8eab\u5206 ${id || "\u2014"}\u3000\u639b\u8cbb\u512a\u5f85 ${discount}\u3000\u5be6\u6536\u639b\u865f ${reg}\u3000\u90e8\u5206\u8ca0\u64d4 ${COPAY_FIXED}${waiveNote}${depositNote}`,
    patch,
  };
}

function pricedVisitPatch(
  base: Partial<RegisterEditForm>,
  aged: { regFee: string; copayAmt: string; copayDiscAmt: string },
  selfPay: boolean,
  feesOnly: boolean,
): Partial<RegisterEditForm> {
  const fees: Partial<RegisterEditForm> = {
    regFee: aged.regFee,
    copayAmt: aged.copayAmt,
    copayDiscAmt: aged.copayDiscAmt,
    ...(selfPay ? { copayCode: "" } : {}),
  };
  return feesOnly ? fees : { ...base, ...fees };
}

/** Identity deposit is the amount for a deposit hold. A card visit stores none. */
function feesForVisit(
  icException: string,
  code: string,
  hit: { deposit?: number; reg_fee?: number; copay?: number } | undefined,
  clinicReg: string,
  personDisc?: string,
): { note: string; patch: Partial<RegisterEditForm> } {
  const applied = identityFeePatch(code, hit, clinicReg, icException === "deposit", personDisc);
  if (!icException || icException === "ic") applied.patch.deposit = "";
  return applied;
}

function withCardIdentity(
  patch: Partial<RegisterEditForm>,
  mark: string | undefined,
  selfPay: boolean,
): Partial<RegisterEditForm> {
  const card = cardIdentityBenefit(mark);
  if (!card || selfPay) return patch;
  const next: Partial<RegisterEditForm> = { ...patch };
  if (card.waiveBasic) {
    const gross = String(next.copayAmt ?? "0");
    next.copayDiscAmt = gross === "0" ? "0" : gross;
  }
  if (card.copayCode) next.copayCode = card.copayCode;
  return next;
}

function cardIdentityNote(mark: string | undefined): string {
  const card = cardIdentityBenefit(mark);
  return card ? `\u5065\u4fdd\u5361 ${card.label}` : "";
}

function shiftCode(shift: string): string {
  if (shift === "下午") return "2";
  if (shift === "晚上") return "3";
  return "1";
}

function shiftFromCode(code: string): string {
  if (code === "2") return "下午";
  if (code === "3") return "晚上";
  return "上午";
}

/** 右側快捷格裡，目前這張單對上的那一顆。 */
function activeQuickLabel(form: RegisterEditForm): string {
  if (form.prebook || form.payType === "prebook") return "預約";
  if (form.icException === "selfPay" || form.caseNo === "9X") return "自費";
  if (form.icException === "paper") return "紙卡";
  if (form.icException === "afterCheck") return "補卡";
  if (
    form.icException === "noCard" ||
    form.icException === "childNoCard" ||
    form.icException === "pregnantNoCard" ||
    form.icException === "badCard"
  ) {
    return "無卡例外";
  }
  if (form.caseNo === "04") return "04 西醫慢性";
  if (form.caseNo === "08") return "08 慢箋領藥";
  if (form.caseNo === "02" || form.treatmentItem === "04") return "急診";
  if (form.caseNo === "轉") return "轉診";
  if (form.caseNo === "A3" || form.treatmentItem === "08") return "09 預防保健";
  if (form.caseNo === "01" || !form.caseNo) return "01 西醫門診";
  return "";
}

const inputCls =
  "h-[1.35rem] w-full border border-[#7a9a7a] bg-white px-1 text-[12px] text-black focus:outline-none focus:ring-1 focus:ring-[#004D00]";
/** 下拉目前選中的那一項：底色跟空白欄分開，展開時選項也著色。 */
const pickedCls = `${inputCls} his-picked bg-[#b6f5b6] font-bold`;
const labelCls = "w-[4.6rem] shrink-0 text-right text-[12px] text-[#003300]";

function Row({
  label,
  children,
  accent,
}: {
  label: string;
  children: React.ReactNode;
  accent?: "green" | "red" | "none";
}) {
  return (
    <label className="flex items-center gap-1">
      <span className={labelCls}>{label}</span>
      <span
        className={`min-w-0 flex-1 ${
          accent === "green"
            ? "[&_input]:bg-[#c8f5c8] [&_input]:font-bold"
            : accent === "red"
              ? "[&_input]:bg-[#ffd0d0] [&_input]:font-bold [&_input]:text-red-700"
              : ""
        }`}
      >
        {children}
      </span>
    </label>
  );
}

/**
 * 醫聖「掛號前確認資料存檔」介面（對照專案根目錄 jpg）。
 * F9 存檔才真正掛進；Esc／離開X 取消。
 */
export function RegisterConfirmDialog({
  open,
  encounterDate,
  busy,
  seqBusy,
  seqNote,
  error,
  diagnose,
  form,
  onChange,
  onClose,
  onConfirm,
  onReadCard,
  lockedShift,
  priceBlankFees = false,
}: Props) {
  const [pharmacists, setPharmacists] = useState<ApiStaffRecord[]>([]);
  const [doctors, setDoctors] = useState<ApiStaffRecord[]>([]);
  const [medicalNo, setMedicalNo] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [idCategory, setIdCategory] = useState("");
  const [idFeeNote, setIdFeeNote] = useState("");
  const [idTableOpen, setIdTableOpen] = useState(false);
  const [prevVisit, setPrevVisit] = useState("—");
  const [sameDayNote, setSameDayNote] = useState<string | null>(null);
  const [hist, setHist] = useState<HistRow[]>([]);
  const [weight, setWeight] = useState("0.0");
  const [temperature, setTemperature] = useState("0.0");
  const [specialNote, setSpecialNote] = useState("");
  const [visitTime, setVisitTime] = useState(() => {
    const n = new Date();
    return `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}:${String(n.getSeconds()).padStart(2, "0")}`;
  });
  const [skipCardWarn, setSkipCardWarn] = useState(false);
  const defaults = loadClinicRegisterDefaults();
  const feeBaseRef = useRef<Partial<RegisterEditForm>>({});
  const nhiQuoteRef = useRef<{ note: string; patch: Partial<RegisterEditForm> } | null>(null);
  const selfPayLive = useRef(false);
  const feeEpoch = useRef(0);
  const depositTouched = useRef(false);
  const depositLive = useRef(form.deposit);
  depositLive.current = form.deposit;
  const exceptionLive = useRef(form.icException);
  exceptionLive.current = form.icException;
  const dialogOpen = useRef(false);
  if (open && !dialogOpen.current) depositTouched.current = false;
  dialogOpen.current = open;
  const studentRef = useRef<boolean | null>(null);
  const personDiscRef = useRef("");
  const [askStudent, setAskStudent] = useState(false);
  const [hospPickOpen, setHospPickOpen] = useState(false);

  const isSelfPay = (ex?: string, caseNo?: string) => ex === "selfPay" || caseNo === "9X";
  selfPayLive.current = isSelfPay(form.icException, form.caseNo);

  const paintAge = (base: Partial<RegisterEditForm>, student: boolean | null, selfPay?: boolean) => {
    const isSelf = selfPay ?? isSelfPay(form.icException, form.caseNo);
    feeBaseRef.current = base;
    const aged = applyAgeFees({
      age: ageYearsFromRoc(form.birthday),
      baseReg: Number(base.regFee) || 0,
      listReg: isSelf
        ? Number(defaults.regFeeSelfPay) || Number(base.regFee) || 0
        : Number(defaults.regFeeOutpatient) || Number(base.regFee) || 0,
      baseCopay: isSelf ? 0 : Number(base.copayAmt) || 0,
      baseDisc: isSelf ? 0 : Number(base.copayDiscAmt) || 0,
      selfPay: isSelf,
      student,
      policy: policyFromFees(readLocalClinicBundle().fees),
    });
    setAskStudent(aged.askStudent);
    return aged;
  };

  const enterSelfPayFees = (): Partial<RegisterEditForm> => {
    feeEpoch.current += 1;
    const reg = defaults.regFeeSelfPay || form.regFee || "0";
    const aged = paintAge({ regFee: reg, copayAmt: "0", copayDiscAmt: "0" }, studentRef.current, true);
    const id = idCategory.trim();
    setIdFeeNote(
      [`\u8eab\u5206 ${id || "\u2014"}\u3000\u639b\u865f\u8cbb ${aged.regFee}`, aged.note].filter(Boolean).join("\u3000"),
    );
    return { regFee: aged.regFee, copayAmt: "0", copayDiscAmt: "0", copayCode: "" };
  };

  const leaveSelfPayFees = (): Partial<RegisterEditForm> => {
    feeEpoch.current += 1;
    const saved = nhiQuoteRef.current ?? identityFeePatch("", undefined, defaults.regFeeOutpatient, false, personDiscRef.current);
    const aged = paintAge(saved.patch, studentRef.current, false);
    setIdFeeNote([saved.note, aged.note].filter(Boolean).join("\u3000"));
    return { regFee: aged.regFee, copayAmt: aged.copayAmt, copayDiscAmt: aged.copayDiscAmt };
  };

  const withFee = (next: Partial<RegisterEditForm>): Partial<RegisterEditForm> => {
    const ex = next.icException ?? form.icException;
    const caseNo = next.caseNo ?? form.caseNo;
    const wasSelf = isSelfPay(form.icException, form.caseNo);
    const willSelf = isSelfPay(ex, caseNo);
    if (willSelf) return { ...next, ...enterSelfPayFees() };
    if (wasSelf) return { ...next, ...leaveSelfPayFees() };
    return next;
  };

  const chooseStudent = (yes: boolean) => {
    studentRef.current = yes;
    const aged = paintAge(feeBaseRef.current, yes);
    setIdFeeNote(aged.note);
    onChange({
      regFee: aged.regFee,
      copayAmt: aged.copayAmt,
      copayDiscAmt: aged.copayDiscAmt,
    });
  };

  const selfPayForm = isSelfPay(form.icException, form.caseNo);
  const dueAmt = useMemo(() => {
    const reg = Number(form.regFee) || 0;
    const copay = selfPayForm
      ? 0
      : Math.max(0, (Number(form.copayAmt) || 0) - (Number(form.copayDiscAmt) || 0));
    const deposit = selfPayForm ? 0 : Math.max(0, Number(form.deposit) || 0);
    const sum = reg + copay + deposit;
    return sum > 0 ? String(sum) : "0";
  }, [form.regFee, form.copayAmt, form.copayDiscAmt, form.deposit, selfPayForm]);

  useEffect(() => {
    if (!open) return;
    if (!form.encounterId && lockedShift && form.shift !== lockedShift) onChange({ shift: lockedShift });
    if (!form.visitClock && visitTime) onChange({ visitClock: normalizeClock(visitTime) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lockedShift]);

  useEffect(() => {
    if (!open) return;
    void fetchStaff()
      .then((rows) => {
        const list = rows.filter(
          (s) =>
            /藥師|pharmacist|pharm/i.test(s.role || "") &&
            (s.status === "在職" || s.status === "active" || !s.status),
        );
        setPharmacists(list);
        const docs = rows.filter(
          (s) =>
            /院長|醫師|doctor/i.test(s.role || "") &&
            (s.status === "在職" || s.status === "active" || !s.status),
        );
        setDoctors(docs);
        const patchStaff: Partial<RegisterEditForm> = {};
        if (!(form.pharmacist ?? "").trim()) {
          const pref =
            list.find((p) => p.id === defaults.defaultPharmacistId) || list[0];
          if (pref?.name) patchStaff.pharmacist = pref.name;
        }
        if (!(form.doctorId ?? "").trim()) {
          const pref =
            docs.find((d) => d.id === defaults.defaultDoctorId) || pickClinicDoctor(docs) || docs[0];
          if (pref) {
            patchStaff.doctorId = pref.id;
            patchStaff.doctorName = doctorDisplayName(pref.name, pref.id);
          }
        }
        if (Object.keys(patchStaff).length) onChange(patchStaff);
      })
      .catch(() => {
        setPharmacists([]);
        setDoctors([]);
      });

    const patch: Partial<RegisterEditForm> = {};
    if (!form.patientId && !form.regFee && form.icException !== "selfPay" && defaults.regFeeOutpatient) {
      patch.regFee = defaults.regFeeOutpatient;
    }
    if (!form.regFee && form.icException === "selfPay" && defaults.regFeeSelfPay) {
      patch.regFee = defaults.regFeeSelfPay;
    }
    if (!form.room || /\u79d1/.test(form.room)) {
      patch.room = roomNumber(loadClinicSession()?.room || "1");
    }
    if (Object.keys(patch).length) onChange(patch);

    const n = new Date();
    setVisitTime(
      `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}:${String(n.getSeconds()).padStart(2, "0")}`,
    );
    setWeight("0.0");
    setTemperature("0.0");
    setSpecialNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!form.patientId) {
      setMedicalNo("");
      setPhone("");
      setAddress("");
      setIdCategory("");
      personDiscRef.current = "";
      setIdFeeNote("");
      setPrevVisit("—");
      setSameDayNote(null);
      setHist([]);
      return;
    }
    let cancelled = false;
    const epoch = feeEpoch.current;
    (async () => {
      try {
        const p = await fetchPatient(form.patientId!);
        if (cancelled) return;
        const hit = mapApiPatientToHit(p);
        setMedicalNo(hit.medicalNo || "");
        setPhone(hit.phone || "");
        const addr = p.address?.[0]?.text || "";
        setAddress(addr);
        const cat =
          p.extension
            ?.find((e) => e.url?.includes("patient-clinic-ext"))
            ?.extension?.find((s) => s.url === "idCategory")?.valueString || "";
        const shown = canonicalIdCategory(cat) || cat;
        const personDisc =
          p.extension
            ?.find((e) => e.url?.includes("patient-clinic-ext"))
            ?.extension?.find((s) => s.url === "copayDisc")?.valueString || "";
        personDiscRef.current = personDisc;
        setIdCategory(shown);
        if (cat) {
          try {
            const cats = await fetchIdCategorySettings();
            const hit = matchIdCategory(cats, cat);
            if (hit || shown) {
              const applied = feesForVisit(exceptionLive.current, shown || cat, hit, defaults.regFeeOutpatient, personDisc);
              if (depositTouched.current) applied.patch.deposit = depositLive.current;
              nhiQuoteRef.current = applied;
              if (visitNeedsFeeSchedule(form.encounterId, priceBlankFees, form.regFee, form.copayAmt) && feeEpoch.current === epoch) {
                const selfPay = selfPayLive.current;
                const base = selfPay
                  ? { ...applied.patch, regFee: defaults.regFeeSelfPay || applied.patch.regFee, copayAmt: "0", copayDiscAmt: "0" }
                  : applied.patch;
                const aged = paintAge(base, studentRef.current, selfPay);
                const cardNote = cardIdentityNote(form.cardIdentity);
                setIdFeeNote(
                  [
                    selfPay
                      ? `\u8eab\u5206 ${shown || "\u2014"}\u3000\u639b\u865f\u8cbb ${aged.regFee}`
                      : applied.note,
                    aged.note,
                    cardNote,
                  ].filter(Boolean).join("\u3000"),
                );
                onChange(withCardIdentity(pricedVisitPatch(base, aged, selfPay, Boolean(form.encounterId)), form.cardIdentity, selfPay));
              } else if (
                cardIdentityBenefit(form.cardIdentity)?.waiveBasic &&
                !selfPayLive.current &&
                feeEpoch.current === epoch
              ) {
                const cardNote = cardIdentityNote(form.cardIdentity);
                setIdFeeNote([applied.note, cardNote].filter(Boolean).join("\u3000"));
                onChange(
                  withCardIdentity(
                    { copayAmt: form.copayAmt || COPAY_FIXED, copayDiscAmt: form.copayDiscAmt },
                    form.cardIdentity,
                    false,
                  ),
                );
              } else if (cardIdentityNote(form.cardIdentity)) {
                setIdFeeNote([applied.note, cardIdentityNote(form.cardIdentity)].filter(Boolean).join("\u3000"));
              }
            } else {
              setIdFeeNote("此身分類別尚未對到優惠表，請按身份類別旁的 … 設定");
            }
          } catch {
            setIdFeeNote("");
          }
        } else {
          const plain = identityFeePatch("", undefined, defaults.regFeeOutpatient, false, personDiscRef.current);
          nhiQuoteRef.current = plain;
          if (visitNeedsFeeSchedule(form.encounterId, priceBlankFees, form.regFee, form.copayAmt) && feeEpoch.current === epoch) {
            const selfPay = selfPayLive.current;
            const base = selfPay
              ? { ...plain.patch, regFee: defaults.regFeeSelfPay || plain.patch.regFee, copayAmt: "0", copayDiscAmt: "0" }
              : plain.patch;
            const aged = paintAge(base, studentRef.current, selfPay);
            const cardNote = cardIdentityNote(form.cardIdentity);
            setIdFeeNote(
              [
                selfPay ? `\u8eab\u5206 \u2014\u3000\u639b\u865f\u8cbb ${aged.regFee}` : "",
                aged.note,
                cardNote,
              ].filter(Boolean).join("\u3000"),
            );
            onChange(withCardIdentity(pricedVisitPatch(base, aged, selfPay, Boolean(form.encounterId)), form.cardIdentity, selfPay));
          } else if (
            cardIdentityBenefit(form.cardIdentity)?.waiveBasic &&
            !selfPayLive.current &&
            feeEpoch.current === epoch
          ) {
            setIdFeeNote(cardIdentityNote(form.cardIdentity));
            onChange(
              withCardIdentity(
                { copayAmt: form.copayAmt || COPAY_FIXED, copayDiscAmt: form.copayDiscAmt },
                form.cardIdentity,
                false,
              ),
            );
          } else if (cardIdentityNote(form.cardIdentity)) {
            setIdFeeNote(cardIdentityNote(form.cardIdentity));
          }
        }
        try {
          const same = await fetchSameDayEncounters(form.patientId!, encounterDate, {
            includeCloud: false,
          });
          if (!cancelled && same.isSameDay && same.count > 0) {
            const brief = same.encounters
              .slice(0, 3)
              .map((e) => {
                const src = e.source === "nhi_cloud" ? "雲端" : "本機";
                return `[${src}]#${e.queueNumber || e.treatSeq || "?"} ${e.hospitalId || e.queueStatus || ""}`;
              })
              .join("；");
            const cloudPart = same.cloudError
              ? `雲端未通（${same.cloudError}），僅本機。`
              : `本機 ${same.localCount ?? 0}／雲端 ${same.cloudCount ?? 0}。`;
            setSameDayNote(`同日就診提示：共 ${same.count} 筆。${cloudPart} ${brief}。請櫃台確認。`);
          } else if (!cancelled) {
            setSameDayNote(null);
          }
        } catch {
          if (!cancelled) setSameDayNote(null);
        }
      } catch {
        if (!cancelled) {
          setMedicalNo("");
          setPhone("");
          setAddress("");
          setIdCategory("");
        }
      }
      try {
        const [encRes, condRes] = await Promise.all([
          fetchPatientEncounters(form.patientId!),
          fetchPatientConditions(form.patientId!),
        ]);
        if (cancelled) return;
        const encs = (encRes.entry ?? []).map((e) => e.resource);
        const conds = (condRes.entry ?? []).map((e) => e.resource);
        const byEnc: Record<string, { code: string; dx: string }> = {};
        for (const c of conds) {
          const eid = c.encounter?.reference?.split("/").pop() || "";
          if (!eid) continue;
          if (!byEnc[eid]) {
            byEnc[eid] = {
              code: c.code?.coding?.[0]?.code || "",
              dx: c.code?.text || c.code?.coding?.[0]?.code || "",
            };
          }
        }
        const rows: HistRow[] = encs.slice(0, 12).map((enc) => {
          const dx = byEnc[enc.id] || { code: "", dx: enc.reasonCode?.[0]?.text || "—" };
          return {
            date: enc.period?.start ? isoToRocDots(enc.period.start.slice(0, 10)) : "—",
            dept: "—",
            code: dx.code || "—",
            dx: dx.dx || "—",
            doctor: enc.participant?.[0]?.individual?.display || "—",
          };
        });
        setHist(rows);
        setPrevVisit(rows[0]?.date || "—");
      } catch {
        if (!cancelled) {
          setHist([]);
          setPrevVisit("—");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, form.patientId, form.cardIdentity, priceBlankFees]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (ev.key === "Escape") {
        ev.preventDefault();
        onClose();
        return;
      }
      if (!typing && (ev.key === "x" || ev.key === "X")) {
        ev.preventDefault();
        onClose();
        return;
      }
      if (ev.key === "F9") {
        ev.preventDefault();
        ev.stopPropagation();
        if (busy || seqBusy) return;
        void onConfirm();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, busy, seqBusy, onClose, onConfirm]);

  if (!open) return null;

  const applyQuick = (q: (typeof QUICK_CASES)[number]) => {
    const next: Partial<RegisterEditForm> = {
      caseNo: q.caseNo,
      treatmentItem: q.treatmentItem,
    };
    if (q.kind === "appointment") {
      next.payType = "prebook";
      next.prebook = true;
      next.icException = "ic";
      next.deposit = "";
      next.noCardReason = "";
      next.reasonText = form.reasonText?.includes("預約") ? form.reasonText : "預約";
    } else if (q.icException === "selfPay" || q.kind === "selfPay") {
      next.payType = "4";
      next.prebook = false;
      next.deposit = "";
    }
    if (q.icException) {
      next.icException = q.icException;
      next.paperCard = q.icException === "paper";
      next.afterCheck = q.icException === "afterCheck" ? "2" : "1";
      if (q.icException === "selfPay") next.caseNo = "9X";
    } else if (isSelfPay(form.icException, form.caseNo) && q.kind !== "appointment") {
      next.icException = "ic";
      if (form.payType === "4") next.payType = "";
    }
    if (q.copayCode !== undefined && q.icException !== "selfPay") next.copayCode = q.copayCode;
    onChange(withFee(next));
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 font-sans">
      <style>{`select.his-picked option:checked { background: #7dff7d; color: #003300; }`}</style>
      <div className="flex max-h-[96vh] w-[min(58rem,98vw)] flex-col overflow-hidden border-2 border-[#004d00] bg-[#c5e6c5] shadow-2xl">
        {/* 頂列：身分／電話／地址 */}
        <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-[#80a080] bg-[#004d00] px-2 py-1 text-[11px] text-white">
          <span className="font-bold">{form.encounterId ? "\u4fee\u6539\u6b64\u6b21\u639b\u865f" : "\u639b\u865f\u524d\u78ba\u8a8d\u8cc7\u6599\u5b58\u6a94"}</span>
          <span className="font-mono">證：{form.idNo || "—"}</span>
          <span className="font-mono">生：{rocDotsFrom7(form.birthday)}</span>
          <span>電：{phone || "—"}</span>
          <span className="truncate">址：{address || "—"}</span>
          <span className="ml-auto text-lime-100">F9 存檔　Esc／X 離開</span>
        </header>

        {seqBusy && !form.prebook && (
          <p className="shrink-0 bg-amber-200 px-2 py-1 text-xs font-bold text-amber-950">
            連線健保局取號中…
          </p>
        )}
        {seqNote && !seqBusy && (
          <p className="shrink-0 bg-sky-100 px-2 py-0.5 text-[11px] text-sky-900">{seqNote}</p>
        )}
        {sameDayNote && (
          <p className="shrink-0 bg-amber-100 px-2 py-0.5 text-[11px] text-amber-950">{sameDayNote}</p>
        )}
        {diagnose ? (
          <CardFaultPanel diagnose={diagnose} />
        ) : (
          error && <p className="shrink-0 bg-red-200 px-2 py-1 text-xs text-red-900">{error}</p>
        )}

        <div className="min-h-0 flex-1 overflow-auto p-1.5">
          <div className="grid grid-cols-[1fr_1fr_1.15fr] gap-1.5">
            {/* 左：就醫欄 */}
            <section className="space-y-1 rounded border border-[#7a9a7a] bg-[#d8efd8] p-1.5">
              <Row label="就醫日期">
                <input className={inputCls} readOnly value={isoToRocDots(encounterDate)} />
              </Row>
              <Row label="就診時間">
                <span className={`${inputCls} inline-flex items-center`}>
                  <HisFixedClockInput
                    value={form.visitClock || visitTime}
                    onChange={(visitClock) => {
                      setVisitTime(visitClock);
                      onChange({ visitClock });
                    }}
                  />
                </span>
              </Row>
              <Row label="就診時段">
                {lockedShift ? (
                  <input className={inputCls} readOnly value={lockedShift} />
                ) : (
                  <select
                    className={pickedCls}
                    value={shiftCode(form.shift)}
                    onChange={(e) => onChange({ shift: shiftFromCode(e.target.value) })}
                  >
                    <option value="1">1 上午</option>
                    <option value="2">2 下午</option>
                    <option value="3">3 晚上</option>
                  </select>
                )}
              </Row>
              <Row label="診間">
                <input
                  className={inputCls}
                  value={roomNumber(form.room)}
                  onChange={(e) => onChange({ room: e.target.value.replace(/\D/g, "") || "1" })}
                />
              </Row>
              <Row label="就醫科別">
                <input className={inputCls} readOnly value={lastClinicDept()} />
              </Row>
              <Row label="就診序號" accent="green">
                <input
                  className={inputCls}
                  value={form.queueNumber || ""}
                  placeholder="空白＝存檔後自動取號"
                  onChange={(e) => onChange({ queueNumber: e.target.value.replace(/\D/g, "") })}
                />
              </Row>
              <Row label="案件代號">
                <select
                  className={pickedCls}
                  value={form.caseNo}
                  onChange={(e) => {
                    const caseNo = e.target.value;
                    const next: Partial<RegisterEditForm> = { caseNo };
                    if (caseNo === "9X") {
                      next.icException = "selfPay";
                      next.payType = "4";
                      next.prebook = false;
                      next.deposit = "";
                    } else if (form.icException === "selfPay") {
                      next.icException = "ic";
                      if (form.payType === "4") next.payType = "";
                    }
                    onChange(withFee(next));
                  }}
                >
                  <option value="01">01 西醫門診</option>
                  <option value="04">04 西醫慢性</option>
                  <option value="08">08 慢箋</option>
                  <option value="A3">A3 預防保健</option>
                  <option value="9X">9X 自費</option>
                </select>
              </Row>
              <Row label="IC卡序">
                <input className={inputCls} readOnly value={form.cardId || "—"} />
              </Row>
              {!selfPayForm && (
                <>
                  <Row label="部分代號">
                    <input
                      className={inputCls}
                      value={form.copayCode}
                      onChange={(e) => onChange({ copayCode: e.target.value })}
                      placeholder="如 D12"
                    />
                  </Row>
                  <Row label="部分負擔">
                    <input className={inputCls} readOnly value={form.copayAmt || COPAY_FIXED} />
                  </Row>
                  <Row label="負擔優待">
                    <input
                      className={inputCls}
                      value={form.copayDiscAmt ?? "0"}
                      onChange={(e) => onChange({ copayDiscAmt: e.target.value.replace(/[^\d]/g, "") })}
                    />
                  </Row>
                </>
              )}
              <label className="flex items-center gap-1 pt-1 text-[11px] text-[#003300]">
                <input
                  type="checkbox"
                  checked={skipCardWarn}
                  onChange={(e) => setSkipCardWarn(e.target.checked)}
                />
                卡號未填不警告
              </label>
            </section>

            {/* 中：費用／體徵 */}
            <section className="space-y-1 rounded border border-[#7a9a7a] bg-[#d8efd8] p-1.5">
              <Row label="掛號費用">
                <input
                  className={inputCls}
                  value={form.regFee}
                  onChange={(e) => onChange({ regFee: e.target.value })}
                />
              </Row>
              <Row label="應收金額" accent="red">
                <input className={inputCls} readOnly value={dueAmt || "—"} />
              </Row>
              <Row label="已收金額" accent="red">
                <input className={inputCls} readOnly value="" placeholder="—" title="未收款不填，不編造" />
              </Row>
              <Row label="押金">
                <input
                  className={inputCls}
                  value={form.deposit}
                  onChange={(e) => {
                    depositTouched.current = true;
                    onChange({ deposit: e.target.value.replace(/[^\d]/g, "") });
                  }}
                />
              </Row>
              <Row label="就醫類別">
                <select
                  className={pickedCls}
                  value={form.treatmentItem}
                  onChange={(e) => onChange({ treatmentItem: e.target.value })}
                >
                  <option value="01">01 西醫門診</option>
                  <option value="04">04 急診</option>
                  <option value="08">08 預防保健</option>
                </select>
              </Row>
              <Row label="體重">
                <input className={inputCls} value={weight} onChange={(e) => setWeight(e.target.value)} />
              </Row>
              <Row label="體溫">
                <input
                  className={inputCls}
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                />
              </Row>
              <Row label="特別記載">
                <input
                  className={inputCls}
                  value={specialNote || form.reasonText}
                  onChange={(e) => {
                    setSpecialNote(e.target.value);
                    onChange({ reasonText: e.target.value });
                  }}
                />
              </Row>
              <Row label="讀卡例外">
                <select
                  className={pickedCls}
                  value={form.icException}
                  onChange={(e) => {
                    const icException = e.target.value as IcException;
                    const next: Partial<RegisterEditForm> = {
                      icException,
                      paperCard: icException === "paper",
                      afterCheck: icException === "afterCheck" ? "2" : "1",
                      caseNo: icException === "selfPay" ? "9X" : form.caseNo === "9X" ? "01" : form.caseNo,
                    };
                    if (icException === "badCard") {
                      next.noCardReason = BAD_CARD_REASON;
                    } else if (!needsNhiNoCardReason(icException)) {
                      next.noCardReason = "";
                    }
                    if (icException === "selfPay") {
                      next.payType = "4";
                      next.prebook = false;
                      next.deposit = "";
                      depositTouched.current = false;
                    } else {
                      if (form.payType === "4") next.payType = "";
                      if (icException === "ic") {
                        next.deposit = "";
                        depositTouched.current = false;
                      } else if (icException === "deposit" && !String(form.deposit || "").trim()) {
                        next.deposit = loadClinicRegisterDefaults().depositAmount;
                      }
                    }
                    onChange(withFee(next));
                  }}
                >
                  <option value="ic">正常 IC</option>
                  <option value="deposit">押單（欠卡）</option>
                  <option value="afterCheck">補卡</option>
                  <option value="noCard">無卡例外</option>
                  <option value="childNoCard">兒少無卡</option>
                  <option value="pregnantNoCard">孕婦無卡</option>
                  <option value="badCard">卡片不良</option>
                  <option value="paper">紙卡</option>
                  <option value="selfPay">自費</option>
                </select>
              </Row>
              {needsNhiNoCardReason(form.icException) && form.icException !== "badCard" && (
                <Row label="無卡原因">
                  <select
                    className={form.noCardReason ? pickedCls : inputCls}
                    value={form.noCardReason}
                    onChange={(e) => onChange({ noCardReason: e.target.value })}
                  >
                    <option value="">請選擇（押單不用填）</option>
                    {NHI_NOCARD_REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {reason}
                      </option>
                    ))}
                  </select>
                </Row>
              )}
              <Row label="醫師">
                <select
                  className={form.doctorId ? pickedCls : inputCls}
                  value={form.doctorId}
                  onChange={(e) => {
                    const d = doctors.find((x) => x.id === e.target.value);
                    onChange({
                      doctorId: e.target.value,
                      doctorName: doctorDisplayName(d?.name, d?.id),
                    });
                  }}
                >
                  <option value="">—</option>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {doctorDisplayName(d.name, d.id)}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="藥師">
                <select
                  className={form.pharmacist ? pickedCls : inputCls}
                  value={form.pharmacist}
                  onChange={(e) => onChange({ pharmacist: e.target.value })}
                >
                  <option value="">（必填）</option>
                  {pharmacists.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Row>
              {pharmacists.length === 0 && (
                <Row label="藥師姓名">
                  <input
                    className={inputCls}
                    value={form.pharmacist}
                    onChange={(e) => onChange({ pharmacist: e.target.value })}
                  />
                </Row>
              )}
            </section>

            {/* 右：病患大字＋快捷格 */}
            <section className="flex flex-col gap-1 rounded border border-[#7a9a7a] bg-[#d8efd8] p-1.5">
              <div className="space-y-1">
                <Row label="病歷號碼">
                  <input className={`${inputCls} font-mono`} readOnly value={medicalNo || "—"} />
                </Row>
                <Row label="前次就診">
                  <input className={inputCls} readOnly value={prevVisit} />
                </Row>
                <Row label="身份類別">
                  <span className="flex items-center gap-1">
                    <input
                      className={`${inputCls} font-bold text-red-700`}
                      readOnly
                      value={idCategory || "—"}
                      title={idFeeNote || undefined}
                    />
                    <button
                      type="button"
                      className="shrink-0 border border-[#608060] bg-[#E8F8C8] px-1 text-[12px] font-bold"
                      title="身分類別控制"
                      onClick={() => setIdTableOpen(true)}
                    >
                      …
                    </button>
                  </span>
                </Row>
                {idFeeNote ? (
                  <p className="px-1 text-[10px] font-bold text-[#800000]">{idFeeNote}</p>
                ) : null}
                <Row label="身分證號">
                  <input className={`${inputCls} font-mono`} readOnly value={form.idNo || "—"} />
                </Row>
                <Row label="實際年齡">
                  <input
                    className={inputCls}
                    readOnly
                    value={`${ageFromRoc(form.birthday)}　（${rocDotsFrom7(form.birthday)}）`}
                  />
                </Row>
                {askStudent ? (
                  <div className="mx-1 border border-[#806000] bg-[#fff4cc] p-1 text-[12px]">
                    <p className="font-bold">
                      {"\u8acb\u554f\u9019\u4f4d\u662f\u4e0d\u662f\u5b78\u751f\uff1f\u662f\u7684\u8a71\u639b\u865f\u8cbb\u6e1b\u8cbb\u3002"}
                    </p>
                    <div className="mt-1 flex gap-1">
                      <button
                        type="button"
                        className="border border-[#004d00] bg-[#c8f5c8] px-2 py-0.5 font-bold"
                        onClick={() => chooseStudent(true)}
                      >
                        {"\u662f\u5b78\u751f"}
                      </button>
                      <button
                        type="button"
                        className="border border-[#333] bg-white px-2 py-0.5 font-bold"
                        onClick={() => chooseStudent(false)}
                      >
                        {"\u4e0d\u662f"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="flex min-h-[3.5rem] items-center justify-center border border-[#7a9a7a] bg-white px-2 py-1">
                <span className="text-center text-[28px] font-black leading-tight text-[#1a3cff]">
                  {form.patientName || "—"}
                </span>
              </div>
              <div className="grid flex-1 grid-cols-3 gap-0.5">
                <button
                  type="button"
                  className={
                    form.acceptReferral === "1"
                      ? "col-span-3 rounded-sm border-2 border-[#8a6a00] bg-[#ffe14a] px-0.5 py-1 text-[12px] font-black text-[#3a2a00]"
                      : "col-span-3 rounded-sm border border-[#2a8a8a] bg-[#40e0d0] px-0.5 py-1 text-[12px] font-bold text-[#003333] hover:bg-[#7fffd4]"
                  }
                  onClick={() => setHospPickOpen(true)}
                >
                  {form.acceptReferral === "1"
                    ? `\u63a5\u53d7\u8f49\u8a3a\uff1a${form.referralHospName || form.referralHospId || "\u5df2\u9078\u9662\u6240"}`
                    : "\u63a5\u53d7\u8f49\u8a3a"}
                </button>
                {QUICK_CASES.map((q) => {
                  const on = q.label === activeQuickLabel(form);
                  return (
                    <button
                      key={q.label}
                      type="button"
                      className={
                        on
                          ? "rounded-sm border-2 border-[#8a6a00] bg-[#ffe14a] px-0.5 py-1 text-[10px] font-black text-[#3a2a00]"
                          : "rounded-sm border border-[#2a8a8a] bg-[#40e0d0] px-0.5 py-1 text-[10px] font-bold text-[#003333] hover:bg-[#7fffd4]"
                      }
                      onClick={() => applyQuick(q)}
                    >
                      {q.label}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>

          {/* 歷史病歷 */}
          <section className="mt-1.5 overflow-hidden rounded border border-[#7a9a7a] bg-white">
            <div className="bg-[#004d00] px-2 py-0.5 text-[11px] font-bold text-white">歷史病歷</div>
            <div className="max-h-36 overflow-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead className="sticky top-0 bg-[#c5e6c5] text-[#003300]">
                  <tr>
                    <th className="border border-[#9bbb9b] px-1 py-0.5 text-left">日期</th>
                    <th className="border border-[#9bbb9b] px-1 py-0.5 text-left">科別</th>
                    <th className="border border-[#9bbb9b] px-1 py-0.5 text-left">代碼</th>
                    <th className="border border-[#9bbb9b] px-1 py-0.5 text-left">病名</th>
                    <th className="border border-[#9bbb9b] px-1 py-0.5 text-left">醫師</th>
                  </tr>
                </thead>
                <tbody>
                  {hist.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-2 py-3 text-center text-slate-400">
                        無歷次就診（或尚未載入）
                      </td>
                    </tr>
                  ) : (
                    hist.map((r, i) => (
                      <tr key={`${r.date}-${i}`} className="odd:bg-[#f2faf2]">
                        <td className="border border-[#d0e8d0] px-1 py-0.5 font-mono">{r.date}</td>
                        <td className="border border-[#d0e8d0] px-1 py-0.5">{r.dept}</td>
                        <td className="border border-[#d0e8d0] px-1 py-0.5 font-mono">{r.code}</td>
                        <td className="border border-[#d0e8d0] px-1 py-0.5">{r.dx}</td>
                        <td className="border border-[#d0e8d0] px-1 py-0.5">{r.doctor}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-1 border-t border-[#80a080] bg-[#a8d4a8] px-2 py-1.5">
          {onReadCard && (
            <button
              type="button"
              disabled={busy || seqBusy}
              className="rounded border border-[#333] bg-[#e8e8e8] px-2.5 py-1 text-[12px] font-bold disabled:opacity-40"
              onClick={() => void onReadCard()}
            >
              IC資訊
            </button>
          )}
          <button
            type="button"
            disabled={busy || seqBusy || !form.idNo.trim() || !form.birthday.trim()}
            className="rounded border border-[#004d00] bg-[#004d00] px-3 py-1 text-[12px] font-bold text-white disabled:opacity-50"
            onClick={() => void onConfirm()}
          >
            存檔 F9
          </button>
          <button
            type="button"
            className="rounded border border-[#333] bg-[#e8e8e8] px-2.5 py-1 text-[12px] font-bold"
            onClick={onClose}
          >
            離開 X
          </button>
          <span className="ml-auto text-[10px] text-[#003300]">
            缺資料顯示 —，金額未批不編造
          </span>
        </footer>
        <IdCategoryTableDialog
          open={idTableOpen}
          onClose={() => setIdTableOpen(false)}
          onSaved={() => {
            if (!form.patientId) return;
            void fetchIdCategorySettings().then((cats) => {
              const hit = matchIdCategory(cats, idCategory);
              if (!hit) {
                setIdFeeNote("此身分類別尚未對到優惠表，請按身份類別旁的 … 設定");
                return;
              }
              const applied = feesForVisit(exceptionLive.current, idCategory, hit, defaults.regFeeOutpatient, personDiscRef.current);
              if (depositTouched.current) applied.patch.deposit = depositLive.current;
              nhiQuoteRef.current = applied;
              const selfPay = selfPayLive.current;
              const base = selfPay
                ? { ...applied.patch, regFee: defaults.regFeeSelfPay || applied.patch.regFee, copayAmt: "0", copayDiscAmt: "0" }
                : applied.patch;
              const aged = paintAge(base, studentRef.current, selfPay);
              setIdFeeNote(
                selfPay
                  ? [`\u8eab\u5206 ${idCategory || "\u2014"}\u3000\u639b\u865f\u8cbb ${aged.regFee}`, aged.note].filter(Boolean).join("\u3000")
                  : [applied.note, aged.note].filter(Boolean).join("\u3000"),
              );
              onChange(
                withCardIdentity(
                  {
                    ...base,
                    regFee: aged.regFee,
                    copayAmt: aged.copayAmt,
                    copayDiscAmt: aged.copayDiscAmt,
                    ...(selfPay ? { copayCode: "" } : {}),
                  },
                  form.cardIdentity,
                  selfPay,
                ),
              );
            });
          }}
        />
        <HospitalLookupDialog
          open={hospPickOpen}
          onClose={() => setHospPickOpen(false)}
          onPick={(row) => {
            onChange({
              acceptReferral: "1",
              referralHospId: row.code,
              referralHospName: row.name,
            });
            setHospPickOpen(false);
          }}
        />
      </div>
    </div>,
    document.body,
  );
}
