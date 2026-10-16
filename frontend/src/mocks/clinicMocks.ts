/**
 * 沙盒 1 — 皮膚科門診 Mock 資料（唯一真相來源）
 * 資料形狀對齊後端 queueMeta / dual-layer 貼紙，僅本地狀態。
 */

export type QueueStatus = "waiting" | "in_progress" | "no_show" | "finished";

export interface QueueEntry {
  encounterId: string;
  patientId: string;
  queueNumber: number;
  queueStatus: QueueStatus;
  patientDisplay: string;
  ageSex: string;
  hasAllergyAlert: boolean;
  /** 護理／自助預診已完成 → 掛號列 💬 */
  preVisitCompleted: boolean;
  reasonText: string;
  /** 醫聖 DoctBrw 欄位（UX 展示；API 模式可逐步對齊） */
  slotTime?: string;
  medicalNo?: string;
  age?: string;
  sex?: string;
  caseNo?: string;
  treatSeq?: string;
  treatDateTime?: string;
  treatmentNumber?: string;
  icException?: string;
  noCardReason?: string;
  pharmacist?: string;
  doctorId?: string;
  doctorName?: string;
  payType?: string;
  copayCode?: string;
  dispense?: string;
  room?: string;
  shift?: string;
  paperCard?: boolean;
  hcId?: string;
  afterCheck?: string;
  treatmentItem?: string;
  regFee?: string;
  copayAmt?: string;
  deposit?: string;
  consultFee?: string;
  drugFee?: string;
  totalFee?: string;
  materialFee?: string;
  burdenFee?: string;
  primaryDx?: string;
  phone?: string;
  address?: string;
  icdCode?: string;
  diseaseName?: string;
  rxDays?: string;
  weight?: string;
  id?: string;
  patientName?: string;
  birthday?: string;
  idNo?: string;
  sequenceNo?: number;
  /** 醫聖掛號「預」＝預掛，不是預診 */
  prebook?: boolean;
  /** 註（REMARK：押／還／暫…） */
  note?: string;
  /** 完診且健保卡已寫入 */
  cardWritten?: boolean;
}

export type BuffTone = "red" | "gold" | "blue" | "emerald";

export interface ClinicalBuff {
  id: string;
  label: string;
  tone: BuffTone;
}

/** 臨床狀態化身（Avatar + activeBuffs） */
export interface PatientClinicalProfile {
  initials: string;
  bgClass: string;
  ringClass: string;
  activeBuffs: ClinicalBuff[];
}

export interface AllergyRow {
  text: string;
  substance: string;
  manifestation: string;
  level: "high" | "confirmed" | "unconfirmed";
}

export interface DiagnosisRow {
  id?: string;
  icd10: string;
  snomed?: string;
  nhiIcd10?: string;
  /** ICD-9 / A-code. Not the same value as icd10. */
  icd9?: string;
  text: string;
  site?: string;
  morphology?: string;
}

/** 處置名稱左側計費註記（點擊切換；空白＝健保申報） */
export type RxPayMark = "" | "自" | "申" | "調" | "不" | "轉" | "交" | "材";

export const RX_PAY_MARKS: RxPayMark[] = ["", "自", "申", "調", "不", "轉", "交", "材"];

export const RX_PAY_MARK_HINT: Record<string, string> = {
  "": "健保申報",
  自: "自費或自行吸收",
  申: "申報用，不另供給病人",
  調: "交付調劑時此用藥為自調",
  不: "不另計價",
  轉: "轉檢項目",
  交: "交付檢驗項目",
  材: "自費特材",
};

/** 處置「註」欄右鍵符號（對醫聖「符號 代表意義」） */
export type RxMemoMark = "" | "[" | "/" | "*" | "@" | "," | "\\" | "^" | "$" | "!" | "?" | "+";

export const RX_MEMO_MARKS: { mark: RxMemoMark; hint: string }[] = [
  { mark: "", hint: "（清除／空白）" },
  { mark: "[", hint: "加入自費總額" },
  { mark: "/", hint: "強迫列印此項" },
  { mark: "*", hint: "不印在處方箋" },
  { mark: "@", hint: "申報且另收自費" },
  { mark: ",", hint: "A5 處方印「勿替代」" },
  { mark: "\\", hint: "不扣庫存" },
  { mark: "^", hint: "連續處方不印" },
  { mark: "$", hint: "總量固定值" },
  { mark: "!", hint: "自行檢驗" },
  { mark: "?", hint: "印自費同意書" },
  { mark: "+", hint: "強迫印檢驗單" },
];

