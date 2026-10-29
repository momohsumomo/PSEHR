import { useCallback, useEffect, useRef, useState } from "react";
import { isDepositHold, needsNhiNoCardReason } from "@/lib/registerModes";
import { depositInTotal } from "@/lib/visitFee";
import {
  fetchQueueForDate,
  fetchPatientVisitDetail,
  fetchPatientVisits,
  fetchWorkspace,
  isApiMode,
  patchQueueStatus,
  fetchSeqNext,
  queryReferral,
  markReferralAccepted,
  patchEncounterReg,
  type ReferralSlipHit,
  readCardAndRegister,
  correctPatientName,
  arrangeDiagnosisRows,
  registerCondition,
  registerEncounter,
  registerMedication,
  registerPatient,
  registerSoap,
  registerObservation,
  retainEncounterChart,
  updateConditionResource,
  updateMedicationRequest,
  type WorkspaceResponse,
  type ApiQueueEntry,
  type QueueDateHints,
  type PatientVisitEntry,
} from "@/api/clinicApi";

const EMPTY_WS_VITALS = {
  weight: "",
  temperature: "",
  bpSys: "",
  bpDia: "",
};
import type { QueueRegisterForm } from "@/components/clinic/QueueRegisterStrip";
import type { RegisterEditForm } from "@/components/clinic/RegisterEditDialog";
import type { IncomingChoice } from "@/components/clinic/ReferralAcceptDialogs";
import { BAD_CARD_REASON, claimSeqFor } from "@/lib/nocardClaim";
import { roomNumber } from "@/lib/roomMark";
import {
  buildConditionIntake,
  buildMedicationIntake,
  buildSoapIntake,
  medicationSaveBody,
  extractPatientIdNo,
  lineSaveCode,
} from "@/utils/nhiIntake";
import {
  cloneRxLines,
  emptyCurrentRx,
  mockAllergiesByPatient,
  mockConditionsByEncounter,
  mockEncounters,
  mockMediaByPatient,
  mockPatients,
  mockPrevRxByPatient,
  mockHistoryVisitsFor,
  mockQueue,
  getPatientClinicalProfile,
  type AllergyRow,
  type DiagnosisRow,
  type HistoryVisit,
  type LesionMedia,
  type QueueEntry,
  type QueueStatus,
  type RxLine,
} from "@/mocks";

function queueStamp(date: string, rows: QueueEntry[]): string {
  // cardWritten is the yellow circle. Leave it out and another computer
  // keeps the checkmark until the clinic page is opened again.
  const body = rows
    .map((row) =>
      [
        row.encounterId,
        row.queueNumber,
        row.queueStatus,
        row.cardWritten ? 1 : 0,
        row.shift,
        row.slotTime,
        row.room,
        row.patientDisplay,
        row.medicalNo,
        row.diseaseName,
        row.caseNo,
        row.note,
        row.reasonText,
        row.weight,
        row.deposit,
        row.regFee,
        row.copayAmt,
        row.drugFee,
        row.totalFee,
        row.treatSeq,
        row.icException,
        row.regCc,
        row.prebook ? 1 : 0,
        row.referredOut ? 1 : 0,
        row.patientArrearage || "",
      ].join("|"),
    )
    .join("\n");
  return `${date}\n${body}`;
}

function mapApiQueue(entries: ApiQueueEntry[]): QueueEntry[] {
  return entries.map((e) => ({
    encounterId: e.resource.id,
    patientId: e.queueMeta.patientId,
    queueNumber: e.queueMeta.queueNumber,
    queueStatus: e.queueMeta.queueStatus as QueueStatus,
    patientDisplay: e.queueMeta.patientDisplay,
    ageSex: e.queueMeta.ageSex ?? "",
    hasAllergyAlert: Boolean(e.queueMeta.hasAllergyAlert),
    preVisitCompleted: Boolean(e.queueMeta.preVisitCompleted),
    visitKind: e.queueMeta.visitKind || "",
    reasonText: e.queueMeta.reasonText ?? "",
    visitCc: e.queueMeta.visitCc || "",
    slotTime: e.queueMeta.slotTime,
    medicalNo: e.queueMeta.medicalNo,
    age: e.queueMeta.age,
    sex: e.queueMeta.sex,
    phone: e.queueMeta.phone,
    address: e.queueMeta.address,
    icdCode: e.queueMeta.icdCode,
    diseaseName: e.queueMeta.diseaseName,
    rxDays: e.queueMeta.rxDays,
    weight: e.queueMeta.weight,
    caseNo: e.queueMeta.caseNo,
    treatSeq: e.queueMeta.treatSeq,
    treatDateTime: e.queueMeta.treatDateTime as string | undefined,
    treatmentNumber: e.queueMeta.treatmentNumber,
    icException: e.queueMeta.icException,
    noCardReason: e.queueMeta.noCardReason,
    pharmacist: e.queueMeta.pharmacist,
    doctorId: e.queueMeta.doctorId,
    doctorName: e.queueMeta.doctorName,
    payType: e.queueMeta.payType,
    copayCode: e.queueMeta.copayCode,
    dispense: e.queueMeta.dispense,
    room: e.queueMeta.room,
    shift: e.queueMeta.shift,
    paperCard: e.queueMeta.paperCard,
    note: e.queueMeta.noteMark || e.queueMeta.note || undefined,
    cardWritten: Boolean(e.queueMeta.cardWritten),
    // Yu: live appointment only (API already hides after check-in)
    prebook: Boolean(e.queueMeta.prebook),
    regCc: e.queueMeta.regCc,
    referredOut: Boolean(e.queueMeta.referredOut),
    deposit: e.queueMeta.deposit,
    depositPaid: e.queueMeta.depositPaid,
    regFee: e.queueMeta.regFee,
    copayAmt: e.queueMeta.copayAmt,
    drugCopay: e.queueMeta.drugCopay,
    cardIdentity: e.queueMeta.cardIdentity,
    hcId: e.queueMeta.hcId,
    afterCheck: e.queueMeta.afterCheck,
    treatmentItem: e.queueMeta.treatmentItem,
    consultFee: e.queueMeta.consultFee,
    drugFee: e.queueMeta.drugFee,
    totalFee: e.queueMeta.totalFee,
    materialFee: e.queueMeta.materialFee,
    burdenFee: e.queueMeta.burdenFee,
    selfPay:
      e.queueMeta.selfPay != null && String(e.queueMeta.selfPay).trim() !== ""
        ? String(e.queueMeta.selfPay)
        : undefined,
    referralSeq: e.queueMeta.referralSeq,
    referralHospId: e.queueMeta.referralHospId,
    referralHospName: e.queueMeta.referralHospName,
    referralDate: e.queueMeta.referralDate,
    referralLocalId: e.queueMeta.referralLocalId,
    acceptReferral: e.queueMeta.acceptReferral,
    id: e.resource.id,
    patientName: e.queueMeta.patientDisplay,
    birthday: e.queueMeta.birthday,
    idNo: e.queueMeta.hcIdNo || e.queueMeta.idNo || "",
    sequenceNo: e.queueMeta.queueNumber,
    patientArrearage: e.queueMeta.patientArrearage || "",
  }));
}

const NOCARD_MODES = new Set(["noCard", "childNoCard", "pregnantNoCard", "badCard", "paper"]);

