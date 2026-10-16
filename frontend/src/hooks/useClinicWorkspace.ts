import { useCallback, useEffect, useRef, useState } from "react";
import { isDepositHold, needsNhiNoCardReason } from "@/lib/registerModes";
import {
  fetchQueueForDate,
  fetchPatientVisitDetail,
  fetchPatientVisits,
  fetchWorkspace,
  isApiMode,
  patchQueueStatus,
  fetchSeqNext,
  queryReferral,
  patchEncounterReg,
  readCardAndRegister,
  registerCondition,
  registerEncounter,
  registerMedication,
  registerPatient,
  registerSoap,
  registerObservation,
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
import {
  buildConditionIntake,
  buildMedicationIntake,
  buildSoapIntake,
  extractPatientIdNo,
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
    reasonText: e.queueMeta.reasonText ?? "",
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
    deposit: e.queueMeta.deposit,
    regFee: e.queueMeta.regFee,
    copayAmt: e.queueMeta.copayAmt,
    hcId: e.queueMeta.hcId,
    afterCheck: e.queueMeta.afterCheck,
    treatmentItem: e.queueMeta.treatmentItem,
    consultFee: e.queueMeta.consultFee,
    drugFee: e.queueMeta.drugFee,
    totalFee: e.queueMeta.totalFee,
    materialFee: e.queueMeta.materialFee,
    burdenFee: e.queueMeta.burdenFee,
    id: e.resource.id,
    patientName: e.queueMeta.patientDisplay,
    birthday: e.queueMeta.birthday,
    idNo: e.queueMeta.hcIdNo || e.queueMeta.idNo || "",
    sequenceNo: e.queueMeta.queueNumber,
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
} {
  let payMark = "";
  let memo = "";
  let bodySite = "";
  const exts = (resource.extension as Array<Record<string, unknown>> | undefined) || [];
  for (const ext of exts) {
    const url = String(ext.url || "");
    if (url.endsWith("/payMark")) payMark = String(ext.valueString || "");
    if (url.endsWith("/memoMark")) memo = String(ext.valueString || "");
    if (url.endsWith("/bodySite")) bodySite = String(ext.valueString || "");
  }
  return { payMark, memo, bodySite };
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
      memo: marks.memo || "",
      bodySite: marks.bodySite || "",
      unitPrice:
        meta.unitPrice === null || meta.unitPrice === undefined
          ? undefined
          : Number(meta.unitPrice),
    };
  });
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
  const diagnoses: DiagnosisRow[] = ws.diagnoses.map((d) => {
    const meta = d.indexMeta ?? {};
    const res = (d.resource as { id?: string }) ?? {};
    return {
      id: res.id,
      icd10: String(meta.icd10Code ?? ""),
      snomed: meta.snomedCode ? String(meta.snomedCode) : undefined,
      nhiIcd10: meta.nhiIcd10Code ? String(meta.nhiIcd10Code) : undefined,
      text: String(meta.summaryText ?? ""),
    };
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
}) {
  const loadWorkspace = options?.loadWorkspace ?? false;
  const initialDate = options?.initialDate;
  const initialEncounterId = options?.initialEncounterId;
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
  const [queueHints, setQueueHints] = useState<QueueDateHints>({});
  const [selectedEncounterId, setSelectedEncounterId] = useState<string | null>(
    () => initialEncounterId || null,
  );
  const [loading, setLoading] = useState(apiMode);
  const [error, setError] = useState<string | null>(null);
  const [workspaceData, setWorkspaceData] = useState<ReturnType<typeof mapWorkspace> | null>(
    null,
  );
  // 病人歷史 light 清單快取（醫聖式：選過／預載的病人幾乎瞬開）
  const historyCacheRef = useRef(new Map<string, HistoryVisit[]>());
  /** 後到的舊查詢不能蓋掉較新的病名／處置。 */
  const wsGen = useRef(0);

  const refreshQueue = useCallback(async (targetDate?: string) => {
    if (!apiMode) return;
    const queryDate = targetDate ?? currentDate;
    const res = await fetchQueueForDate(queryDate);
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
    // 僅後端 autoFallback（today 空日）時才改看診日；使用者明確選的空日維持不動
    if (res.autoFallback && res.resolvedDate && res.resolvedDate !== queryDate) {
      setCurrentDate(res.resolvedDate);
    }
    return mapped;
  }, [apiMode, currentDate]);

  useEffect(() => {
    if (!apiMode) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetchQueueForDate(currentDate);
        if (cancelled) return;
        const mapped = mapApiQueue(res.entry);
        setQueue(mapped);
        // 候診名單進站後背景預載 light 歷史（開病人才瞬開）
        void (async () => {
          const seen = new Set<string>();
          for (const e of mapped) {
            if (cancelled) return;
            if (e.prebook || e.queueStatus === "finished") continue;
            const pid = e.patientId?.split("/").pop();
            if (!pid || seen.has(pid) || historyCacheRef.current.has(pid)) continue;
            seen.add(pid);
            try {
              const hist = await fetchPatientVisits(pid, 200, {
                light: true,
                excludeEncounterId: e.encounterId,
              });
              if (cancelled) return;
              historyCacheRef.current.set(pid, mapHistoryVisitsLight(hist.entry || []));
            } catch {
              /* ignore prefetch errors */
            }
          }
        })();
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
  }, [apiMode, currentDate]);

  useEffect(() => {
    if (!loadWorkspace) {
      setWorkspaceData(null);
      return;
    }
    if (!apiMode || !selectedEncounterId) {
      setWorkspaceData(null);
      return;
    }
    let cancelled = false;
    const gen = ++wsGen.current;
    (async () => {
      try {
        // 1) 當次看診先到（history_limit=0）
        const ws = await fetchWorkspace(selectedEncounterId, { historyLimit: 0 });
        if (cancelled || gen !== wsGen.current) return;
        const mapped = mapWorkspace(ws);
        const pid = String(ws.patientId || "").split("/").pop() || "";
        const cached = pid ? historyCacheRef.current.get(pid) : undefined;
        setWorkspaceData({
          ...mapped,
          historyVisits: cached ?? mapped.historyVisits,
        });
        setError(null);

        // 2) light 歷史（快）；有快取則略過網路
        if (!pid || cached) return;
        try {
          const hist = await fetchPatientVisits(pid, 200, {
            light: true,
            excludeEncounterId: selectedEncounterId,
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

  const allergies = apiMode
    ? (workspaceData?.allergies ?? [])
    : patientId
      ? (mockAllergiesByPatient[patientId] ?? [])
      : [];
  const diagnoses = apiMode
    ? (workspaceData?.diagnoses ?? [])
    : selectedEncounterId
      ? (mockConditionsByEncounter[selectedEncounterId] ?? [])
      : [];
  const prevRx = apiMode
    ? (workspaceData?.prevRx ?? [])
    : patientId
      ? (mockPrevRxByPatient[patientId] ?? [])
      : [];
  const historyVisits = apiMode
    ? (workspaceData?.historyVisits ?? [])
    : mockHistoryVisitsFor(patientId, selectedEncounterId);
  const currentRx = apiMode
    ? (workspaceData?.currentRx ?? [])
    : selectedEncounterId
      ? undefined
      : [];
  const patientResource = apiMode
    ? (workspaceData?.patientResource ?? null)
    : patientId
      ? (mockPatients[patientId] ?? null)
      : null;
  const encounterResource = apiMode
    ? (workspaceData?.encounterResource ?? null)
    : selectedEncounterId
      ? (mockEncounters[selectedEncounterId] ?? null)
      : null;
  const ccFromWs = workspaceData?.cc;
  const patientIdNo = extractPatientIdNo(patientResource);

  const refreshWorkspace = useCallback(async (encounterId?: string) => {
    const eid = encounterId ?? selectedEncounterId;
    if (!eid) return;
    const gen = ++wsGen.current;
    const ws = await fetchWorkspace(eid, { historyLimit: 0 });
    if (gen !== wsGen.current) return;
    const mapped = mapWorkspace(ws);
    setWorkspaceData((prev) => ({
      ...mapped,
      historyVisits: prev?.historyVisits?.length ? prev.historyVisits : mapped.historyVisits,
    }));
  }, [selectedEncounterId]);

  const readCardRegisterPatient = useCallback(async () => {
    if (!apiMode) throw new Error("需 API 模式");
    const res = await readCardAndRegister(false);
    return res;
  }, [apiMode]);

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
        queueNumber?: string;
        visitClock?: string;
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
        room: form.room,
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
        prebook: form.prebook,
        queueNumber: form.queueNumber ? Number(form.queueNumber) : undefined,
        visitClock: form.visitClock,
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
    ) => {
      if (!apiMode) throw new Error("掛號需 API 模式");
      const mode = form.icException || "ic";
      if (!form.idNo.trim() || !form.birthday.trim()) {
        throw new Error("請填身分證與民國生日");
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
          treatDateTime = seq.treatmentDateTime || "";
          cardId = seq.hcId || cardId;
          securitySign = seq.signature || securitySign;
          samId = seq.samId || samId;
          const hints: string[] = [];
          if (seq.skipped) hints.push(seq.reason);
          else if (treatSeq) hints.push(`健保局回覆就醫序號 ${treatSeq}`);
          else if (treatmentNumber) hints.push(`健保局回覆就醫識別碼 ${treatmentNumber}`);
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

      const rememberReferral = async (encounterId: string) => {
        if (mode === "selfPay" || NOCARD_MODES.has(mode) || form.prebook) return;
        try {
          const ref = await queryReferral({ encounterId, idNo: form.idNo.trim() });
          const extra = ref.serial ? `\u8f49\u8a3a\u55ae\u5e8f\u865f ${ref.serial}` : ref.reason;
          if (!extra) return;
          onSeqFields?.({
            treatSeq,
            treatmentNumber,
            treatDateTime,
            cardId,
            seqNote: [seqNote, extra].filter(Boolean).join(" \u00b7 "),
          });
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
        }
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
        await patchEncounterReg(form.encounterId, {
          patientId,
          patientIdNo: form.idNo.trim(),
          reasonText: payload.reasonText,
          caseNo: payload.caseNo,
          copayCode: payload.copayCode,
          dispense: payload.dispense,
          room: payload.room,
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
          prebook: Boolean(form.prebook),
          queueNumber: form.queueNumber ? Number(form.queueNumber) : undefined,
          visitClock: form.visitClock,
        });
        await rememberReferral(form.encounterId);
        await refreshQueue();
        return { encounterId: form.encounterId, patientId };
      }
      const created = await registerPatientAndEncounter(payload);
      await rememberReferral(created.encounterId);
      return created;
    },
    [apiMode, registerPatientAndEncounter, refreshQueue],
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

  const persistMedications = useCallback(
    async (lines: RxLine[]) => {
      if (!apiMode || !selectedEncounterId || !lines.length) return;
      for (const line of lines) {
        if (!line.nhiCode?.trim()) continue;
        if (!isDraftId(line.id) && line.id && patientId) {
          await updateMedicationRequest(line.id, {
            status: "active",
            intent: "order",
            subject: { reference: `Patient/${patientId}` },
            encounter: { reference: `Encounter/${selectedEncounterId}` },
            drugText: line.name,
            nhiCode: line.nhiCode,
            dosageInstruction: [{ text: line.sig || "依醫囑" }],
            bodySite: line.bodySite || "",
          });
          continue;
        }
        const body = buildMedicationIntake(selectedEncounterId, line, patientIdNo);
        await registerMedication(body);
      }
      await refreshWorkspace(selectedEncounterId);
    },
    [apiMode, selectedEncounterId, patientId, patientIdNo, refreshWorkspace],
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
      const assessment = dxRows[0]?.text;
      if (chiefComplaint.trim()) {
        await persistChiefComplaint(chiefComplaint, assessment);
      }
      const existingDx = new Set(
        (workspaceData?.diagnoses ?? []).map((d) => `${d.icd10}|${d.text}`),
      );
      for (const dx of dxRows) {
        const key = `${dx.icd10}|${dx.text}`;
        if (!isDraftId(dx.id) && dx.id && patientId) {
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
      workspaceData?.diagnoses,
    ],
  );

  const persistHistoryVisit = useCallback(
    async (visit: HistoryVisit) => {
      if (!apiMode) return;
      const eid = visit.encounterId;
      const pid = patientId;
      if (visit.chiefComplaint.trim()) {
        await persistChiefComplaint(visit.chiefComplaint, visit.diagnoses[0]?.text, undefined, eid);
      }
      for (const dx of visit.diagnoses) {
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
      for (const line of visit.medications) {
        if (!isDraftId(line.id) && line.id && pid) {
          await updateMedicationRequest(line.id, {
            status: "active",
            intent: "order",
            subject: { reference: `Patient/${pid}` },
            encounter: { reference: `Encounter/${eid}` },
            drugText: line.name,
            nhiCode: line.nhiCode,
            dosageInstruction: [{ text: line.sig || "依醫囑" }],
            bodySite: line.bodySite || "",
          });
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
      selectedEncounterId,
    ],
  );

  const handleStatusChange = useCallback(
    async (encounterId: string, status: QueueStatus) => {
      if (apiMode) {
        await patchQueueStatus(encounterId, status);
        const res = await fetchQueueForDate(currentDate);
        setQueue(mapApiQueue(res.entry));
        if (selectedEncounterId === encounterId) {
          await refreshWorkspace(encounterId);
        }
        return;
      }
      setQueue((prev) =>
        prev.map((e) => {
          if (status === "in_progress") {
            if (e.encounterId === encounterId) return { ...e, queueStatus: status };
            if (e.queueStatus === "in_progress") return { ...e, queueStatus: "waiting" };
            return e;
          }
          if (e.encounterId === encounterId) return { ...e, queueStatus: status };
          return e;
        }),
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
    async (form: QueueRegisterForm, slotTime: string, insertAtNumber?: number) => {
      const reason = form.reasonText.trim();
      if (apiMode) {
        await registerPatientAndEncounter({ ...form, reasonText: reason, prebook: true });
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
    vitalsFromWs: workspaceData?.vitals ?? EMPTY_WS_VITALS,
    lesionMedia: apiMode
      ? (workspaceData?.lesionMedia ?? [])
      : patientId
        ? (mockMediaByPatient[patientId] ?? [])
        : [],
    clinicalProfile: patientId ? getPatientClinicalProfile(patientId) : null,
    emptyCurrentRx,
    cloneRxLines,
    handleStatusChange,
    refreshQueue,
    refreshWorkspace,
    readCardRegisterPatient,
    registerPatientAndEncounter,
    submitRegisterEdit,
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