export interface RxLine {
  id: string;
  name: string;
  sig: string;
  days: number;
  nhiCode: string;
  rxnorm?: string;
  route: "topical" | "oral" | "injection" | "treatment" | "exam" | "material" | string;
  qty?: number;
  unitPrice?: number;
  /** @deprecated 請用 payMark；true 時等同 payMark「自」 */
  selfPay?: boolean;
  /** 處置名稱左側：自／申／調…（空白＝健保申報） */
  payMark?: RxPayMark;
  memo?: string;
  shortName?: string;
  /** 總量（顯示用，如 7 #／1 Bx） */
  totalAmount?: string;
  /** 部位 */
  bodySite?: string;
  /** 標 */
  tag?: string;
}

export interface LesionMedia {
  id: string;
  capturedAt: string;
  site: string;
  label: string;
}

/** 醫聖新歷史病歷四格的一筆就診（SC32.exe DrHistory 瀏覽列） */
export interface HistoryVisit {
  encounterId: string;
  visitDate: string;
  slotDept: string;
  caseNo: string;
  rxDays: string;
  cardNo: string;
  aCode: string;
  diseaseName: string;
  doctor: string;
  dispense: string;
  chiefComplaint: string;
  diagnoses: DiagnosisRow[];
  medications: RxLine[];
}

export const mockPatients: Record<
  string,
  {
    resourceType: "Patient";
    id: string;
    name: { family: string; given: string[]; text?: string }[];
    gender: string;
    birthDate: string;
    identifier: { use?: string; system?: string; value: string }[];
    telecom?: { system: string; value: string; use?: string }[];
    address?: { text: string; use?: string }[];
    extension?: Array<{
      url: string;
      extension?: Array<{ url: string; valueString?: string; valueCode?: string }>;
    }>;
  }
> = {
  "local-patient-demo-1": {
    resourceType: "Patient",
    id: "local-patient-demo-1",
    name: [{ family: "王", given: ["小明"], text: "王小明" }],
    gender: "male",
    birthDate: "1985-03-15",
    identifier: [
      { use: "official", system: "http://www.moi.gov.tw/id", value: "A123456789" },
      { use: "secondary", system: "https://clinic.org/chart-number", value: "100001" },
    ],
    telecom: [
      { system: "phone", value: "06-2221111", use: "home" },
      { system: "phone", value: "0912345678", use: "mobile" },
    ],
    address: [{ text: "台南市北區成功路1號", use: "home" }],
    extension: [
      {
        url: "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/nhi-card-basic",
        extension: [
          { url: "idNo", valueString: "A123456789" },
          { url: "birthdayRoc", valueString: "0740315" },
          { url: "sex", valueCode: "M" },
        ],
      },
      {
        url: "https://clinic.org/fhir/StructureDefinition/patient-clinic-ext",
        extension: [
          { url: "kind", valueString: "D10 一般案" },
          { url: "keymoney", valueString: "500" },
          { url: "arrearage", valueString: "0" },
          { url: "idCategory", valueString: "老人優" },
          { url: "blood", valueString: "O" },
          { url: "marry", valueString: "已婚" },
          { url: "memo", valueString: "示範病患" },
          { url: "allergic", valueString: "青黴素" },
        ],
      },
    ],
  },
  "local-patient-demo-2": {
    resourceType: "Patient",
    id: "local-patient-demo-2",
    name: [{ family: "陳", given: ["美玲"], text: "陳美玲" }],
    gender: "female",
    birthDate: "1992-08-20",
    identifier: [
      { use: "official", system: "http://www.moi.gov.tw/id", value: "B223456789" },
      { use: "secondary", system: "https://clinic.org/chart-number", value: "100002" },
    ],
    telecom: [{ system: "phone", value: "0987654321", use: "mobile" }],
    address: [{ text: "台南市東區崇德路2號", use: "home" }],
    extension: [
      {
        url: "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/nhi-card-basic",
        extension: [
          { url: "idNo", valueString: "B223456789" },
          { url: "birthdayRoc", valueString: "0810820" },
          { url: "sex", valueCode: "F" },
        ],
      },
      {
        url: "https://clinic.org/fhir/StructureDefinition/patient-clinic-ext",
        extension: [
          { url: "kind", valueString: "D10 一般案" },
          { url: "keymoney", valueString: "0" },
          { url: "arrearage", valueString: "0" },
          { url: "idCategory", valueString: "S" },
          { url: "blood", valueString: "A" },
        ],
      },
    ],
  },
};

export const mockPatientClinicalProfiles: Record<string, PatientClinicalProfile> = {
  "local-patient-demo-1": {
    initials: "王明",
    bgClass: "bg-gradient-to-br from-sky-500 to-sky-700",
    ringClass: "border-sky-300",
    activeBuffs: [
      { id: "allergy", label: "藥物過敏", tone: "red" },
      { id: "chronic", label: "慢性追蹤", tone: "blue" },
    ],
  },
  "local-patient-demo-2": {
    initials: "陳美",
    bgClass: "bg-gradient-to-br from-rose-400 to-rose-600",
    ringClass: "border-rose-300",
    activeBuffs: [
      { id: "self_pay", label: "自費意願", tone: "gold" },
      { id: "pre_visit", label: "預診完成", tone: "emerald" },
    ],
  },
};