/** 畫面上還沒寫進 FHIR 的暫存列。local- 是匯入後的正式 id。 */
function isDraftId(id: string | undefined): boolean {
  if (!id) return true;
  return /^(rx-draft-|rx-|dx-tmp-|dx-|new-|prebook-|media-)/i.test(id);
}

/** Import formats like "QD * 3天" / "BID * 7d qty=1" -> short sig + days + qty */
function parseImportedDosage(text: string): { sig: string; days?: number; qty?: number } {
  const raw = text.trim();
  if (!raw) return { sig: "" };
  const m = raw.match(
    /^(.+?)\s*\*\s*([\d.]+)\s*(?:d|\u5929)\s*(?:\(?(?:\u7e3d\u91cf\s*:|qty\s*[:=])\s*([\d.]+)\s*\)?)?/i,
  );
  if (m) {
    return {
      sig: m[1].trim(),
      days: Number(m[2]) > 0 ? Number(m[2]) : undefined,
      qty: m[3] != null && Number(m[3]) > 0 ? Number(m[3]) : undefined,
    };
  }
  // Keep only short code if already QD/BID/...
  if (/^[A-Za-z][A-Za-z0-9/]{0,15}$/.test(raw)) return { sig: raw };
  return { sig: raw };
}

function extractRxMarks(resource: Record<string, unknown>): {
  payMark: string;
  memo: string;
  bodySite: string;
  tradeName: string;
} {
  let payMark = "";
  let memo = "";
  let bodySite = "";
  let tradeName = "";
  const exts = (resource.extension as Array<Record<string, unknown>> | undefined) || [];
  for (const ext of exts) {
    const url = String(ext.url || "");
    if (url.endsWith("/payMark")) payMark = String(ext.valueString || "");
    if (url.endsWith("/memoMark")) memo = String(ext.valueString || "");
    if (url.endsWith("/bodySite")) bodySite = String(ext.valueString || "");
    if (url.endsWith("/tradeName")) tradeName = String(ext.valueString || "");
  }
  return { payMark, memo, bodySite, tradeName };
}

function mapHistoryVisitEntry(v: NonNullable<WorkspaceResponse["historyVisits"]>[number]): HistoryVisit {
  return {
    encounterId: v.encounterId,
    visitDate: v.visitDate,
    slotDept: v.slotDept,
    caseNo: v.caseNo,
    rxDays: v.rxDays,
    cardNo: v.cardNo,
    aCode: v.aCode,
    diseaseName: v.diseaseName,
    doctor: v.doctor,
    dispense: v.dispense,
    chiefComplaint: v.chiefComplaint,
    diagnoses: (v.diagnoses ?? []).map((d, i) => {
      const meta = d.indexMeta ?? {};
      return {
        id: String((d.resource as { id?: string })?.id ?? `dx-${i}`),
        icd10: String(meta.icd10Code ?? ""),
        snomed: meta.snomedCode ? String(meta.snomedCode) : undefined,
        nhiIcd10: meta.nhiIcd10Code ? String(meta.nhiIcd10Code) : undefined,
        text: String(meta.summaryText ?? ""),
      };
    }),
    medications: mapRxFromWorkspace(v.medications ?? []),
  };
}

function mapHistoryVisitsLight(rows: PatientVisitEntry[]): HistoryVisit[] {
  return (rows ?? []).map((v) => mapHistoryVisitEntry(v));
}

function mapRxFromWorkspace(
  entries: WorkspaceResponse["currentMedications"],
): RxLine[] {
  return entries.map((m, i) => {
    const meta = m.indexMeta ?? {};
    const resource = (m.resource ?? {}) as Record<string, unknown>;
    const dosage = (
      resource as { dosageInstruction?: Array<{ text?: string }> }
    ).dosageInstruction?.[0];
    const metaUseage = String((meta as { useage?: string }).useage || "").trim();
    const parsed = parseImportedDosage(dosage?.text?.trim() || "");
    const marks = extractRxMarks(resource);
    const sig = metaUseage || parsed.sig || "";
    const daysRaw = meta.daysSupply ?? parsed.days;
    const qtyRaw = meta.quantity ?? parsed.qty;
    const days =
      typeof daysRaw === "number" && daysRaw > 0
        ? daysRaw
        : Number(daysRaw) > 0
          ? Number(daysRaw)
          : parsed.days && parsed.days > 0
            ? parsed.days
            : 0;
    const qty =
      typeof qtyRaw === "number" && qtyRaw > 0
        ? qtyRaw
        : Number(qtyRaw) > 0
          ? Number(qtyRaw)
          : parsed.qty && parsed.qty > 0
            ? parsed.qty
            : undefined;
    const payMark = (marks.payMark || (meta as { payMark?: string }).payMark || "") as RxLine["payMark"];
    // route filled later from catalog MEDICAL.USE_TYPE / CAST
    const status = String(
      (resource as { status?: string }).status || (meta as { status?: string }).status || "active",
    );
    if (status === "cancelled" || status === "entered-in-error" || status === "stopped") return null;
    return {
      id: String((resource as { id?: string }).id ?? `rx-${i}`),
      name: String(meta.drugText ?? "\u85e5\u54c1"),
      sig,
      days,
      qty,
      nhiCode: String(meta.nhiCode ?? ""),
      rxnorm: meta.rxnormCode ? String(meta.rxnormCode) : undefined,
      route: "po",
      selfPay: payMark === "\u81ea" || payMark === "\u6750",
      payMark: payMark || "",
      memo: marks.memo || String((meta as { memo?: string }).memo || ""),
      bodySite: marks.bodySite || "",
      tradeName: marks.tradeName || "",
      unitPrice:
        meta.unitPrice === null || meta.unitPrice === undefined
          ? undefined
          : Number(meta.unitPrice),
    };
  }).filter((line): line is RxLine => line != null);
}

