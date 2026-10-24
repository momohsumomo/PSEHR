import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useClinicWorkspace } from "@/hooks/useClinicWorkspace";
import { cancelRegister, CardReadError, fetchStaff, importCareOnline, type CardFaultReport } from "@/api/clinicApi";
import { dropChartDraft } from "@/lib/chartDraft";
import { pharmacistDisplayName, type ClinicStaffLike } from "@/lib/doctorName";
import { IcCardInfoDialog } from "@/components/clinic/IcCardInfoDialog";
import { ChangePharmacistDialog } from "@/components/clinic/ChangePharmacistDialog";
import { emptyRegisterForm, type RegisterEditForm } from "@/components/clinic/RegisterEditDialog";
import { RegisterConfirmDialog } from "@/components/clinic/RegisterConfirmDialog";
import { useIncomingReferralAsk } from "@/components/clinic/ReferralAcceptDialogs";
import { PatientFinderDialog } from "@/components/clinic/PatientFinderDialog";
import { DeleteRegisterDialog } from "@/components/clinic/DeleteRegisterDialog";
import { REGI_COLUMNS } from "@/components/clinic/HisRegisterToolBar";
import { FIRST_VISIT_BG, isFirstVisit, visitListMark } from "@/lib/visitListMark";
import { ClinicShortcutBar } from "@/components/clinic/ClinicShortcutBar";
import { RegisterOptionsDialog } from "@/components/clinic/RegisterOptionsDialog";
import { RefundDepositDialog } from "@/components/clinic/RefundDepositDialog";
import { PatientEditDialog, type PatientEditSeed } from "@/components/clinic/PatientEditDialog";
import { NewPatientDialog } from "@/components/clinic/NewPatientDialog";
import { REGISTER_SHORTCUT_BAR } from "@/lib/clinicShortcutSets";
import { openPrintPreview } from "@/lib/printJob";
import { buildDepositSlipHtml } from "@/lib/clinicPrintDocs";
import { readLocalClinicBundle } from "@/lib/clinicProfile";
import { useEscLayer } from "@/hooks/useEscLayer";
import { useListNav } from "@/hooks/useListNav";
import {
  HisStubDialog,
  type HisStubId,
} from "@/components/clinic/HisStubDialog";
import type { QueueEntry } from "@/mocks";
import { HisRocDateField, isoToRoc, rocToIso } from "@/components/clinic/HisRocDatePicker";
import { defaultShift, lastPharmacist, loadClinicSession, saveClinicSession, lastClinicDept, type ClinicSession } from "@/lib/clinicSession";
import { openNhiCloudRx } from "@/lib/nhiCloud";
import { registerHubAction } from "@/lib/registerHubActions";
import { isoBirthDateToRoc, formatBirthdayRoc, loadClinicRegisterDefaults, type PatientHit } from "@/lib/patientSearch";
import { isDepositHold } from "@/lib/registerModes";
import { HIS, HIS_FONT, hisFontStyle } from "@/lib/hisTheme";
import { findCardCheckIn, findWaitingAppointment, otherShiftAppointmentNote } from "@/lib/appointmentCheckIn";
import { displayCase } from "@/lib/caseMark";
import { roomLabel, roomNumber } from "@/lib/roomMark";
import { clockLabel, compareClinicQueue, normalizeClock, nowClock, planQueueNumber, shiftFromClock, shiftQueueNumbers } from "@/lib/queueOrder";
import { depositPrintOptions, findPrintSetup, loadPrintSettings } from "@/lib/printSettings";
import { openDepositSlip, openSavedVisitReceipt } from "@/lib/visitReceiptPrint";
import { VisitPrintDialog } from "@/components/clinic/VisitPrintDialog";
import { DoneMarkCell, queueRowBackground } from "@/components/clinic/EncounterQueuePanel";
import { AppointmentCheckInDialog, InsertNumberDialog } from "@/components/clinic/InsertNumberDialog";
import {
  pendingDuplicateHits,
  SameDayFlash,
  SameDayRegisterDialog,
  type SameDayHit,
} from "@/components/clinic/SameDayRegisterDialog";
import { HisWinTitle } from "@/components/clinic/HisPageFrame";

function dash(v: unknown): string {
  if (v === null || v === undefined) return "—";
  const s = String(v).trim();
  return s.length ? s : "—";
}

function regiCell(entry: QueueEntry, key: string): string {
  const timeLabel = entry.slotTime;
  const hour = timeLabel?.includes(":") ? parseInt(timeLabel.split(":")[0], 10) : NaN;
  const shift = Number.isFinite(hour) ? (hour < 12 ? "上午" : hour < 18 ? "下午" : "晚上") : "";
  const sexLabel =
    entry.sex === "M" || entry.ageSex.endsWith("M")
      ? "男"
      : entry.sex === "F" || entry.ageSex.endsWith("F")
        ? "女"
        : "";
  const statusLabel =
    entry.queueStatus === "in_progress"
      ? "看診中"
      : entry.queueStatus === "finished"
        ? "已完診"
        : entry.queueStatus === "no_show"
          ? "未到"
          : "候診中";
  switch (key) {
    case "queueNumber":
      return String(entry.queueNumber);
    case "slotTime":
      return dash(clockLabel(timeLabel));
    case "medicalNo":
      return dash(entry.medicalNo);
    case "patientDisplay":
      return dash(entry.patientDisplay);
    case "sex":
      return dash(sexLabel);
    case "shift":
      return dash(entry.shift || shift);
    case "room":
      return dash(roomLabel(entry.room));
    case "note":
      return entry.note?.trim() || "";
    case "preVisit":
      return visitListMark(entry, { appointmentWhileWaiting: false });
    case "caseNo":
      return dash(displayCase(entry.caseNo));
    case "paperCard":
      return entry.paperCard ? "紙" : "";
    case "deptSlot":
      return "";
    case "dept":
      return lastClinicDept();
    case "copayCode":
      return dash(entry.copayCode);
    case "collected":
      return dash(entry.totalFee || entry.drugFee);
    case "copay":
      return dash(entry.copayAmt);
    case "deposit":
      return dash(entry.deposit);
    case "regFee":
      return dash(entry.regFee);
    case "drugFee":
    case "drugDisc":
      return dash(entry.drugFee);
    case "totalFee":
      return dash(entry.totalFee);
    case "diseaseName":
      return dash(entry.diseaseName);
    case "dispense":
      return dash(entry.dispense);
    case "queueStatus":
      return statusLabel;
    case "age":
      return dash(entry.age ?? entry.ageSex.replace(/[MF]$/, ""));
    case "weight":
      return dash(entry.weight);
    case "reasonText":
      return dash(entry.reasonText);
    default:
      return "—";
  }
}