export function getPatientClinicalProfile(patientId: string): PatientClinicalProfile {
  return (
    mockPatientClinicalProfiles[patientId] ?? {
      initials: "?",
      bgClass: "bg-slate-400",
      ringClass: "border-slate-300",
      activeBuffs: [],
    }
  );
}

export const mockQueue: QueueEntry[] = [
  {
    encounterId: "enc-1",
    patientId: "local-patient-demo-1",
    queueNumber: 1,
    queueStatus: "in_progress",
    patientDisplay: "王小明",
    ageSex: "41M",
    age: "41",
    sex: "M",
    medicalNo: "000001",
    slotTime: "09:15",
    caseNo: "01",
    primaryDx: "蕁麻疹",
    hasAllergyAlert: true,
    preVisitCompleted: true,
    reasonText: "全身搔癢加劇、紅疹",
    idNo: "A123456789",
    birthday: "1985-03-15",
    deposit: "500",
    regFee: "150",
    copayAmt: "50",
  },
  {
    encounterId: "enc-2",
    patientId: "local-patient-demo-2",
    queueNumber: 2,
    queueStatus: "waiting",
    patientDisplay: "陳美玲",
    ageSex: "34F",
    age: "34",
    sex: "F",
    medicalNo: "000002",
    slotTime: "09:30",
    caseNo: "01",
    primaryDx: "輕度痤瘡",
    hasAllergyAlert: false,
    preVisitCompleted: true,
    reasonText: "臉部皮疹追蹤",
    idNo: "B223456789",
    birthday: "1992-08-20",
    deposit: "0",
    regFee: "50",
    copayAmt: "50",
  },
  {
    encounterId: "enc-3",
    patientId: "local-patient-demo-1",
    queueNumber: 3,
    queueStatus: "finished",
    patientDisplay: "王小明",
    ageSex: "41M",
    age: "41",
    sex: "M",
    medicalNo: "000001",
    slotTime: "08:00",
    caseNo: "08",
    primaryDx: "異位性皮膚炎",
    hasAllergyAlert: true,
    preVisitCompleted: false,
    reasonText: "複診（已完成）",
    idNo: "A123456789",
    birthday: "1985-03-15",
    deposit: "500",
  },
];

export const mockAllergiesByPatient: Record<string, AllergyRow[]> = {
  "local-patient-demo-1": [
    {
      text: "NSAIDs 類過敏",
      substance: "Ibuprofen (RxNorm 5640)",
      manifestation: "蕁麻疹",
      level: "high",
    },
  ],
  "local-patient-demo-2": [],
};

/** @deprecated use mockAllergiesByPatient */
export const mockAllergies = mockAllergiesByPatient["local-patient-demo-1"];

export const mockEncounters: Record<
  string,
  {
    resourceType: "Encounter";
    id: string;
    status: string;
    class: { code: string; display: string };
    subject: { reference: string };
    period: { start: string };
    reasonCode?: { text: string }[];
  }
> = {
  "enc-1": {
    resourceType: "Encounter",
    id: "enc-1",
    status: "in-progress",
    class: { code: "AMB", display: "ambulatory" },
    subject: { reference: "Patient/local-patient-demo-1" },
    period: { start: "2026-06-02T09:15:00+08:00" },
    reasonCode: [{ text: "全身搔癢加劇、紅疹" }],
  },
  "enc-2": {
    resourceType: "Encounter",
    id: "enc-2",
    status: "planned",
    class: { code: "AMB", display: "ambulatory" },
    subject: { reference: "Patient/local-patient-demo-2" },
    period: { start: "2026-06-02T09:30:00+08:00" },
    reasonCode: [{ text: "臉部皮疹追蹤" }],
  },
  "enc-3": {
    resourceType: "Encounter",
    id: "enc-3",
    status: "finished",
    class: { code: "AMB", display: "ambulatory" },
    subject: { reference: "Patient/local-patient-demo-1" },
    period: { start: "2026-06-02T08:00:00+08:00" },
    reasonCode: [{ text: "複診（已完成）" }],
  },
};