function mapWorkspace(ws: WorkspaceResponse) {
  const allergies: AllergyRow[] = ws.allergies.map((a) => ({
    text: String(a.text ?? ""),
    substance: String(a.substance ?? ""),
    manifestation: String(a.manifestation ?? ""),
    level: (a.level === "high"
      ? "high"
      : a.level === "confirmed"
        ? "confirmed"
        : "unconfirmed") as AllergyRow["level"],
  }));
  const diagnoses: DiagnosisRow[] = ws.diagnoses.flatMap((d) => {
    const meta = d.indexMeta ?? {};
    const status = String(meta.clinicalStatus || "");
    if (status === "entered-in-error" || status === "inactive") return [];
    const res = (d.resource as { id?: string }) ?? {};
    return [{
      id: res.id,
      icd10: String(meta.icd10Code ?? ""),
      snomed: meta.snomedCode ? String(meta.snomedCode) : undefined,
      nhiIcd10: meta.nhiIcd10Code ? String(meta.nhiIcd10Code) : undefined,
      text: String(meta.summaryText ?? ""),
    }];
  });
  const mapPrevRx = (entries: WorkspaceResponse["previousMedications"]): RxLine[] =>
    mapRxFromWorkspace(entries);

  const mapHistoryVisits = (rows: WorkspaceResponse["historyVisits"]): HistoryVisit[] =>
    (rows ?? []).map((v) => mapHistoryVisitEntry(v));

  const mapLesionMedia = (entries: WorkspaceResponse["lesionMedia"]): LesionMedia[] =>
    (entries ?? []).map((e, i) => {
      const meta = e.indexMeta ?? {};
      const rid = String(e.resource?.id ?? meta.resourceId ?? `media-${i}`);
      const site = String(meta.siteLabel ?? "");
      const capturedAt = String(meta.capturedDateTime ?? "");
      return { id: rid, capturedAt, site, label: site || "病灶" };
    });

  const vitalsFlat: {
    weight: string;
    temperature: string;
    bpSys: string;
    bpDia: string;
  } = { weight: "", temperature: "", bpSys: "", bpDia: "" };
  for (const row of ws.vitals ?? []) {
    const meta = row.indexMeta ?? {};
    const vt = String(meta.vitalType ?? "").toLowerCase();
    const val = meta.value;
    if (val == null || val === "") continue;
    const n = String(val);
    if (vt.includes("weight") || vt === "body_weight") vitalsFlat.weight = n;
    else if (vt.includes("temp") || vt === "body_temperature") vitalsFlat.temperature = n;
    else if (vt.includes("systolic") || vt === "systolic_bp") vitalsFlat.bpSys = n;
    else if (vt.includes("diastolic") || vt === "diastolic_bp") vitalsFlat.bpDia = n;
  }

  return {
    allergies,
    diagnoses,
    prevRx: mapPrevRx(ws.previousMedications),
    historyVisits: mapHistoryVisits(ws.historyVisits),
    currentRx: mapRxFromWorkspace(ws.currentMedications),
    lesionMedia: mapLesionMedia(ws.lesionMedia),
    vitals: vitalsFlat,
    cc: ws.chiefComplaint,
    patientResource: ws.patient as (typeof mockPatients)[string],
    encounterResource: ws.encounter as (typeof mockEncounters)[string],
    preVisitCompleted: ws.preVisitCompleted,
  };
}