function seedFromEntry(entry: QueueEntry): Partial<RegisterEditForm> {
  return {
    encounterId: entry.encounterId,
    patientId: entry.patientId,
    idNo: entry.idNo || "",
    birthday: isoBirthDateToRoc(entry.birthday) || (entry.birthday || "").replace(/\D/g, "").slice(0, 7),
    sex: entry.sex || (entry.ageSex?.endsWith("M") ? "M" : "F"),
    patientName: entry.patientDisplay,
    reasonText: entry.note && entry.note !== "—" && entry.note !== "-" ? entry.note : "",
    caseNo: entry.caseNo && entry.caseNo !== "—" ? entry.caseNo : "01",
    copayCode: entry.copayCode || "",
    payType: entry.payType || "4",
    dispense: entry.dispense || "自行調劑",
    pharmacist: entry.pharmacist || lastPharmacist(),
    doctorId: entry.doctorId || "",
    doctorName: entry.doctorName || "",
    shift: entry.shift || "",
    room: roomNumber(entry.room),
    treatmentItem: entry.treatmentItem || "01",
    afterCheck: entry.afterCheck === "2" ? "2" : "1",
    icException: (entry.icException as RegisterEditForm["icException"]) || "ic",
    noCardReason: entry.noCardReason || "",
    paperCard: Boolean(entry.paperCard),
    treatSeq: entry.treatSeq || "",
    treatmentNumber: entry.treatmentNumber || "",
    treatDateTime: entry.treatDateTime || "",
    queueNumber: entry.queueNumber != null ? String(entry.queueNumber) : "",
    visitClock: entry.slotTime || "",
    cardId: entry.hcId || "",
    cardIdentity: entry.cardIdentity || "",
    regFee: entry.regFee || "",
    copayAmt: entry.copayAmt || "",
    deposit: entry.deposit || "",
    acceptReferral: entry.acceptReferral || "",
    referralSeq: entry.referralSeq || "",
    referralHospId: entry.referralHospId || "",
    referralHospName: entry.referralHospName || "",
    referralDate: entry.referralDate || "",
    consultFee: entry.consultFee || "",
    drugFee: entry.drugFee || "",
    materialFee: entry.materialFee || "",
    burdenFee: entry.burdenFee || "",
  };
}

function seedFromPatientHit(hit: PatientHit): RegisterEditForm {
  const base = emptyRegisterForm();
  return {
    ...base,
    patientId: hit.id,
    idNo: hit.idNo,
    birthday: hit.birthdayRoc || isoBirthDateToRoc(hit.birthDateIso),
    sex: hit.sex || "F",
    patientName: hit.name,
    icException: "deposit",
    noCardReason: "",
    deposit: loadClinicRegisterDefaults().depositAmount,
    prebook: false,
    pharmacist: lastPharmacist(),
    reasonText: "",
  };
}