export const mockConditionsByEncounter: Record<string, DiagnosisRow[]> = {
  "enc-1": [
    {
      icd10: "L50.9",
      snomed: "126485001",
      nhiIcd10: "L50.9",
      text: "蕁麻疹",
      site: "軀幹",
      morphology: "紅斑、風團",
    },
  ],
  "enc-2": [
    {
      icd10: "L70.0",
      nhiIcd10: "L70.0",
      text: "輕度痤瘡",
      site: "臉部",
      morphology: "粉刺",
    },
  ],
  "enc-3": [
    {
      icd10: "L20.9",
      nhiIcd10: "L20.9",
      text: "異位性皮膚炎",
      site: "四肢",
    },
  ],
};

export const mockMediaByPatient: Record<string, LesionMedia[]> = {
  "local-patient-demo-1": [
    { id: "m1", capturedAt: "2026-05-15", site: "背部", label: "紅斑" },
    { id: "m2", capturedAt: "2026-05-28", site: "背部", label: "脫屑改善" },
    { id: "m3", capturedAt: "2026-06-01", site: "四肢", label: "新發風團" },
    { id: "m4", capturedAt: "2026-06-02", site: "軀幹", label: "今日" },
  ],
  "local-patient-demo-2": [
    { id: "m5", capturedAt: "2026-06-02", site: "臉部", label: "T 區丘疹" },
  ],
};

export const mockPrevRxByPatient: Record<string, RxLine[]> = {
  "local-patient-demo-1": [
    {
      id: "prx-1",
      name: "Betamethasone 膏",
      shortName: "Betamethasone",
      sig: "BID 外用",
      days: 7,
      qty: 1,
      nhiCode: "AC44121",
      rxnorm: "1292",
      route: "topical",
      payMark: "自",
      selfPay: true,
      memo: "",
      bodySite: "軀幹",
    },
    {
      id: "prx-2",
      name: "Cetirizine 錠",
      shortName: "Cetirizine",
      sig: "QD",
      days: 5,
      qty: 1,
      nhiCode: "BC25210",
      route: "oral",
      payMark: "",
      memo: "",
    },
  ],
  "local-patient-demo-2": [],
};

const demo1PrevRx = mockPrevRxByPatient["local-patient-demo-1"];

export const mockHistoryVisitsByPatient: Record<string, HistoryVisit[]> = {
  "local-patient-demo-1": [
    {
      encounterId: "enc-3",
      visitDate: "2026-06-02",
      slotDept: "08:00/門診/3",
      caseNo: "01",
      rxDays: "7",
      cardNo: "—",
      aCode: "—",
      diseaseName: "異位性皮膚炎",
      doctor: "—",
      dispense: "—",
      chiefComplaint: "複診（已完成）",
      diagnoses: mockConditionsByEncounter["enc-3"] ?? [],
      medications: demo1PrevRx,
    },
    {
      encounterId: "enc-h1",
      visitDate: "2026-05-15",
      slotDept: "10:20/門診",
      caseNo: "01",
      rxDays: "14",
      cardNo: "—",
      aCode: "—",
      diseaseName: "蕁麻疹",
      doctor: "—",
      dispense: "—",
      chiefComplaint: "CC: 全身搔癢、夜間加劇",
      diagnoses: [
        {
          icd10: "L50.9",
          nhiIcd10: "L50.9",
          text: "蕁麻疹",
          site: "軀幹",
        },
      ],
      medications: [
        {
          id: "prx-h1",
          name: "Cetirizine 錠",
          sig: "QD",
          days: 14,
          qty: 14,
          nhiCode: "BC25210",
          route: "oral",
        },
      ],
    },
    {
      encounterId: "enc-h2",
      visitDate: "2026-04-20",
      slotDept: "14:00/門診",
      caseNo: "01",
      rxDays: "7",
      cardNo: "—",
      aCode: "—",
      diseaseName: "異位性皮膚炎",
      doctor: "—",
      dispense: "—",
      chiefComplaint: "CC: 四肢濕疹復發",
      diagnoses: mockConditionsByEncounter["enc-3"] ?? [],
      medications: [
        {
          id: "prx-h2",
          name: "Betamethasone 膏",
          sig: "BID 外用",
          days: 7,
          qty: 1,
          nhiCode: "AC44121",
          route: "topical",
        },
      ],
    },
  ],
  "local-patient-demo-2": [],
};

export function mockHistoryVisitsFor(
  patientId: string,
  excludeEncounterId: string | null,
): HistoryVisit[] {
  return (mockHistoryVisitsByPatient[patientId] ?? []).filter(
    (v) => v.encounterId !== excludeEncounterId,
  );
}

/** @deprecated use mockPrevRxByPatient */
export const mockPrevRx = mockPrevRxByPatient["local-patient-demo-1"];

export function emptyCurrentRx(): RxLine[] {
  return [];
}

export function cloneRxLines(lines: RxLine[]): RxLine[] {
  return lines.map((l) => ({
    ...l,
    id: `rx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  }));
}
