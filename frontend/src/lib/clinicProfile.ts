/** ?|??]?w?G?u???v?l?w API?A????~?h?^ localStorage?C */
import {
  fetchClinicProfile,
  saveClinicProfile,
  type ClinicProfileBundle,
} from "@/api/clinicApi";

/** bump when imported Frame/Sc.ini fees change shape so stale localStorage is ignored */
export const PROFILE_KEY = "wundadi-clinic-profile-page-v2";

export type ClinicFees = {
  regFeeOutpatient: number;
  regFeeEmerg: number;
  depositAmount: number;
  depositDaysLimit: number;
  seniorAge: number;
  seniorDiscount: number;
  childFreeAge: number;
  /** Registration-fee cut for students and for ages 3 up to studentAutoUntil. */
  studentDiscount: number;
  /** Automatic cut applies while age is at least childFreeAge and below this. */
  studentAutoUntil: number;
  /** Ask "student?" from studentAutoUntil through this age, inclusive. */
  studentAskUntil: number;
  feeRulesVersion?: number;
  regFeeSelfPay: number;
  regFeeAdultCheckup: number;
  regFeeChildCare: number;
  regFeeCancerScreen: number;
  consultFeeDefault: number;
};

export type ClinicProfileFields = {
  clinicGrade: string;
  region: string;
  clinicCode: string;
  clinicName: string;
  licenseNo: string;
  controlCertNo: string;
  mainDept: string;
  dispenseType: string;
  phone: string;
  zipCode: string;
  address: string;
  engAddress: string;
  defaultDoctorId: string;
  defaultPharmacistId: string;
};

export type ClinicWorkflow = {
  defaultMedDays: number;
  grindMaxAge: number;
  historyVisitsCount: number;
  maxVisitsLimit: number;
  medPriceCap: number;
  procedurePriceCap: number;
  adultUsageDefault: string;
  childUsageDefault: string;
  checkAllergyIC: boolean;
  checkCatastropheIC: boolean;
  readerPort: number;
  morningFrom: string;
  morningTo: string;
  afternoonFrom: string;
  afternoonTo: string;
  eveningFrom: string;
  eveningTo: string;
};

/** ???????E?? Frame.Set??Sc.ini?F??????H API clinic_profile_v1 ???? */
export const DEFAULT_FEES: ClinicFees = {
  regFeeOutpatient: 100,
  regFeeEmerg: 100,
  depositAmount: 300,
  depositDaysLimit: 30,
  seniorAge: 70,
  seniorDiscount: 100,
  childFreeAge: 3,
  studentDiscount: 100,
  studentAutoUntil: 18,
  studentAskUntil: 25,
  regFeeSelfPay: 300,
  regFeeAdultCheckup: 0,
  regFeeChildCare: 0,
  regFeeCancerScreen: 0,
  consultFeeDefault: 0,
};

export const DEFAULT_PROFILE: ClinicProfileFields = {
  clinicGrade: "D \u57fa\u5c64\u9662\u6240",
  region: "A \u672c\u5cf6\u5e73\u5730\u5730\u5340",
  clinicCode: "3521013662",
  clinicName: "\u74ba\u5230\u5e95\u76ae\u819a\u5c08\u79d1\u8a3a\u6240",
  licenseNo: "\u885b\u8a3a\u5b57\u7b2c 3521013662 \u865f",
  controlCertNo: "",
  mainDept: "11 \u76ae\u819a\u79d1",
  dispenseType: "0 \u81ea\u884c\u8abf\u5291",
  phone: "06-2882555",
  zipCode: "701",
  address: "\u53f0\u5357\u5e02\u6771\u5340\u5d07\u660e\u8def153-1\u865f",
  engAddress: "No. 153-1, Chongming Rd., East Dist., Tainan City 701, Taiwan",
  defaultDoctorId: "",
  defaultPharmacistId: "",
};

export const DEFAULT_WORKFLOW: ClinicWorkflow = {
  defaultMedDays: 3,
  grindMaxAge: 6,
  historyVisitsCount: 16,
  maxVisitsLimit: 6,
  medPriceCap: 3000,
  procedurePriceCap: 5000,
  adultUsageDefault: "TID/AC",
  childUsageDefault: "QID/PC",
  checkAllergyIC: true,
  checkCatastropheIC: true,
  readerPort: 5066,
  morningFrom: "08:00",
  morningTo: "12:00",
  afternoonFrom: "12:00",
  afternoonTo: "18:00",
  eveningFrom: "18:00",
  eveningTo: "21:00",
};

function clockOr(value: string | undefined, fallback: string): string {
  return /^(\d{1,2}):(\d{2})$/.test((value || "").trim()) ? (value || "").trim() : fallback;
}

function normalizeWorkflow(raw: Partial<ClinicWorkflow> | undefined): ClinicWorkflow {
  const workflow: ClinicWorkflow = { ...DEFAULT_WORKFLOW, ...(raw || {}) };
  const afternoonFrom = clockOr(raw?.afternoonFrom, DEFAULT_WORKFLOW.afternoonFrom);
  const eveningFrom = clockOr(raw?.eveningFrom, DEFAULT_WORKFLOW.eveningFrom);
  workflow.morningFrom = clockOr(raw?.morningFrom, DEFAULT_WORKFLOW.morningFrom);
  workflow.morningTo = clockOr(raw?.morningTo, afternoonFrom);
  workflow.afternoonFrom = afternoonFrom;
  workflow.afternoonTo = clockOr(raw?.afternoonTo, eveningFrom);
  workflow.eveningFrom = eveningFrom;
  workflow.eveningTo = clockOr(raw?.eveningTo, DEFAULT_WORKFLOW.eveningTo);
  return workflow;
}