export function RegisterPage() {
  const navigate = useNavigate();
  const ws = useClinicWorkspace();
  const {
    apiMode,
    error,
    queue,
    readCardRegisterPatient,
    submitRegisterEdit,
    refreshQueue,
    currentDate,
    setCurrentDate,
    addPrebook,
  } = ws;
  const incoming = useIncomingReferralAsk();

  const [localError, setLocalError] = useState<string | null>(null);
  const [staffPeople, setStaffPeople] = useState<ClinicStaffLike[]>([]);
  useEffect(() => {
    void fetchStaff()
      .then((rows) => setStaffPeople(rows))
      .catch(() => setStaffPeople([]));
  }, []);
  const [busy, setBusy] = useState(false);
  const [birthdayQ, setBirthdayQ] = useState("");
  const [idNoQ, setIdNoQ] = useState("");
  const [phoneQ, setPhoneQ] = useState("");
  const searchQuery = [idNoQ, birthdayQ, phoneQ].map((s) => s.trim()).filter(Boolean).join(" ");
  const [regShift, setRegShift] = useState<ClinicSession["shift"]>(
    () => loadClinicSession()?.shift || defaultShift(),
  );
  const [sameDayFlash, setSameDayFlash] = useState(false);
  const [dupAsk, setDupAsk] = useState<SameDayHit[] | null>(null);
  const dupGo = useRef<(() => void) | null>(null);
  const [careBusy, setCareBusy] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [insertNo, setInsertNo] = useState("");
  const [insertAsk, setInsertAsk] = useState<{
    gap: number;
    tail: number;
    go: (n: number) => void;
  } | null>(null);
  const [checkInAsk, setCheckInAsk] = useState<{
    encounterId: string;
    queueNumber: string;
    visitClock: string;
    fromCard: boolean;
    seed: Partial<RegisterEditForm>;
  } | null>(null);
  const [depositAsk, setDepositAsk] = useState<{
    name: string;
    medicalNo: string;
    idNo?: string;
    birthday?: string;
    deposit: string;
    regFee: string;
    date: string;
  } | null>(null);
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [shellNotice, setShellNotice] = useState<string | null>(null);
  const [printMenuOpen, setPrintMenuOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queueListRef = useRef<HTMLDivElement>(null);
  const preferAfterDeleteRef = useRef<string | null>(null);

  /** 已掛一筆 → 掛號編輯 */

  /** 掛號前確認存檔 */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [priceBlankFees, setPriceBlankFees] = useState(false);
  const [confirmForm, setConfirmForm] = useState<RegisterEditForm>(emptyRegisterForm());
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [cardDiagnose, setCardDiagnose] = useState<CardFaultReport | null>(null);
  const [seqBusy, setSeqBusy] = useState(false);
  const [seqNote, setSeqNote] = useState<string | null>(null);

  /** 共用找人 */
  const [finderOpen, setFinderOpen] = useState(false);
  const [newPatientQuery, setNewPatientQuery] = useState<string | null>(null);
  const [finderSeed, setFinderSeed] = useState("");

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [stubId, setStubId] = useState<HisStubId | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [icInfoOpen, setIcInfoOpen] = useState(false);
  const [pharmacistOpen, setPharmacistOpen] = useState(false);
  const [registerOptionsOpen, setRegisterOptionsOpen] = useState(false);
  const [patientEditOpen, setPatientEditOpen] = useState(false);
  const [finderPatient, setFinderPatient] = useState<PatientEditSeed | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const selected = queue.find((e) => e.encounterId === selectedId) ?? null;
  const tellShell = (msg: string) => setShellNotice(msg);

  const loadCareOnline = useCallback(
    (day: string) => {
      setCareBusy(true);
      void importCareOnline(day)
        .then(async (res) => {
          const err = res.errors?.length
            ? `　有 ${res.errors.length} 筆沒掛上：${res.errors.slice(0, 2).join("；")}`
            : "";
          tellShell(
            `照護線上 ${res.date}：讀到 ${res.fetched}，預約寫入 ${res.imported}（新病患 ${res.createdPatients}，已有病歷略過 ${res.skippedExisting}，原生日保留 ${res.birthdayKept}）${err}`,
          );
          await refreshQueue();
        })
        .catch((e: unknown) => {
          tellShell(e instanceof Error ? e.message : "照護線上匯入失敗");
        })
        .finally(() => setCareBusy(false));
    },
    [refreshQueue],
  );

  useEffect(() => {
    if (searchParams.get("care") !== "today") return;
    setSearchParams({}, { replace: true });
    loadCareOnline(currentDate);
    // 只在從大廳工具帶入時跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const openConfirmFromSeed = useCallback((seed: Partial<RegisterEditForm>, fillBlankFees = false) => {
    setConfirmError(null);
    setSeqNote(null);
    setCardDiagnose(null);
    const next = { ...emptyRegisterForm(), ...seed };
    next.pharmacist = seed.pharmacist || lastPharmacist();
    if (!seed.encounterId) next.shift = regShift;
    if (!seed.visitClock) next.visitClock = nowClock();
    setRegisterOptionsOpen(false);
    setPriceBlankFees(fillBlankFees);
    setConfirmForm(next);
    setConfirmOpen(true);
  }, [regShift]);

  const offerQueueNumber = useCallback(
    (shift: string, go: (n: number) => void) => {
      const plan = planQueueNumber(shiftQueueNumbers(queue, shift));
      if (plan.contiguous) go(plan.next);
      else setInsertAsk({ gap: plan.gap, tail: plan.tail, go });
    },
    [queue],
  );

  const beginCheckIn = useCallback(
    (
      row: { encounterId: string; queueNumber?: number; slotTime?: string },
      seed: Partial<RegisterEditForm>,
      fromCard = false,
    ) => {
      setRegisterOptionsOpen(false);
      setFinderOpen(false);
      setCheckInAsk({
        encounterId: row.encounterId,
        queueNumber: row.queueNumber != null ? String(row.queueNumber) : "",
        visitClock: row.slotTime || seed.visitClock || "",
        fromCard,
        seed: {
          ...seed,
          prebook: false,
          payType: seed.payType === "prebook" ? "4" : seed.payType || "4",
          ...(fromCard ? { icException: "ic" as const, deposit: "", noCardReason: "" } : {}),
        },
      });
    },
    [],
  );

  const openFinder = (seed = searchQuery) => {
    setRegisterOptionsOpen(false);
    setFinderSeed(seed.trim());
    setFinderOpen(true);
  };

  /** F9：讀卡 → 掛號前確認（尚未掛進清單） */
  const handleReadCardConfirm = useCallback(async () => {
    if (!apiMode) {
      setLocalError("讀卡需 API 模式");
      return;
    }
    setLocalError(null);
    setConfirmError(null);
    setCardDiagnose(null);
    setSeqNote(null);
    const next = emptyRegisterForm();
    next.pharmacist = lastPharmacist();
    next.icException = "ic";
    next.reasonText = "";
    next.shift = regShift;
    next.visitClock = nowClock();
    try {
      const res = await readCardRegisterPatient();
      const seed: RegisterEditForm = {
        ...next,
        patientId: res.patientId,
        idNo: res.validation?.idNo ?? next.idNo,
        birthday: res.validation?.birthdayRoc ?? next.birthday,
        sex: res.validation?.sex ?? next.sex,
        patientName: res.validation?.patientName || next.patientName,
        cardId: res.validation?.cardId ?? next.cardId,
        cardIdentity: res.validation?.identityStatus || "",
        icException: "ic",
      };
      if (res.cardBridgeNote) setSeqNote(res.cardBridgeNote);
      const booked = findCardCheckIn(queue, { idNo: seed.idNo, patientId: seed.patientId }, regShift);
      if (booked) {
        beginCheckIn(
          booked,
          {
            ...seedFromEntry(booked),
            patientId: seed.patientId,
            idNo: seed.idNo,
            birthday: seed.birthday,
            sex: seed.sex,
            patientName: seed.patientName,
            cardId: seed.cardId,
            cardIdentity: seed.cardIdentity,
            pharmacist: seed.pharmacist,
            icException: "ic",
            deposit: "",
            noCardReason: "",
            prebook: false,
            payType: "4",
            queueNumber: booked.queueNumber != null ? String(booked.queueNumber) : "",
            visitClock: booked.slotTime || seed.visitClock,
          },
          true,
        );
        return;
      }
      const otherNote = otherShiftAppointmentNote(queue, { idNo: seed.idNo }, regShift);
      if (otherNote) setSeqNote([res.cardBridgeNote, otherNote].filter(Boolean).join(" "));
      offerQueueNumber(regShift, (n) => {
        setConfirmForm({ ...seed, queueNumber: String(n) });
        setConfirmOpen(true);
      });
    } catch (e) {
      setConfirmForm(next);
      setConfirmOpen(true);
      setConfirmError(e instanceof Error ? e.message : "讀卡失敗");
      setCardDiagnose(e instanceof CardReadError ? e.diagnose : null);
    }
  }, [apiMode, beginCheckIn, offerQueueNumber, queue, readCardRegisterPatient, regShift]);

  const applyRegisterHub = (label: string) => {
    const act = registerHubAction(label);
    if (act.kind === "readCard") {
      void handleReadCardConfirm();
      return;
    }
    if (act.kind === "icInfo") {
      setIcInfoOpen(true);
      return;
    }
    if (act.kind === "go") {
      navigate(act.path);
      return;
    }
    if (act.kind === "referral") {
      tellShell("轉診單在診療的看診畫面才開。");
      return;
    }
    if (act.kind === "cloud") {
      openNhiCloudRx();
      return;
    }
    if (act.kind === "allergy") {
      tellShell("過敏資料在診療作業，請到診療按 F5");
      return;
    }
    if (act.kind === "say") {
      tellShell(act.text);
      return;
    }
    if (act.kind === "refund") {
      setRefundOpen(true);
      return;
    }
    setStubId(act.id);
  };

  const confirmSaveRegister = async (allowDuplicate = false) => {
    const hits = pendingDuplicateHits(queue, confirmForm, regShift);
    if (!allowDuplicate && hits.length) {
      dupGo.current = () => {
        setDupAsk(null);
        void confirmSaveRegister(true);
      };
      setDupAsk(hits);
      return;
    }
    let bureauSameDay = false;
    setConfirmError(null);
    const skipSeq =
      Boolean(confirmForm.prebook) ||
      isDepositHold(confirmForm) ||
      confirmForm.icException === "selfPay";
    if (!skipSeq) setSeqBusy(true);
    setBusy(true);
    try {
      const depositHold = isDepositHold(confirmForm);
      const appointment = Boolean(confirmForm.prebook);
      const toSave = {
        ...(depositHold
          ? {
              ...confirmForm,
              noCardReason: "",
              deposit: confirmForm.deposit.trim() || loadClinicRegisterDefaults().depositAmount,
            }
          : confirmForm),
        shift: regShift,
        visitClock: normalizeClock(confirmForm.visitClock || nowClock()),
        confirmDuplicate: allowDuplicate,
      };
      if (toSave !== confirmForm) setConfirmForm(toSave);
      await submitRegisterEdit(toSave, (fields) => {
        const { seqNote: note, ...rest } = fields;
        setConfirmForm((prev) => ({ ...prev, ...rest }));
        setSeqNote(note);
        setSeqBusy(false);
        if ((note || "").includes("\u540c\u65e5\u5c31\u8a3a")) bureauSameDay = true;
      }, incoming.ask);
      if (confirmForm.pharmacist.trim()) {
        const prev = loadClinicSession();
        saveClinicSession({
          date: currentDate,
          pharmacist: confirmForm.pharmacist.trim(),
          shift: prev?.shift || "上午",
          dept: prev?.dept || "皮膚科",
        });
      }
      setConfirmOpen(false);
      if (toSave.encounterId) return;
      if (hits.length || bureauSameDay) setSameDayFlash(true);
      if (depositHold) {
        setDepositAsk({
          name: toSave.patientName,
          medicalNo: "",
          idNo: toSave.idNo,
          birthday: toSave.birthday,
          deposit: toSave.deposit || "\u2014",
          regFee: toSave.regFee || "\u2014",
          date: currentDate,
        });
      } else {
        tellShell(appointment ? "已預約進清單" : "已掛號進清單");
      }
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : "掛號失敗");
    } finally {
      setSeqBusy(false);
      setBusy(false);
    }
  };

  const answerInsert = (yes: boolean) => {
    const cur = insertAsk;
    if (!cur) return;
    setInsertAsk(null);
    cur.go(yes ? cur.gap : cur.tail);
  };

  const onPatientPicked = (hit: PatientHit) => {
    setFinderOpen(false);
    const booked = findWaitingAppointment(queue, { patientId: hit.id, idNo: hit.idNo }, regShift);
    if (booked) {
      beginCheckIn(booked, {
        ...seedFromEntry(booked),
        patientId: hit.id,
        idNo: hit.idNo,
        birthday: hit.birthdayRoc || isoBirthDateToRoc(hit.birthDateIso),
        sex: hit.sex || "F",
        patientName: hit.name,
        icException: "deposit",
        noCardReason: "",
        deposit: loadClinicRegisterDefaults().depositAmount,
        prebook: false,
        payType: "4",
        pharmacist: lastPharmacist(),
        queueNumber: booked.queueNumber != null ? String(booked.queueNumber) : "",
        visitClock: booked.slotTime || "",
      });
      return;
    }
    const otherNote = otherShiftAppointmentNote(queue, { patientId: hit.id, idNo: hit.idNo }, regShift);
    if (otherNote) setSeqNote(otherNote);
    const seed = seedFromPatientHit(hit);
    offerQueueNumber(regShift, (n) =>
      openConfirmFromSeed({ ...seed, queueNumber: String(n), shift: regShift }),
    );
  };

  const handlePrebook = async (insert: boolean, allowDuplicate = false) => {
    if (!selected) {
      tellShell("這個時段還沒有選定的掛號（或先讀卡掛號）。");
      return;
    }
    if (!allowDuplicate) {
      const hits = pendingDuplicateHits(
        queue,
        {
          patientId: selected.patientId,
          idNo: selected.idNo,
          queueNumber: selected.queueNumber != null ? String(selected.queueNumber) : "",
        },
        regShift,
      );
      if (hits.length) {
        dupGo.current = () => {
          setDupAsk(null);
          void handlePrebook(insert, true);
        };
        setDupAsk(hits);
        return;
      }
    }
    const typedInsert = Number(insertNo);
    const insertAt = insert ? (typedInsert > 0 ? typedInsert : selected.queueNumber) : undefined;
    setBusy(true);
    try {
      await addPrebook(
        {
          idNo: selected.idNo || "",
          birthday: isoBirthDateToRoc(selected.birthday) || (selected.birthday || "").replace(/\D/g, "").slice(0, 7),
          sex: selected.sex || "F",
          patientName: selected.patientDisplay,
          reasonText: "",
          confirmDuplicate: allowDuplicate,
        },
        selected.slotTime || "",
        insertAt,
      );
      tellShell(insert ? `已插號於序 ${insertAt}（其後序號 +1）` : "已預掛，清單「預」欄為預。");
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "預掛失敗");
    } finally {
      setBusy(false);
    }
  };

  const openDeleteDialog = () => {
    if (!selectedId) {
      tellShell("這個時段還沒有選定的掛號。");
      return;
    }
    setDeleteError(null);
    setDeleteOpen(true);
  };

  const closePatientEdit = () => {
    setPatientEditOpen(false);
    setFinderPatient(null);
  };

  const openPatientEdit = () => {
    if (!selected?.patientId) {
      tellShell("這個時段還沒有選定的掛號。");
      return;
    }
    setFinderPatient(null);
    setPatientEditOpen(true);
  };

  const patientEditSeed = useMemo((): PatientEditSeed | null => {
    if (patientEditOpen && finderPatient?.patientId) return finderPatient;
    if (!selected?.patientId) return null;
    return {
      patientId: selected.patientId,
      name: selected.patientDisplay,
      idNo: selected.idNo || "",
      birthday: isoBirthDateToRoc(selected.birthday) || (selected.birthday || "").replace(/\D/g, "").slice(0, 7),
      sex: selected.sex || "",
      medicalNo: selected.medicalNo || "",
    };
  }, [patientEditOpen, finderPatient, selected]);

  const runRegisterShortcut = (action: (typeof REGISTER_SHORTCUT_BAR)[number]["action"]) => {
    switch (action) {
      case "register":
        setRegisterOptionsOpen(true);
        break;
      case "registerEdit":
        if (!selected) {
          tellShell("這個時段還沒有選定的掛號。");
          return;
        }
        openConfirmFromSeed(seedFromEntry(selected));
        break;
      case "refundDeposit":
        setRefundOpen(true);
        break;
      case "editPatient":
        openPatientEdit();
        break;
      case "printVisit":
        if (!selected) {
          tellShell("\u9019\u500b\u6642\u6bb5\u9084\u6c92\u6709\u9078\u5b9a\u7684\u639b\u865f\u3002");
          return;
        }
        setPrintMenuOpen(true);
        break;
      case "receipt":
        if (!selected) {
          tellShell("這個時段還沒有選定的掛號。");
          return;
        }
        try {
          openPrintPreview({
            kind: "receipt",
            title: `收據_${selected.patientDisplay || "未命名"}`,
            patientName: selected.patientDisplay,
            medicalNo: selected.medicalNo,
            lines: [
              { label: "掛號費", value: String(selected.regFee ?? "—") },
              { label: "藥費", value: String(selected.drugFee ?? "—") },
              { label: "押金", value: String(selected.deposit ?? "—") },
              { label: "總計", value: String(selected.totalFee ?? "—") },
            ],
          });
        } catch {
          setStubId("receipt");
        }
        break;
      case "deleteReg":
        openDeleteDialog();
        break;
      case "emrLookup":
        navigate("/emr-lookup");
        break;
      case "readCard":
        void handleReadCardConfirm();
        break;
      case "escapeHome":
        navigate("/");
        break;
      default:
        break;
    }
  };

  useEscLayer([
    { open: newPatientQuery != null, close: () => setNewPatientQuery(null) },
    { open: checkInAsk != null, close: () => setCheckInAsk(null) },
    { open: insertAsk != null, close: () => answerInsert(false) },
    { open: finderOpen, close: () => setFinderOpen(false) },
    { open: confirmOpen, close: () => setConfirmOpen(false) },
    { open: patientEditOpen, close: closePatientEdit },
    { open: deleteOpen, close: () => setDeleteOpen(false) },
    { open: icInfoOpen, close: () => setIcInfoOpen(false) },
    { open: pharmacistOpen, close: () => setPharmacistOpen(false) },
    { open: !!stubId, close: () => setStubId(null) },
    { open: printMenuOpen, close: () => setPrintMenuOpen(false) },
    { open: registerOptionsOpen, close: () => setRegisterOptionsOpen(false) },
    { open: true, close: () => navigate("/") },
  ]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") return;
      if (finderOpen || newPatientQuery != null || checkInAsk != null || confirmOpen || deleteOpen || stubId || icInfoOpen || pharmacistOpen || registerOptionsOpen || patientEditOpen || printMenuOpen) {
        return;
      }
      const tag = (ev.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (ev.key === "F2") {
        ev.preventDefault();
        setRegisterOptionsOpen(true);
        return;
      }
      if (ev.key === "F3") {
        ev.preventDefault();
        runRegisterShortcut("registerEdit");
        return;
      }
      if (ev.key === "F4") {
        ev.preventDefault();
        runRegisterShortcut("refundDeposit");
        return;
      }
      if (ev.key === "F5") {
        ev.preventDefault();
        runRegisterShortcut("editPatient");
        return;
      }
      if (ev.key === "F6") {
        ev.preventDefault();
        runRegisterShortcut("printVisit");
        return;
      }
      if (ev.key === "F7") {
        ev.preventDefault();
        runRegisterShortcut("deleteReg");
        return;
      }
      if (ev.key === "F8") {
        ev.preventDefault();
        navigate("/emr-lookup");
        return;
      }
      if (ev.key === "F11") {
        ev.preventDefault();
        void handleReadCardConfirm();
        return;
      }
      if (ev.key === "F9") {
        ev.preventDefault();
        void handleReadCardConfirm();
        return;
      }
      if (ev.key === "Delete" && !typing) {
        ev.preventDefault();
        openDeleteDialog();
        return;
      }
      if (ev.key === "Enter" && !typing && selected) {
        ev.preventDefault();
        openConfirmFromSeed(seedFromEntry(selected));
        return;
      }
      if (ev.altKey && !typing) {
        const k = ev.key.toLowerCase();
        const altMap: Record<string, HisStubId | "prebook" | "add" | "edit" | "home"> = {
          v: "vaccine",
          h: "virtual",
          c: "chronic",
          f: "prebook",
          s: "sale",
          i: "refund",
          k: "track",
          a: "add",
          e: "edit",
          x: "home",
        };
        const hit = altMap[k];
        if (hit) {
          ev.preventDefault();
          if (hit === "prebook") void handlePrebook(false);
          else if (hit === "add") navigate("/patients?add=1");
          else if (hit === "edit") {
            openPatientEdit();
          } else if (hit === "home") navigate("/");
          else setStubId(hit);
          return;
        }
      }
      if (typing) return;
      if (ev.key === "f" || ev.key === "F") {
        ev.preventDefault();
        void handlePrebook(false);
      }
      if (ev.key === "a" || ev.key === "A") {
        ev.preventDefault();
        navigate("/patients?add=1");
      }
      if (ev.key === "e" || ev.key === "E") {
        ev.preventDefault();
        openPatientEdit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    navigate,
    confirmOpen,
    finderOpen,
    deleteOpen,
    selected,
    apiMode,
    stubId,
    icInfoOpen,
    pharmacistOpen,
    registerOptionsOpen,
    patientEditOpen,
    printMenuOpen,
    handleReadCardConfirm,
  ]);

  /** 清單跟底下選的時段走，不把上午下午晚上混在一起 */
  const filteredQueue = useMemo(
    () =>
      queue.filter((e) => {
        const shift = (e.shift || "").trim() || shiftFromClock(e.slotTime || "");
        return shift === regShift;
      }),
    [queue, regShift],
  );

  const displayQueue = useMemo(() => {
    const sorted = [...filteredQueue].sort((a, b) => {
      if (!sortField) return compareClinicQueue(a, b);
      return regiCell(a, sortField).localeCompare(regiCell(b, sortField), "zh-Hant", { numeric: true });
    });
    if (!sortField) return sorted;
    return sortAsc ? sorted : [...sorted].reverse();
  }, [filteredQueue, sortField, sortAsc]);

  const displayQueueRef = useRef(displayQueue);
  displayQueueRef.current = displayQueue;
  const onQueueIndex = useCallback((i: number) => {
    const row = displayQueueRef.current[i];
    if (row) setSelectedId(row.encounterId);
  }, []);
  const queueIndex = displayQueue.findIndex((e) => e.encounterId === selectedId);
  useEffect(() => {
    if (filteredQueue.length === 0) {
      if (selectedId) setSelectedId(null);
      return;
    }
    if (filteredQueue.some((e) => e.encounterId === selectedId)) {
      if (preferAfterDeleteRef.current && preferAfterDeleteRef.current === selectedId) {
        preferAfterDeleteRef.current = null;
      }
      return;
    }
    const wanted = preferAfterDeleteRef.current;
    if (wanted !== null) {
      preferAfterDeleteRef.current = null;
      if (wanted && filteredQueue.some((e) => e.encounterId === wanted)) {
        setSelectedId(wanted);
        const id = wanted;
        requestAnimationFrame(() => {
          queueListRef.current
            ?.querySelector<HTMLElement>(`[data-qid="${CSS.escape(id)}"]`)
            ?.scrollIntoView({ block: "nearest" });
        });
        return;
      }
      setSelectedId(null);
      return;
    }
    const last = filteredQueue.reduce((best, row) =>
      (Number(row.queueNumber) || 0) >= (Number(best.queueNumber) || 0) ? row : best,
    );
    setSelectedId(last.encounterId);
    const id = last.encounterId;
    requestAnimationFrame(() => {
      queueListRef.current
        ?.querySelector<HTMLElement>(`[data-qid="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }, [filteredQueue, selectedId]);
  useListNav({
    active: !(
      finderOpen ||
      confirmOpen ||
      deleteOpen ||
      stubId ||
      registerOptionsOpen ||
      patientEditOpen ||
      insertAsk
    ),
    length: displayQueue.length,
    index: queueIndex,
    onIndex: onQueueIndex,
    scrollerRef: queueListRef,
    wheelRows: 1,
  });

  const waiting = filteredQueue.filter((e) => e.queueStatus === "waiting").length;
  const finishedCount = filteredQueue.filter((e) => e.queueStatus === "finished").length;
  const noShowCount = filteredQueue.filter((e) => e.queueStatus === "no_show").length;
  const inProgress = filteredQueue.filter((e) => e.queueStatus === "in_progress").length;

  return (
    <div
      className="flex h-screen flex-col overflow-hidden text-black select-none"
      style={{ ...hisFontStyle, background: HIS.chrome }}
    >
      {incoming.dialog}
      <HisWinTitle
        title={`掛號作業　${regShift}　全部:${filteredQueue.length}　完診:${finishedCount}　候診:${waiting}${inProgress ? `　暫診:${inProgress}` : ""}${noShowCount ? `　缺診:${noShowCount}` : ""}`}
        trailing={
          <button
            type="button"
            className="border border-white/40 bg-white/15 px-1.5 text-[10px] font-bold hover:bg-white/25"
            onClick={() => navigate("/")}
          >
            Esc 大廳
          </button>
        }
      />

      {(error || localError || shellNotice) && (
        <div className="shrink-0 px-2 py-1 text-xs font-bold">
          {error && (
            <p className="rounded border border-red-300 bg-red-100 px-2 py-0.5 text-red-800">
              {error}（請確認後端 API 已啟動）
            </p>
          )}
          {localError && (
            <p className="rounded border border-red-300 bg-red-100 px-2 py-0.5 text-red-800">{localError}</p>
          )}
          {shellNotice && (
            <p className="rounded border border-[#80C080] bg-[#E8F8E8] px-2 py-0.5 text-[#004D00]">{shellNotice}</p>
          )}
        </div>
      )}

      <div
        className="flex shrink-0 flex-wrap items-center gap-2 border-b px-2 py-0.5 text-[11px] font-bold"
        style={{ borderColor: HIS.chromeBorder, background: HIS.chrome }}
      >
        {(
          [
            ["birthday", "生日", birthdayQ, setBirthdayQ, 88],
            ["idNo", "身分證", idNoQ, setIdNoQ, 108],
            ["phone", "電話", phoneQ, setPhoneQ, 96],
          ] as const
        ).map(([k, lab, val, setVal, width]) => (
          <label key={k} className="flex items-center gap-1">
            <span>{lab}</span>
            <input
              className="border bg-white px-1 font-mono font-normal outline-none"
              style={{
                borderColor: HIS.chromeBorder,
                height: 20,
                color: HIS.inputBlue,
                width,
              }}
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  openFinder(val.trim() || searchQuery);
                }
              }}
              ref={k === "idNo" ? searchRef : undefined}
            />
          </label>
        ))}
        <span className="text-[#404040]">欠款 —</span>
        <div className="ml-auto flex items-center gap-1">
          {[
            { ic: "🔍", lab: "查閱掛號", fn: () => openFinder(searchQuery) },
            { ic: "💊", lab: "更改藥師", fn: () => setPharmacistOpen(true) },
            { ic: "💳", lab: "F9 讀卡", fn: () => void handleReadCardConfirm() },
          ].map((b) => (
            <button
              key={b.lab}
              type="button"
              className="w-[52px] text-center text-[10px] font-bold"
              onClick={b.fn}
            >
              <div
                className="mx-auto mb-0.5 grid h-7 w-9 place-items-center border text-[14px]"
                style={{
                  borderColor: "#404040",
                  background: "linear-gradient(180deg,#fff,#d8d4c8)",
                }}
              >
                {b.ic}
              </div>
              {b.lab}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={queueListRef}
        className="min-h-0 flex-1 overflow-auto bg-white"
        style={{ fontFamily: HIS_FONT }}
      >
        <table
          className="w-full min-w-max border-collapse leading-none text-black"
          style={{ fontFamily: HIS_FONT }}
        >
          <thead
            className="sticky top-0 z-10 select-none text-black"
            style={{ background: "#D8D4C8" }}
          >
            <tr style={{ height: HIS.row.listHeader }}>
              {REGI_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="cursor-pointer border px-0.5 py-0 text-left font-bold hover:bg-[#C8C4B8]"
                  style={{
                    borderColor: HIS.chromeBorder,
                    fontSize: HIS.fs.secondary,
                    height: HIS.row.listHeader,
                    background: "#D8D4C8",
                  }}
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}
                  {sortField === col.key ? (sortAsc ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayQueue.map((e, rowIdx) => {
              const selected = selectedId === e.encounterId;
              const alt = rowIdx % 2 === 1;
              const finished = e.queueStatus === "finished" || e.queueStatus === "no_show";
              const waiting = e.queueStatus === "waiting";
              return (
              <tr
                key={e.encounterId}
                data-list-row=""
                data-qid={e.encounterId}
                onClick={() => setSelectedId(e.encounterId)}
                onDoubleClick={() => openConfirmFromSeed(seedFromEntry(e))}
                className="cursor-pointer leading-none"
                style={{
                  height: HIS.row.list,
                  background: queueRowBackground(
                    e.visitKind,
                    selected,
                    selected
                      ? "#7FFFFF"
                      : finished
                        ? HIS.rowFinished
                        : waiting
                          ? HIS.rowWaiting
                          : alt
                            ? HIS.rowAlt
                            : "#FFFFFF",
                  ),
                  color: finished && !selected ? "#666666" : "#000000",
                }}
              >
                {REGI_COLUMNS.map((col) => {
                  const isPrimary =
                    col.key === "patientDisplay" ||
                    col.key === "patientName" ||
                    col.key === "diseaseName";
                  return (
                  <td
                    key={col.key}
                    className="whitespace-nowrap border px-0.5 py-0 leading-none"
                    style={{
                      borderColor: "#A0A0A0",
                      fontSize: isPrimary ? HIS.fs.primary : HIS.fs.body,
                      fontWeight: isPrimary ? 700 : 400,
                      textAlign: col.key === "doneMark" ? "center" : undefined,
                      background:
                        col.key === "patientDisplay" && isFirstVisit(e.regCc) ? FIRST_VISIT_BG : undefined,
                    }}
                  >
                    {col.key === "doneMark" ? (
                      <DoneMarkCell entry={e} />
                    ) : (
                    <span
                      style={{
                        color: col.key === "preVisit" && visitListMark(e, { appointmentWhileWaiting: false }) ? "#800080" : undefined,
                        fontWeight: col.key === "preVisit" ? 700 : undefined,
                      }}
                    >
                      {regiCell(e, col.key)}
                    </span>
                    )}
                  </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div
        className="flex shrink-0 flex-wrap items-center gap-2 border-t px-2 py-0.5 text-[12px] font-bold"
        style={{ borderColor: HIS.chromeDark, background: HIS.chrome, fontFamily: HIS_FONT }}
      >
        <label className="flex items-center gap-1">
          <span>掛號日期</span>
          <HisRocDateField
            value={isoToRoc(currentDate)}
            onChange={(roc) => {
              const iso = rocToIso(roc);
              if (!iso) return;
              setCurrentDate(iso);
              const sess = loadClinicSession();
              if (sess) saveClinicSession({ ...sess, date: iso, shift: regShift });
            }}
          />
        </label>
        <label className="flex items-center gap-1">
          <span>時段</span>
          <select
            className="border bg-white px-1 font-bold outline-none"
            style={{ borderColor: HIS.chromeBorder, height: 22, color: HIS.inputBlue }}
            value={regShift}
            onChange={(e) => {
              const next = e.target.value as ClinicSession["shift"];
              setRegShift(next);
              const sess = loadClinicSession();
              if (sess) saveClinicSession({ ...sess, shift: next });
            }}
          >
            <option value="上午">1.上午</option>
            <option value="下午">2.下午</option>
            <option value="晚上">3.晚上</option>
          </select>
        </label>
        <button
          type="button"
          disabled={careBusy}
          className="border border-[#808080] bg-[#D4D0C8] px-2 py-0.5 text-[12px] font-bold disabled:opacity-50"
          onClick={() => loadCareOnline(currentDate)}
        >
          {careBusy ? "載入中…" : "載入照護線上"}
        </button>
        <span>
          看診中: {roomLabel(selected?.room || "1")} {pharmacistDisplayName(selected?.pharmacist || lastPharmacist(), staffPeople, selected?.pharmacist || lastPharmacist()) || "—"}
        </span>
        <label className="flex items-center gap-1">
          <span>插號</span>
          <input
            className="w-10 border bg-white px-1 font-mono outline-none"
            style={{ borderColor: HIS.chromeBorder, height: 20, color: HIS.inputBlue }}
            value={insertNo}
            onChange={(e) => setInsertNo(e.target.value.replace(/\D/g, "").slice(0, 3))}
            title="插號序；預掛時用此序插入"
          />
        </label>
      </div>

      <VisitPrintDialog
        open={printMenuOpen}
        patientLabel={selected ? `${selected.patientDisplay || ""} ${selected.medicalNo || ""}`.trim() : ""}
        onClose={() => setPrintMenuOpen(false)}
        onDeposit={() => {
          if (!selected) return;
          setPrintMenuOpen(false);
          openDepositSlip(selected, currentDate);
        }}
        onReceipt={() => {
          if (!selected) return;
          setPrintMenuOpen(false);
          void openSavedVisitReceipt(selected, currentDate).catch((err: unknown) => {
            tellShell(err instanceof Error ? err.message : "\u6536\u64da\u6253\u4e0d\u958b");
          });
        }}
      />
      {depositAsk && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
          <div
            className="w-[22rem] border-2 bg-[#ECE9D8] p-3 shadow-lg"
            style={{ borderColor: "#404040", fontFamily: HIS_FONT }}
          >
            <h3 className="mb-2 text-[14px] font-bold">無卡掛號已存檔</h3>
            <p className="mb-3 text-[12px]">
              {depositAsk.name || "病患"}　押金 {depositAsk.deposit} 元。是否列印押金單？
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="border px-3 py-1 text-[12px] font-bold"
                style={{ borderColor: "#004d00", background: "#004d00", color: "#fff" }}
                onClick={() => {
                  openPrintPreview({
                    kind: "receipt",
                    layout: "sheet",
                    setupId: "deposit",
                    title: "\u62bc\u91d1\u55ae",
                    lines: [],
                    bodyHtml: buildDepositSlipHtml({
                      clinicName: readLocalClinicBundle().profile.clinicName,
                      patientName: depositAsk.name,
                      medicalNo: depositAsk.medicalNo,
                      idNo: depositAsk.idNo,
                      birthday: depositAsk.birthday,
                      date: depositAsk.date,
                      deposit: depositAsk.deposit,
                      ...depositPrintOptions(findPrintSetup(loadPrintSettings(), "deposit")),
                    }),
                  });
                  setDepositAsk(null);
                  tellShell("已開押金單");
                }}
              >
                是，印押金單
              </button>
              <button
                type="button"
                className="border px-3 py-1 text-[12px] font-bold"
                style={{ borderColor: "#808080", background: "#fff" }}
                onClick={() => {
                  setDepositAsk(null);
                  tellShell("已掛號進清單（不印押金單）");
                }}
              >
                否
              </button>
            </div>
          </div>
        </div>
      )}

      <ClinicShortcutBar items={REGISTER_SHORTCUT_BAR} onActivate={runRegisterShortcut} />

      <RegisterOptionsDialog
        open={registerOptionsOpen}
        onClose={() => setRegisterOptionsOpen(false)}
        initialQuery={searchQuery}
        pharmacist={lastPharmacist()}
        selectedLabel={
          selected
            ? `${selected.patientDisplay || ""} [${selected.medicalNo || ""}] 案件:${selected.caseNo || "—"} 序:${selected.queueNumber ?? "—"}`
            : undefined
        }
        onIcRegister={() => void handleReadCardConfirm()}
        onPatientPicked={onPatientPicked}
        onSearchPatients={(q) => openFinder(q)}
        onNoCardRegister={(q) => {
          openFinder(q || searchQuery);
        }}
        onEditSelected={() => {
          /* Register page: edit selected via existing F3 path if any */
        }}
        onIcRelated={applyRegisterHub}
        onOtherQuery={applyRegisterHub}
        omit={["轉診"]}
      />
      <PatientEditDialog
        open={patientEditOpen}
        onClose={closePatientEdit}
        seed={patientEditSeed}
        onSaved={() => navigate("/clinic")}
      />

      <PatientFinderDialog
        open={finderOpen}
        paused={patientEditOpen}
        initialQuery={finderSeed}
        onClose={() => setFinderOpen(false)}
        onSelect={onPatientPicked}
        allowCreate
        onCreate={(q) => setNewPatientQuery(q)}
        onEdit={(hit) => {
          setFinderPatient({
            patientId: hit.id,
            name: hit.name,
            idNo: hit.idNo,
            birthday: hit.birthdayRoc,
            sex: hit.sex,
            medicalNo: hit.medicalNo,
            phone: hit.phone,
          });
          setPatientEditOpen(true);
        }}
      />
      <NewPatientDialog
        open={newPatientQuery != null}
        query={newPatientQuery || ""}
        onClose={() => setNewPatientQuery(null)}
        onCreated={(hit) => {
          setNewPatientQuery(null);
          onPatientPicked(hit);
        }}
      />

      <AppointmentCheckInDialog
        open={checkInAsk != null}
        onYes={() => {
          const cur = checkInAsk;
          setCheckInAsk(null);
          if (!cur) return;
          openConfirmFromSeed({
            ...cur.seed,
            encounterId: cur.encounterId,
            queueNumber: cur.queueNumber,
            visitClock: cur.visitClock || cur.seed.visitClock,
            prebook: false,
            shift: regShift,
            ...(cur.fromCard ? { icException: "ic" as const, deposit: "", noCardReason: "" } : {}),
          }, true);
        }}
        onNo={() => setCheckInAsk(null)}
      />
      <InsertNumberDialog
        open={insertAsk != null}
        gap={insertAsk?.gap ?? 0}
        onYes={() => answerInsert(true)}
        onNo={() => answerInsert(false)}
      />

      <RegisterConfirmDialog
        open={confirmOpen}
        encounterDate={currentDate}
        busy={busy}
        seqBusy={seqBusy}
        seqNote={seqNote}
        error={confirmError}
        diagnose={cardDiagnose}
        form={confirmForm}
        priceBlankFees={priceBlankFees}
        onChange={(patch) => setConfirmForm((prev) => ({ ...prev, ...patch }))}
        onClose={() => {
          setConfirmOpen(false);
          setCardDiagnose(null);
        }}
        onConfirm={confirmSaveRegister}
        lockedShift={regShift}
        onReadCard={async () => {
          try {
            setConfirmError(null);
            setCardDiagnose(null);
            const res = await readCardRegisterPatient();
            setConfirmForm((prev) => ({
              ...prev,
              patientId: res.patientId,
              idNo: res.validation?.idNo ?? prev.idNo,
              birthday: res.validation?.birthdayRoc ?? prev.birthday,
              sex: res.validation?.sex ?? prev.sex,
              patientName: res.validation?.patientName || prev.patientName,
              cardId: res.validation?.cardId ?? prev.cardId,
              cardIdentity: res.validation?.identityStatus || prev.cardIdentity || "",
              icException: "ic",
              deposit: "",
              noCardReason: "",
              prebook: false,
            }));
            if (res.cardBridgeNote) setSeqNote(res.cardBridgeNote);
          } catch (e) {
            setConfirmError(e instanceof Error ? e.message : "讀卡失敗");
            setCardDiagnose(e instanceof CardReadError ? e.diagnose : null);
          }
        }}
      />

      <SameDayFlash open={sameDayFlash} onClose={() => setSameDayFlash(false)} />
      <SameDayRegisterDialog
        open={dupAsk != null}
        hits={dupAsk || []}
        onConfirm={() => dupGo.current?.()}
        onCancel={() => setDupAsk(null)}
      />
      <DeleteRegisterDialog
        open={deleteOpen}
        busy={deleteBusy}
        error={deleteError}
        patientDisplay={selected?.patientDisplay}
        hasTreatSeq={Boolean(selected?.treatSeq)}
        onClose={() => setDeleteOpen(false)}
        onDelete={async (mode) => {
          if (!selectedId) return;
          setDeleteBusy(true);
          setDeleteError(null);
          try {
            dropChartDraft(selectedId);
            const res = await cancelRegister({ encounterId: selectedId, mode });
            const rows = displayQueueRef.current;
            const idx = rows.findIndex((row) => row.encounterId === selectedId);
            const neighbor = idx >= 0 ? rows[idx + 1] || rows[idx - 1] || null : null;
            preferAfterDeleteRef.current = neighbor?.encounterId ?? "";
            await refreshQueue();
            if (res.localCancelled) setSelectedId(neighbor?.encounterId ?? null);
            else preferAfterDeleteRef.current = null;
            setDeleteOpen(false);
          } catch (e) {
            setDeleteError(e instanceof Error ? e.message : "刪除掛號失敗");
          } finally {
            setDeleteBusy(false);
          }
        }}
      />
      <IcCardInfoDialog
        open={icInfoOpen}
        onClose={() => setIcInfoOpen(false)}
        treatSeq={selected?.treatSeq}
        treatmentNumber={selected?.treatmentNumber}
        treatDateTime={selected?.treatDateTime}
        cardNo={selected?.hcId}
      />
      <ChangePharmacistDialog
        open={pharmacistOpen}
        onClose={() => setPharmacistOpen(false)}
        date={currentDate}
        shift={regShift}
        dept={lastClinicDept()}
        rows={filteredQueue.map((row) => ({
          encounterId: row.encounterId,
          patientId: row.patientId,
          patientDisplay: row.patientDisplay,
          queueNumber: row.queueNumber,
          pharmacist: row.pharmacist,
          paperCard: row.paperCard,
          prebook: row.prebook,
        }))}
        onDone={(message) => {
          tellShell(message);
          void refreshQueue();
        }}
      />
      <HisStubDialog
        stubId={stubId}
        patientDisplay={selected?.patientDisplay}
        values={{
          姓名: selected?.patientDisplay || "",
          病歷號: selected?.medicalNo || "",
          身分證: selected?.idNo || "",
          生日: formatBirthdayRoc(selected?.birthday || ""),
          看診日: currentDate,
          時段: selected?.shift || "",
          診間: roomLabel(selected?.room || "1"),
          卡號: selected?.hcId || "",
          就醫序號: selected?.treatSeq || "",
          就醫識別碼: selected?.treatmentNumber || "",
          掛號費: selected?.regFee || "",
          藥費: selected?.drugFee || "",
          材料費: selected?.materialFee || "",
          診察費: selected?.consultFee || "",
          押金: selected?.deposit || "",
          目前藥師: selected?.pharmacist || "",
          病患: selected?.patientDisplay || "",
        }}
        onClose={() => setStubId(null)}
      />
      <RefundDepositDialog
        open={refundOpen}
        initialIdNo={selected?.idNo}
        onClose={() => setRefundOpen(false)}
        onDone={() => void refreshQueue()}
      />
    </div>
  );
}