export function useClinicWorkspace(options?: {
  loadWorkspace?: boolean;
  /** 調閱進入：第一筆就查這天，不要先落到今天。 */
  initialDate?: string;
  initialEncounterId?: string | null;
  /** 進門選日期之前不要先抓今天，避免先閃出另一天的名單。 */
  queueEnabled?: boolean;
  /** 選日期的同時先把這天抓好，確定後直接顯示。 */
  prefetchDate?: string;
}) {
  const loadWorkspace = options?.loadWorkspace ?? false;
  const initialDate = options?.initialDate;
  const initialEncounterId = options?.initialEncounterId;
  const queueEnabled = options?.queueEnabled ?? true;
  const prefetchDate = options?.prefetchDate || "";
  const apiMode = isApiMode();
  const [currentDate, setCurrentDate] = useState(() => {
    if (initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)) return initialDate;
    const d = new Date();
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const dy = String(d.getDate()).padStart(2, "0");
    return `${yr}-${mo}-${dy}`;
  });
  const [queue, setQueue] = useState<QueueEntry[]>(apiMode ? [] : mockQueue);
  const [loading, setLoading] = useState(apiMode && queueEnabled);
  const [queueEpoch, setQueueEpoch] = useState(currentDate);
  if (apiMode && queueEpoch !== currentDate) {
    setQueueEpoch(currentDate);
    setQueue([]);
    setLoading(true);
  }
  const [queueHints, setQueueHints] = useState<QueueDateHints>({});
  const [selectedEncounterId, setSelectedEncounterId] = useState<string | null>(
    () => initialEncounterId || null,
  );
  const [error, setError] = useState<string | null>(null);
  const [workspaceData, setWorkspaceData] = useState<ReturnType<typeof mapWorkspace> | null>(
    null,
  );
  const [workspaceFor, setWorkspaceFor] = useState("");
  // 病人歷史 light 清單快取（醫聖式：選過／預載的病人幾乎瞬開）
  const historyCacheRef = useRef(new Map<string, HistoryVisit[]>());
  const readyQueue = useRef<{ date: string; res: Awaited<ReturnType<typeof fetchQueueForDate>> } | null>(null);
  const queueStampRef = useRef("");
  /** 後到的舊查詢不能蓋掉較新的病名／處置。 */
  const wsGen = useRef(0);
  const acceptOrderFlight = useRef<Set<string>>(new Set());
  const outboundOrderFlight = useRef<Map<string, Promise<string>>>(new Map());

  const refreshQueue = useCallback(async (targetDate?: string) => {
    if (!apiMode) return;
    const queryDate = targetDate ?? currentDate;
    const res = await fetchQueueForDate(queryDate);
    const mapped = mapApiQueue(res.entry);
    const stamp = queueStamp(queryDate, mapped);
    if (stamp === queueStampRef.current) return mapped;
    queueStampRef.current = stamp;
    setQueue(mapped);
    setQueueHints({
      requestedDate: res.requestedDate,
      autoFallback: res.autoFallback,
      dateMin: res.dateMin,
      dateMax: res.dateMax,
      suggestedDate: res.suggestedDate,
      suggestedCount: res.suggestedCount,
      nearestBefore: res.nearestBefore,
      nearestAfter: res.nearestAfter,
    });
    // 僅後端 autoFallback（today 空日）時才改看診日；使用者明確選的空日維持不動
    if (res.autoFallback && res.resolvedDate && res.resolvedDate !== queryDate) {
      setCurrentDate(res.resolvedDate);
    }
    return mapped;
  }, [apiMode, currentDate]);

  useEffect(() => {
    if (!apiMode || queueEnabled || !prefetchDate) return;
    let cancelled = false;
    void fetchQueueForDate(prefetchDate)
      .then((res) => {
        if (cancelled) return;
        if (res.autoFallback && res.resolvedDate && res.resolvedDate !== prefetchDate) return;
        readyQueue.current = { date: prefetchDate, res };
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiMode, queueEnabled, prefetchDate]);

  useEffect(() => {
    if (!apiMode || !queueEnabled) return;
    const cached = readyQueue.current;
    if (cached && cached.date === currentDate && !cached.res.autoFallback) {
      readyQueue.current = null;
      const mapped = mapApiQueue(cached.res.entry);
      setQueue(mapped);
      const res = cached.res;
      setQueueHints({
        requestedDate: res.requestedDate,
        autoFallback: res.autoFallback,
        dateMin: res.dateMin,
        dateMax: res.dateMax,
        suggestedDate: res.suggestedDate,
        suggestedCount: res.suggestedCount,
        nearestBefore: res.nearestBefore,
        nearestAfter: res.nearestAfter,
      });
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetchQueueForDate(currentDate);
        if (cancelled) return;
        const mapped = mapApiQueue(res.entry);
        setQueue(mapped);
        setQueueHints({
          requestedDate: res.requestedDate,
          autoFallback: res.autoFallback,
          dateMin: res.dateMin,
          dateMax: res.dateMax,
          suggestedDate: res.suggestedDate,
          suggestedCount: res.suggestedCount,
          nearestBefore: res.nearestBefore,
          nearestAfter: res.nearestAfter,
        });
        if (res.autoFallback && res.resolvedDate && res.resolvedDate !== currentDate) {
          setCurrentDate(res.resolvedDate);
        }
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "載入掛號失敗");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiMode, currentDate, queueEnabled]);

  useEffect(() => {
    if (!loadWorkspace) {
      setWorkspaceData(null);
      setWorkspaceFor("");
      return;
    }
    if (!apiMode || !selectedEncounterId) {
      setWorkspaceData(null);
      setWorkspaceFor("");
      return;
    }
    const requestedId = selectedEncounterId;
    setWorkspaceData(null);
    setWorkspaceFor("");
    let cancelled = false;
    const gen = ++wsGen.current;
    (async () => {
      try {
        // 1) 當次看診先到（history_limit=0）
        const ws = await fetchWorkspace(requestedId, { historyLimit: 0 });
        if (cancelled || gen !== wsGen.current) return;
        const mapped = mapWorkspace(ws);
        setWorkspaceFor(requestedId);
        const pid = String(ws.patientId || "").split("/").pop() || "";
        setWorkspaceData(mapped);
        setError(null);

        if (!pid) return;
        try {
          const hist = await fetchPatientVisits(pid, 200, {
            light: true,
            excludeEncounterId: requestedId,
          });
          if (cancelled || gen !== wsGen.current) return;
          const visits = mapHistoryVisitsLight(hist.entry || []);
          historyCacheRef.current.set(pid, visits);
          setWorkspaceData((prev) =>
            prev ? { ...prev, historyVisits: visits } : prev,
          );
        } catch {
          /* 歷史失敗不擋看診 */
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "載入工作台失敗");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiMode, selectedEncounterId, loadWorkspace]);

  const selected = queue.find((q) => q.encounterId === selectedEncounterId) ?? null;
  const patientId = selected?.patientId ?? "";
  const workspaceLive =
    apiMode && workspaceFor && workspaceFor === (selectedEncounterId || "") ? workspaceData : null;

  const allergies = apiMode
    ? (workspaceLive?.allergies ?? [])
    : patientId
      ? (mockAllergiesByPatient[patientId] ?? [])
      : [];
  const diagnoses = apiMode
    ? (workspaceLive?.diagnoses ?? [])
    : selectedEncounterId
      ? (mockConditionsByEncounter[selectedEncounterId] ?? [])
      : [];
  const prevRx = apiMode
    ? (workspaceLive?.prevRx ?? [])
    : patientId
      ? (mockPrevRxByPatient[patientId] ?? [])
      : [];
  const historyVisits = apiMode
    ? (workspaceLive?.historyVisits ?? [])
    : mockHistoryVisitsFor(patientId, selectedEncounterId);
  const currentRx = apiMode
    ? (workspaceLive?.currentRx ?? [])
    : selectedEncounterId
      ? undefined
      : [];
  const patientResource = apiMode
    ? (workspaceLive?.patientResource ?? null)
    : patientId
      ? (mockPatients[patientId] ?? null)
      : null;
  const encounterResource = apiMode
    ? (workspaceLive?.encounterResource ?? null)
    : selectedEncounterId
      ? (mockEncounters[selectedEncounterId] ?? null)
      : null;
  const ccFromWs = workspaceLive?.cc;
  const patientIdNo = extractPatientIdNo(patientResource);

  const selectedEncounterRef = useRef(selectedEncounterId);
  selectedEncounterRef.current = selectedEncounterId;
  const workspaceForRef = useRef(workspaceFor);
  workspaceForRef.current = workspaceFor;
  const refreshWorkspace = useCallback(async (encounterId?: string) => {
    const eid = encounterId ?? selectedEncounterRef.current;
    if (!eid) return;
    const ws = await fetchWorkspace(eid, { historyLimit: 0 });
    if (selectedEncounterRef.current !== eid) return;
    const mapped = mapWorkspace(ws);
    setWorkspaceFor(eid);
    setWorkspaceData((prev) => ({
      ...mapped,
      historyVisits:
        workspaceForRef.current === eid && prev?.historyVisits?.length
          ? prev.historyVisits
          : mapped.historyVisits,
    }));
  }, []);

  const ensureOutboundReferralOrder = useCallback(async (encounterId: string): Promise<string> => {
    if (!encounterId) return "";
    const running = outboundOrderFlight.current.get(encounterId);
    if (running) return running;
    const job = (async () => {
      const ws = await fetchWorkspace(encounterId, { historyLimit: 0 });
      const hit = mapRxFromWorkspace(ws.currentMedications || []).find((row) => {
        return (row.nhiCode || "").toUpperCase() === "01036C";
      });
      if (hit?.id && !isDraftId(hit.id)) {
        if (selectedEncounterId === encounterId) await refreshWorkspace(encounterId);
        return hit.id;
      }
      let medId = await registerMedication({
        encounterId,
        drugText: "\u8fa6\u7406\u8f49\u8a3a\u8cbb-\u96fb\u5b50\u8f49\u8a3a",
        nhiCode: "01036C",
        sig: "\u4f9d\u91ab\u56d1",
        daysSupply: 1,
        quantity: 1,
      });
      if (!medId) {
        const again = await fetchWorkspace(encounterId, { historyLimit: 0 });
        medId = mapRxFromWorkspace(again.currentMedications || []).find((row) => {
          return (row.nhiCode || "").toUpperCase() === "01036C" && row.id && !isDraftId(row.id);
        })?.id || "";
      }
      if (selectedEncounterId === encounterId) await refreshWorkspace(encounterId);
      return medId;
    })();
    outboundOrderFlight.current.set(encounterId, job);
    try {
      return await job;
    } finally {
      outboundOrderFlight.current.delete(encounterId);
    }
  }, [refreshWorkspace, selectedEncounterId]);

  const ensureAcceptReferralOrder = useCallback(async (encounterId: string) => {
    if (!encounterId || acceptOrderFlight.current.has(encounterId)) return;
    acceptOrderFlight.current.add(encounterId);
    try {
      const ws = await fetchWorkspace(encounterId, { historyLimit: 0 });
      const has = mapRxFromWorkspace(ws.currentMedications || []).some((row) => {
        const code = (row.nhiCode || "").toUpperCase();
        return code === "01038C" || code === "00193C";
      });
      if (has) return;
      await registerMedication({
        encounterId,
        drugText: "\u63a5\u53d7\u8f49\u8a3a",
        nhiCode: "01038C",
        sig: "\u4f9d\u91ab\u56d1",
        daysSupply: 1,
        quantity: 1,
      });
      if (selectedEncounterId === encounterId) await refreshWorkspace(encounterId);
    } finally {
      acceptOrderFlight.current.delete(encounterId);
    }
  }, [refreshWorkspace, selectedEncounterId]);

  const readCardRegisterPatient = useCallback(async () => {
    if (!apiMode) throw new Error("需 API 模式");
    const res = await readCardAndRegister(false);
    const cardName = (res.validation?.cardName || "").trim();
    const chartName = (res.validation?.patientName || "").trim();
    const same = cardName.replace(/\s+/g, "") === chartName.replace(/\s+/g, "");
    if (res.patientId && cardName && !same) {
      const chartShown = chartName || "（病歷沒有姓名）";
      const yes = window.confirm(
        `健保卡姓名是「${cardName}」，病歷上是「${chartShown}」。\n要改成健保卡上的姓名嗎？`,
      );
      if (yes) {
        await correctPatientName(res.patientId, cardName);
        if (res.validation) res.validation.patientName = cardName;
        await refreshQueue().catch(() => undefined);
      }
    }
    return res;
  }, [apiMode, refreshQueue]);

  const registerPatientAndEncounter = useCallback(
    async (
      form: QueueRegisterForm & {
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
        securitySign?: string;
        samId?: string;
        treatDateTime?: string;
        cardId?: string;
        cardIdentity?: string;
        patientId?: string;
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
        materialFee?: string;
        burdenFee?: string;
        prebook?: boolean;
        confirmDuplicate?: boolean;
        queueNumber?: string;
        visitClock?: string;
        acceptReferral?: string;
        referralSeq?: string;
        referralHospId?: string;
        referralHospName?: string;
        referralDate?: string;
      },
      targetDate?: string,
    ) => {
      if (!apiMode) throw new Error("需 API 模式");
      let patientId = form.patientId;
      if (!patientId) {
        const patientRes = await registerPatient({
          idNo: form.idNo.trim(),
          birthday: form.birthday.trim(),
          sex: form.sex,
          patientName: form.patientName.trim() || undefined,
        });
        patientId = patientRes.patientId;
      }
      const encDate = targetDate ?? currentDate;
      const enc = await registerEncounter({
        patientId,
        patientIdNo: form.idNo.trim(),
        queueStatus: "waiting",
        reasonText: form.reasonText.trim() || undefined,
        encounterDate: encDate,
        caseNo: form.caseNo,
        copayCode: form.copayCode,
        dispense: form.dispense,
        room: roomNumber(form.room),
        shift: form.shift,
        treatmentItem: form.treatmentItem,
        afterCheck: form.afterCheck,
        paperCard: form.paperCard,
        treatSeq: form.treatSeq,
        treatmentNumber: form.treatmentNumber,
        treatDateTime: form.treatDateTime,
        ...(form.securitySign ? { securitySign: form.securitySign } : {}),
        ...(form.samId ? { samId: form.samId } : {}),
        hcId: form.cardId,
        hcIdNo: form.idNo.trim(),
        icException: form.icException,
        noCardReason: form.noCardReason,
        pharmacist: form.pharmacist,
        doctorId: form.doctorId,
        doctorName: form.doctorName,
        payType: form.payType,
        regFee: form.regFee,
        copayAmt: form.copayAmt,
        deposit: form.deposit,
        consultFee: form.consultFee,
        drugFee: form.drugFee,
        materialFee: form.materialFee,
        burdenFee: form.burdenFee,
        cardIdentity: form.cardIdentity,
        prebook: form.prebook,
        confirmDuplicate: form.confirmDuplicate,
        queueNumber: form.queueNumber ? Number(form.queueNumber) : undefined,
        visitClock: form.visitClock,
        acceptReferral: form.acceptReferral,
        referralSeq: form.referralSeq,
        referralHospId: form.referralHospId,
        referralHospName: form.referralHospName,
        referralDate: form.referralDate,
      });
      await refreshQueue(encDate);
      setSelectedEncounterId(enc.encounterId);
      return enc;
    },
    [apiMode, refreshQueue, currentDate],
  );

  const submitRegisterEdit = useCallback(
    async (
      form: RegisterEditForm,
      onSeqFields?: (fields: Partial<RegisterEditForm> & { seqNote: string }) => void,
      onIncoming?: (slips: ReferralSlipHit[]) => Promise<IncomingChoice | null>,
    ) => {
      if (!apiMode) throw new Error("掛號需 API 模式");
      const mode = form.icException || "ic";
      if (mode === "ic") form = { ...form, deposit: "" };
      if (mode === "badCard" && !form.noCardReason.trim()) {
        form = { ...form, noCardReason: BAD_CARD_REASON };
      }
      if (!form.birthday.trim()) {
        throw new Error("\u8acb\u586b\u6c11\u570b\u751f\u65e5");
      }
      const selfPayVisit = mode === "selfPay" || form.caseNo === "9X";
      if (!selfPayVisit && !form.idNo.trim()) {
        throw new Error("\u8acb\u586b\u8eab\u5206\u8b49\u3002\u6c92\u6709\u8b49\u865f\u8acb\u6539\u9078\u81ea\u8cbb\u3002");
      }
      if (needsNhiNoCardReason(mode) && !form.noCardReason.trim()) {
        throw new Error("您未使用押單方式建檔，所以請輸入無卡原因");
      }
      if (!form.pharmacist.trim()) {
        throw new Error("藥師未填不可存檔");
      }

      const alreadyHas = Boolean(form.treatSeq) || Boolean(form.treatmentNumber);
      let treatSeq = form.treatSeq;
      let treatmentNumber = form.treatmentNumber;
      let treatDateTime = form.treatDateTime;
      let cardId = form.cardId;
      let securitySign = form.securitySign || "";
      let samId = "";
      let seqNote = "";

      if (!alreadyHas && form.prebook) {
        seqNote = "";
      } else if (!alreadyHas && (mode === "selfPay" || form.caseNo === "9X")) {
        seqNote = "\u81ea\u8cbb\uff1a\u4e0d\u8b80\u5361\u3001\u4e0d\u53d6\u865f\u3002";
      } else if (!alreadyHas && isDepositHold(form)) {
        seqNote = "押單：未向健保局取號，待補卡。";
      } else if (!alreadyHas) {
        const noCard = NOCARD_MODES.has(mode);
        try {
          const seq = await fetchSeqNext({
            treatmentItem: form.treatmentItem,
            afterCheck: form.afterCheck,
            icException: mode,
            patientIdNo: form.idNo.trim(),
            noCardReason: form.noCardReason,
          });
          treatSeq = seq.sequenceNumber || "";
          treatmentNumber = seq.treatmentNumber || treatmentNumber;
          if (noCard && treatmentNumber && !treatSeq) {
            treatSeq = claimSeqFor(mode, form.noCardReason);
          }
          treatDateTime = seq.treatmentDateTime || "";
          cardId = seq.hcId || cardId;
          securitySign = seq.signature || securitySign;
          samId = seq.samId || samId;
          const hints: string[] = [];
          if (seq.skipped) hints.push(seq.reason);
          else if (noCard && treatmentNumber) {
            hints.push(
              treatSeq
                ? `\u5065\u4fdd\u5c40\u56de\u8986\u5c31\u91ab\u8b58\u5225\u78bc ${treatmentNumber}\uff0c\u7533\u5831\u5e8f\u865f ${treatSeq}`
                : `\u5065\u4fdd\u5c40\u56de\u8986\u5c31\u91ab\u8b58\u5225\u78bc ${treatmentNumber}`,
            );
          } else if (treatSeq) hints.push(`健保局回覆就醫序號 ${treatSeq}`);
          if (seq.isSameDay) hints.push("同日就診");
          if (seq.hvExpire) hints.push("重大傷病將屆");
          if (seq.treatmentLimit != null) hints.push(`高診次數提醒 ${seq.treatmentLimit}`);
          seqNote = hints.filter(Boolean).join(" · ");
        } catch (err) {
          if (!noCard && mode !== "selfPay") throw err;
          seqNote = err instanceof Error ? err.message : "未取號";
        }
        if (mode !== "selfPay" && !noCard && !treatSeq && !treatmentNumber) {
          throw new Error("健保局未回傳就醫序號／識別碼。未掛進清單。");
        }
        if (noCard && !treatSeq && !treatmentNumber) {
          seqNote = [seqNote, "無卡未取號，以押單掛進清單"].filter(Boolean).join(" · ");
        }
      } else {
        seqNote = treatSeq
          ? `沿用已取到的就醫序號 ${treatSeq}`
          : `沿用已取到的就醫識別碼 ${treatmentNumber}`;
      }

      onSeqFields?.({ treatSeq, treatmentNumber, treatDateTime, cardId, securitySign, seqNote });

      const rememberReferral = async (encounterId: string): Promise<ReferralSlipHit[]> => {
        if (
          mode === "selfPay" ||
          mode === "deposit" ||
          isDepositHold(form) ||
          NOCARD_MODES.has(mode) ||
          form.prebook
        ) {
          return [];
        }
        try {
          const ref = await queryReferral({ encounterId, idNo: form.idNo.trim() });
          const slips = ref.slips || [];
          const extra = slips.length
            ? `\u6709 ${slips.length} \u7b46\u8f49\u5165\u8cc7\u6599`
            : ref.reason;
          if (extra) {
            onSeqFields?.({
              treatSeq,
              treatmentNumber,
              treatDateTime,
              cardId,
              seqNote: [seqNote, extra].filter(Boolean).join(" \u00b7 "),
            });
          }
          return slips;
        } catch (err) {
          onSeqFields?.({
            treatSeq,
            treatmentNumber,
            treatDateTime,
            cardId,
            seqNote: [seqNote, err instanceof Error ? err.message : "\u8f49\u8a3a\u5e8f\u865f\u6c92\u4e0b\u8f09\u5230"]
              .filter(Boolean)
              .join(" \u00b7 "),
          });
          return [];
        }
      };

      const storeIncoming = async (encounterId: string, patientId: string, slips: ReferralSlipHit[]) => {
        if (!slips.length || !onIncoming) return false;
        const choice = await onIncoming(slips);
        if (!choice?.accept || !choice.serial) return false;
        try {
          await markReferralAccepted(choice.serial);
        } catch {
          /* The chart flag below still records this acceptance. */
        }
        await patchEncounterReg(encounterId, {
          patientId,
          referralSeq: choice.serial,
          referralHospId: choice.hospId,
          referralHospName: choice.hospName,
          referralDate: choice.openDate,
          acceptReferral: "1",
        });
        return true;
      };

      const gross = Number(form.copayAmt) || 0;
      const disc = Number(form.copayDiscAmt) || 0;
      const payload = {
        ...form,
        treatSeq,
        treatmentNumber,
        treatDateTime,
        securitySign,
        samId,
        cardId,
        paperCard: mode === "paper",
        reasonText: form.reasonText.trim(),
        copayAmt: form.copayAmt ? String(Math.max(0, gross - disc)) : form.copayAmt,
      };

      if (form.encounterId) {
        const patientId = form.patientId?.trim();
        if (!patientId) throw new Error("本筆缺少 patientId，無法存檔此次掛號資料");
        const prior = queue.find((row) => row.encounterId === form.encounterId);
        const yuan = (value: string | undefined) => {
          const text = String(value ?? "").trim();
          if (!text || text === "\u2014" || text === "-") return 0;
          const n = Number(text.replace(/[^\d.-]/g, ""));
          return Number.isFinite(n) ? n : 0;
        };
        const burden = String(form.burdenFee || "").trim() ? yuan(form.burdenFee) : yuan(form.copayAmt);
        const totalFee = String(
          Math.round(
            yuan(form.regFee) + burden + depositInTotal(form.deposit, prior?.depositPaid) + yuan(prior?.selfPay),
          ),
        );
        await patchEncounterReg(form.encounterId, {
          patientId,
          patientIdNo: form.idNo.trim(),
          reasonText: payload.reasonText,
          caseNo: payload.caseNo,
          copayCode: payload.copayCode,
          dispense: payload.dispense,
          room: roomNumber(payload.room),
          shift: payload.shift,
          treatmentItem: payload.treatmentItem,
          afterCheck: payload.afterCheck,
          paperCard: payload.paperCard,
          treatSeq,
          treatmentNumber,
          treatDateTime,
          ...(securitySign ? { securitySign } : {}),
          ...(samId ? { samId } : {}),
          hcId: cardId,
          hcIdNo: form.idNo.trim(),
          icException: payload.icException,
          noCardReason: payload.noCardReason,
          pharmacist: payload.pharmacist,
          doctorId: payload.doctorId,
          doctorName: payload.doctorName,
          payType: payload.payType,
          regFee: payload.regFee,
          copayAmt: payload.copayAmt,
          deposit: payload.deposit,
          consultFee: payload.consultFee,
          drugFee: payload.drugFee,
          materialFee: payload.materialFee,
          burdenFee: payload.burdenFee,
          cardIdentity: form.cardIdentity,
          totalFee,
          prebook: Boolean(form.prebook),
          queueNumber: form.queueNumber ? Number(form.queueNumber) : undefined,
          visitClock: form.visitClock,
          acceptReferral: payload.acceptReferral,
          referralSeq: payload.referralSeq,
          referralHospId: payload.referralHospId,
          referralHospName: payload.referralHospName,
          referralDate: payload.referralDate,
        });
        const slips = await rememberReferral(form.encounterId);
        const fromSlip = await storeIncoming(form.encounterId, patientId, slips);
        if ((payload.acceptReferral || "").trim() === "1" || fromSlip) {
          await ensureAcceptReferralOrder(form.encounterId);
        }
        await refreshQueue();
        return { encounterId: form.encounterId, patientId };
      }
      const created = await registerPatientAndEncounter(payload);
      const slips = await rememberReferral(created.encounterId);
      const fromSlip = await storeIncoming(created.encounterId, created.patientId, slips);
      if ((payload.acceptReferral || "").trim() === "1" || fromSlip) {
        await ensureAcceptReferralOrder(created.encounterId);
      }
      return created;
    },
    [apiMode, queue, registerPatientAndEncounter, refreshQueue, ensureAcceptReferralOrder],
  );

  const persistCondition = useCallback(
    async (dx: DiagnosisRow) => {
      if (!apiMode || !selectedEncounterId) return;
      const body = buildConditionIntake(selectedEncounterId, dx, patientIdNo);
      if (!body.icd10Code && !body.nhiIcd10Code) {
        throw new Error("病名缺少 ICD-10 / 健保碼，無法寫入");
      }
      await registerCondition(body);
      await refreshWorkspace(selectedEncounterId);
    },
    [apiMode, selectedEncounterId, patientIdNo, refreshWorkspace],
  );

  const persistMedication = useCallback(
    async (line: RxLine) => {
      if (!apiMode || !selectedEncounterId) return;
      const body = buildMedicationIntake(selectedEncounterId, line, patientIdNo);
      await registerMedication(body);
      await refreshWorkspace(selectedEncounterId);
    },
    [apiMode, selectedEncounterId, patientIdNo, refreshWorkspace],
  );

  const retainQuiet = useCallback(
    async (encounterId: string, body: { medicationIds?: string[]; conditionIds?: string[] }) => {
      try {
        await retainEncounterChart(encounterId, body);
      } catch {
        /* The host program may not have this route yet. The row-by-row cancel still runs. */
      }
    },
    [],
  );

  const persistMedications = useCallback(
    async (lines: RxLine[]) => {
      if (!apiMode || !selectedEncounterId) return;
      const kept = new Set(
        lines.filter((line) => line.id && !isDraftId(line.id)).map((line) => line.id),
      );
      await retainQuiet(selectedEncounterId, { medicationIds: [...kept] });
      if (patientId) {
        for (const old of workspaceLive?.currentRx ?? []) {
          if (!old.id || isDraftId(old.id) || kept.has(old.id)) continue;
          await updateMedicationRequest(old.id, {
            ...medicationSaveBody(patientId, selectedEncounterId, old),
            status: "cancelled",
          });
        }
      }
      for (const line of lines) {
        if (!lineSaveCode(line)) continue;
        if (!isDraftId(line.id) && line.id && patientId) {
          await updateMedicationRequest(line.id, medicationSaveBody(patientId, selectedEncounterId, line));
          continue;
        }
        const body = buildMedicationIntake(selectedEncounterId, line, patientIdNo);
        await registerMedication(body);
      }
      await refreshWorkspace(selectedEncounterId);
    },
    [apiMode, selectedEncounterId, patientId, patientIdNo, refreshWorkspace, retainQuiet, workspaceLive?.currentRx],
  );

  const persistChiefComplaint = useCallback(
    async (chiefComplaint: string, assessment?: string, plan?: string, encounterId?: string) => {
      if (!apiMode) return;
      const eid = encounterId ?? selectedEncounterId;
      if (!eid) return;
      const text = chiefComplaint.trim();
      if (!text) return;
      const body = buildSoapIntake(
        eid,
        text,
        assessment,
        plan,
        patientIdNo,
      );
      await registerSoap(body);
      await refreshWorkspace(eid);
    },
    [apiMode, selectedEncounterId, patientIdNo, refreshWorkspace],
  );

  const persistVitals = useCallback(
    async (v: {
      weight?: string;
      temperature?: string;
      bpSys?: string;
      bpDia?: string;
    }) => {
      if (!apiMode || !selectedEncounterId) return;
      const parseNum = (raw?: string) => {
        if (!raw) return null;
        const m = String(raw).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
        if (!m) return null;
        const n = Number(m[0]);
        return Number.isFinite(n) && n > 0 ? n : null;
      };
      const jobs: Array<Promise<void>> = [];
      const w = parseNum(v.weight);
      if (w != null) {
        jobs.push(
          registerObservation({
            encounterId: selectedEncounterId,
            vitalType: "body_weight",
            value: w,
            unit: "kg",
            displayText: "Body weight",
          }),
        );
      }
      const t = parseNum(v.temperature);
      if (t != null) {
        jobs.push(
          registerObservation({
            encounterId: selectedEncounterId,
            vitalType: "body_temperature",
            value: t,
            unit: "Cel",
            displayText: "Body temperature",
          }),
        );
      }
      const sys = parseNum(v.bpSys);
      if (sys != null) {
        jobs.push(
          registerObservation({
            encounterId: selectedEncounterId,
            vitalType: "systolic_bp",
            value: sys,
            unit: "mmHg",
            displayText: "Systolic blood pressure",
          }),
        );
      }
      const dia = parseNum(v.bpDia);
      if (dia != null) {
        jobs.push(
          registerObservation({
            encounterId: selectedEncounterId,
            vitalType: "diastolic_bp",
            value: dia,
            unit: "mmHg",
            displayText: "Diastolic blood pressure",
          }),
        );
      }
      if (!jobs.length) return;
      await Promise.all(jobs);
      await refreshWorkspace(selectedEncounterId);
    },
    [apiMode, selectedEncounterId, refreshWorkspace],
  );

  const persistVisit = useCallback(
    async (chiefComplaint: string, dxRows: DiagnosisRow[], rxLines: RxLine[]) => {
      if (!apiMode || !selectedEncounterId) return;
      dxRows = await arrangeDiagnosisRows(dxRows);
      const assessment = dxRows[0]?.text;
      if (chiefComplaint.trim()) {
        await persistChiefComplaint(chiefComplaint, assessment);
      }
      const ownDxIds = new Set(
        (workspaceLive?.diagnoses ?? [])
          .map((dx) => dx.id)
          .filter((id): id is string => Boolean(id) && !isDraftId(id)),
      );
      const keptDx = dxRows
        .filter((dx) => dx.id && !isDraftId(dx.id) && ownDxIds.has(dx.id))
        .map((dx) => dx.id as string);
      await retainQuiet(selectedEncounterId, { conditionIds: keptDx });
      if (patientId) {
        for (const old of workspaceLive?.diagnoses ?? []) {
          if (!old.id || isDraftId(old.id) || keptDx.includes(old.id)) continue;
          await updateConditionResource(old.id, {
            subject: { reference: `Patient/${patientId}` },
            encounter: { reference: `Encounter/${selectedEncounterId}` },
            summaryText: old.text || old.icd10 || "dx",
            icd10Code: old.icd10 || undefined,
            nhiIcd10Code: old.nhiIcd10 || old.icd10?.replace(/\./g, "") || undefined,
            clinicalStatus: { coding: [{ code: "entered-in-error" }] },
          });
        }
      }
      const existingDx = new Set(
        (workspaceLive?.diagnoses ?? []).map((d) => `${d.icd10}|${d.text}`),
      );
      for (const dx of [...dxRows].reverse()) {
        const key = `${dx.icd10}|${dx.text}`;
        if (!isDraftId(dx.id) && dx.id && patientId && ownDxIds.has(dx.id)) {
          await updateConditionResource(dx.id, {
            subject: { reference: `Patient/${patientId}` },
            encounter: { reference: `Encounter/${selectedEncounterId}` },
            summaryText: dx.text,
            icd10Code: dx.icd10 || undefined,
            nhiIcd10Code: dx.nhiIcd10 || dx.icd10?.replace(/\./g, "") || undefined,
          });
          existingDx.add(key);
          continue;
        }
        if (existingDx.has(key)) continue;
        await persistCondition(dx);
        existingDx.add(key);
      }
      await persistMedications(rxLines);
      await refreshWorkspace(selectedEncounterId);
    },
    [
      apiMode,
      selectedEncounterId,
      patientId,
      persistChiefComplaint,
      persistCondition,
      persistMedications,
      refreshWorkspace,
      retainQuiet,
      workspaceLive?.diagnoses,
    ],
  );

  const persistHistoryVisit = useCallback(
    async (visit: HistoryVisit) => {
      if (!apiMode) return;
      const eid = visit.encounterId;
      const pid = patientId;
      const diagnoses = await arrangeDiagnosisRows(visit.diagnoses);
      if (visit.chiefComplaint.trim()) {
        await persistChiefComplaint(visit.chiefComplaint, diagnoses[0]?.text, undefined, eid);
      }
      const keptMeds = new Set(
        visit.medications.filter((line) => line.id && !isDraftId(line.id)).map((line) => line.id),
      );
      const keptDx = diagnoses.filter((dx) => dx.id && !isDraftId(dx.id)).map((dx) => dx.id as string);
      await retainQuiet(eid, { medicationIds: [...keptMeds], conditionIds: keptDx });
      const priorDx =
        (workspaceLive?.historyVisits ?? []).find((row) => row.encounterId === eid)?.diagnoses ??
        (selectedEncounterId === eid ? workspaceLive?.diagnoses ?? [] : []);
      if (pid) {
        for (const old of priorDx) {
          if (!old.id || isDraftId(old.id) || keptDx.includes(old.id)) continue;
          await updateConditionResource(old.id, {
            subject: { reference: `Patient/${pid}` },
            encounter: { reference: `Encounter/${eid}` },
            summaryText: old.text || old.icd10 || "dx",
            icd10Code: old.icd10 || undefined,
            nhiIcd10Code: old.nhiIcd10 || old.icd10?.replace(/\./g, "") || undefined,
            clinicalStatus: { coding: [{ code: "entered-in-error" }] },
          });
        }
      }
      for (const dx of [...diagnoses].reverse()) {
        if (!isDraftId(dx.id) && dx.id && pid) {
          await updateConditionResource(dx.id!, {
            subject: { reference: `Patient/${pid}` },
            encounter: { reference: `Encounter/${eid}` },
            summaryText: dx.text,
            icd10Code: dx.icd10 || undefined,
            nhiIcd10Code: dx.nhiIcd10 || dx.icd10?.replace(/\./g, "") || undefined,
          });
        } else {
          const body = buildConditionIntake(eid, dx, patientIdNo);
          if (!body.icd10Code && !body.nhiIcd10Code) continue;
          await registerCondition(body);
        }
      }
      const priorMeds =
        (workspaceLive?.historyVisits ?? []).find((row) => row.encounterId === eid)?.medications ??
        (selectedEncounterId === eid ? workspaceLive?.currentRx ?? [] : []);
      if (pid) {
        for (const old of priorMeds) {
          if (!old.id || isDraftId(old.id) || keptMeds.has(old.id)) continue;
          await updateMedicationRequest(old.id, {
            ...medicationSaveBody(pid, eid, old),
            status: "cancelled",
          });
        }
      }
      for (const line of visit.medications) {
        if (!isDraftId(line.id) && line.id && pid) {
          await updateMedicationRequest(line.id, medicationSaveBody(pid, eid, line));
        } else if (line.nhiCode?.trim()) {
          await registerMedication(buildMedicationIntake(eid, line, patientIdNo));
        }
      }
      if (selectedEncounterId === eid) {
        await refreshWorkspace(eid);
      }
    },
    [
      apiMode,
      patientId,
      patientIdNo,
      persistChiefComplaint,
      refreshWorkspace,
      retainQuiet,
      selectedEncounterId,
      workspaceLive?.diagnoses,
      workspaceLive?.historyVisits,
      workspaceLive?.currentRx,
    ],
  );

  const handleStatusChange = useCallback(
    async (encounterId: string, status: QueueStatus) => {
      if (apiMode) {
        await patchQueueStatus(encounterId, status);
        const res = await fetchQueueForDate(currentDate);
        const mapped = mapApiQueue(res.entry);
        queueStampRef.current = queueStamp(currentDate, mapped);
        setQueue(mapped);
        if (selectedEncounterId === encounterId) {
          await refreshWorkspace(encounterId);
        }
        return;
      }
      setQueue((prev) =>
        prev.map((e) => (e.encounterId === encounterId ? { ...e, queueStatus: status } : e)),
      );
    },
    [apiMode, refreshWorkspace, selectedEncounterId],
  );

  const ensureVisitDetail = useCallback(
    async (visit: HistoryVisit): Promise<HistoryVisit> => {
      if (!apiMode || !patientId) return visit;
      if ((visit.medications?.length ?? 0) > 0 || (visit.diagnoses?.length ?? 0) > 0) {
        return visit;
      }
      try {
        const detail = await fetchPatientVisitDetail(patientId, visit.encounterId);
        const mapped = mapHistoryVisitEntry(detail);
        const pid = patientId.split("/").pop() || patientId;
        const cached = historyCacheRef.current.get(pid);
        if (cached) {
          historyCacheRef.current.set(
            pid,
            cached.map((v) => (v.encounterId === mapped.encounterId ? mapped : v)),
          );
        }
        setWorkspaceData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            historyVisits: prev.historyVisits.map((v) =>
              v.encounterId === mapped.encounterId ? mapped : v,
            ),
          };
        });
        return mapped;
      } catch {
        return visit;
      }
    },
    [apiMode, patientId],
  );

  const addPrebook = useCallback(
    async (form: QueueRegisterForm & { confirmDuplicate?: boolean }, slotTime: string, insertAtNumber?: number) => {
      const reason = form.reasonText.trim();
      if (apiMode) {
        await registerPatientAndEncounter({
          ...form,
          reasonText: reason,
          prebook: true,
          confirmDuplicate: form.confirmDuplicate,
        });
        await refreshQueue(currentDate);
        return;
      }
      setQueue((prev) => {
        const n =
          insertAtNumber ??
          Math.max(0, ...prev.map((e) => e.queueNumber)) + 1;
        const shifted =
          insertAtNumber == null
            ? prev
            : prev.map((e) => (e.queueNumber >= n ? { ...e, queueNumber: e.queueNumber + 1 } : e));
        const row: QueueEntry = {
          encounterId: `prebook-${Date.now()}`,
          patientId: `local-prebook-${Date.now()}`,
          queueNumber: n,
          queueStatus: "waiting",
          patientDisplay: form.patientName.trim() || "—",
          ageSex: form.sex || "",
          hasAllergyAlert: false,
          preVisitCompleted: false,
          prebook: true,
          reasonText: reason,
          slotTime: slotTime || undefined,
          medicalNo: "",
          sex: form.sex,
          birthday: form.birthday,
          patientName: form.patientName,
        };
        return [...shifted, row];
      });
    },
    [apiMode, registerPatientAndEncounter, refreshQueue, currentDate],
  );

  return {
    apiMode,
    loading,
    error,
    currentDate,
    setCurrentDate,
    queueHints,
    queue,
    selectedEncounterId,
    setSelectedEncounterId,
    selected,
    patientId,
    patientIdNo,
    allergies,
    diagnoses,
    prevRx,
    historyVisits,
    ensureVisitDetail,
    currentRx,
    patientResource,
    encounterResource,
    ccFromWs,
    vitalsFromWs: workspaceLive?.vitals ?? EMPTY_WS_VITALS,
    lesionMedia: apiMode
      ? (workspaceLive?.lesionMedia ?? [])
      : patientId
        ? (mockMediaByPatient[patientId] ?? [])
        : [],
    forgetPatientHistory: (patientId?: string) => {
      const pid = (patientId || "").split("/").pop() || "";
      if (!pid) historyCacheRef.current.clear();
      else historyCacheRef.current.delete(pid);
    },
    clinicalProfile: patientId ? getPatientClinicalProfile(patientId) : null,
    emptyCurrentRx,
    cloneRxLines,
    handleStatusChange,
    refreshQueue,
    refreshWorkspace,
    readCardRegisterPatient,
    registerPatientAndEncounter,
    submitRegisterEdit,
    ensureAcceptReferralOrder,
    ensureOutboundReferralOrder,
    persistCondition,
    persistMedication,
    persistMedications,
    persistChiefComplaint,
    persistVitals,
    persistVisit,
    persistHistoryVisit,
    addPrebook,
  };
}