function normalizeFees(raw: Partial<ClinicFees> | undefined): ClinicFees {
  const fees: ClinicFees = { ...DEFAULT_FEES, ...(raw || {}) };
  const version = Number(raw?.feeRulesVersion || 0);
  if (raw?.studentDiscount == null) fees.studentDiscount = DEFAULT_FEES.studentDiscount;
  if (raw?.studentAutoUntil == null) fees.studentAutoUntil = DEFAULT_FEES.studentAutoUntil;
  if (raw?.studentAskUntil == null) fees.studentAskUntil = DEFAULT_FEES.studentAskUntil;
  if (version < 2 && (raw?.seniorDiscount == null || raw.seniorDiscount === 50)) {
    fees.seniorDiscount = 100;
  }
  return fees;
}

function healClinicText(value: string, fallback: string): string {
  const text = (value || "").trim();
  if (!text || text.includes("?")) return fallback;
  if (/[\u4e00-\u9fff]/.test(fallback) && !/[\u4e00-\u9fff]/.test(text)) return fallback;
  return text;
}

function healClinicName(value: string): string {
  const text = healClinicText(value, DEFAULT_PROFILE.clinicName);
  if (text.replace(/^\u74e3/, "\u74ba") === DEFAULT_PROFILE.clinicName) return DEFAULT_PROFILE.clinicName;
  return text;
}

function fromBundle(data: ClinicProfileBundle): {
  profile: ClinicProfileFields;
  fees: ClinicFees;
  workflow: ClinicWorkflow;
} {
  const profile: ClinicProfileFields = { ...DEFAULT_PROFILE, ...(data.profile as Partial<ClinicProfileFields>) };
  if (!profile.mainDept || profile.mainDept.includes("?")) {
    profile.mainDept = "11 \u76ae\u819a\u79d1";
  }
  profile.clinicGrade = healClinicText(profile.clinicGrade, DEFAULT_PROFILE.clinicGrade);
  profile.region = healClinicText(profile.region, DEFAULT_PROFILE.region);
  profile.clinicName = healClinicName(profile.clinicName);
  profile.licenseNo = healClinicText(profile.licenseNo, DEFAULT_PROFILE.licenseNo);
  profile.dispenseType = healClinicText(profile.dispenseType, DEFAULT_PROFILE.dispenseType);
  profile.address = healClinicText(profile.address, DEFAULT_PROFILE.address);
  return {
    profile,
    fees: normalizeFees(data.fees as Partial<ClinicFees>),
    workflow: normalizeWorkflow(data.workflow as Partial<ClinicWorkflow>),
  };
}

export function readLocalClinicBundle(): {
  profile: ClinicProfileFields;
  fees: ClinicFees;
  workflow: ClinicWorkflow;
} {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) {
      return { profile: DEFAULT_PROFILE, fees: DEFAULT_FEES, workflow: DEFAULT_WORKFLOW };
    }
    const parsed = JSON.parse(raw) as ClinicProfileBundle;
    return fromBundle(parsed);
  } catch {
    return { profile: DEFAULT_PROFILE, fees: DEFAULT_FEES, workflow: DEFAULT_WORKFLOW };
  }
}

export async function loadClinicBundle(): Promise<{
  profile: ClinicProfileFields;
  fees: ClinicFees;
  workflow: ClinicWorkflow;
  source: "api" | "local";
}> {
  try {
    const res = await fetchClinicProfile();
    const bundle = fromBundle(res.data);
    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({ profile: bundle.profile, fees: bundle.fees, workflow: bundle.workflow }),
    );
    return { ...bundle, source: "api" };
  } catch {
    return { ...readLocalClinicBundle(), source: "local" };
  }
}

export async function persistClinicBundle(bundle: {
  profile: ClinicProfileFields;
  fees: ClinicFees;
  workflow: ClinicWorkflow;
}): Promise<"api" | "local"> {
  const stamped = { ...bundle, fees: { ...bundle.fees, feeRulesVersion: 2 } };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(stamped));
  try {
    await saveClinicProfile(bundle);
    return "api";
  } catch {
    return "local";
  }
}

/** ?P?B????????w?]?]????????F?i?????s???|??s?^?C */
export function loadClinicRegisterDefaults(): {
  regFeeOutpatient: string;
  regFeeSelfPay: string;
  mainDept: string;
  consultFeeDefault: string;
  defaultDoctorId: string;
  defaultPharmacistId: string;
  dispenseType: string;
  depositAmount: string;
} {
  const { profile, fees } = readLocalClinicBundle();
  const out =
    fees.regFeeOutpatient != null && fees.regFeeOutpatient !== 0
      ? String(fees.regFeeOutpatient)
      : fees.regFeeOutpatient === 0
        ? "0"
        : "";
  const self =
    fees.regFeeSelfPay != null && fees.regFeeSelfPay !== 0
      ? String(fees.regFeeSelfPay)
      : fees.regFeeSelfPay === 0
        ? "0"
        : "";
  return {
    regFeeOutpatient: out,
    regFeeSelfPay: self,
    mainDept: (profile.mainDept || "").trim(),
    consultFeeDefault:
      fees.consultFeeDefault != null ? String(fees.consultFeeDefault) : "250",
    defaultDoctorId: (profile.defaultDoctorId || "").trim(),
    defaultPharmacistId: (profile.defaultPharmacistId || "").trim(),
    dispenseType: (profile.dispenseType || "").trim(),
    depositAmount:
      fees.depositAmount != null && fees.depositAmount !== 0
        ? String(fees.depositAmount)
        : fees.depositAmount === 0
          ? "0"
          : "",
  };
}
