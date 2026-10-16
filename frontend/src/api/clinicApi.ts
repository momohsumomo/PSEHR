import { API_BASE, API_ENABLED } from "@/config/sandbox";
import { loadLocalDeviceMeta } from "@/lib/clinicDevice";

function workstationHeader(): string {
  const meta = loadLocalDeviceMeta();
  const label = meta.label.trim();
  if (label && label !== meta.id) return `${label} (${meta.id})`;
  return meta.id || "Unknown_Machine";
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const machineId = workstationHeader();
  
  // 15-minute PIN session cache check
  let cachedPin = "";
  const pinVal = sessionStorage.getItem("clinic_operator_pin");
  const pinTime = sessionStorage.getItem("clinic_operator_pin_time");
  if (pinVal && pinTime) {
    const elapsed = Date.now() - parseInt(pinTime, 10);
    if (elapsed < 15 * 60 * 1000) {
      cachedPin = pinVal;
    } else {
      sessionStorage.removeItem("clinic_operator_pin");
      sessionStorage.removeItem("clinic_operator_pin_time");
    }
  }

  const customHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Machine-ID": machineId,
  };

  if (cachedPin) {
    customHeaders["X-PIN-Code"] = cachedPin;
  }

  const oauthToken = sessionStorage.getItem("oauth_token");
  if (oauthToken) {
    customHeaders["Authorization"] = `Bearer ${oauthToken}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...customHeaders,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const parsed = JSON.parse(text) as { detail?: unknown };
      const detail = parsed.detail;
      if (typeof detail === "string") throw new Error(detail);
      if (detail && typeof detail === "object" && "diagnose" in detail && "message" in detail) {
        const body = detail as { message: string; diagnose?: CardFaultReport };
        throw new CardReadError(body.message, body.diagnose ?? null);
      }
      if (detail != null) throw new Error(JSON.stringify(detail));
    } catch (e) {
      if (e instanceof Error && e.name !== "SyntaxError") throw e;
    }
    throw new Error(text || `${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type CardFaultCheck = {
  id: string;
  ok: boolean;
  label: string;
  detail?: string;
  stop?: boolean;
};

export type CardInitSlot = {
  name: string;
  alive: boolean;
  kind: "dead" | "empty" | "hc" | "hpc" | "partial" | "unknown" | string;
  kindLabel?: string;
  detail?: string;
};

export type CardFaultReport = {
  owner?: string;
  ownerLabel?: string;
  headline: string;
  checks?: CardFaultCheck[];
  stages?: CardFaultCheck[];
  slots?: CardInitSlot[];
  humanAction?: "none" | "reseat_card" | "unplug_reader" | "start_software" | "restart_software" | string;
  humanActionLabel?: string;
  deskAction?: "none" | "reseat_card" | "unplug_reader" | "start_software" | "restart_software" | string;
  deskTitle?: string;
  deskWhich?: string;
  autoFixed?: string[];
  defaultReader?: string;
  hcStatusCode?: number | null;
};

export class CardReadError extends Error {
  diagnose: CardFaultReport | null;
  constructor(message: string, diagnose?: CardFaultReport | null) {
    super(message);
    this.name = "CardReadError";
    this.diagnose = diagnose ?? null;
  }
}

export type ApiQueueEntry = {
  resource: { id: string };
  queueMeta: {
    queueNumber: number;
    queueStatus: string;
    fhirStatus?: string;
    encounterDate?: string;
    patientId: string;
    patientDisplay: string;
    preVisitCompleted?: boolean;
    hasAllergyAlert?: boolean;
    reasonText?: string;
    slotTime?: string;
    medicalNo?: string;
    age?: string;
    sex?: string;
    ageSex?: string;
    phone?: string;
    address?: string;
    icdCode?: string;
    diseaseName?: string;
    rxDays?: string;
    weight?: string;
    birthday?: string;
    id?: string;
    patientName?: string;
    sequenceNo?: number;
    caseNo?: string;
    treatSeq?: string;
    treatmentNumber?: string;
    treatDateTime?: string;
    copayCode?: string;
    dispense?: string;
    room?: string;
    shift?: string;
    paperCard?: boolean;
    hcId?: string;
    hcIdNo?: string;
    /** 病患主檔身分證（Encounter hcIdNo 空時後端會回填） */
    idNo?: string;
    idCategory?: string;
    kind?: string;
    icException?: string;
    noCardReason?: string;
    pharmacist?: string;
    doctorId?: string;
    doctorName?: string;
    payType?: string;
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
    selfPay?: string;
    cardDisc?: string;
    drugDisc?: string;
    arrears?: string;
    treatFee?: string;
    note?: string;
    noteMark?: string;
    forespeak?: string;
    prebook?: boolean;
    cardWritten?: boolean;
    timesNo?: number;
    oweCard?: boolean;
    regCc?: string;
    regRemark?: string;
  };
};

export type WorkspaceResponse = {
  encounterId: string;
  patientId: string;
  preVisitCompleted: boolean;
  hasAllergyAlert: boolean;
  chiefComplaint: string;
  patient: Record<string, unknown>;
  encounter: Record<string, unknown>;
  allergies: Array<{
    text?: string;
    substance?: string;
    manifestation?: string;
    level: string;
  }>;
  vitals: Array<{ resource: Record<string, unknown>; indexMeta?: Record<string, unknown> }>;
  diagnoses: Array<{ resource: Record<string, unknown>; indexMeta?: Record<string, unknown> }>;
  currentMedications: Array<{ resource: Record<string, unknown>; indexMeta?: Record<string, unknown> }>;
  previousMedications: Array<{ resource: Record<string, unknown>; indexMeta?: Record<string, unknown> }>;
  historyVisits?: Array<{
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
    diagnoses: Array<{ resource: Record<string, unknown>; indexMeta?: Record<string, unknown> }>;
    medications: Array<{ resource: Record<string, unknown>; indexMeta?: Record<string, unknown> }>;
  }>;
  lesionMedia?: Array<{
    resource?: Record<string, unknown>;
    indexMeta?: {
      resourceId?: string;
      siteLabel?: string;
      capturedDateTime?: string;
    };
  }>;
};

export function isApiMode(): boolean {
  return API_ENABLED;
}

export type QueueDateHints = {
  requestedDate?: string;
  autoFallback?: boolean;
  dateMin?: string | null;
  dateMax?: string | null;
  suggestedDate?: string | null;
  suggestedCount?: number;
  nearestBefore?: { date: string; count: number } | null;
  nearestAfter?: { date: string; count: number } | null;
};

export async function fetchQueueForDate(
  dateStr: string,
): Promise<{ entry: ApiQueueEntry[]; resolvedDate: string } & QueueDateHints> {
  const bundle = await request<
    {
      entry?: ApiQueueEntry[];
      date?: string;
      requestedDate?: string;
      autoFallback?: boolean;
      dateMin?: string | null;
      dateMax?: string | null;
      suggestedDate?: string | null;
      suggestedCount?: number;
      nearestBefore?: { date: string; count: number } | null;
      nearestAfter?: { date: string; count: number } | null;
    }
  >(`/fhir/Encounter?date=${encodeURIComponent(dateStr)}`);
  return {
    entry: bundle.entry ?? [],
    resolvedDate: bundle.date ?? dateStr,
    requestedDate: bundle.requestedDate,
    autoFallback: bundle.autoFallback,
    dateMin: bundle.dateMin,
    dateMax: bundle.dateMax,
    suggestedDate: bundle.suggestedDate,
    suggestedCount: bundle.suggestedCount,
    nearestBefore: bundle.nearestBefore,
    nearestAfter: bundle.nearestAfter,
  };
}

/** 調閱病歷：依看診日區間撈掛號／就醫清單（不必先指定病患）。 */
export async function fetchEncountersInRange(opts: {
  dateFrom: string;
  dateTo: string;
  patientId?: string | null;
  hasImage?: boolean;
}): Promise<{
  entry: ApiQueueEntry[];
  total: number;
  dateFrom: string;
  dateTo: string;
  clipped?: boolean;
  requestedFrom?: string;
  hasImage?: boolean;
  imageFolderReady?: boolean;
  cashReturns: {
    date: string;
    amount: number;
    copayCode?: string;
    chart?: string;
    patientName?: string;
    idNo?: string;
    seg?: string;
    treatSeq?: string;
    caseNo?: string;
  }[];
}> {
  const params = new URLSearchParams({
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
    _t: String(Date.now()),
  });
  if (opts.patientId) {
    params.set("patient", opts.patientId.startsWith("Patient/") ? opts.patientId : `Patient/${opts.patientId}`);
  }
  if (opts.hasImage) params.set("hasImage", "true");
  const bundle = await request<{
    entry?: ApiQueueEntry[];
    total?: number;
    dateFrom?: string;
    dateTo?: string;
    clipped?: boolean;
    requestedFrom?: string;
    hasImage?: boolean;
    imageFolderReady?: boolean;
    cashReturns?: {
      date: string;
      amount: number;
      copayCode?: string;
      chart?: string;
      patientName?: string;
      idNo?: string;
      seg?: string;
      treatSeq?: string;
      caseNo?: string;
    }[];
  }>(`/fhir/Encounter/emr-lookup?${params.toString()}`);
  return {
    entry: bundle.entry ?? [],
    total: bundle.total ?? bundle.entry?.length ?? 0,
    dateFrom: bundle.dateFrom ?? opts.dateFrom,
    dateTo: bundle.dateTo ?? opts.dateTo,
    clipped: Boolean(bundle.clipped),
    requestedFrom: bundle.requestedFrom,
    hasImage: Boolean(bundle.hasImage),
    imageFolderReady: bundle.imageFolderReady !== false,
    cashReturns: bundle.cashReturns ?? [],
  };
}

export async function fetchCashBook(opts: {
  dateFrom: string;
  dateTo: string;
  shift?: string;
  finished?: boolean;
}): Promise<{
  dateFrom: string;
  dateTo: string;
  days: {
    date: string;
    people: number;
    deposit: number;
    copayAmt: number;
    cardDisc: number;
    drugDisc: number;
    regFee: number;
    selfPay: number;
    received: number;
    arrears: number;
    returnSlip: number;
    total: number;
  }[];
  buckets: {
    code: string;
    firstVisit: number;
    revisit: number;
    missingCard: number;
    returnCard: number;
  }[];
}> {
  const params = new URLSearchParams({
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
  });
  if (opts.shift) params.set("shift", opts.shift);
  if (opts.finished) params.set("finished", "true");
  return request(`/fhir/Encounter/cash-book?${params.toString()}`);
}

export async function fetchEncounterDateSpan(): Promise<{
  dateMin: string | null;
  dateMax: string | null;
  total: number;
  suggestedDate: string | null;
  suggestedCount: number;
}> {
  return request("/fhir/Encounter/date-span");
}

export async function fetchWorkspace(
  encounterId: string,
  opts?: { historyLimit?: number },
): Promise<WorkspaceResponse> {
  const limit = opts?.historyLimit;
  const q =
    limit === undefined ? "" : `?history_limit=${encodeURIComponent(String(limit))}`;
  return request<WorkspaceResponse>(`/nhi/v1/outpatient/workspace/${encounterId}${q}`);
}

export async function patchQueueStatus(
  encounterId: string,
  queue_status: string,
): Promise<void> {
  await request(`/fhir/Encounter/${encounterId}/queue-status`, {
    method: "PATCH",
    body: JSON.stringify({ queue_status }),
  });
}

export async function submitPreVisit(body: {
  encounterId: string;
  chiefComplaint: string;
  symptomTags: string[];
  patientIdNo?: string;
  hasDrugAllergyHistory?: boolean;
}): Promise<void> {
  await request("/nhi/v1/previsit/submit", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchCcPhrases(): Promise<string[]> {
  const data = await request<{ items?: string[] }>("/nhi/v1/cc/phrases");
  return data.items || [];
}

export async function lookupIntake(rocBirthday: string): Promise<Array<{ encounterId: string; maskedName: string; idTail: string }>> {
  const data = await request<{ items?: Array<{ encounterId: string; maskedName: string; idTail: string }> }>(
    "/nhi/v1/kiosk/intake/lookup",
    { method: "POST", body: JSON.stringify({ rocBirthday }) },
  );
  return data.items || [];
}

export async function submitIntake(body: {
  encounterId: string;
  location: string;
  symptoms: string[];
  duration: string;
  priorTopical: boolean;
}): Promise<void> {
  await request("/nhi/v1/kiosk/intake/submit", { method: "POST", body: JSON.stringify(body) });
}

export async function readVirtualCard(token: string): Promise<PatientRegisterResponse> {
  return request<PatientRegisterResponse>("/nhi/v1/kiosk/virtual-card", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export async function registerCondition(body: Record<string, unknown>): Promise<void> {
  await request("/nhi/v1/condition/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export interface IcdCrosswalkResult {
  inputKind: string;
  kind: string;
  icd10: string;
  nhiIcd10: string;
  title: string;
  secondary: { icd10: string; nhiIcd10: string; title: string }[];
  chiefNote: string;
  review: boolean;
}

export async function crosswalkDiagnosis(code: string, text?: string): Promise<IcdCrosswalkResult> {
  return request<IcdCrosswalkResult>("/nhi/v1/diagnosis/crosswalk", {
    method: "POST",
    body: JSON.stringify({ code, text: text || "" }),
  });
}

export interface DiagnosisSearchHit {
  icd9: string;
  name: string;
  nameEn?: string;
  icd10: string;
  nhiIcd10: string;
  title: string;
  secondary: { icd10: string; nhiIcd10: string; title: string }[];
  chiefNote: string;
}

export async function fetchDiagnosisGroups(query: {
  lo?: number;
  hi?: number;
  letter?: string;
}): Promise<{ code: string; name: string; nameEn: string; count: number }[]> {
  const params = new URLSearchParams();
  if (query.letter) params.set("letter", query.letter);
  else {
    params.set("lo", String(query.lo || 0));
    params.set("hi", String(query.hi || 0));
  }
  const res = await request<{ groups: { code: string; name: string; nameEn: string; count: number }[] }>(
    `/nhi/v1/diagnosis/browse?${params.toString()}`,
  );
  return res.groups || [];
}

export async function fetchDiagnosisCodes(prefix: string): Promise<{ icd9: string; name: string; nameEn: string }[]> {
  const res = await request<{ codes: { icd9: string; name: string; nameEn: string }[] }>(
    `/nhi/v1/diagnosis/browse?prefix=${encodeURIComponent(prefix)}`,
  );
  return res.codes || [];
}

export async function searchDiagnosisCodes(query: string): Promise<DiagnosisSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const res = await request<{ hits: DiagnosisSearchHit[] }>(
    `/nhi/v1/diagnosis/search?q=${encodeURIComponent(q)}`,
  );
  return res.hits || [];
}

export interface Icd10BookHit {
  icd10: string;
  nhiIcd10: string;
  nameEn: string;
  nameZh: string;
  icd9: string;
}

export async function searchIcd10Book(query: string): Promise<Icd10BookHit[]> {
  const q = query.trim();
  if (!q || (q.length < 2 && !/[\u4e00-\u9fff]/.test(q))) return [];
  const res = await request<{ hits: Icd10BookHit[] }>(
    `/nhi/v1/diagnosis/book?q=${encodeURIComponent(q)}`,
  );
  return res.hits || [];
}

export async function registerMedication(body: Record<string, unknown>): Promise<void> {
  await request("/nhi/v1/medication/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateMedicationRequest(
  medicationId: string,
  body: Record<string, unknown>,
): Promise<void> {
  await request(`/fhir/MedicationRequest/${medicationId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function updateConditionResource(
  conditionId: string,
  body: Record<string, unknown>,
): Promise<void> {
  await request(`/fhir/Condition/${conditionId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function registerSoap(body: Record<string, unknown>): Promise<void> {
  await request("/nhi/v1/soap/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** 生命徵象 Observation（體重／體溫／血壓…） */
export async function registerObservation(body: {
  encounterId: string;
  patientIdNo?: string;
  vitalType:
    | "body_temperature"
    | "heart_rate"
    | "systolic_bp"
    | "diastolic_bp"
    | "body_weight"
    | "body_height"
    | "custom";
  value: number;
  unit?: string;
  displayText?: string;
}): Promise<void> {
  await request("/nhi/v1/observation/register", {
    method: "POST",
    body: JSON.stringify({ category: "vital-signs", status: "final", ...body }),
  });
}

export type PatientRegisterBody = {
  idNo: string;
  birthday: string;
  sex: string;
  patientName?: string;
};

export type PatientRegisterResponse = {
  created: boolean;
  patientId: string;
  validation?: {
    idNo?: string;
    birthdayRoc?: string;
    sex?: string;
    patientName?: string;
    cardId?: string;
  };
  cardBridgeNote?: string | null;
  consoleReachable?: boolean;
};

export type EncounterRegisterBody = {
  patientId: string;
  patientIdNo?: string;
  queueStatus?: "waiting" | "in_progress";
  reasonText?: string;
  encounterDate?: string;
  caseNo?: string;
  copayCode?: string;
  dispense?: string;
  room?: string;
  shift?: string;
  treatmentItem?: string;
  afterCheck?: string;
  paperCard?: boolean;
  treatSeq?: string;
  treatmentNumber?: string;
  treatDateTime?: string;
  securitySign?: string;
  samId?: string;
  hcId?: string;
  hcIdNo?: string;
  icException?: string;
  noCardReason?: string;
  pharmacist?: string;
  doctorId?: string;
  doctorName?: string;
  payType?: string;
  regFee?: string;
  copayAmt?: string;
  deposit?: string;
  consultFee?: string;
  drugFee?: string;
  totalFee?: string;
  materialFee?: string;
  burdenFee?: string;
  prebook?: boolean;
  /** 只有雲端／寫卡成功才送 true；省略表示不改既有勾圈 */
  cardWritten?: boolean;
  queueNumber?: number;
  visitClock?: string;
};

export type EncounterRegisterResponse = {
  encounterId: string;
  patientId: string;
  queueNumber: number;
  queueStatus: string;
};

export async function readCardAndRegister(mock = false): Promise<PatientRegisterResponse> {
  return request<PatientRegisterResponse>(
    `/nhi/v1/card/read-and-register?mock=${mock ? "true" : "false"}`,
    { method: "POST" },
  );
}

export type CardConsoleStatus = {
  reachable: boolean;
  consoleBase?: string;
  initialized?: boolean;
  deviceName?: string;
  defaultReader?: string;
  readerName?: string;
  readers?: string[];
  sam?: { status?: number | null; statusLabel?: string; typeLabel?: string };
  hc?: { status?: number | null; statusLabel?: string; typeLabel?: string };
  hpc?: { status?: number | null; statusLabel?: string; typeLabel?: string };
  hcRead?: { ok?: boolean; idNoMasked?: string; statusHint?: string } | null;
  hpcRead?: { ok?: boolean; idNoMasked?: string; statusHint?: string } | null;
  advice?: string[];
  fault?: CardFaultReport;
  consoleFixable?: boolean;
};

export type CardConsoleFixResult = {
  ok: boolean;
  action: "none" | "start" | "restart" | "unsupported" | string;
  message: string;
  steps?: string[];
  needsPortFix?: boolean;
  portFixBat?: string;
  status?: CardConsoleStatus;
};

export async function fetchCardConsoleStatus(light = true): Promise<CardConsoleStatus> {
  const q = light ? "?light=true" : "";
  return request<CardConsoleStatus>(`/nhi/v1/card/console-status${q}`);
}

export async function fixCardConsole(): Promise<CardConsoleFixResult> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 35000);
  try {
    return await request<CardConsoleFixResult>("/nhi/v1/card/console-fix", {
      method: "POST",
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("讀卡軟體除錯逾時，請看工作列是否已出現主控台圖示。");
    }
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function writeVisitToCard(body: {
  encounterId: string;
  writeDx?: boolean;
  writeOrders?: boolean;
}): Promise<{ written: boolean; reason: string; source?: string }> {
  const ctrl = new AbortController();
  // VPN WriteCodeFee / Prescription 可能較久
  const timer = window.setTimeout(() => ctrl.abort(), 45000);
  try {
    return await request<{ written: boolean; reason: string; source?: string }>("/nhi/v1/card/write-visit", {
      method: "POST",
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("健保雲端寫入逾時。本機病歷若已存請核對；勿重複假裝成功。請確認 VPN／插卡後再 F9。");
    }
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
}

export type OpenDeposit = {
  encounterId: string;
  encounterDate: string;
  queueNumber: number;
  amount: number;
  name: string;
  chartNo: string;
};

export async function fetchOpenDeposits(idNo: string): Promise<{ items: OpenDeposit[] }> {
  const q = new URLSearchParams({ idNo });
  return request(`/nhi/v1/deposits/open?${q.toString()}`);
}

export async function refundDeposit(encounterId: string): Promise<{
  ok: boolean;
  amount: number;
  sequenceNumber: string;
  uploadDate: string;
  reason: string;
}> {
  return request(`/nhi/v1/encounter/${encodeURIComponent(encounterId)}/refund-deposit`, {
    method: "POST",
  });
}

export async function fetchSeqNext(body: {
  treatmentItem?: string;
  afterCheck?: string;
  paperCard?: boolean;
  icException?: string;
  patientIdNo?: string;
  noCardReason?: string;
}): Promise<{
  ok: boolean;
  skipped: boolean;
  reason: string;
  sequenceNumber?: string | null;
  treatmentNumber?: string | null;
  treatmentDateTime?: string | null;
  signature?: string | null;
  samId?: string | null;
  hcId?: string | null;
  hcIdNo?: string | null;
  isSameDay?: boolean | null;
  hvExpire?: boolean | null;
  treatmentLimit?: number | null;
}> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 35000);
  try {
    return await request("/nhi/v1/card/seq-next", {
      method: "POST",
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("健保局取號逾時。未編造就醫序號，本筆尚未掛進清單。");
    }
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
}

export type ReferralSlipRow = {
  id: string;
  kind: "out" | "reply" | string;
  encounterId: string;
  patientName: string;
  medicalNo: string;
  idNo: string;
  destHosp: string;
  destCode: string;
  dept: string;
  purpose: string;
  doctor: string;
  diagnosis: string;
  note: string;
  historyText?: string;
  treatText?: string;
  sex?: string;
  birth?: string;
  phone?: string;
  address?: string;
  contact?: string;
  allergyText?: string;
  destDept?: string;
  destDoctor?: string;
  destTel?: string;
  destAddr?: string;
  fax?: string;
  email?: string;
  clinicTel?: string;
  examOn?: string;
  medOn?: string;
  purposeNote?: string;
  serial: string;
  validUntil: string;
  status: string;
  openedOn?: string;
  updatedAt: string;
};

export async function fetchReferralSlips(kind: "out" | "reply"): Promise<{ items: ReferralSlipRow[] }> {
  return request(`/nhi/v1/referral/slips?kind=${kind}`);
}

export async function saveReferralSlip(body: Partial<ReferralSlipRow> & { kind: "out" | "reply" }): Promise<ReferralSlipRow> {
  const data = await request<{ ok: boolean; item?: ReferralSlipRow; reason?: string }>("/nhi/v1/referral/slips", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!data.ok || !data.item) throw new Error(data.reason || "\u8f49\u8a3a\u540d\u55ae\u5b58\u6a94\u5931\u6557");
  return data.item;
}

export async function queryReferral(body: { encounterId?: string; idNo?: string }): Promise<{
  ok: boolean;
  reason: string;
  serial: string;
  openDate?: string;
  retry?: boolean;
  count?: number;
}> {
  return request("/nhi/v1/referral/query", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function replyReferral(body: {
  encounterId?: string;
  idNo?: string;
  serial?: string;
  doctorId?: string;
  diagnosis?: string;
  note?: string;
  expectReferral?: boolean;
}): Promise<{
  ok: boolean;
  skipped: boolean;
  uploaded: boolean;
  reason: string;
  serial: string;
  localId?: string;
}> {
  return request("/nhi/v1/referral/reply", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function cancelRegister(body: {
  encounterId: string;
  mode: "local" | "ic" | "both";
}): Promise<{
  ok: boolean;
  localCancelled: boolean;
  icRolledBack: boolean;
  reason: string;
}> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 35000);
  try {
    return await request("/nhi/v1/encounter/cancel", {
      method: "POST",
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("健保局退掛逾時。本機掛號未刪。");
    }
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function registerPatient(body: PatientRegisterBody): Promise<PatientRegisterResponse> {
  return request<PatientRegisterResponse>("/nhi/v1/patient/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function registerEncounter(
  body: EncounterRegisterBody,
): Promise<EncounterRegisterResponse> {
  return request<EncounterRegisterResponse>("/nhi/v1/encounter/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function patchEncounterReg(
  encounterId: string,
  body: EncounterRegisterBody,
): Promise<{ ok: boolean; encounterId: string }> {
  return request(`/nhi/v1/encounter/${encodeURIComponent(encounterId)}/reg`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function modifyLayoutWithLlm(body: {
  current_layout: any;
  command: string;
  api_key?: string;
}): Promise<{ layoutGrid: any; message: string }> {
  return request<{ layoutGrid: any; message: string }>("/sandbox/layout/modify", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type ApiPatient = {
  id: string;
  name?: Array<{ text?: string; family?: string; given?: string[] }>;
  gender?: string;
  birthDate?: string;
  identifier?: Array<{ system?: string; value?: string; use?: string }>;
  telecom?: Array<{ system?: string; value?: string; use?: string }>;
  address?: Array<{ text?: string; use?: string; postalCode?: string }>;
  extension?: Array<{
    url: string;
    extension?: Array<{ url: string; valueString?: string; valueCode?: string }>;
  }>;
};

export async function fetchPatients(query?: {
  name?: string;
  idNo?: string;
  q?: string;
  /** typed＝只比對這個輸入該屬的欄位（調閱病歷） */
  match?: "typed";
  phone?: string;
  birthday?: string;
  _offset?: number;
  _count?: number;
}): Promise<{ entry?: Array<{ resource: ApiPatient }>; total: number }> {
  const params: Record<string, string> = {};
  if (query?.name) params.name = query.name;
  if (query?.idNo) params.identifier = query.idNo;
  if (query?.q) params.q = query.q;
  if (query?.match) params.match = query.match;
  if (query?.phone) params.phone = query.phone;
  if (query?.birthday) params.birthday = query.birthday;
  if (query?._offset !== undefined) params._offset = String(query._offset);
  if (query?._count !== undefined) params._count = String(query._count);
  const qStr = new URLSearchParams(params).toString();
  const path = qStr ? `/fhir/Patient?${qStr}` : "/fhir/Patient";
  return request<{ entry?: Array<{ resource: ApiPatient }>; total: number }>(path);
}

export type PatientRosterItem = {
  id: string;
  medicalNo: string;
  name: string;
  idNo: string;
  birthdayRoc: string;
  phone: string;
  idCategory: string;
};

export async function fetchPatientRoster(): Promise<{ total: number; items: PatientRosterItem[] }> {
  return request("/fhir/Patient/roster");
}

export type FamilyMember = {
  patientId: string;
  name: string;
  age: string;
  sex: string;
  medicalNo: string;
  lastVisit: string;
  disease: string;
};

/** 家族清單：同電話／手機或同住址。 */
export async function fetchPatientFamily(patientId: string): Promise<FamilyMember[]> {
  const bundle = await request<{ entry?: FamilyMember[] }>(
    `/fhir/Patient/${encodeURIComponent(patientId)}/family`,
  );
  return bundle.entry ?? [];
}

export type PatientPhotoIndex = {
  id: string;
  siteLabel: string;
  capturedAt: string;
  contentType: string;
};

export type LookFolderFile = { rel: string; name: string; medicalNo: string; modified?: string };

export async function fetchLookFolder(medicalNo: string): Promise<{
  root: string;
  reachable: boolean;
  total: number;
  entry: LookFolderFile[];
}> {
  const q = new URLSearchParams({ medicalNo });
  return request(`/fhir/Media/look-folder?${q.toString()}`);
}

export function lookFileUrl(rel: string): string {
  const q = new URLSearchParams({ rel });
  return `${API_BASE}/fhir/Media/look-file?${q.toString()}`;
}

export async function saveLookPhoto(medicalNo: string, file: File): Promise<{ rel: string; name: string }> {
  const q = new URLSearchParams({ medicalNo });
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`${API_BASE}/fhir/Media/look-file?${q.toString()}`, {
    method: "POST",
    headers: { "X-Machine-ID": workstationHeader() },
    body,
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<{ rel: string; name: string }>;
}

export async function replaceLookPhoto(
  rel: string,
  file: Blob,
  filename: string,
): Promise<{ rel: string; name: string }> {
  const q = new URLSearchParams({ rel });
  const body = new FormData();
  body.append("file", file, filename);
  const res = await fetch(`${API_BASE}/fhir/Media/look-file/replace?${q.toString()}`, {
    method: "POST",
    headers: { "X-Machine-ID": workstationHeader() },
    body,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ rel: string; name: string }>;
}

export async function removeLookPhoto(rel: string): Promise<void> {
  const q = new URLSearchParams({ rel });
  await request(`/fhir/Media/look-file/remove?${q.toString()}`, { method: "POST" });
}

export async function fetchPatientPhotos(patientId: string): Promise<PatientPhotoIndex[]> {
  const bundle = await request<{
    entry?: Array<{
      resource?: { id?: string };
      indexMeta?: {
        siteLabel?: string;
        capturedDateTime?: string;
        contentType?: string;
        hasImageData?: boolean;
      };
    }>;
  }>(`/fhir/Media?patient=${encodeURIComponent(patientId)}`);
  return (bundle.entry ?? [])
    .filter((e) => e.indexMeta?.hasImageData !== false && e.resource?.id)
    .map((e) => ({
      id: String(e.resource?.id),
      siteLabel: e.indexMeta?.siteLabel || "",
      capturedAt: (e.indexMeta?.capturedDateTime || "").slice(0, 16).replace("T", " "),
      contentType: e.indexMeta?.contentType || "image/jpeg",
    }));
}

export type CareOnlineImportResult = {
  date: string;
  fetched: number;
  imported: number;
  createdPatients: number;
  skippedExisting: number;
  birthdayKept: number;
  errors: string[];
};

/** 照護線上：指定看診日的預約，號碼沿用平台掛號號。 */
export async function importCareOnline(visitingDate: string): Promise<CareOnlineImportResult> {
  return request<CareOnlineImportResult>(
    `/nhi/v1/care-online/import?visitingDate=${encodeURIComponent(visitingDate)}`,
    { method: "POST" },
  );
}

export async function fetchMediaDataUrl(mediaId: string): Promise<string | null> {
  const body = await request<{
    content?: { contentType?: string; data?: string };
    resource?: { content?: { contentType?: string; data?: string } };
  }>(`/fhir/Media/${encodeURIComponent(mediaId)}?includeData=true`);
  const resource = body.content ? body : (body.resource ?? body);
  const data = resource.content?.data;
  if (!data || data === "[stored]" || data === "[omitted]") return null;
  const ctype = resource.content?.contentType || "image/jpeg";
  return `data:${ctype};base64,${data}`;
}

export async function updatePatient(patientId: string, body: any, pin?: string): Promise<ApiPatient> {
  const headers: Record<string, string> = {};
  if (pin) {
    headers["X-PIN-Code"] = pin;
  }
  return request<ApiPatient>(`/fhir/Patient/${patientId}`, {
    method: "PUT",
    body: JSON.stringify(body),
    headers,
  });
}

export async function createPatient(body: any, pin?: string): Promise<ApiPatient> {
  const headers: Record<string, string> = {};
  if (pin) {
    headers["X-PIN-Code"] = pin;
  }
  return request<ApiPatient>("/fhir/Patient", {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
}

export async function fetchNextMedicalNo(): Promise<string> {
  const res = await request<{ medicalNo: string }>("/fhir/Patient/next-medical-no");
  return res.medicalNo;
}

export type AuditStatus = {
  recordingEnabled: boolean;
  goLiveAt: string | null;
  modificationCount: number;
};

export async function fetchAuditStatus(): Promise<AuditStatus> {
  return request<AuditStatus>("/fhir/Patient/audit-status");
}

export type PatientModification = {
  id: number;
  recordId: string;
  resourceType: string;
  timestamp: string;
  machineId: string;
  changedFields: Record<string, unknown>;
  operatorIdentity: string;
  action: string;
};

export async function fetchPatientModifications(
  patientId: string,
  limit = 50
): Promise<PatientModification[]> {
  const res = await request<{ entry?: PatientModification[] }>(
    `/fhir/Patient/${encodeURIComponent(patientId)}/modifications?limit=${limit}`
  );
  return res.entry ?? [];
}

export async function fetchPatient(patientId: string): Promise<ApiPatient> {
  return request<ApiPatient>(`/fhir/Patient/${patientId}`);
}

export async function deletePatient(patientId: string, pin?: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (pin) {
    headers["X-PIN-Code"] = pin;
  }
  await request<void>(`/fhir/Patient/${patientId}`, {
    method: "DELETE",
    headers,
  });
}


export type ApiEncounter = {
  id: string;
  status: string;
  period?: { start?: string };
  reasonCode?: Array<{ text?: string }>;
  participant?: Array<{ individual?: { display?: string; reference?: string } }>;
};

export type ApiCondition = {
  id: string;
  code?: { text?: string; coding?: Array<{ system?: string; code?: string }> };
  recordedDate?: string;
  encounter?: { reference?: string };
};

export type ApiMedicationRequest = {
  id: string;
  medicationCodeableConcept?: { text?: string; coding?: Array<{ system?: string; code?: string }> };
  dosageInstruction?: Array<{ text?: string }>;
  encounter?: { reference?: string };
};

export async function fetchPatientEncounters(patientId: string): Promise<{ entry?: Array<{ resource: ApiEncounter }> }> {
  return request<{ entry?: Array<{ resource: ApiEncounter }> }>(`/fhir/Encounter?patient=Patient/${patientId}`);
}

export async function fetchPatientConditions(patientId: string): Promise<{ entry?: Array<{ resource: ApiCondition }> }> {
  return request<{ entry?: Array<{ resource: ApiCondition }> }>(`/fhir/Condition?patient=Patient/${patientId}`);
}

export async function fetchPatientMedications(patientId: string): Promise<{ entry?: Array<{ resource: ApiMedicationRequest }> }> {
  return request<{ entry?: Array<{ resource: ApiMedicationRequest }> }>(`/fhir/MedicationRequest?patient=Patient/${patientId}`);
}

export type PatientVisitEntry = NonNullable<WorkspaceResponse["historyVisits"]>[number];

export async function fetchPatientVisits(
  patientId: string,
  limit = 200,
  opts?: { light?: boolean; excludeEncounterId?: string },
): Promise<{ resourceType: string; total: number; entry: PatientVisitEntry[]; light?: boolean }> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (opts?.light !== undefined) q.set("light", opts.light ? "true" : "false");
  if (opts?.excludeEncounterId) q.set("exclude_encounter_id", opts.excludeEncounterId);
  return request(
    `/fhir/Patient/${encodeURIComponent(patientId)}/visits?${q.toString()}`,
  );
}

export async function fetchPatientVisitDetail(
  patientId: string,
  encounterId: string,
): Promise<PatientVisitEntry> {
  return request(
    `/fhir/Patient/${encodeURIComponent(patientId)}/visits/${encodeURIComponent(encounterId)}`,
  );
}

export type IdCategorySetting = {
  code: string;
  deposit: number;
  reg_fee: number;
  copay: number;
  min_age?: number;
  max_age?: number;
  is_default?: number;
};

export async function fetchIdCategorySettings(): Promise<IdCategorySetting[]> {
  return request<IdCategorySetting[]>("/fhir/Patient/idCategorySettings");
}

export async function saveIdCategorySettings(settings: IdCategorySetting[]): Promise<void> {
  await request<void>("/fhir/Patient/idCategorySettings", {
    method: "POST",
    body: JSON.stringify(settings),
  });
}

export async function deleteIdCategorySetting(code: string): Promise<void> {
  await request<void>(`/fhir/Patient/idCategorySettings/${encodeURIComponent(code)}`, {
    method: "DELETE",
  });
}

export type ApiStaffRecord = {
  id: string;
  name: string;
  role: string;
  nhiId?: string;
  certNo?: string;
  pin: string;
  status?: string;
};

export async function fetchStaff(): Promise<ApiStaffRecord[]> {
  return request<ApiStaffRecord[]>("/fhir/staff");
}

export async function saveStaff(record: ApiStaffRecord): Promise<void> {
  await request<void>("/fhir/staff", {
    method: "POST",
    body: JSON.stringify(record),
  });
}

export async function deleteStaff(id: string): Promise<void> {
  await request<void>(`/fhir/staff/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export type ClinicProfileBundle = {
  profile: Record<string, unknown>;
  fees: Record<string, unknown>;
  workflow: Record<string, unknown>;
};

export async function fetchClinicProfile(): Promise<{ ok: boolean; source: string; data: ClinicProfileBundle }> {
  return request(`/clinic/settings/profile`);
}

export async function saveClinicProfile(data: ClinicProfileBundle): Promise<{ ok: boolean; data: ClinicProfileBundle }> {
  return request(`/clinic/settings/profile`, {
    method: "PUT",
    body: JSON.stringify({ data }),
  });
}

export type OrderCaseRule = { code: string; name: string; reason: string };
export type ChronicCaseRule = { code: string; name: string };
export type CaseRulesPayload = {
  lines: string[];
  minDays: number;
  officialChronic: string[];
  orderRules: OrderCaseRule[];
  chronicRules: ChronicCaseRule[];
  projectDrugFloor: number;
  outsideLabCodes: string[];
};

export async function fetchCaseRules(): Promise<{ ok: boolean; data: CaseRulesPayload }> {
  return request(`/clinic/settings/case-rules`);
}

export async function saveCaseRules(data: {
  orderRules: OrderCaseRule[];
  chronicRules: ChronicCaseRule[];
  projectDrugFloor: number;
  outsideLabCodes: string[];
}): Promise<{ ok: boolean; data: CaseRulesPayload }> {
  return request(`/clinic/settings/case-rules`, {
    method: "PUT",
    body: JSON.stringify({ data }),
  });
}

export type SpecialtyTemplate = {
  id: string;
  name: string;
  note: string;
  orderRuleCount: number;
  diagnosisCount: number;
  drugCount: number;
  orderSetCount: number;
};

export async function fetchSpecialtyTemplates(): Promise<{ ok: boolean; templates: SpecialtyTemplate[] }> {
  return request(`/clinic/settings/specialty-templates`);
}

export async function applySpecialtyTemplate(
  templateId: string,
): Promise<{ ok: boolean; templateName?: string; note?: string; data: CaseRulesPayload }> {
  return request(`/clinic/settings/specialty-templates/${encodeURIComponent(templateId)}/apply`, {
    method: "POST",
  });
}

export type CatalogOverrides = {
  drugs: Array<Record<string, unknown>>;
  diagnoses: Array<Record<string, unknown>>;
  packages: Array<Record<string, unknown>>;
  usages: Array<Record<string, unknown>>;
  ccTemplates: Array<Record<string, unknown>>;
  deletedDrugKeys: string[];
  deletedDxKeys: string[];
  deletedPackageKeys: string[];
};

export async function fetchCatalogOverrides(): Promise<{ ok: boolean; data: CatalogOverrides }> {
  return request(`/clinic/settings/catalog-overrides`);
}

export async function saveCatalogOverrides(
  data: CatalogOverrides,
): Promise<{ ok: boolean; data: CatalogOverrides }> {
  return request(`/clinic/settings/catalog-overrides`, {
    method: "PUT",
    body: JSON.stringify({ data }),
  });
}

export type SciniRow = {
  seqNo: string;
  section: string;
  entry: string;
  value: string;
  canEdit?: string;
  combox?: string;
  picture?: string;
  desc?: string;
  suggestedScope?: "clinic" | "role" | "device";
};

/** 醫聖 SCINI／Sc.ini 全文（匯入後才有） */
export async function fetchSciniSettings(section?: string, withRows = false): Promise<{
  ok: boolean;
  importedAt?: string;
  catalogCount?: number;
  valueCount?: number;
  values: Record<string, Record<string, string>>;
  catalog: Array<Record<string, unknown>>;
  sections?: string[];
  rows?: SciniRow[];
  frameFields?: Array<{ type: string; len: number; value: string }>;
}> {
  const params = new URLSearchParams();
  if (section) params.set("section", section);
  if (withRows) params.set("with_rows", "true");
  const q = params.toString() ? `?${params}` : "";
  return request(`/clinic/settings/scini${q}`);
}

export async function saveSciniValues(
  values: Record<string, Record<string, string>>,
): Promise<{ ok: boolean; changed: number }> {
  return request(`/clinic/settings/scini`, {
    method: "PUT",
    body: JSON.stringify({ values }),
  });
}

export type ClinicDeviceRecord = {
  id: string;
  label: string;
  role: string;
  sciniOverrides?: Record<string, Record<string, string>>;
  printSettings?: Record<string, unknown>;
  updatedAt?: string;
};

export async function fetchClinicDevice(deviceId: string): Promise<{ ok: boolean; device: ClinicDeviceRecord }> {
  return request(`/clinic/settings/devices/${encodeURIComponent(deviceId)}`);
}

const LOCAL_PRINT = "http://127.0.0.1:5310";

async function localPrintFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${LOCAL_PRINT}${path}`, init);
  } catch {
    throw new Error(
      "\u9019\u53f0\u96fb\u8166\u7684\u5217\u5370\u6c92\u6709\u8ddf\u8457\u9580\u8a3a\u8d77\u4f86\u3002\u8acb\u91cd\u65b0\u958b\u555f\u9580\u8a3a\u3002",
    );
  }
}

export async function printToNamedPrinter(body: {
  printerName: string;
  html: string;
  widthMm: number;
  heightMm: number;
}): Promise<{ ok: boolean; printer: string }> {
  const res = await localPrintFetch("/print", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; printer?: string; detail?: string };
  if (!res.ok) throw new Error(data.detail || "\u9001\u5230\u5370\u8868\u6a5f\u5931\u6557");
  return { ok: true, printer: data.printer || body.printerName };
}

export type LocalPrintHealth = {
  ok?: boolean;
  edge?: boolean;
  sumatra?: boolean;
  printers?: Array<{ name?: string; online?: boolean | null; default?: boolean; device?: boolean }>;
};

export async function fetchLocalPrintHealth(): Promise<LocalPrintHealth | null> {
  try {
    const res = await localPrintFetch("/health");
    if (!res.ok) return null;
    return (await res.json()) as LocalPrintHealth;
  } catch {
    return null;
  }
}

export async function fetchVpnReach(): Promise<boolean | null> {
  try {
    const data = await request<{ reachable?: boolean }>("/nhi/v1/vpn-reach");
    return data.reachable === true;
  } catch {
    return null;
  }
}

export async function fetchInstalledPrinters(): Promise<string[]> {
  try {
    const res = await localPrintFetch("/printers");
    if (!res.ok) return [];
    const data = (await res.json()) as { printers?: string[] };
    return Array.isArray(data.printers) ? data.printers.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function saveClinicDevice(
  deviceId: string,
  device: Partial<ClinicDeviceRecord>,
): Promise<{ ok: boolean; device: ClinicDeviceRecord }> {
  return request(`/clinic/settings/devices/${encodeURIComponent(deviceId)}`, {
    method: "PUT",
    body: JSON.stringify({ device }),
  });
}

export async function fetchEffectiveSettings(opts: {
  deviceId?: string;
  role?: string;
  section?: string;
}): Promise<{
  ok: boolean;
  deviceId?: string;
  role?: string;
  values: Record<string, Record<string, string>>;
  rows: SciniRow[];
  profile: ClinicProfileBundle;
  layers: { clinic: boolean; role: boolean; device: boolean };
}> {
  const params = new URLSearchParams();
  if (opts.deviceId) params.set("device_id", opts.deviceId);
  if (opts.role) params.set("role", opts.role);
  if (opts.section) params.set("section", opts.section);
  const q = params.toString() ? `?${params}` : "";
  return request(`/clinic/settings/effective${q}`);
}

export type IcUploadPreview = {
  date: string;
  institutionCode: string;
  format?: string;
  total: number;
  finished: number;
  readyForExport: number;
  blockedCount?: number;
  blocked?: Array<{ queueNumber?: number | null; patientName?: string; reasons: string[] }>;
  warnings?: string[];
  lastExport?: Record<string, unknown>;
  note?: string;
};

export type IcUploadHistoryRow = {
  uploadDate: string;
  uploadTime: string;
  startDate: string;
  endDate: string;
  receiveDate: string;
  receiveTime: string;
  uploadCount: string;
  receiveCount: string;
  kind: string;
};

export async function fetchIcUploadHistory(): Promise<IcUploadHistoryRow[]> {
  const data = await request<{ rows: IcUploadHistoryRow[] }>("/ic-upload/history");
  return data.rows || [];
}

export type IcUploadSendResult = {
  ok: boolean;
  sent: boolean;
  date: string;
  count: number;
  statusCode?: number | null;
  uploadDate?: string;
  uploadTime?: string;
  receiveDate?: string;
  receiveTime?: string;
  reason?: string;
};

export async function sendIcUpload(dateDay: string): Promise<IcUploadSendResult> {
  return request(`/ic-upload/send?date=${encodeURIComponent(dateDay)}`, { method: "POST" });
}

export async function fetchIcUploadPreview(dateDay: string): Promise<IcUploadPreview> {
  return request(`/ic-upload/preview?date=${encodeURIComponent(dateDay)}`);
}

export async function downloadIcUploadExport(dateDay: string): Promise<{ blob: Blob; filename: string }> {
  const machineId = workstationHeader();
  const res = await fetch(`${API_BASE}/ic-upload/export?date=${encodeURIComponent(dateDay)}`, {
    method: "POST",
    headers: { "X-Machine-ID": machineId },
  });
  if (!res.ok) {
    let detail = `export failed ${res.status}`;
    try {
      const j = (await res.json()) as { detail?: string };
      if (j.detail) detail = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  const dispo = res.headers.get("Content-Disposition") || "";
  const m = /filename=\"?([^\";]+)\"?/i.exec(dispo);
  const filename = m?.[1] || `IC_UPLOAD_${dateDay}.xml`;
  return { blob: await res.blob(), filename };
}

export type SameDayResult = {
  patientId: string;
  date: string;
  count: number;
  localCount?: number;
  cloudCount?: number;
  isSameDay: boolean;
  encounters: Array<{
    encounterId: string;
    queueNumber?: number;
    queueStatus?: string;
    treatSeq?: string;
    doctorName?: string;
    hospitalId?: string;
    source?: string;
  }>;
  cloudOk?: boolean;
  cloudError?: string;
  note?: string;
};

export async function fetchSameDayEncounters(
  patientId: string,
  dateDay: string,
  opts?: { includeCloud?: boolean },
): Promise<SameDayResult> {
  const q = new URLSearchParams({
    patientId,
    date: dateDay,
    includeCloud: String(opts?.includeCloud !== false),
  });
  return request(`/nhi/v1/same-day?${q}`);
}

export type ApiClaimsStatistics = {
  yearMonth: string;
  finishedEncounters: number;
  totalConsultationPoints: number;
  totalDrugPoints: number;
  totalPoints: number;
};

export type ClaimsSubmitType = "songhe" | "bubao";

export type ApiClaimsPreview = ApiClaimsStatistics & {
  records?: Array<{
    encounterId: string;
    queueNumber?: number | null;
    patientName?: string;
    totalPoints?: number;
    caseNo?: string;
    caseReason?: string;
    consultCode?: string;
    daysSupply?: number;
    claimNotes?: string[];
    medications?: Array<{ priceSource?: string; unitPrice?: number | null }>;
  }>;
  check?: {
    ok: boolean;
    canExport?: boolean;
    blockCount?: number;
    warnCount?: number;
    blocks?: Array<{ medicalNo?: string; encounterDate?: string; caseNo?: string; code?: string; message: string }>;
    warnings?: Array<{ medicalNo?: string; encounterDate?: string; caseNo?: string; code?: string; message: string }>;
    settingsSource?: string;
    acuteChronicTo09?: boolean;
    repeatDxDays?: number;
    repeatDxMonthOnly?: boolean;
  };
  caseCounts?: Record<string, number>;
  totalSheet?: {
    t1: string;
    t2: string;
    t3: string;
    t4: string;
    t5: string;
    t6: string;
    t7: number;
    t8: number;
    t9: number;
    t10: number;
    t17: number;
    t18: number;
    t37: number;
    t38: number;
    t39: number;
    t40: number;
  };
};

export async function fetchClaimsStatistics(dateMonth: string): Promise<ApiClaimsStatistics> {
  return request<ApiClaimsStatistics>(`/claims/statistics?date_month=${encodeURIComponent(dateMonth)}`);
}

export async function fetchClaimsPreview(
  dateMonth: string,
  submitType: ClaimsSubmitType = "songhe",
): Promise<ApiClaimsPreview> {
  const q = new URLSearchParams({ date_month: dateMonth, submit_type: submitType });
  return request<ApiClaimsPreview>(`/claims/preview?${q}`);
}

export async function exportClaimsXml(
  dateMonth: string,
  submitType: ClaimsSubmitType = "songhe",
  options?: { format?: "nhi" | "legacy"; packaging?: "xml" | "zip" },
): Promise<{ blob: Blob; filename: string; format: string }> {
  const q = new URLSearchParams({
    date_month: dateMonth,
    submit_type: submitType,
    format: options?.format ?? "nhi",
    packaging: options?.packaging ?? "zip",
  });
  const response = await fetch(`${API_BASE}/claims/export?${q}`, {
    method: "POST",
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "匯出失敗");
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = /filename=([^;]+)/i.exec(disposition);
  const filename = match ? match[1].replace(/"/g, "").trim() : `NHI_OPD_${dateMonth}.bin`;
  const format = response.headers.get("X-Wundadi-Claims-Format") || "nhi-outpatient-xml";
  return { blob, filename, format };
}

export type ApiControlIndex = {
  targetDate: string;
  packVersion: string | null;
  count: number;
  byNhiCode: Record<string, string>;
  note: string;
};

export async function fetchControlIndex(targetDate: string): Promise<ApiControlIndex> {
  return request<ApiControlIndex>(
    `/sync/packages/control-index?target_date=${encodeURIComponent(targetDate)}`,
  );
}

export type ApiBreakTheGlassResponse = {
  status: string;
  token: string;
  expiresIn: number;
  auditEventId: string;
  authorizedUsers: string[];
};

export async function breakTheGlass(
  encounterId: string,
  doctorPin: string,
  nursePin: string,
  reason: string
): Promise<ApiBreakTheGlassResponse> {
  return request<ApiBreakTheGlassResponse>("/nhi/v1/break-the-glass", {
    method: "POST",
    body: JSON.stringify({ encounterId, doctorPin, nursePin, reason })
  });
}

export async function fetchRegisterOptions(patientId: string, attachment = "cross-platform"): Promise<any> {
  return request<any>(`/nhi/v1/auth/register-options?patientId=${encodeURIComponent(patientId)}&attachment=${encodeURIComponent(attachment)}`);
}

export async function registerCredential(patientId: string, registrationResponse: any): Promise<any> {
  return request<any>("/nhi/v1/auth/register-credential", {
    method: "POST",
    body: JSON.stringify({ patientId, registrationResponse }),
  });
}

export async function fetchLoginOptions(patientId: string): Promise<any> {
  return request<any>(`/nhi/v1/auth/login-options?patientId=${encodeURIComponent(patientId)}`);
}

export async function getOAuthToken(patientId: string, assertionResponse: any): Promise<any> {
  return request<any>("/oauth/token", {
    method: "POST",
    body: JSON.stringify({
      grant_type: "webauthn",
      patientId,
      assertionResponse,
    }),
  });
}


/** IC卡內容資訊（F8）：只讀卡面，不建檔、不掛號、不取號。 */
export type CardProfile = {
  idNo?: string;
  birthday?: string;
  sex?: string;
  patientName?: string;
  cardId?: string;
  [key: string]: string | undefined;
};

export async function readCardProfile(): Promise<{ ok: boolean; source: string; profile: CardProfile; note: string }> {
  return request(`/nhi/v1/card/read-profile`, { method: "POST" });
}

/** 統計資料（醫聖 費用統計的其他統計種類）。 */
export type ReportKind = "disease" | "opdCount" | "drug" | "treatment" | "claim";

export type ReportColumn = { key: string; label: string; align: "left" | "right" };

export type ReportResult = {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, string | number | null>;
  note: string;
};

export async function fetchReport(
  kind: ReportKind,
  opts: {
    dateFrom: string;
    dateTo: string;
    shift?: string;
    finished?: boolean;
    selfPay?: "exclude" | "only" | "all";
    name?: string;
  },
): Promise<ReportResult> {
  const params = new URLSearchParams({ dateFrom: opts.dateFrom, dateTo: opts.dateTo });
  if (opts.shift) params.set("shift", opts.shift);
  if (opts.finished) params.set("finished", "true");
  if (opts.selfPay) params.set("selfPay", opts.selfPay);
  if (opts.name) params.set("name", opts.name);
  return request<ReportResult>(`/maintenance/reports/${kind}?${params.toString()}`);
}

/** 資料備份：影子庫整份複製到指定資料夾。 */
export type BackupInfo = {
  settings: { dir: string; keep: number; lastOk: { at: string; file: string; bytes: number } | null };
  dbPath: string;
  dbBytes: number;
  freeBytes: number | null;
  sameDrive: boolean;
  files: { name: string; bytes: number; modifiedAt: string }[];
  state: {
    running: boolean;
    startedAt: string;
    finishedAt: string;
    ok: boolean | null;
    message: string;
    file: string;
    bytes: number;
    seconds: number;
    removed: string[];
  };
};

export async function fetchBackupInfo(): Promise<BackupInfo> {
  return request<BackupInfo>(`/maintenance/backup`);
}

export async function saveBackupSettings(body: { dir: string; keep: number }): Promise<BackupInfo> {
  return request<BackupInfo>(`/maintenance/backup/settings`, { method: "PUT", body: JSON.stringify(body) });
}

export async function runBackupNow(browserSettings?: Record<string, string | null>): Promise<BackupInfo> {
  return request<BackupInfo>(`/maintenance/backup/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ browserSettings: browserSettings || {} }),
  });
}
