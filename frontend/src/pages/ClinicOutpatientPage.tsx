import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ClinicalAlertsPanel } from "@/components/clinic/ClinicalAlertsPanel";
import { ClinicShortcutBar } from "@/components/clinic/ClinicShortcutBar";
import { ClinicBigPalette } from "@/components/clinic/ClinicBigPalette";
import { QUEUE_FILTERS, type QueueFilterId } from "@/components/clinic/HisRegisterToolBar";
import { ClinicModuleTabs } from "@/components/clinic/ClinicModuleTabs";
import { RegisterOptionsDialog } from "@/components/clinic/RegisterOptionsDialog";
import { PatientEditDialog, type PatientEditSeed } from "@/components/clinic/PatientEditDialog";
import { NewPatientDialog } from "@/components/clinic/NewPatientDialog";
import { CertificateDialog } from "@/components/clinic/CertificateDialog";
import { OutpatientSidebarQueue } from "@/components/clinic/OutpatientSidebarQueue";
import { PatientLookDialog } from "@/components/clinic/PatientLookDialog";
import { ReferralSlipDialog } from "@/components/clinic/ReferralSlipDialog";
import { IcCardInfoDialog } from "@/components/clinic/IcCardInfoDialog";
import {
  pendingDuplicateHits,
  SameDayFlash,
  SameDayRegisterDialog,
  type SameDayHit,
} from "@/components/clinic/SameDayRegisterDialog";
import { ChartPatientHead } from "@/components/clinic/ChartPatientHead";
import {
  ChartVitalsColumn,
  EMPTY_VITALS,
  type ChartVitals,
} from "@/components/clinic/ChartVitalsColumn";
import { ChartQtyPad } from "@/components/clinic/ChartQtyPad";
import {
  CLINIC_CHART_SHORTCUT_BAR,
  CLINIC_LIST_SHORTCUT_BAR,
  CLINIC_MODULE_TABS,
  type ClinicTab,
} from "@/lib/clinicShortcutSets";
import { rxLinesMissingFrom } from "@/lib/dittoRxLines";
import { EncounterQueuePanel } from "@/components/clinic/EncounterQueuePanel";
import { HistoryRxPanel } from "@/components/clinic/HistoryRxPanel";
import { PatientHeaderWidget } from "@/components/clinic/widgets/PatientHeaderWidget";
import { LesionPhotosWidget } from "@/components/clinic/widgets/LesionPhotosWidget";
import { ChiefComplaintWidget } from "@/components/clinic/widgets/ChiefComplaintWidget";
import { DiagnosesWidget } from "@/components/clinic/widgets/DiagnosesWidget";
import { CurrentRxWidget } from "@/components/clinic/widgets/CurrentRxWidget";
import {
  ChartContextRail,
  type ChartEditFocus,
} from "@/components/clinic/ChartContextRail";
import { useI18n } from "@/i18n/I18nContext";
import { useClinicCatalog } from "@/hooks/useClinicCatalog";
import { useClinicWorkspace } from "@/hooks/useClinicWorkspace";
import { useDefaultUiConfig } from "@/hooks/useDefaultUiConfig";
import type { DiagnosisRow, HistoryVisit, RxLine } from "@/mocks";
import { emptyRegisterForm, type RegisterEditForm } from "@/components/clinic/RegisterEditDialog";
import { RegisterConfirmDialog } from "@/components/clinic/RegisterConfirmDialog";
import { PatientFinderDialog } from "@/components/clinic/PatientFinderDialog";
import { DeleteRegisterDialog } from "@/components/clinic/DeleteRegisterDialog";
import { formatBirthdayRoc, type PatientHit } from "@/lib/patientSearch";
import {
  HisStubDialog,
  type HisStubId,
} from "@/components/clinic/HisStubDialog";
import { ClinicSessionGate } from "@/components/clinic/ClinicSessionGate";
import {
  lastClinicDept,
  lastPharmacist,
  loadClinicSession,
  saveClinicSession,
  shiftForClock,
  type ClinicSession,
} from "@/lib/clinicSession";
import {
  applyClinicDrugDisplayNames,
  resolvePackageLines,
} from "@/utils/catalogRx";
import { cancelRegister, writeVisitToCard, CardReadError, type CardFaultReport, patchEncounterReg, previewVisitCase, fetchStaff, saveReferralSlip, claimChartOpen, releaseChartOpen, CHART_IN_USE } from "@/api/clinicApi";
import { dropChartDraft } from "@/lib/chartDraft";
import { displayCase, prescriptionDays, prescriptionOrders, storedCase } from "@/lib/caseMark";
import { ageYearsMonths } from "@/lib/ageLabel";
import { roomLabel, roomNumber } from "@/lib/roomMark";
import { LobbyPage } from "@/pages/LobbyPage";
import { ReferralReplyDialog, useIncomingReferralAsk } from "@/components/clinic/ReferralAcceptDialogs";
import { loadLocalDeviceMeta } from "@/lib/clinicDevice";
import { appendChiefNotes, mapDiagnosisList, readyIcd9, resolveIcd9Row } from "@/lib/icdCrosswalk";
import { loadClinicRegisterDefaults } from "@/lib/clinicProfile";
import { isDepositHold } from "@/lib/registerModes";
import { openPrintPreview } from "@/lib/printJob";
import { depositPrintOptions, findPrintSetup, loadPrintSettings, partOn } from "@/lib/printSettings";
import { openReleaseRxIfWanted } from "@/lib/releaseRx";
import { giveDaysBesideLabs, labSlipLines, openDelegateLabSlip } from "@/lib/delegateLabSlip";
import { openDepositSlip } from "@/lib/visitReceiptPrint";
import { VisitPrintDialog } from "@/components/clinic/VisitPrintDialog";
import { buildSimpleSlipHtml, storedSelfPayText, visitCashParts } from "@/lib/simpleSlip";
import { buildDepositSlipHtml } from "@/lib/clinicPrintDocs";
import { doctorDisplayName, pharmacistDisplayName, pickClinicDoctor, type ClinicStaffLike } from "@/lib/doctorName";
import { openNhiCloudRx } from "@/lib/nhiCloud";
import { registerHubAction } from "@/lib/registerHubActions";
import { RefundDepositDialog } from "@/components/clinic/RefundDepositDialog";
import { readLocalClinicBundle } from "@/lib/clinicProfile";
import {
  VisitSaveConfirmPanel,
  buildVisitSaveDraft,
  type VisitSaveDraft,
} from "@/components/clinic/VisitSaveConfirmPanel";
import { HIS, HIS_FONT, hisFontStyle } from "@/lib/hisTheme";
import { findCardCheckIn, findWaitingAppointment, otherShiftAppointmentNote } from "@/lib/appointmentCheckIn";
import { compareClinicQueue, normalizeClock, nowClock, planQueueNumber, shiftQueueNumbers, showsUploadCircle, skipsCloudWrite } from "@/lib/queueOrder";
import { AppointmentCheckInDialog, InsertNumberDialog, PrebookArriveDialog, PrebookNoCardDialog } from "@/components/clinic/InsertNumberDialog";
import { useEscLayer } from "@/hooks/useEscLayer";

type ChartRailTab = "common" | "full" | "oral" | "waiting" | "history";

/**
 * 診療作業 — 頂部分層（F2 清單｜F3 看診｜F4 歷史｜F5 過敏｜F6 放射）；
 * 底列依清單／看診切換快捷鍵組；清單全幅候診，看診左表單右側候診／歷史／常用。
 */
const PLACEHOLDER_CC = new Set(["門診掛號", "門診登記", "預掛", "預掛 門診掛號"]);

function visibleComplaint(value: string | null | undefined): string {
  const text = (value || "").trim();
  return PLACEHOLDER_CC.has(text) ? "" : text;
}

const CHART_DRAFT_KEY = "psehr.chartDrafts.v1";

type ChartDraft = { cc: string; dx: DiagnosisRow[]; rx: RxLine[] };

function loadChartDrafts(): Record<string, ChartDraft> {
  try {
    const raw = localStorage.getItem(CHART_DRAFT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ChartDraft>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function diagnosisKey(row: { nhiIcd10?: string; icd10?: string; text?: string }): string {
  return (row.nhiIcd10 || row.icd10 || row.text || "").trim().toUpperCase();
}

function diagnosisTaken(
  rows: { nhiIcd10?: string; icd10?: string; text?: string }[],
  row: { nhiIcd10?: string; icd10?: string; text?: string },
  except?: number,
): boolean {
  const key = diagnosisKey(row);
  if (!key) return false;
  return rows.some((item, index) => index !== except && diagnosisKey(item) === key);
}

/** 門診申報 d19–d23：一個主診斷、四個次診斷。 */
const CLAIM_DX_LIMIT = 5;
const CLAIM_DX_FULL =
  "健保申報的診斷最多五個（主診斷加四個次診斷）。多出來的沒有寫進去。";
const CLAIM_DX_SAVE =
  "這筆看診的診斷超過五個。申報只有五格，請先刪到五個以內再存檔。";

function takeDiagnosisSlots(
  base: DiagnosisRow[],
  incoming: DiagnosisRow[],
): { accepted: DiagnosisRow[]; overflow: boolean; duplicateName: string } {
  const accepted: DiagnosisRow[] = [];
  let overflow = false;
  let duplicateName = "";
  for (const item of incoming) {
    if (diagnosisTaken([...base, ...accepted], item)) {
      duplicateName = item.text || item.nhiIcd10 || item.icd10 || "";
      continue;
    }
    if (base.length + accepted.length >= CLAIM_DX_LIMIT) {
      overflow = true;
      break;
    }
    accepted.push({
      ...item,
      id: item.id || `dx-tmp-${Date.now()}-${base.length + accepted.length}`,
    });
  }
  return { accepted, overflow, duplicateName };
}

function readEmrSeek(params: URLSearchParams): ClinicSession | null {
  if (params.get("from") !== "emr" || !params.get("encounter")) return null;
  const date = (params.get("date") || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const shiftRaw = params.get("shift") || "";
  const shift: ClinicSession["shift"] =
    shiftRaw === "下午" || shiftRaw === "晚上" || shiftRaw === "上午" ? shiftRaw : "上午";
  const prev = loadClinicSession();
  return {
    date,
    shift,
    pharmacist: params.get("pharmacist") || prev?.pharmacist || "",
    dept: prev?.dept || lastClinicDept(),
  };
}

export function ClinicOutpatientPage() {
  const t = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const seekBoot = readEmrSeek(searchParams);
  const {
    prefs,
    ccChips,
    sections,
    currentRxColumns,
    defaultUsages,
    queueColumns,
    queueColumnKeys,
  } = useDefaultUiConfig();
  const { catalog } = useClinicCatalog();
  const [session, setSession] = useState<ClinicSession | null>(() => seekBoot ?? loadClinicSession());
  const [entered, setEntered] = useState(seekBoot != null);
  const [gateOpen, setGateOpen] = useState(seekBoot == null);
  const gateLeaveRef = useRef(false);
  const ws = useClinicWorkspace({
    loadWorkspace: true,
    initialDate: seekBoot?.date,
    initialEncounterId: seekBoot ? searchParams.get("encounter") : null,
    queueEnabled: entered || seekBoot != null,
    prefetchDate:
      entered || seekBoot
        ? ""
        : session?.date ||
          `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`,
  });
  const {
    apiMode,
    loading,
    error,
    queue,
    selectedEncounterId,
    setSelectedEncounterId,
    selected,
    allergies,
    diagnoses,
    prevRx,
    historyVisits,
    ensureVisitDetail,
    currentRx: apiCurrentRx,
    patientResource,
    ccFromWs,
    lesionMedia,
    clinicalProfile,
    emptyCurrentRx,
    cloneRxLines,
    handleStatusChange,
    persistChiefComplaint,
    persistVitals,
    persistVisit,
    persistHistoryVisit,
    refreshQueue,
    forgetPatientHistory,
    readCardRegisterPatient,
    submitRegisterEdit,
    ensureAcceptReferralOrder,
    currentDate,
    setCurrentDate,
    queueHints,
    vitalsFromWs,
  } = ws;
  const incoming = useIncomingReferralAsk();
  const [replyAsk, setReplyAsk] = useState<{
    serial: string;
    hosp: string;
    dx: string;
    note: string;
    meds: string;
    patientName: string;
  } | null>(null);
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState("");

  const [queueSearch, setQueueSearch] = useState("");
  const [queueFilter, setQueueFilter] = useState<QueueFilterId>("all");
  const [registerBusy, setRegisterBusy] = useState(false);
  const [lesionOpen, setLesionOpen] = useState(false);
  const [lookOpen, setLookOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [icInfoOpen, setIcInfoOpen] = useState(false);
  const [sameDayFlash, setSameDayFlash] = useState(false);
  const [dupAsk, setDupAsk] = useState<SameDayHit[] | null>(null);
  const dupGo = useRef<(() => void) | null>(null);
  const [currentRxByEncounter, setCurrentRxByEncounter] = useState<Record<string, RxLine[]>>(
    {},
  );
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [ccText, setCcText] = useState("");
  const [showDevPanels, setShowDevPanels] = useState(false);
  const [localDxByEncounter, setLocalDxByEncounter] = useState<
    Record<string, DiagnosisRow[]>
  >({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [chartInUse, setChartInUse] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSpent, setSaveSpent] = useState(false);
  const [activeShortcutKey, setActiveShortcutKey] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [clinicTab, setClinicTab] = useState<ClinicTab>(seekBoot ? "chart" : "list");
  const [registerOptionsOpen, setRegisterOptionsOpen] = useState(false);
  const [patientEditOpen, setPatientEditOpen] = useState(false);
  const [staffPeople, setStaffPeople] = useState<ClinicStaffLike[]>([]);
  useEffect(() => {
    void fetchStaff()
      .then((rows) => setStaffPeople(rows))
      .catch(() => setStaffPeople([]));
  }, []);
  const [finderPatient, setFinderPatient] = useState<PatientEditSeed | null>(null);
  const [leaveToLobby, setLeaveToLobby] = useState(false);
  const [liveCase, setLiveCase] = useState<{ encounterId: string; display: string } | null>(null);
  const [certificateOpen, setCertificateOpen] = useState(false);
  const [otherMenuOpen, setOtherMenuOpen] = useState(false);
  const [chartRailTab, setChartRailTab] = useState<ChartRailTab>("waiting");
  const [historyVisit, setHistoryVisit] = useState<HistoryVisit | null>(null);
  const [saveLayerOpen, setSaveLayerOpen] = useState(false);
  const [cloudAgainAsk, setCloudAgainAsk] = useState(false);
  const [saveDraft, setSaveDraft] = useState<VisitSaveDraft>(() =>
    buildVisitSaveDraft({ selected: null, diagnoses: [], currentRx: [] }),
  );
  const [cardNote, setCardNote] = useState<string | null>(null);
  const [printNote, setPrintNote] = useState<string | null>(null);
  /** 掛號前確認存檔（F2 找人／F9 讀卡），F3 修改已掛的也開這一頁 */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [priceBlankFees, setPriceBlankFees] = useState(false);
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
  const [prebookAskId, setPrebookAskId] = useState<string | null>(null);
  const [noCardAskId, setNoCardAskId] = useState<string | null>(null);
  const [confirmForm, setConfirmForm] = useState<RegisterEditForm>(() => emptyRegisterForm());
  const [finderOpen, setFinderOpen] = useState(false);
  const [newPatientQuery, setNewPatientQuery] = useState<string | null>(null);
  const [finderSeed, setFinderSeed] = useState("");
  const queueSearchRef = useRef<HTMLInputElement>(null);
  const [seqBusy, setSeqBusy] = useState(false);
  const [seqNote, setSeqNote] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [depositAsk, setDepositAsk] = useState<{
    name: string;
    medicalNo?: string;
    idNo?: string;
    birthday?: string;
    deposit: string;
    regFee: string;
    date: string;
  } | null>(null);
  const [cardDiagnose, setCardDiagnose] = useState<CardFaultReport | null>(null);
  const [printMenuOpen, setPrintMenuOpen] = useState(false);
  const [chartFocus, setChartFocus] = useState<ChartEditFocus>("history");
  const [dxQuery, setDxQuery] = useState("");
  const [rxQuery, setRxQuery] = useState("");
  const [selectedDxIndex, setSelectedDxIndex] = useState(0);
  const [selectedRxIndex, setSelectedRxIndex] = useState(-1);
  const [seekEnteredBanner, setSeekEnteredBanner] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [stubId, setStubId] = useState<HisStubId | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [chartVitals, setChartVitals] = useState<ChartVitals>(EMPTY_VITALS);
  const [clockText, setClockText] = useState(() =>
    new Date().toLocaleTimeString("zh-TW", { hour12: false }),
  );
  /**
   * Screen edits stay local until F9.
   * A visit that has never been saved keeps 主訴／病名／處置 when leaving, and the
   * queue shows the pause mark. Clearing all three and leaving removes the pause.
   * A visit that already has the check mark asks before leaving; declining keeps
   * the saved chart and does not write the edits.
   */
  const [apiRxOverlay, setApiRxOverlay] = useState<RxLine[] | null>(null);
  const [apiDxOverlay, setApiDxOverlay] = useState<DiagnosisRow[] | null>(null);
  const [visitDrafts, setVisitDrafts] = useState<Record<string, ChartDraft>>(loadChartDrafts);
  useEffect(() => {
    try {
      localStorage.setItem(CHART_DRAFT_KEY, JSON.stringify(visitDrafts));
    } catch {
      /* keep going if this computer cannot store the draft */
    }
  }, [visitDrafts]);
  const ccDirtyRef = useRef(false);
  const chartDirtyRef = useRef(false);
  const [leaveAsk, setLeaveAsk] = useState(false);
  const leaveBoxRef = useRef<HTMLDivElement>(null);
  const leaveIntentRef = useRef<
    | { kind: "list" }
    | { kind: "open"; encounterId: string; opts?: { fromSeek?: boolean; label?: string } }
    | null
  >(null);
  const leaveBypassRef = useRef(false);
  const afterSaveLeaveRef = useRef<(() => void) | null>(null);
  const printSimpleSlipRef = useRef<() => void>(() => {});
  const leaveListAfterPrintRef = useRef(false);
  const closeChartNowRef = useRef<(discard: boolean) => void>(() => {});
  const openLabSheetRef = useRef<() => void>(() => {});
  const finishReply = useCallback(() => {
    setReplyAsk(null);
    setReplyError("");
    const leaveAfter = afterSaveLeaveRef.current;
    afterSaveLeaveRef.current = null;
    if (leaveAfter) leaveAfter();
  }, []);

  useEffect(() => {
    if (!leaveAsk) return;
    const box = leaveBoxRef.current;
    const buttons = box ? Array.from(box.querySelectorAll("button")) : [];
    if (!buttons.length) return;
    let index = 0;
    const paint = () => {
      buttons.forEach((btn, i) => {
        btn.style.background = i === index ? "#FFFF80" : "#F0F0F0";
      });
      buttons[index]?.focus();
    };
    paint();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight" && ev.key !== "Enter") return;
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === "ArrowLeft") index = (index + buttons.length - 1) % buttons.length;
      if (ev.key === "ArrowRight") index = (index + 1) % buttons.length;
      if (ev.key === "Enter") {
        buttons[index]?.click();
        return;
      }
      paint();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [leaveAsk]);

  const entryShift = (e: (typeof queue)[number]) => {
    if (e.shift === "上午" || e.shift === "下午" || e.shift === "晚上") return e.shift;
    const timeLabel = e.slotTime ?? "";
    const parts = timeLabel.split(":");
    const hour = Number(parts[0]);
    const minute = Number(parts[1]);
    if (!Number.isFinite(hour)) return "";
    const clock = new Date();
    clock.setHours(hour, Number.isFinite(minute) ? minute : 0, 0, 0);
    return shiftForClock(clock);
  };

  const shiftQueue = useMemo(() => {
    const wantRoom = roomNumber(session?.room || "1");
    return queue.filter((e) => {
      if (roomNumber(e.room) !== wantRoom) return false;
      if (!session?.shift) return true;
      const sh = entryShift(e);
      if (sh && sh !== session.shift) return false;
      return true;
    });
  }, [queue, session?.shift, session?.room]);

  const filteredQueue = useMemo(() => {
    return shiftQueue
      .filter((e) => {
        if (queueFilter === "waiting") return e.queueStatus === "waiting";
        if (queueFilter === "finished") return e.queueStatus === "finished";
        if (queueFilter === "hold") return e.queueStatus === "in_progress";
        if (queueFilter === "er") return e.treatmentItem === "04" || /急診/.test(e.reasonText || "");
        return true;
      })
      .filter((e) => {
        const q = queueSearch.trim().toLowerCase();
        if (!q) return true;
        const blob = [e.patientDisplay, e.medicalNo, e.reasonText, String(e.queueNumber)]
          .join(" ")
          .toLowerCase();
        return blob.includes(q);
      })
      .slice()
      .sort(compareClinicQueue);
  }, [shiftQueue, queueFilter, queueSearch]);

  const queueForPanel = useMemo(
    () =>
      filteredQueue.map((entry) => {
        const live = liveCase?.encounterId === entry.encounterId ? liveCase.display : "";
        const shown = live || displayCase(entry.caseNo);
        if (!shown || shown === entry.caseNo) return entry;
        return { ...entry, caseNo: shown };
      }),
    [filteredQueue, liveCase],
  );

  const preferAfterDeleteRef = useRef<string | null>(null);

  useEffect(() => {
    if (!entered || shiftQueue.length === 0) return;
    const seekId = searchParams.get("from") === "emr" ? searchParams.get("encounter") || "" : "";
    if (seekId && queue.some((e) => e.encounterId === seekId)) {
      if (selectedEncounterId !== seekId) setSelectedEncounterId(seekId);
      const row = queue.find((e) => e.encounterId === seekId);
      const sh = row ? entryShift(row) : "";
      if ((sh === "上午" || sh === "下午" || sh === "晚上") && session?.shift !== sh) {
        setSession((prev) => (prev ? { ...prev, shift: sh } : prev));
      }
      return;
    }
    const stillThere = shiftQueue.some((e) => e.encounterId === selectedEncounterId);
    if (stillThere) {
      if (preferAfterDeleteRef.current && preferAfterDeleteRef.current === selectedEncounterId) {
        preferAfterDeleteRef.current = null;
      }
      return;
    }
    const wanted = preferAfterDeleteRef.current;
    if (wanted !== null) {
      preferAfterDeleteRef.current = null;
      if (wanted && shiftQueue.some((e) => e.encounterId === wanted)) {
        setSelectedEncounterId(wanted);
        return;
      }
      setSelectedEncounterId(null);
      return;
    }
    const last = shiftQueue.reduce((best, row) =>
      (Number(row.queueNumber) || 0) >= (Number(best.queueNumber) || 0) ? row : best,
    );
    setSelectedEncounterId(last.encounterId);
    requestAnimationFrame(() => queuePanelRef.current?.focus());
  }, [entered, shiftQueue, selectedEncounterId, setSelectedEncounterId, searchParams, queue, session?.shift]);
  const committedFpRef = useRef<Record<string, string>>({});

  const queuePanelRef = useRef<HTMLElement>(null);
  const mainPanelRef = useRef<HTMLElement>(null);
  const historyPanelRef = useRef<HTMLDivElement>(null);
  /** Ignore left-zone onFocus right after clicking 候診／歷史／內服 (unmount focus bounce). */
  const railTabClickGuardRef = useRef(0);
  const lesionSectionRef = useRef<HTMLElement>(null);
  const commandFocusBump = useRef(0);

  const mockCurrentRx =
    (selectedEncounterId && currentRxByEncounter[selectedEncounterId]) ||
    emptyCurrentRx();
  const currentRxRaw = apiMode
    ? (apiRxOverlay ?? apiCurrentRx ?? [])
    : mockCurrentRx;
  // Display names from MEDICAL.MAKING; never collapse same-NHI variants (e.g. BETAMT vs BETAT)
  const currentRx = useMemo(
    () => applyClinicDrugDisplayNames(currentRxRaw, catalog.drugs, catalog.usages),
    [currentRxRaw, catalog.drugs, catalog.usages],
  );
  useEffect(() => {
    const id = selected?.encounterId;
    if (!apiMode || !id || selected?.acceptReferral !== "1") return;
    if ((currentRxRaw || []).some((row) => {
      const code = (row.nhiCode || "").toUpperCase();
      return code === "01038C" || code === "00193C";
    })) return;
    void ensureAcceptReferralOrder(id);
  }, [apiMode, selected?.encounterId, selected?.acceptReferral, currentRxRaw, ensureAcceptReferralOrder]);
  const displayHistoryVisits = useMemo(
    () =>
      historyVisits.map((v) => ({
        ...v,
        medications: applyClinicDrugDisplayNames(v.medications ?? [], catalog.drugs, catalog.usages),
      })),
    [historyVisits, catalog.drugs, catalog.usages],
  );

  const displayDiagnoses = apiMode
    ? (apiDxOverlay ?? diagnoses)
    : [
        ...diagnoses,
        ...(selectedEncounterId ? localDxByEncounter[selectedEncounterId] ?? [] : []),
      ];
  const dxListRef = useRef<DiagnosisRow[]>([]);
  const dxQueueRef = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    const pending = dxListRef.current;
    const visible = displayDiagnoses;
    const pendingExtendsVisible =
      visible.length > 0 &&
      pending.length > visible.length &&
      visible.every((row, index) => diagnosisKey(row) === diagnosisKey(pending[index]));
    if (pendingExtendsVisible) return;
    dxListRef.current = visible;
  }, [displayDiagnoses]);

  const isList = clinicTab === "list";
  const isChart = clinicTab === "chart";
  const needsPatientTab =
    clinicTab === "chart" || clinicTab === "history" || clinicTab === "alerts" || clinicTab === "radiology";

  useEffect(() => {
    if (!needsPatientTab || !selectedEncounterId) return;
    const eid = selectedEncounterId;
    const deviceId = loadLocalDeviceMeta().id;
    let alive = true;
    const beat = () => {
      void claimChartOpen(eid, deviceId).catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof Error && err.message === CHART_IN_USE) {
          setChartInUse(true);
          setClinicTab("list");
        }
      });
    };
    beat();
    const timer = window.setInterval(beat, 15000);
    const onHide = () => releaseChartOpen(eid, deviceId);
    window.addEventListener("pagehide", onHide);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("pagehide", onHide);
      releaseChartOpen(eid, deviceId);
    };
  }, [needsPatientTab, selectedEncounterId]);

  const visitFingerprint = JSON.stringify({
    cc: ccText.trim(),
    dx: displayDiagnoses.map((d) => `${d.icd10}|${d.text}`),
    rx: currentRx.map((r) => `${r.nhiCode}|${r.sig}|${r.days}|${r.qty ?? 1}`),
    vitals: chartVitals,
  });

  const historyFontPx = prefs.historyFontSizePx ?? 15;
  const allergyEmpty = prefs.allergyEmptyText ?? t.allergy.none;

  // Reload edit surface only when switching encounter (not on workspace refresh)
  useEffect(() => {
    if (!selectedEncounterId) return;
    const draft = visitDrafts[selectedEncounterId];
    ccDirtyRef.current = false;
    chartDirtyRef.current = false;
    setSelectedMediaId(null);
    setActionError(null);
    setSelectedDxIndex(0);
    setSelectedRxIndex(0);
    if (draft) {
      ccDirtyRef.current = true;
      chartDirtyRef.current = true; setSaveSpent(false);
      setCcText(draft.cc);
      setApiDxOverlay(draft.dx);
      setApiRxOverlay(draft.rx);
      return;
    }
    setCcText("");
    setApiRxOverlay(null);
    setApiDxOverlay(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore draft once per encounter switch
  }, [selectedEncounterId]);

  useEffect(() => {
    if (ccDirtyRef.current) return;
    if (visitDrafts[selectedEncounterId || ""]) return;
    const wsId = String((ws.encounterResource as { id?: string } | null)?.id || "");
    if (selectedEncounterId && wsId && wsId !== selectedEncounterId) return;
    setCcText(visibleComplaint(ccFromWs));
  }, [ccFromWs, selectedEncounterId, visitDrafts, ws.encounterResource]);

  useEffect(() => {
    setSelectedMediaId(lesionMedia[lesionMedia.length - 1]?.id ?? null);
  }, [selectedEncounterId, lesionMedia]);

  useEffect(() => {
    const w =
      vitalsFromWs.weight ||
      (selected?.weight ? String(selected.weight).replace(/\s*kg/i, "") : "") ||
      "0.0";
    const next = {
      ...EMPTY_VITALS,
      weight: w,
      temperature: vitalsFromWs.temperature || "0.0",
      bpSys: vitalsFromWs.bpSys || "0",
      bpDia: vitalsFromWs.bpDia || "0",
    };
    setChartVitals((prev) =>
      prev.weight === next.weight &&
      prev.temperature === next.temperature &&
      prev.bpSys === next.bpSys &&
      prev.bpDia === next.bpDia
        ? prev
        : next,
    );
  }, [selectedEncounterId, vitalsFromWs, selected?.weight]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setClockText(new Date().toLocaleTimeString("zh-TW", { hour12: false }));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!entered || !apiMode) return;
    let pending = false;
    let last = 0;
    const pull = () => {
      const now = Date.now();
      if (pending || now - last < 700) return;
      last = now;
      pending = true;
      void refreshQueue()
        .catch(() => undefined)
        .finally(() => {
          pending = false;
        });
    };
    window.addEventListener("wheel", pull, { passive: true });
    window.addEventListener("pointerdown", pull);
    return () => {
      window.removeEventListener("wheel", pull);
      window.removeEventListener("pointerdown", pull);
    };
  }, [entered, apiMode, refreshQueue]);

  const runAction = useCallback(async (fn: () => Promise<void>) => {
    setSaving(true);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "操作失敗");
      console.error(e);
    } finally {
      setSaving(false);
    }
  }, []);

  const setMockCurrentRx = useCallback(
    (lines: RxLine[]) => {
      if (!selectedEncounterId) return;
      setCurrentRxByEncounter((prev) => ({ ...prev, [selectedEncounterId]: lines }));
    },
    [selectedEncounterId],
  );

  const applyQtyPadToken = useCallback(
    (token: string) => {
      if (!currentRx.length) return;
      const idx =
        selectedRxIndex >= 0 && selectedRxIndex < currentRx.length ? selectedRxIndex : 0;
      const frac: Record<string, number> = { "1/2": 0.5, "1/3": 1 / 3, "1/4": 0.25 };
      const isLetter = /^[A-M]$/i.test(token);
      const qtyVal =
        token in frac ? frac[token] : /^\d+(\.\d+)?$/.test(token) ? Number(token) : null;
      const next = currentRx.map((line, i) => {
        if (i !== idx) return line;
        if (isLetter) {
          return { ...line, memo: token.toUpperCase() };
        }
        if (qtyVal != null) {
          return { ...line, qty: Math.round(qtyVal * 100) / 100 };
        }
        return line;
      });
      if (apiMode) setApiRxOverlay(next);
      else setMockCurrentRx(next);
      chartDirtyRef.current = true; setSaveSpent(false);
      setChartFocus("rx");
      setChartRailTab((prev) =>
        prev === "waiting" || prev === "history" ? "common" : prev,
      );
    },
    [apiMode, currentRx, selectedRxIndex, setMockCurrentRx],
  );

  const markChartDirty = useCallback(() => {
    chartDirtyRef.current = true; setSaveSpent(false);
  }, []);

  const placeDiagnosisRows = useCallback(
    (incoming: DiagnosisRow[], note?: string): true | string => {
      const base = dxListRef.current;
      const { accepted, overflow, duplicateName } = takeDiagnosisSlots(base, incoming);
      if (!accepted.length) {
        if (overflow) {
          setActionError(CLAIM_DX_FULL);
          return CLAIM_DX_FULL;
        }
        if (duplicateName) {
          const msg = `病名「${duplicateName}」已經有了，同一筆看診不重複。`;
          setActionError(msg);
          return msg;
        }
        return "沒有寫進病名";
      }
      const next = [...base, ...accepted];
      dxListRef.current = next;
      if (apiMode) setApiDxOverlay(next);
      else if (selectedEncounterId) {
        const serverCount = diagnoses.length;
        setLocalDxByEncounter((prev) => ({
          ...prev,
          [selectedEncounterId]: next.slice(serverCount),
        }));
      }
      if (note) setCcText((prev) => appendChiefNotes(prev, [note]));
      return true;
    },
    [apiMode, diagnoses.length, selectedEncounterId],
  );

  const addDiagnosis = useCallback(
    (row: DiagnosisRow): true | string => {
      markChartDirty();
      const code = (row.icd10 || row.nhiIcd10 || "").trim();
      if (!readyIcd9(code)) {
        return placeDiagnosisRows([row]);
      }
      const job = dxQueueRef.current.then(async () => {
        let rows = [row];
        let note = "";
        try {
          const resolved = await resolveIcd9Row(row);
          if (resolved.choices.length > 1) {
            const msg = "這個 ICD-9 會對到兩個 ICD-10，請雙擊病名勾一個或兩個再寫入。";
            setActionError(msg);
            return;
          }
          rows = resolved.rows;
          note = resolved.note;
        } catch {
          rows = [row];
        }
        placeDiagnosisRows(rows, note);
      });
      dxQueueRef.current = job.then(
        () => undefined,
        () => undefined,
      );
      return true;
    },
    [markChartDirty, placeDiagnosisRows],
  );

  const changeDiagnosisAt = useCallback(
    (index: number, row: DiagnosisRow): true | string => {
      markChartDirty();
      const base = apiMode
        ? (apiDxOverlay ?? diagnoses)
        : [
            ...diagnoses,
            ...(selectedEncounterId ? localDxByEncounter[selectedEncounterId] ?? [] : []),
          ];
      const next = base.map((d, i) => (i === index ? { ...d, ...row, id: row.id || d.id } : d));
      if (diagnosisTaken(base, next[index], index)) {
        const msg = `病名「${row.text || row.nhiIcd10 || row.icd10}」已經有了，同一筆看診不重複。`;
        setActionError(msg);
        return msg;
      }
      dxListRef.current = next;
      if (apiMode) {
        setApiDxOverlay(next);
        return true;
      }
      if (!selectedEncounterId) return "沒有選到這筆看診";
      const localOnly = next.slice(diagnoses.length);
      setLocalDxByEncounter((prev) => ({ ...prev, [selectedEncounterId]: localOnly }));
      return true;
    },
    [
      apiMode,
      apiDxOverlay,
      diagnoses,
      localDxByEncounter,
      markChartDirty,
      selectedEncounterId,
    ],
  );

  const removeDiagnosisAt = useCallback(
    (index: number) => {
      markChartDirty();
      const base = apiMode
        ? (apiDxOverlay ?? diagnoses)
        : [
            ...diagnoses,
            ...(selectedEncounterId ? localDxByEncounter[selectedEncounterId] ?? [] : []),
          ];
      const next = base.filter((_, i) => i !== index);
      dxListRef.current = next;
      setSelectedDxIndex(Math.max(0, Math.min(index, Math.max(next.length - 1, 0))));
      if (apiMode) {
        setApiDxOverlay(next);
        return;
      }
      if (!selectedEncounterId) return;
      const localOnly = next.slice(Math.min(diagnoses.length, next.length));
      setLocalDxByEncounter((prev) => ({ ...prev, [selectedEncounterId]: localOnly }));
    },
    [
      apiMode,
      apiDxOverlay,
      diagnoses,
      localDxByEncounter,
      markChartDirty,
      selectedEncounterId,
    ],
  );

  const addRxLines = useCallback(
    (lines: RxLine[]) => {
      if (!lines.length) return;

      for (const line of lines) {
        const collision = allergies.find((a) => {
          const sub = (a.substance || "").toLowerCase().trim();
          const txt = (a.text || "").toLowerCase().trim();
          const name = (line.name || "").toLowerCase().trim();
          const code = (line.nhiCode || "").toLowerCase().trim();
          if (sub && (name.includes(sub) || sub.includes(name) || code === sub)) return true;
          if (txt && (name.includes(txt) || txt.includes(name))) return true;
          return false;
        });

        if (collision) {
          if (collision.level === "high") {
            alert(
              `\u26a0\ufe0f \u81e8\u5e8a\u98a8\u63a7\u786c\u6027\u963b\u65b7\uff01\n\n\u85e5\u7269\u3010${line.name}\u3011\u8207\u75c5\u60a3\u7684\u91cd\u5ea6\u904e\u654f\u539f\u3010${collision.text}\u3011\u56b4\u91cd\u885d\u7a81\uff0c\u7cfb\u7d71\u5df2\u5f37\u5236\u9396\u6b7b\u8a72\u8655\u65b9\uff01`,
            );
            return;
          }
          if (
            !confirm(
              `\u26a0\ufe0f \u81e8\u5e8a\u904e\u654f\u8b66\u544a\uff01\n\n\u85e5\u54c1\u3010${line.name}\u3011\u8207\u75c5\u60a3\u7684\u904e\u654f\u6b77\u53f2\u3010${collision.text}\u3011\u7591\u4f3c\u5b58\u5728\u885d\u7a81\u3002\n\n\u60a8\u78ba\u5b9a\u4ecd\u8981\u958b\u7acb\u6b64\u8655\u65b9\u55ce\uff1f`,
            )
          ) {
            return;
          }
        }
      }

      markChartDirty();
      if (apiMode) {
        const base = apiRxOverlay ?? apiCurrentRx ?? [];
        const cloned = cloneRxLines(lines);
        // 同一筆可以兩條一樣的藥（例如一條健保、一條自費）
        setApiRxOverlay([...base, ...cloned]);
        return;
      }
      setMockCurrentRx([...mockCurrentRx, ...lines]);
    },
    [
      apiMode,
      apiRxOverlay,
      apiCurrentRx,
      cloneRxLines,
      markChartDirty,
      mockCurrentRx,
      setMockCurrentRx,
      allergies,
    ],
  );

  const saveCc = useCallback(() => {
    if (!apiMode || !ccText.trim()) return;
    const assessment = displayDiagnoses[0]?.text;
    runAction(() => persistChiefComplaint(ccText, assessment));
  }, [apiMode, ccText, displayDiagnoses, persistChiefComplaint, runAction]);

  useEffect(() => {
    if (!isChart || !selectedEncounterId) {
      setLiveCase(null);
      return;
    }
    let stop = false;
    const timer = window.setTimeout(() => {
      const rawCase = String(selected?.caseNo || "").trim();
      const selfPay = rawCase === "9X" || rawCase === "\u81ea" || rawCase === "\u81ea\u8cbb";
      void previewVisitCase({
        stored: selfPay ? "9X" : rawCase || "01",
        days: prescriptionDays(currentRx),
        dispense: selected?.dispense || "",
        selfPay,
        codes: displayDiagnoses.map((row) => row.nhiIcd10 || row.icd10 || "").filter(Boolean),
        orders: prescriptionOrders(currentRx),
      })
        .then((res) => {
          if (!stop) setLiveCase({ encounterId: selectedEncounterId, display: res.display || res.case });
        })
        .catch(() => {
          if (!stop) setLiveCase(null);
        });
    }, 250);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [isChart, selectedEncounterId, currentRx, displayDiagnoses, selected?.caseNo, selected?.dispense]);

  const openSaveLayer = useCallback(async () => {
    if (!isChart || !selectedEncounterId) {
      setActionError("請先 F4／Enter 進入看診再 F9 存檔");
      return;
    }
    if (displayDiagnoses.length > CLAIM_DX_LIMIT) {
      setActionError(CLAIM_DX_SAVE);
      return;
    }
    const defaults = loadClinicRegisterDefaults();
    let doctorLabel = doctorDisplayName(selected?.doctorName, selected?.doctorId);
    let doctorId = selected?.doctorId || defaults.defaultDoctorId || "";
    if (!doctorLabel) {
      try {
        const staff = await fetchStaff();
        const doc =
          (doctorId ? staff.find((s) => s.id === doctorId) : undefined) ||
          staff.find((s) => s.id === defaults.defaultDoctorId) ||
          pickClinicDoctor(staff);
        if (doc) {
          doctorId = doc.id;
          doctorLabel = doctorDisplayName(doc.name, doc.id) || doc.name;
        }
      } catch {
        doctorLabel = doctorId;
      }
    }
    setSaveSpent(false);
    const draft = buildVisitSaveDraft({
      selected,
      diagnoses: displayDiagnoses,
      currentRx,
      doctor: doctorLabel,
      doctorId,
      consultFeeDefault: defaults.consultFeeDefault,
      drugs: catalog.drugs,
      usages: catalog.usages,
    });
    if (liveCase?.encounterId === selectedEncounterId && liveCase.display) {
      draft.caseNo = liveCase.display;
    }
    setSaveDraft(draft);
    setCardNote(null);
    if (selected && showsUploadCircle(selected) && draft.writeCard) {
      setCloudAgainAsk(true);
      return;
    }
    setSaveLayerOpen(true);
  }, [isChart, selectedEncounterId, selected, displayDiagnoses, currentRx, liveCase, catalog.drugs, catalog.usages]);

  useEffect(() => {
    if (!cloudAgainAsk) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      setCloudAgainAsk(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cloudAgainAsk]);

  const confirmSave = useCallback(async () => {
    if (!selectedEncounterId) return;
    if (displayDiagnoses.length > CLAIM_DX_LIMIT) {
      setActionError(CLAIM_DX_SAVE);
      return;
    }
    setSaving(true);
    setActionError(null);
    setCardNote(null);
    let hisOk = false;
    try {
      if (apiMode) {
        let doctorId =
          saveDraft.doctorId || selected?.doctorId || loadClinicRegisterDefaults().defaultDoctorId || undefined;
        if (!doctorId) {
          try {
            const doc = pickClinicDoctor(await fetchStaff());
            if (doc) doctorId = doc.id;
          } catch {
            doctorId = undefined;
          }
        }
        await patchEncounterReg(selectedEncounterId, {
          patientId: selected?.patientId || "",
          caseNo: (() => {
            const stored = storedCase(saveDraft.caseNo);
            return stored && stored !== "\u2014" ? stored : undefined;
          })(),
          copayCode: saveDraft.copayCode !== "—" ? saveDraft.copayCode : undefined,
          payType: saveDraft.payType !== "—" ? saveDraft.payType : undefined,
          dispense: saveDraft.dispense !== "—" ? saveDraft.dispense : undefined,
          treatSeq: saveDraft.treatSeq !== "—" ? saveDraft.treatSeq : undefined,
          pharmacist: saveDraft.pharmacist || selected?.pharmacist,
          doctorId,
          doctorName: doctorDisplayName(saveDraft.doctor, doctorId) || undefined,
          regFee: saveDraft.regFee !== "—" ? saveDraft.regFee : undefined,
          drugFee: saveDraft.drugFee !== "—" ? saveDraft.drugFee : undefined,
          materialFee: saveDraft.materialFee !== "—" ? saveDraft.materialFee : undefined,
          consultFee: saveDraft.consultFee !== "—" ? saveDraft.consultFee : undefined,
          burdenFee: saveDraft.burden !== "—" ? saveDraft.burden : undefined,
          copayAmt: saveDraft.burden !== "—" ? saveDraft.burden : undefined,
          drugCopay: saveDraft.drugCopay !== "—" ? saveDraft.drugCopay : undefined,
          selfPay: saveDraft.selfPay !== "—" ? saveDraft.selfPay : undefined,
          totalFee: String(
            Math.round(
              [saveDraft.regFee, saveDraft.burden, saveDraft.drugCopay, selected?.deposit, saveDraft.selfPay].reduce((sum, part) => {
                if (!part || part === "—" || part === "-") return sum;
                const n = Number(part.replace(/[^\d.-]/g, ""));
                return sum + (Number.isFinite(n) ? n : 0);
              }, 0),
            ),
          ),
        });
        let ccForSave = ccText;
        let dxForSave = displayDiagnoses;
        try {
          const mapped = await mapDiagnosisList(displayDiagnoses);
          if (mapped.needsChoice) {
            setActionError("\u6709\u8a3a\u65b7\u5f9e\u4e00\u500b ICD-9 \u5c0d\u5230\u5169\u500b ICD-10\uff0c\u8acb\u96d9\u64ca\u90a3\u4e00\u5217\u52fe\u4e00\u500b\u6216\u5169\u500b\u518d\u5b58\u6a94\u3002");
            setSaving(false);
            return;
          }
          ccForSave = appendChiefNotes(ccText, mapped.notes);
          dxForSave = mapped.rows;
          if (dxForSave.length > CLAIM_DX_LIMIT) {
            setActionError(CLAIM_DX_SAVE);
            setSaving(false);
            return;
          }
          if (ccForSave !== ccText) setCcText(ccForSave);
          const changed =
            mapped.rows.length !== displayDiagnoses.length ||
            mapped.rows.some((row, i) => row.icd10 !== displayDiagnoses[i]?.icd10);
          if (changed) setApiDxOverlay(dxForSave);
        } catch {
          ccForSave = ccText;
          dxForSave = displayDiagnoses;
        }
        await persistVisit(ccForSave, dxForSave, currentRx);
        try {
          await persistVitals({
            weight: chartVitals.weight,
            temperature: chartVitals.temperature,
            bpSys: chartVitals.bpSys,
            bpDia: chartVitals.bpDia,
          });
        } catch {
          /* vitals best-effort; SOAP/Rx already saved */
        }
        hisOk = true;
        const accepted = (selected?.acceptReferral || "").trim() === "1";
        const replied = Boolean((selected?.referralLocalId || "").trim());
        if (accepted && !replied) {
          setReplyError("");
          setReplyAsk({
            serial: (selected?.referralSeq || "").trim(),
            hosp: selected?.referralHospName || selected?.referralHospId || "",
            dx: dxForSave
              .map((row) => [row.icd10 || row.nhiIcd10 || "", row.text].filter((part) => part.trim()).join(" ").trim())
              .filter(Boolean)
              .join("\n"),
            note: ccForSave.trim(),
            meds: currentRx
              .map((row) => [row.name, row.sig, row.days ? `${row.days}\u5929` : ""].filter(Boolean).join(" "))
              .join("\n"),
            patientName: selected?.patientDisplay || "",
          });
          setSaveLayerOpen(false);
        }
      }
      const deskOnly = selected ? skipsCloudWrite(selected) : false;
      if (saveDraft.writeCard && !deskOnly) {
        if (!apiMode) {
          throw new Error("\u5beb\u96f2\u7aef\u9700 API \u8207\u8b80\u5361\u6a5f\uff0fVPN\uff0c\u672a\u5047\u88dd\u5beb\u5165\u3002");
        }
        const wr = await writeVisitToCard({
          encounterId: selectedEncounterId,
          writeDx: saveDraft.writeDx,
          writeOrders: saveDraft.writeOrders,
        });
        if (wr.written && wr.source === "cloud" && selected?.patientId) {
          try {
            await patchEncounterReg(selectedEncounterId, {
              patientId: selected.patientId,
              cardWritten: true,
            });
          } catch {
            /* circle flag is display-only; a failed patch does not undo the chart */
          }
        }
      } else if (deskOnly && selected?.cardWritten && selected.patientId) {
        try {
          await patchEncounterReg(selectedEncounterId, {
            patientId: selected.patientId,
            cardWritten: false,
          });
        } catch {
          /* list still hides the circle for desk-only visits */
        }
      }
      if (apiMode) {
        try {
          await handleStatusChange(selectedEncounterId, "finished");
        } catch {
          /* status update best-effort */
        }
      }
      if (saveDraft.printRx) {
        const holdForReply =
          apiMode && (selected?.acceptReferral || "").trim() === "1" && !(selected?.referralLocalId || "").trim();
        leaveListAfterPrintRef.current = !holdForReply;
        printSimpleSlipRef.current();
      } else {
        openLabSheetRef.current();
      }
      committedFpRef.current[selectedEncounterId] = visitFingerprint;
      const holdForReply =
        apiMode && (selected?.acceptReferral || "").trim() === "1" && !(selected?.referralLocalId || "").trim();
      if (!holdForReply) {
        const leaveAfter = afterSaveLeaveRef.current;
        afterSaveLeaveRef.current = null;
        if (leaveAfter) leaveAfter();
      }
      setVisitDrafts((prev) => {
        if (!prev[selectedEncounterId]) return prev;
        const next = { ...prev };
        delete next[selectedEncounterId];
        return next;
      });
      setApiRxOverlay(null);
      setApiDxOverlay(null);
      ccDirtyRef.current = false;
      chartDirtyRef.current = false;
      setSaveSpent(true);
    } catch (e) {
      const raw = e instanceof Error ? e.message : "存檔失敗";
      const msg = hisOk ? `病歷已寫入本機。${raw}` : raw;
      setCardNote(msg);
      setActionError(msg);
    } finally {
      setSaving(false);
    }
  }, [
    selectedEncounterId,
    apiMode,
    persistVisit,
    persistVitals,
    chartVitals,
    ccText,
    displayDiagnoses,
    currentRx,
    saveDraft,
    visitFingerprint,
    selected,
    handleStatusChange,
  ]);

  const printVisitReceipt = useCallback(() => {
    const clinic = readLocalClinicBundle();
    const setup = findPrintSetup(loadPrintSettings(), "simple");
    const profile = clinic.profile;
    const cash = visitCashParts(selected);
    setPrintNote("\u5df2\u958b\u555f\u9810\u89bd\u3002\u78ba\u5b9a\u5f8c\u518d\u6309\u9810\u89bd\u4e0a\u7684\u5217\u5370\u3002");
    void (async () => {
      let people: { id: string; name: string }[] = [];
      try {
        people = await fetchStaff();
      } catch {
        people = [];
      }
      const pharmacistName = pharmacistDisplayName(
        selected?.pharmacist,
        people,
        session?.pharmacist,
      );
      const leaveList = leaveListAfterPrintRef.current;
      leaveListAfterPrintRef.current = false;
      const result = await openPrintPreview({
      kind: "receipt",
      layout: "paged",
      setupId: "simple",
      title: "\u7c21\u5f0f\u4ea4\u4ed8\u8655\u65b9\u7c3d",
      bodyHtml: buildSimpleSlipHtml({
        medicalNo: selected?.medicalNo || "",
        name: selected?.patientDisplay || "",
        sex: selected?.sex || selected?.ageSex || "",
        idNo: selected?.idNo || selected?.id || "",
        birthday: selected?.birthday || "",
        age: selected?.age || "",
        visitDate: currentDate,
        dept: saveDraft.dept || profile.mainDept || "",
        caseNo: saveDraft.caseNo,
        cardNo: saveDraft.cardNo,
        doctor: saveDraft.doctor,
        pharmacist: pharmacistName,
        chief: ccText,
        diagnoses: displayDiagnoses,
        drugs: currentRx,
        room: selected?.room || "",
        queueNo: selected ? String(selected.queueNumber) : "",
        deposit: cash.deposit,
        regFee: cash.regFee || saveDraft.regFee,
        burden: saveDraft.burden !== "\u2014" ? saveDraft.burden : cash.burden,
        drugCopay: saveDraft.drugCopay !== "\u2014" ? saveDraft.drugCopay : cash.drugCopay,
        selfPay: storedSelfPayText(selected?.selfPay, saveDraft.selfPay),
        clinicName: profile.clinicName,
        address: profile.address,
        clinicCode: profile.clinicCode,
        phone: profile.phone,
        dispenseDate: currentDate,
        pharmacy: saveDraft.dispense || "\u672c\u9662\u6240",
        consultFee: saveDraft.consultFee,
        drugFee: saveDraft.drugFee,
        materialFee: saveDraft.materialFee,
        footer: setup.footer,
        fontSizePx: setup.fontSizePx,
        drugFontSizePx: setup.drugFontSizePx,
        receiptTitle: setup.receiptTitle,
        showChief: partOn(setup, "chief"),
        showDiagnoses: partOn(setup, "diagnoses"),
        showMarks: partOn(setup, "marks"),
        showLeftMoney: partOn(setup, "leftMoney"),
        showDue: partOn(setup, "due"),
        showFeeTable: partOn(setup, "feeTable"),
        showWarning: partOn(setup, "warning"),
      }),
      lines: [],
      });
        setPrintNote(
          result.printed ? `\u5df2\u9001\u5230 ${result.printer}` : "\u9810\u89bd\u5df2\u95dc\u9589\uff0c\u5c1a\u672a\u9001\u51fa\u3002",
        );
        if (leaveList) {
          setSaveLayerOpen(false);
          closeChartNowRef.current(true);
        }
        const clinicNow = readLocalClinicBundle().profile;
        openLabSheetRef.current();
        if (!result.printed) return;
        await openReleaseRxIfWanted({
          caseNo: saveDraft.caseNo,
          clinicName: clinicNow.clinicName,
          clinicCode: clinicNow.clinicCode,
          address: clinicNow.address,
          phone: clinicNow.phone,
          name: selected?.patientDisplay || "",
          idNo: selected?.idNo || selected?.id || "",
          sex: selected?.sex || selected?.ageSex || "",
          birthday: selected?.birthday || "",
          medicalNo: selected?.medicalNo || "",
          dept: saveDraft.dept || clinicNow.mainDept || "",
          visitDate: currentDate,
          cardNo: saveDraft.cardNo,
          queueNo: selected ? String(selected.queueNumber) : "",
          doctor: saveDraft.doctor,
          pharmacist: pharmacistName,
          diagnoses: displayDiagnoses.map((row) => ({
            code: row.icd10 || row.nhiIcd10 || "",
            text: row.text || "",
          })),
          drugs: currentRx.map((row) => ({
            name: row.name,
            sig: row.sig,
            days: row.days || 0,
            qty: row.qty == null ? "" : String(row.qty),
            total: row.totalAmount == null ? "" : String(row.totalAmount),
          })),
        });
    })().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "\u9001\u5230\u5370\u8868\u6a5f\u5931\u6557";
        setPrintNote(msg);
      });
  }, [currentDate, saveDraft, selected, ccText, displayDiagnoses, currentRx, session?.pharmacist]);
  printSimpleSlipRef.current = printVisitReceipt;

  const openLabSheet = useCallback(() => {
    const lines = labSlipLines(currentRx);
    if (!lines.length) return;
    const clinic = readLocalClinicBundle().profile;
    const dx = displayDiagnoses.map((row) => ({
      code: row.icd10 || row.nhiIcd10 || "",
      text: row.text || "",
    }));
    void openDelegateLabSlip({
      caseNo: saveDraft.caseNo,
      clinicName: clinic.clinicName,
      clinicCode: clinic.clinicCode,
      address: clinic.address,
      phone: clinic.phone,
      name: selected?.patientDisplay || "",
      idNo: selected?.idNo || selected?.id || "",
      sex: selected?.sex || selected?.ageSex || "",
      birthday: selected?.birthday || "",
      medicalNo: selected?.medicalNo || "",
      copayCode: saveDraft.copayCode,
      dept: saveDraft.dept || clinic.mainDept || "",
      visitDate: currentDate,
      cardNo: saveDraft.cardNo,
      queueNo: selected ? String(selected.queueNumber) : "",
      doctorId: selected?.doctorId || saveDraft.doctor || "",
      diagnoses: dx,
      giveDays: giveDaysBesideLabs(currentRx),
      lines,
    });
  }, [currentDate, currentRx, displayDiagnoses, saveDraft, selected]);
  openLabSheetRef.current = openLabSheet;

  const onF9 = useCallback(() => {
    if (saving || cloudAgainAsk) return;
    if (saveLayerOpen) {
      if (saveSpent) return;
      void confirmSave();
      return;
    }
    void openSaveLayer();
  }, [saveLayerOpen, openSaveLayer, confirmSave, saving, saveSpent, cloudAgainAsk]);

  const dittoRx = useCallback(
    (lines: RxLine[]) => {
      const missing = rxLinesMissingFrom(currentRx, lines);
      if (!missing.length) return;
      addRxLines(cloneRxLines(missing));
    },
    [addRxLines, cloneRxLines, currentRx],
  );

  const dittoCc = useCallback(
    (text: string, _visitDate: string, force?: boolean) => {
      if (!force && !prefs.dittoCc) return;
      const copied = text.trim();
      if (!copied) return;
      ccDirtyRef.current = true;
      chartDirtyRef.current = true; setSaveSpent(false);
      setCcText((prev) => (prev ? `${prev} ${copied}` : copied));
    },
    [prefs.dittoCc],
  );

  const dittoDx = useCallback(
    (rows: DiagnosisRow[], force?: boolean) => {
      if (!force && !prefs.dittoDx) return;
      for (const row of rows) addDiagnosis(row);
    },
    [addDiagnosis, prefs.dittoDx],
  );

  const dittoVisit = useCallback(
    (visit: HistoryVisit) => {
      dittoCc(visit.chiefComplaint, visit.visitDate);
      dittoDx(visit.diagnoses);
      dittoRx(visit.medications);
    },
    [dittoCc, dittoDx, dittoRx],
  );

  const transferVisit = useCallback(
    (visit: HistoryVisit) => {
      dittoCc(visit.chiefComplaint, visit.visitDate, true);
      dittoDx(visit.diagnoses, true);
      dittoRx(visit.medications);
    },
    [dittoCc, dittoDx, dittoRx],
  );

  const transferVisitNoCc = useCallback(
    (visit: HistoryVisit) => {
      dittoDx(visit.diagnoses, true);
      dittoRx(visit.medications);
    },
    [dittoDx, dittoRx],
  );

  const copyPrevRx = useCallback(() => {
    dittoRx(historyVisit?.medications?.length ? historyVisit.medications : prevRx);
  }, [dittoRx, historyVisit, prevRx]);

  const barItems = useMemo(
    () =>
      isList
        ? CLINIC_LIST_SHORTCUT_BAR
        : CLINIC_CHART_SHORTCUT_BAR.filter((item) => item.key === "F9"),
    [isList],
  );

  const clearChartOverlays = useCallback(() => {
    setLesionOpen(false);
    setLookOpen(false);
    setPaletteOpen(false);
    setSaveLayerOpen(false);
    setOtherMenuOpen(false);
  }, []);

  /** Left zone click -> right rail shows matching picker (YiSheng parity) */
  const activateChartZone = useCallback((zone: ChartEditFocus) => {
    setChartFocus(zone);
    if (Date.now() < railTabClickGuardRef.current) return;
    if (zone === "cc" || zone === "dx" || zone === "rx") {
      setChartRailTab((prev) => {
        // 候診／歷史：點左欄才回到常用選單
        if (prev === "waiting" || prev === "history") return "common";
        // 內服只對處置區；點主訴／病名時退回常用（對齊醫聖）
        if (prev === "oral" && zone !== "rx") return "common";
        return prev;
      });
    }
  }, []);

  const revealChart = useCallback(
    (encounterId: string, opts?: { fromSeek?: boolean; label?: string }) => {
      const entry = queue.find((e) => e.encounterId === encounterId);
      const finished =
        entry?.queueStatus === "finished" || entry?.queueStatus === "no_show";
      const draft = visitDrafts[encounterId];

      setSelectedEncounterId(encounterId);
      setClinicTab("chart");
      // Default right rail: waiting/family (YiSheng)
      setChartRailTab(opts?.fromSeek ? "common" : "waiting");
      setChartFocus(opts?.fromSeek ? "rx" : "cc");
      setDxQuery("");
      setRxQuery("");
      setSelectedDxIndex(0);
      setSelectedRxIndex(-1);
      commandFocusBump.current += 1;
      chartDirtyRef.current = false;
      setSaveSpent(false);

      if (finished) {
        // Re-open saved visit: always server truth until F9
        setVisitDrafts((prev) => {
          if (!prev[encounterId]) return prev;
          const next = { ...prev };
          delete next[encounterId];
          return next;
        });
        setApiRxOverlay(null);
        setApiDxOverlay(null);
        ccDirtyRef.current = false;
      } else if (draft) {
        ccDirtyRef.current = true;
        chartDirtyRef.current = true; setSaveSpent(false);
        setCcText(draft.cc);
        setApiDxOverlay(draft.dx);
        setApiRxOverlay(draft.rx);
      } else {
        setApiDxOverlay(null);
        setApiRxOverlay(null);
      }

      if (opts?.fromSeek) {
        setSeekEnteredBanner(
          opts.label ||
            "\u8abf\u95b1\u9032\u5165\uff1a\u53ef\u589e\u522a\u8655\u65b9\u5f8c F9 \u5b58\u6a94\uff08\u8cc7\u6599\u5beb\u5165\u5f71\u5b50\u5eab\uff0fFHIR\uff09",
        );
      } else {
        setSeekEnteredBanner(null);
      }
    },
    [queue, setSelectedEncounterId, visitDrafts, selectedEncounterId],
  );

  const retiredDraftsRef = useRef(new Set<string>());
  const holdUnsavedChart = useCallback(
    (eid: string) => {
      if (retiredDraftsRef.current.has(eid)) return;
      const entry = queue.find((e) => e.encounterId === eid);
      const saved =
        entry?.queueStatus === "finished" ||
        entry?.queueStatus === "no_show" ||
        Boolean(committedFpRef.current[eid]);
      if (saved) return;
      const touched =
        chartDirtyRef.current || ccDirtyRef.current || Boolean(visitDrafts[eid]);
      const cc = visibleComplaint(ccText);
      const dx = displayDiagnoses.filter((row) =>
        (row.nhiIcd10 || row.icd10 || row.text || "").trim(),
      );
      const rx = currentRx.filter((row) => (row.nhiCode || row.name || "").trim());
      const body = Boolean(cc) || dx.length > 0 || rx.length > 0;
      if (touched && body) {
        setVisitDrafts((prev) => ({
          ...prev,
          [eid]: { cc: ccText, dx: displayDiagnoses, rx: currentRx },
        }));
        if (entry?.queueStatus !== "in_progress") {
          void handleStatusChange(eid, "in_progress").then(() => refreshQueue());
        }
        return;
      }
      if (touched && !body) {
        setVisitDrafts((prev) => ({
          ...prev,
          [eid]: { cc: "", dx: [], rx: [] },
        }));
        if (entry?.queueStatus === "in_progress") {
          void handleStatusChange(eid, "waiting").then(() => refreshQueue());
        }
        return;
      }
      if (!visitDrafts[eid] && entry?.queueStatus === "in_progress") {
        void handleStatusChange(eid, "waiting").then(() => refreshQueue());
      }
    },
    [queue, visitDrafts, ccText, displayDiagnoses, currentRx, handleStatusChange, refreshQueue],
  );

  const openChart = useCallback(
    (encounterId: string, opts?: { fromSeek?: boolean; label?: string }) => {
      if (leaveBypassRef.current) {
        leaveBypassRef.current = false;
      } else if (selectedEncounterId && encounterId !== selectedEncounterId) {
        const cur = queue.find((e) => e.encounterId === selectedEncounterId);
        const saved =
          cur?.queueStatus === "finished" ||
          cur?.queueStatus === "no_show" ||
          Boolean(committedFpRef.current[selectedEncounterId]);
        if (saved && (chartDirtyRef.current || ccDirtyRef.current)) {
          leaveIntentRef.current = { kind: "open", encounterId, opts };
          setLeaveAsk(true);
          return;
        }
        if (!saved) holdUnsavedChart(selectedEncounterId);
      }
      void claimChartOpen(encounterId, loadLocalDeviceMeta().id).then(
        () => {
          setChartInUse(false);
          revealChart(encounterId, opts);
        },
        (err: unknown) => {
          if (err instanceof Error && err.message === CHART_IN_USE) {
            setChartInUse(true);
            return;
          }
          setChartInUse(false);
          revealChart(encounterId, opts);
        },
      );
    },
    [queue, selectedEncounterId, revealChart, holdUnsavedChart],
  );

  const closeChartNow = useCallback(
    (discardEdits: boolean) => {
    const eid = selectedEncounterId;
    const status = selected?.queueStatus;
    const saved =
      status === "finished" ||
      status === "no_show" ||
      Boolean(eid && committedFpRef.current[eid]);

    if (eid) {
      if (discardEdits || saved) {
        setVisitDrafts((prev) => {
          if (!prev[eid]) return prev;
          const next = { ...prev };
          delete next[eid];
          return next;
        });
        setApiRxOverlay(null);
        setApiDxOverlay(null);
        ccDirtyRef.current = false;
        chartDirtyRef.current = false;
      } else {
        holdUnsavedChart(eid);
      }
    }

    setSeekEnteredBanner(null);
    clearChartOverlays();
    if (searchParams.get("from") === "emr") {
      navigate("/emr-lookup");
      return;
    }
    setClinicTab("list");
    void refreshQueue();
    const idx = filteredQueue.findIndex((row) => row.encounterId === eid);
    if (idx >= 0 && idx + 1 < filteredQueue.length) {
      setSelectedEncounterId(filteredQueue[idx + 1].encounterId);
    }
    requestAnimationFrame(() => queuePanelRef.current?.focus());
    },
  [
    selectedEncounterId,
    selected?.queueStatus,
    holdUnsavedChart,
    clearChartOverlays,
    navigate,
    searchParams,
    filteredQueue,
    refreshQueue,
    setSelectedEncounterId,
  ]);
  closeChartNowRef.current = closeChartNow;

  const openListPatient = useCallback(
    (id: string) => {
      const row = queue.find((e) => e.encounterId === id);
      if (row?.prebook) {
        setSelectedEncounterId(id);
        setNoCardAskId(null);
        setPrebookAskId(id);
        return;
      }
      openChart(id);
    },
    [queue, openChart, setSelectedEncounterId],
  );

  const closeChart = useCallback(() => {
    const eid = selectedEncounterId;
    const saved =
      selected?.queueStatus === "finished" ||
      selected?.queueStatus === "no_show" ||
      Boolean(eid && committedFpRef.current[eid]);
    const dirty = chartDirtyRef.current || ccDirtyRef.current;
    if (eid && saved && dirty) {
      leaveIntentRef.current = { kind: "list" };
      setLeaveAsk(true);
      return;
    }
    closeChartNow(false);
  }, [selectedEncounterId, selected?.queueStatus, closeChartNow]);

  const runLeaveIntent = useCallback(
    (discard: boolean) => {
      const intent = leaveIntentRef.current;
      leaveIntentRef.current = null;
      setLeaveAsk(false);
      if (intent?.kind === "open") {
        if (discard && selectedEncounterId) {
          setVisitDrafts((prev) => {
            if (!prev[selectedEncounterId]) return prev;
            const next = { ...prev };
            delete next[selectedEncounterId];
            return next;
          });
          setApiRxOverlay(null);
          setApiDxOverlay(null);
          ccDirtyRef.current = false;
          chartDirtyRef.current = false;
        }
        leaveBypassRef.current = true;
        openChart(intent.encounterId, intent.opts);
        return;
      }
      closeChartNow(discard);
    },
    [selectedEncounterId, openChart, closeChartNow],
  );

  const handleClinicTabChange = useCallback(
    (tab: ClinicTab) => {
      if (tab !== "list" && !selectedEncounterId) {
        setActionError("請先在清單選一筆病患");
        return;
      }
      setActionError(null);
      if (tab === "list") {
        closeChart();
        return;
      }
      if (!selectedEncounterId) return;
      void claimChartOpen(selectedEncounterId, loadLocalDeviceMeta().id).then(
        () => {
          setChartInUse(false);
          setClinicTab(tab);
          if (tab === "chart") setChartRailTab("waiting");
        },
        (err: unknown) => {
          if (err instanceof Error && err.message === CHART_IN_USE) {
            setChartInUse(true);
            return;
          }
          setClinicTab(tab);
          if (tab === "chart") setChartRailTab("waiting");
        },
      );
    },
    [selectedEncounterId, closeChart],
  );

  const fillConfirmFromCard = useCallback(async () => {
    if (!apiMode) throw new Error("需 API 模式");
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
      pharmacist: prev.pharmacist || session?.pharmacist || lastPharmacist(),
    }));
    if (res.cardBridgeNote) setSeqNote(res.cardBridgeNote);
  }, [apiMode, readCardRegisterPatient, session]);

  const openConfirmFromSeed = useCallback(
    (seed: Partial<RegisterEditForm>, fillBlankFees = false) => {
      setConfirmError(null);
      setSeqNote(null);
      setCardDiagnose(null);
      const next = { ...emptyRegisterForm(), ...seed };
      next.pharmacist = seed.pharmacist || session?.pharmacist || lastPharmacist();
      if (!seed.encounterId && session?.shift) next.shift = session.shift;
      if (!seed.visitClock) next.visitClock = nowClock();
      setRegisterOptionsOpen(false);
      setPriceBlankFees(fillBlankFees);
      setConfirmForm(next);
      setConfirmOpen(true);
    },
    [session],
  );

  /** F9 讀卡成功後，有空號先問要不要插入，再進存檔。 */
  const offerQueueNumber = useCallback(
    (go: (n: number) => void) => {
      const shift = session?.shift || "";
      const plan = planQueueNumber(shiftQueueNumbers(queue, shift));
      if (plan.contiguous) go(plan.next);
      else setInsertAsk({ gap: plan.gap, tail: plan.tail, go });
    },
    [queue, session?.shift],
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

  const answerInsert = (yes: boolean) => {
    const cur = insertAsk;
    if (!cur) return;
    setInsertAsk(null);
    cur.go(yes ? cur.gap : cur.tail);
  };

  const goRegisterByCard = useCallback(() => {
    if (!apiMode) {
      setActionError("讀卡需 API 模式");
      return;
    }
    setConfirmError(null);
    setCardDiagnose(null);
    setSeqNote(null);
    const shift = session?.shift || "";
    void (async () => {
      try {
        const res = await readCardRegisterPatient();
        const seed: Partial<RegisterEditForm> = {
          pharmacist: session?.pharmacist || lastPharmacist(),
          icException: "ic",
          shift,
          visitClock: nowClock(),
          patientId: res.patientId,
          idNo: res.validation?.idNo,
          birthday: res.validation?.birthdayRoc,
          sex: res.validation?.sex,
          patientName: res.validation?.patientName,
          cardId: res.validation?.cardId,
          cardIdentity: res.validation?.identityStatus || "",
        };
        if (res.cardBridgeNote) setSeqNote(res.cardBridgeNote);
        const booked = findCardCheckIn(
          queue,
          { idNo: seed.idNo, patientId: seed.patientId },
          shift,
          entryShift,
        );
        if (booked) {
          beginCheckIn(
            booked,
            {
              ...seed,
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
        const otherNote = otherShiftAppointmentNote(
          queue,
          { idNo: seed.idNo },
          shift,
          entryShift,
        );
        if (otherNote) setSeqNote([res.cardBridgeNote, otherNote].filter(Boolean).join(" "));
        offerQueueNumber((n) => openConfirmFromSeed({ ...seed, queueNumber: String(n) }));
      } catch (e) {
        openConfirmFromSeed({
          pharmacist: session?.pharmacist || lastPharmacist(),
          icException: "ic",
          shift,
          visitClock: nowClock(),
        });
        setConfirmError(e instanceof Error ? e.message : "讀卡失敗");
        setCardDiagnose(e instanceof CardReadError ? e.diagnose : null);
      }
    })();
  }, [apiMode, beginCheckIn, entryShift, offerQueueNumber, openConfirmFromSeed, queue, readCardRegisterPatient, session]);

  const applyRegisterHub = useCallback(
    (label: string) => {
      const act = registerHubAction(label);
      if (act.kind === "readCard") {
        goRegisterByCard();
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
        if (!selected && !selectedEncounterId) {
          setActionError("請先選病患");
          return;
        }
        setReferralOpen(true);
        return;
      }
      if (act.kind === "cloud") {
        openNhiCloudRx();
        return;
      }
      if (act.kind === "allergy") {
        if (!selected && !selectedEncounterId) {
          setActionError("請先選病患");
          return;
        }
        const allergyId = selectedEncounterId || selected?.encounterId || "";
        void claimChartOpen(allergyId, loadLocalDeviceMeta().id).then(
          () => {
            setChartInUse(false);
            setClinicTab("alerts");
          },
          (err: unknown) => {
            if (err instanceof Error && err.message === CHART_IN_USE) setChartInUse(true);
            else setClinicTab("alerts");
          },
        );
        return;
      }
      if (act.kind === "say") {
        setActionError(act.text);
        return;
      }
      if (act.kind === "refund") {
        setRefundOpen(true);
        return;
      }
      setStubId(act.id);
    },
    [goRegisterByCard, navigate, selected, selectedEncounterId],
  );

  const openFinder = useCallback((seed = queueSearch) => {
    setRegisterOptionsOpen(false);
    setFinderSeed(seed.trim());
    setFinderOpen(true);
  }, [queueSearch]);

  const onPatientPickedForRegister = useCallback(
    (hit: PatientHit) => {
      setFinderOpen(false);
      const booked = findWaitingAppointment(
        queue,
        { patientId: hit.id, idNo: hit.idNo },
        session?.shift,
        entryShift,
      );
      if (booked) {
        beginCheckIn(booked, {
          patientId: hit.id,
          idNo: hit.idNo,
          birthday: hit.birthdayRoc,
          sex: hit.sex || "F",
          patientName: hit.name,
          icException: "deposit",
          noCardReason: "",
          deposit: loadClinicRegisterDefaults().depositAmount,
          prebook: false,
          payType: "4",
          pharmacist: session?.pharmacist || lastPharmacist(),
        });
        return;
      }
      const otherNote = otherShiftAppointmentNote(
        queue,
        { patientId: hit.id, idNo: hit.idNo },
        session?.shift,
        entryShift,
      );
      if (otherNote) setSeqNote(otherNote);
      offerQueueNumber((n) =>
        openConfirmFromSeed({
          patientId: hit.id,
          idNo: hit.idNo,
          birthday: hit.birthdayRoc,
          sex: hit.sex || "F",
          patientName: hit.name,
          icException: "deposit",
          noCardReason: "",
          deposit: loadClinicRegisterDefaults().depositAmount,
          prebook: false,
          pharmacist: session?.pharmacist || lastPharmacist(),
          queueNumber: String(n),
        }),
      );
    },
    [beginCheckIn, entryShift, offerQueueNumber, openConfirmFromSeed, queue, session],
  );

  const seedFromEntry = useCallback((entry: NonNullable<typeof selected>): Partial<RegisterEditForm> => {
    const iso = entry.birthday || "";
    let roc = iso.replace(/\D/g, "");
    if (iso.includes("-")) {
      const [y, m, d] = iso.split("-");
      const yy = Number(y);
      if (yy >= 1911) roc = `${String(yy - 1911).padStart(3, "0")}${m}${d}`;
    }
    return {
      encounterId: entry.encounterId,
      patientId: entry.patientId,
      idNo: entry.idNo || "",
      birthday: roc.slice(0, 7),
      sex: entry.sex || (entry.ageSex?.endsWith("M") ? "M" : "F"),
      patientName: entry.patientDisplay,
      reasonText: entry.reasonText || "",
      caseNo: entry.caseNo && entry.caseNo !== "—" ? entry.caseNo : "01",
      copayCode: entry.copayCode || "",
      payType: entry.payType || "4",
      dispense: entry.dispense || "自行調劑",
      shift: entry.shift || emptyRegisterForm().shift,
      room: roomNumber(entry.room),
      treatmentItem: entry.treatmentItem || "01",
      afterCheck: entry.afterCheck === "2" ? "2" : "1",
      icException: (entry.icException as RegisterEditForm["icException"]) || "ic",
      noCardReason: entry.noCardReason || "",
      acceptReferral: entry.acceptReferral || "",
      referralSeq: entry.referralSeq || "",
      referralHospId: entry.referralHospId || "",
      referralHospName: entry.referralHospName || "",
      referralDate: entry.referralDate || "",
      pharmacist: entry.pharmacist || session?.pharmacist || lastPharmacist(),
      doctorId: entry.doctorId || "",
      doctorName: entry.doctorName || "",
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
      consultFee: entry.consultFee || "",
      drugFee: entry.drugFee || "",
      materialFee: entry.materialFee || "",
      burdenFee: entry.burdenFee || "",
    };
  }, [session]);

  const openPrebookChoice = useCallback(
    (kind: "deposit" | "selfPay") => {
      const id = noCardAskId;
      setNoCardAskId(null);
      if (!id) return;
      const row = queue.find((e) => e.encounterId === id);
      if (!row) return;
      const base = seedFromEntry(row);
      if (kind === "deposit") {
        openConfirmFromSeed(
          {
            ...base,
            prebook: false,
            payType: "4",
            icException: "deposit",
            caseNo: base.caseNo === "9X" ? "01" : base.caseNo || "01",
            deposit: loadClinicRegisterDefaults().depositAmount,
            noCardReason: "",
          },
          true,
        );
        return;
      }
      openConfirmFromSeed(
        {
          ...base,
          prebook: false,
          payType: "4",
          icException: "selfPay",
          caseNo: "9X",
          deposit: "",
          copayAmt: "0",
          copayCode: "",
          noCardReason: "",
        },
        true,
      );
    },
    [noCardAskId, queue, seedFromEntry, openConfirmFromSeed],
  );

  const openF3RegisterEdit = useCallback(() => {
    const entry =
      selected ??
      queue.find((q) => q.encounterId === selectedEncounterId) ??
      null;
    if (!entry) {
      setActionError("請先在清單點選一筆，再按 F3 編輯此次掛號資料");
      return;
    }
    setSelectedEncounterId(entry.encounterId);
    openConfirmFromSeed(seedFromEntry(entry));
  }, [selected, queue, selectedEncounterId, openConfirmFromSeed, seedFromEntry, setSelectedEncounterId]);

  const openDeleteDialog = useCallback(() => {
    if (!selectedEncounterId) {
      setActionError("請先在清單點選一筆再刪除掛號");
      return;
    }
    setDeleteError(null);
    setDeleteOpen(true);
  }, [selectedEncounterId]);

  const closePatientEdit = useCallback(() => {
    setPatientEditOpen(false);
    setFinderPatient(null);
  }, []);

  const openPatientEdit = useCallback(() => {
    const entry =
      selected ?? queue.find((q) => q.encounterId === selectedEncounterId) ?? null;
    if (!entry?.patientId) {
      setActionError("請先在清單選一筆再 F5 病患");
      return;
    }
    setFinderPatient(null);
    setSelectedEncounterId(entry.encounterId);
    setPatientEditOpen(true);
  }, [selected, queue, selectedEncounterId, setSelectedEncounterId]);

  const runShortcut = useCallback(
    (action: (typeof barItems)[number]["action"]) => {
      const item = barItems.find((b) => b.action === action);
      if (item) setActiveShortcutKey(item.key);

      switch (action) {
        case "queueList":
        case "register":
          setRegisterOptionsOpen(true);
          break;
        case "registerEdit":
          openF3RegisterEdit();
          break;
        case "clinicMain":
          if (isList) {
            if (selectedEncounterId) openListPatient(selectedEncounterId);
            else setActionError("請先點清單一筆，再按 F4 看診");
          } else if (selectedEncounterId) {
            openChart(selectedEncounterId);
          }
          break;
        case "clinicalAlerts":
          if (!selectedEncounterId) {
            setActionError("請先選病患");
            return;
          }
          void claimChartOpen(selectedEncounterId, loadLocalDeviceMeta().id).then(
            () => {
              setChartInUse(false);
              setClinicTab("alerts");
            },
            (err: unknown) => {
              if (err instanceof Error && err.message === CHART_IN_USE) setChartInUse(true);
              else setClinicTab("alerts");
            },
          );
          break;
        case "historyChart":
          if (!selectedEncounterId) {
            setActionError("請先選病患");
            return;
          }
          if (isList) {
            void claimChartOpen(selectedEncounterId, loadLocalDeviceMeta().id).then(
              () => {
                setChartInUse(false);
                setClinicTab("history");
              },
              (err: unknown) => {
                if (err instanceof Error && err.message === CHART_IN_USE) setChartInUse(true);
                else setClinicTab("history");
              },
            );
          } else {
            setChartRailTab("history");
            setChartFocus("history");
            historyPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            historyPanelRef.current?.focus();
          }
          break;
        case "editPatient":
          openPatientEdit();
          break;
        case "radiology":
          if (!selectedEncounterId) {
            setActionError("請先選病患");
            return;
          }
          void claimChartOpen(selectedEncounterId, loadLocalDeviceMeta().id).then(
            () => {
              setChartInUse(false);
              setClinicTab("radiology");
            },
            (err: unknown) => {
              if (err instanceof Error && err.message === CHART_IN_USE) setChartInUse(true);
              else setClinicTab("radiology");
            },
          );
          break;
        case "printVisit":
          if (!selected && !selectedEncounterId) {
            setActionError("\u8acb\u5148\u9078\u4e00\u4f4d\u75c5\u4eba");
            return;
          }
          setPrintMenuOpen(true);
          break;
        case "deleteReg":
          openDeleteDialog();
          break;
        case "emrLookup":
          navigate("/emr-lookup");
          break;
        case "escapeHome":
          navigate("/");
          break;
        case "bigPalette":
          setPaletteOpen(true);
          break;
        case "saveChart":
          onF9();
          break;
        case "refundDeposit":
          setRefundOpen(true);
          break;
        case "receipt":
          if (!selected && !selectedEncounterId) {
            setActionError("請先選病患");
            return;
          }
          printVisitReceipt();
          break;
        case "icCard":
          setIcInfoOpen(true);
          break;
        case "dittoRx":
          copyPrevRx();
          break;
        case "lesionPhoto":
          setLesionOpen((open) => !open);
          break;
        case "readCard":
          goRegisterByCard();
          break;
        case "certificate":
          setCertificateOpen(true);
          break;
        case "otherFunctions":
          setCertificateOpen(true);
          setOtherMenuOpen(false);
          break;
        default:
          break;
      }
    },
    [
      barItems,
      copyPrevRx,
      onF9,
      openFinder,
      goRegisterByCard,
      openF3RegisterEdit,
      openPatientEdit,
      isList,
      selectedEncounterId,
      openChart,
      queueSearch,
      navigate,
      openDeleteDialog,
      printVisitReceipt,
      selected,
      openListPatient,
    ],
  );

  const closeSaveLayer = useCallback(() => {
    const spent = saveSpent;
    setSaveLayerOpen(false);
    afterSaveLeaveRef.current = null;
    if (spent) closeChartNow(true);
  }, [saveSpent, closeChartNow]);

  useEscLayer(
    [
      { open: replyAsk != null, close: finishReply },
      { open: newPatientQuery != null, close: () => setNewPatientQuery(null) },
      { open: checkInAsk != null, close: () => setCheckInAsk(null) },
      { open: noCardAskId != null, close: () => setNoCardAskId(null) },
      { open: prebookAskId != null, close: () => setPrebookAskId(null) },
      { open: insertAsk != null, close: () => answerInsert(false) },
      {
        open: leaveAsk,
        close: () => {
          leaveIntentRef.current = null;
          afterSaveLeaveRef.current = null;
          setLeaveAsk(false);
        },
      },
      { open: referralOpen, close: () => setReferralOpen(false) },
      { open: icInfoOpen, close: () => setIcInfoOpen(false) },
      { open: lookOpen, close: () => setLookOpen(false) },
      { open: finderOpen, close: () => setFinderOpen(false) },
      { open: printMenuOpen, close: () => setPrintMenuOpen(false) },
      { open: certificateOpen, close: () => setCertificateOpen(false) },
      { open: patientEditOpen, close: closePatientEdit },
      { open: !!stubId, close: () => setStubId(null) },
      { open: otherMenuOpen, close: () => setOtherMenuOpen(false) },
      {
        open: confirmOpen,
        close: () => {
          setConfirmOpen(false);
          setCardDiagnose(null);
        },
      },
      { open: deleteOpen, close: () => setDeleteOpen(false) },
      {
        open: saveLayerOpen,
        close: () => closeSaveLayer(),
      },
      { open: paletteOpen, close: () => setPaletteOpen(false) },
      { open: lesionOpen, close: () => setLesionOpen(false) },
      { open: registerOptionsOpen, close: () => setRegisterOptionsOpen(false) },
      { open: needsPatientTab, close: () => closeChart() },
      { open: true, close: () => { gateLeaveRef.current = true; setLeaveToLobby(true); setGateOpen(true); } },
    ],
    !gateOpen,
  );

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (gateOpen) return;
      if (replyAsk) {
        if (ev.key === "F9") ev.preventDefault();
        return;
      }
      if (ev.key === "Escape") return;
      if (
        confirmOpen ||
        finderOpen ||
        newPatientQuery != null ||
        checkInAsk != null ||
        prebookAskId != null ||
        noCardAskId != null ||
        deleteOpen ||
        stubId ||
        icInfoOpen ||
        referralOpen ||
        registerOptionsOpen ||
        patientEditOpen ||
        certificateOpen ||
        printMenuOpen
      ) {
        return;
      }
      const typing =
        document.activeElement &&
        (document.activeElement.tagName === "INPUT" ||
          document.activeElement.tagName === "TEXTAREA" ||
          document.activeElement.tagName === "BUTTON" ||
          document.activeElement.getAttribute("contenteditable") === "true" ||
          document.activeElement.getAttribute("role") === "textbox");
      if (ev.key === "F6") {
        ev.preventDefault();
        runShortcut("printVisit");
        return;
      }
      if (isList && ev.key === "F2") {
        ev.preventDefault();
        setRegisterOptionsOpen(true);
        return;
      }
      if ((isList || isChart) && ev.key === "F3") {
        ev.preventDefault();
        openF3RegisterEdit();
        return;
      }
      if (isList && ev.key === "F4" && selectedEncounterId) {
        ev.preventDefault();
        openListPatient(selectedEncounterId);
        return;
      }
      if (!isList && ev.key === "F8") {
        ev.preventDefault();
        setIcInfoOpen(true);
        return;
      }
      if (isList && ev.altKey) {
        const k = ev.key.toLowerCase();
        const stubHit: Record<string, HisStubId> = {
          v: "vaccine",
          h: "virtual",
          c: "chronic",
          s: "sale",
          i: "refund",
          k: "track",
        };
        if (stubHit[k]) {
          ev.preventDefault();
          setStubId(stubHit[k]);
          return;
        }
        if (k === "x") {
          ev.preventDefault();
          navigate("/");
          return;
        }
        if (k === "a") {
          ev.preventDefault();
          navigate("/patients?add=1");
          return;
        }
      }
      if (ev.key === "F9") {
        if (isChart) {
          ev.preventDefault();
          onF9();
        }
        return;
      }
      if (isList && ev.key === "Enter" && selectedEncounterId) {
        if (typing) return;
        ev.preventDefault();
        openChart(selectedEncounterId);
        return;
      }
      if (isList && (ev.key === "Delete" || ev.key === "Del") && selectedEncounterId) {
        if (typing) return;
        ev.preventDefault();
        openDeleteDialog();
        return;
      }
      if (isList && (ev.key === "ArrowUp" || ev.key === "ArrowDown" || ev.key === "PageUp" || ev.key === "PageDown" || ev.key === "Home" || ev.key === "End")) {
        const pageNav = ev.key === "PageUp" || ev.key === "PageDown" || ev.key === "Home" || ev.key === "End";
        if (!pageNav && typing) return;

        const currentIndex = filteredQueue.findIndex((q) => q.encounterId === selectedEncounterId);
        if (filteredQueue.length === 0) return;
        ev.preventDefault();
        const scroller = queuePanelRef.current?.querySelector("[data-queue-scroller]") as HTMLElement | null;
        const rowEls = scroller
          ? Array.from(scroller.querySelectorAll<HTMLElement>("[data-qid]"))
          : [];
        const rowPx = rowEls[0]?.getBoundingClientRect().height || 18;
        const headerPx = scroller?.querySelector("thead")?.getBoundingClientRect().height || 0;
        const page = Math.max(
          1,
          Math.floor(((scroller?.clientHeight || rowPx * 12) - headerPx) / rowPx),
        );
        const last = filteredQueue.length - 1;
        let newIndex = currentIndex;
        if (ev.key === "Home") newIndex = 0;
        else if (ev.key === "End") newIndex = last;
        else if (currentIndex === -1) {
          newIndex = ev.key === "ArrowUp" || ev.key === "PageUp" ? last : 0;
        } else if (ev.key === "ArrowUp") {
          newIndex = Math.max(0, currentIndex - 1);
        } else if (ev.key === "ArrowDown") {
          newIndex = Math.min(last, currentIndex + 1);
        } else if (ev.key === "PageUp") {
          newIndex = Math.max(0, currentIndex - page);
        } else {
          newIndex = Math.min(last, currentIndex + page);
        }
        if (newIndex !== currentIndex && filteredQueue[newIndex]) {
          setSelectedEncounterId(filteredQueue[newIndex].encounterId);
        }
        if (scroller) {
          const clampedTop = newIndex === 0 && (ev.key === "Home" || ev.key === "PageUp");
          const clampedBottom = newIndex === last && (ev.key === "End" || ev.key === "PageDown");
          if (clampedTop || ev.key === "Home") {
            scroller.scrollTop = 0;
          } else if (clampedBottom || ev.key === "End") {
            scroller.scrollTop = scroller.scrollHeight;
          } else if ((ev.key === "PageUp" || ev.key === "PageDown") && rowEls[newIndex]) {
            const curEl = currentIndex >= 0 ? rowEls[currentIndex] : null;
            const rel = curEl ? curEl.offsetTop - scroller.scrollTop : 0;
            scroller.scrollTop = Math.max(0, rowEls[newIndex].offsetTop - rel);
          } else if (rowEls[newIndex]) {
            rowEls[newIndex].scrollIntoView({ block: "nearest" });
          }
        }
        return;
      }
      if (typing) return;
      const action = barItems.find((b) => b.key === ev.key)?.action;
      if (!action) return;
      ev.preventDefault();
      runShortcut(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    runShortcut,
    lesionOpen,
    paletteOpen,
    selectedEncounterId,
    navigate,
    queue,
    saveLayerOpen,
    onF9,
    setSelectedEncounterId,
    needsPatientTab,
    closeChart,
    openChart,
    confirmOpen,
    finderOpen,
    deleteOpen,
    printMenuOpen,
    barItems,
    filteredQueue,
    stubId,
    icInfoOpen,
    referralOpen,
    gateOpen,
    replyAsk,
    openFinder,
    queueSearch,
    isList,
    isChart,
    registerOptionsOpen,
    patientEditOpen,
    certificateOpen,
    otherMenuOpen,
    openF3RegisterEdit,
    openDeleteDialog,
    openListPatient,
    prebookAskId,
    noCardAskId,
  ]);

  const appliedPackageRef = useRef<string | null>(null);
  useEffect(() => {
    const pkgId = searchParams.get("package");
    if (!pkgId || appliedPackageRef.current === pkgId) return;
    if (!selectedEncounterId || !isChart) return;
    const pkg = catalog.packages.find((p) => p.id === pkgId || p.code === pkgId);
    if (!pkg) return;
    const lines = resolvePackageLines(pkg, catalog.drugs);
    appliedPackageRef.current = pkgId;
    if (lines.length) addRxLines(lines);
    navigate("/clinic", { replace: true });
  }, [searchParams, selectedEncounterId, isChart, catalog.packages, catalog.drugs, addRxLines, navigate]);

  /** 調閱／深連結：`/clinic?encounter=&tab=chart&from=emr` */
  const appliedEncounterDeepLink = useRef<string | null>(null);
  useEffect(() => {
    const eid = searchParams.get("encounter");
    if (!eid) return;
    const key = `${eid}|${searchParams.get("tab") || ""}|${searchParams.get("from") || ""}`;
    if (appliedEncounterDeepLink.current === key) return;
    appliedEncounterDeepLink.current = key;
    const fromSeek = searchParams.get("from") === "emr";
    const tab = searchParams.get("tab");
    if (fromSeek) {
      setEntered(true);
      setGateOpen(false);
      const boot = readEmrSeek(searchParams);
      if (boot) {
        setSession(boot);
        setCurrentDate(boot.date);
      }
    }
    openChart(eid, {
      fromSeek,
      label: fromSeek ? `調閱進入 ${eid}` : undefined,
    });
    if (tab === "history" || tab === "alerts" || tab === "radiology") {
      setClinicTab(tab);
    }
    if (!fromSeek) navigate("/clinic", { replace: true });
  }, [searchParams, openChart, navigate, setCurrentDate]);

  const onStatusChange = async (
    encounterId: string,
    status: Parameters<typeof handleStatusChange>[1],
  ) => {
    try {
      await handleStatusChange(encounterId, status);
      await refreshQueue();
    } catch (e) {
      console.error(e);
    }
  };

  const applySession = (next: ClinicSession, firstEnter: boolean) => {
    saveClinicSession(next);
    setSession(next);
    setCurrentDate(next.date);
    setGateOpen(false);
    if (firstEnter) setEntered(true);
    else closeChart();
  };

  const confirmNewRegister = async (allowDuplicate = false) => {
    if (!apiMode) {
      setConfirmError("掛號需 API 模式");
      return;
    }
    const pageShift = session?.shift || confirmForm.shift;
    const hits = pendingDuplicateHits(queue, confirmForm, pageShift);
    if (!allowDuplicate && hits.length) {
      dupGo.current = () => {
        setDupAsk(null);
        void confirmNewRegister(true);
      };
      setDupAsk(hits);
      return;
    }
    let bureauSameDay = false;
    setConfirmError(null);
    setSeqNote(null);
    const skipSeq =
      Boolean(confirmForm.prebook) ||
      isDepositHold(confirmForm) ||
      confirmForm.icException === "selfPay";
    if (!skipSeq) setSeqBusy(true);
    setRegisterBusy(true);
    try {
      const depositHold = isDepositHold(confirmForm);
      const toSave = {
        ...(depositHold
          ? {
              ...confirmForm,
              noCardReason: "",
              deposit: confirmForm.deposit.trim() || loadClinicRegisterDefaults().depositAmount,
            }
          : confirmForm),
        shift: pageShift,
        visitClock: normalizeClock(confirmForm.visitClock || nowClock()),
        confirmDuplicate: allowDuplicate,
      };
      await submitRegisterEdit(toSave, (fields) => {
        const { seqNote: note, ...rest } = fields;
        setConfirmForm((prev) => ({ ...prev, ...rest }));
        setSeqNote(note);
        setSeqBusy(false);
        if ((note || "").includes("\u540c\u65e5\u5c31\u8a3a")) bureauSameDay = true;
      }, incoming.ask);
      const pharmacistName = (confirmForm.pharmacist ?? "").trim();
      if (pharmacistName) {
        const prev = loadClinicSession();
        saveClinicSession({
          date: currentDate,
          pharmacist: pharmacistName,
          shift: prev?.shift || session?.shift || "上午",
          dept: prev?.dept || session?.dept || "皮膚科",
        });
        setSession((s) =>
          s
            ? { ...s, pharmacist: pharmacistName }
            : {
                date: currentDate,
                pharmacist: pharmacistName,
                shift: "上午",
                dept: "皮膚科",
              },
        );
      }
      setConfirmOpen(false);
      if (toSave.encounterId) return;
      if (hits.length || bureauSameDay) setSameDayFlash(true);
      if (depositHold) {
        setDepositAsk({
          name: toSave.patientName,
          idNo: toSave.idNo,
          birthday: toSave.birthday,
          deposit: toSave.deposit || "\u2014",
          regFee: toSave.regFee || "\u2014",
          date: currentDate,
        });
      }
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : "掛號失敗");
    } finally {
      setSeqBusy(false);
      setRegisterBusy(false);
    }
  };

  const stubValues: Record<string, string> = {
    姓名: selected?.patientDisplay || confirmForm.patientName || "",
    病歷號: selected?.medicalNo || "",
    身分證: selected?.idNo || confirmForm.idNo || "",
    生日: formatBirthdayRoc(selected?.birthday || confirmForm.birthday || ""),
    性別: selected?.sex || confirmForm.sex || "",
    卡號: confirmForm.cardId || selected?.hcId || "",
    就醫序號: selected?.treatSeq || confirmForm.treatSeq || "",
    就醫識別碼: selected?.treatmentNumber || confirmForm.treatmentNumber || "",
    就醫日期時間: selected?.treatDateTime || confirmForm.treatDateTime || "",
    看診日: currentDate,
    時段: selected?.shift || confirmForm.shift || "",
    診間: selected?.room || confirmForm.room || "",
    掛號費: selected?.regFee || confirmForm.regFee || "",
    藥費: selected?.drugFee || confirmForm.drugFee || "",
    藥品費: selected?.drugFee || confirmForm.drugFee || "",
    材料費: selected?.materialFee || confirmForm.materialFee || "",
    診察費: selected?.consultFee || confirmForm.consultFee || "",
    押金: selected?.deposit || confirmForm.deposit || "",
    目前藥師:
      pharmacistDisplayName(
        selected?.pharmacist || confirmForm.pharmacist,
        staffPeople,
        selected?.pharmacist || confirmForm.pharmacist,
      ) || "",
    病患: selected?.patientDisplay || "",
  };

  const handleDeleteRegister = async (mode: "local" | "ic" | "both") => {
    if (!selectedEncounterId) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const dropped = selectedEncounterId;
      const droppedPatient = queue.find((row) => row.encounterId === dropped)?.patientId;
      retiredDraftsRef.current.add(dropped);
      dropChartDraft(dropped);
      ccDirtyRef.current = false;
      chartDirtyRef.current = false;
      forgetPatientHistory(droppedPatient);
      const res = await cancelRegister({ encounterId: dropped, mode });
      const idx = filteredQueue.findIndex((row) => row.encounterId === dropped);
      const neighbor = idx >= 0 ? filteredQueue[idx + 1] || filteredQueue[idx - 1] || null : null;
      preferAfterDeleteRef.current = neighbor?.encounterId ?? "";
      await refreshQueue();
      if (res.localCancelled) {
        setVisitDrafts((prev) => {
          if (!prev[dropped]) return prev;
          const next = { ...prev };
          delete next[dropped];
          return next;
        });
        setApiDxOverlay(null);
        setApiRxOverlay(null);
        setCcText("");
        setSelectedEncounterId(neighbor?.encounterId ?? null);
      } else {
        preferAfterDeleteRef.current = null;
      }
      setDeleteOpen(false);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "刪除掛號失敗");
    } finally {
      setDeleteBusy(false);
    }
  };

  const allergyBannerClass =
    allergies.length === 0
      ? "border-slate-300 bg-slate-100 text-slate-700"
      : allergies.some((a) => a.level === "high")
        ? "border-red-900 bg-red-700 text-white"
        : "border-red-800 bg-red-100 text-red-900";

  const selectedMedia = lesionMedia.find((m) => m.id === selectedMediaId);
  const waiting = shiftQueue.filter((e) => e.queueStatus === "waiting").length;
  const inProgress = shiftQueue.filter((e) => e.queueStatus === "in_progress").length;
  const finishedCount = shiftQueue.filter((e) => e.queueStatus === "finished").length;
  const noShowCount = shiftQueue.filter((e) => e.queueStatus === "no_show").length;
  const erCount = shiftQueue.filter(
    (e) => e.treatmentItem === "04" || /急診/.test(e.reasonText || ""),
  ).length;

  const patientEditSeed = useMemo((): PatientEditSeed | null => {
    if (patientEditOpen && finderPatient?.patientId) return finderPatient;
    const entry =
      selected ?? queue.find((q) => q.encounterId === selectedEncounterId) ?? null;
    if (!entry?.patientId) return null;
    const iso = entry.birthday || "";
    let roc = iso.replace(/\D/g, "");
    if (iso.includes("-")) {
      const [y, m, d] = iso.split("-");
      const yy = Number(y);
      if (yy >= 1911) roc = `${String(yy - 1911).padStart(3, "0")}${m}${d}`;
    }
    return {
      patientId: entry.patientId,
      name: entry.patientDisplay,
      idNo: entry.idNo || "",
      birthday: roc.slice(0, 7),
      sex: entry.sex || (entry.ageSex?.endsWith("M") ? "M" : "F"),
      medicalNo: entry.medicalNo,
    };
  }, [patientEditOpen, finderPatient, selected, queue, selectedEncounterId]);

  const certificateSeed = useMemo(() => {
    const dx = displayDiagnoses
      .map((d) => `${d.icd10 || d.nhiIcd10 || ""} ${d.text}`.trim())
      .filter(Boolean)
      .join("\n");
    return {
      patientDisplay: selected?.patientDisplay,
      idNo: selected?.idNo,
      birthday: patientEditSeed?.birthday || selected?.birthday,
      sex: selected?.sex === "M" ? "\u7537" : selected?.sex === "F" ? "\u5973" : selected?.sex || selected?.ageSex,
      age: selected?.age,
      medicalNo: selected?.medicalNo,
      address: selected?.address,
      dept: "11 \u76ae\u819a\u79d1",
      doctorName: selected?.doctorName,
      visitDate: currentDate,
      diagnosesText: dx,
    };
  }, [selected, patientEditSeed?.birthday, currentDate, displayDiagnoses]);

  const historyRxPanel = (
    <HistoryRxPanel
      visits={displayHistoryVisits}
      columns={currentRxColumns}
      fontSizePx={historyFontPx}
      hideIcd={prefs.hideHistoryIcd === true}
      showVisitDateOnRx={prefs.showHistoryRxVisitDate !== false}
      dittoCcEnabled={prefs.dittoCc !== false}
      dittoDxEnabled={prefs.dittoDx !== false}
      onDittoCc={dittoCc}
      onDittoDx={dittoDx}
      onDittoRx={dittoRx}
      onDittoVisit={dittoVisit}
      onTransferVisit={transferVisit}
      onTransferVisitNoCc={transferVisitNoCc}
      onSelectedChange={setHistoryVisit}
      onEnsureDetail={async (visit) => {
        const full = await ensureVisitDetail(visit);
        return {
          ...full,
          medications: applyClinicDrugDisplayNames(
            full.medications ?? [],
            catalog.drugs,
            catalog.usages || [],
          ),
        };
      }}
      onSaveHistory={async (visit) => {
        await runAction(() => persistHistoryVisit(visit));
      }}
      drugs={catalog.drugs}
    />
  );

  if (entered && gateOpen && leaveToLobby) {
    return (
      <div className="relative h-[calc(100vh-1rem)] overflow-hidden">
        <LobbyPage />
        <ClinicSessionGate
          initial={session}
          onConfirm={(next) => {
            gateLeaveRef.current = false;
            setLeaveToLobby(false);
            applySession(next, false);
          }}
          onCancel={() => {
            gateLeaveRef.current = false;
            setLeaveToLobby(false);
            navigate("/");
          }}
        />
      </div>
    );
  }

  if (!entered) {
    return (
      <div className="h-[calc(100vh-1rem)]" style={{ background: HIS.chrome }}>
        <ClinicSessionGate
          preferToday
          initial={session}
          onConfirm={(next) => applySession(next, true)}
          onCancel={() => navigate("/")}
        />
      </div>
    );
  }

  return (
    <div
      className="relative flex h-[calc(100vh-1rem)] flex-col overflow-hidden border"
      style={{ borderColor: HIS.chromeDark, background: HIS.chrome }}
    >
      {loading && (
        <p className="bg-sky-50 px-2 py-0 text-xs text-sky-900">載入門診工作台…</p>
      )}
      {error && (
        <p className="bg-amber-100 px-2 py-0 text-xs text-amber-900">
          {error}（請確認後端 API 已啟動）
        </p>
      )}
      {actionError && (
        <p className="bg-red-100 px-2 py-0 text-xs text-red-900">{actionError}</p>
      )}
      {chartInUse ? (
        <p className="bg-[#F8D0D0] px-3 py-2 text-center text-lg font-bold">{"\u6b63\u5728\u88ab\u5176\u4ed6\u4eba\u4f7f\u7528\u4e2d"}</p>
      ) : null}
      {saving && <p className="bg-sky-100 px-2 py-0 text-xs text-sky-900">寫入 FHIR…</p>}
      {seekEnteredBanner && (
        <p
          className="flex items-center gap-2 px-2 py-0.5 text-[11px] font-bold text-black"
          style={{ background: HIS.rowSelected }}
        >
          <span className="min-w-0 flex-1">{seekEnteredBanner}</span>
          <button
            type="button"
            className="shrink-0 border px-1 text-[10px]"
            style={{ borderColor: HIS.chromeDark }}
            onClick={() => setSeekEnteredBanner(null)}
          >
            關閉
          </button>
        </p>
      )}

      <div
        className="flex shrink-0 items-center gap-2 px-2 py-0 text-[10px] font-semibold leading-none text-white"
        style={{
          background: `linear-gradient(180deg,${HIS.titleBarFrom},${HIS.titleBarTo} 40%,${HIS.titleBarFrom})`,
          borderBottom: `1px solid ${HIS.titleBarBorder}`,
          minHeight: 18,
          ...hisFontStyle,
        }}
      >
        <span>
          {isChart
            ? `診療作業 — ${selected?.patientDisplay || ""}　年齡 ${ageYearsMonths(selected?.age || selected?.ageSex) || "—"}`
            : isList
              ? "診療作業 — 掛號清單"
              : `診療作業 — ${CLINIC_MODULE_TABS.find((t) => t.id === clinicTab)?.label || ""}`}
        </span>
        <span className="ml-auto font-normal opacity-90">
          {currentDate} · {session?.shift || ""} · {roomLabel(session?.room || "1")} · {pharmacistDisplayName(session?.pharmacist, staffPeople, session?.pharmacist) || "—"}
        </span>
        <button
          type="button"
          className="border border-white/40 bg-white/15 px-1.5 py-0 text-[10px] font-bold hover:bg-white/25"
          onClick={() => setGateOpen(true)}
        >
          換日
        </button>
      </div>

      {!isList && selectedEncounterId ? (
        <ChartPatientHead
          selected={selected}
          patientResource={patientResource as Record<string, unknown> | null}
          visitDate={currentDate}
        />
      ) : null}

      <ClinicModuleTabs
        active={clinicTab}
        onChange={handleClinicTabChange}
        hasPatient={Boolean(selectedEncounterId)}
        chartSuffix={selected?.medicalNo || null}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {isList ? (
          <div className="flex min-h-0 w-full flex-1 flex-col">
            <div
              className="flex shrink-0 flex-wrap items-center gap-3 border-b px-2 py-0.5 font-bold text-black"
              style={{
                borderColor: HIS.chromeDark,
                background: HIS.chrome,
                fontSize: HIS.fs.secondary,
                ...hisFontStyle,
              }}
            >
              {QUEUE_FILTERS.map((f) => {
                const count =
                  f.id === "all"
                    ? shiftQueue.length
                    : f.id === "finished"
                      ? finishedCount
                      : f.id === "waiting"
                        ? waiting
                        : f.id === "hold"
                          ? inProgress
                          : erCount;
                return (
                  <label key={f.id} className="flex cursor-pointer items-center gap-1">
                    <input
                      type="radio"
                      name="queue-filter"
                      checked={queueFilter === f.id}
                      onChange={() => setQueueFilter(f.id)}
                    />
                    {f.label}({count})
                  </label>
                );
              })}
              <input
                ref={queueSearchRef}
                type="search"
                placeholder="身分證／手機／生日 → Enter 找人"
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    openFinder(queueSearch);
                  }
                }}
                className="w-56 border bg-white px-1 py-0 font-normal focus:outline-none"
                style={{
                  borderColor: HIS.chromeDark,
                  fontSize: HIS.fs.secondary,
                }}
              />
              <span className="ml-auto font-normal">
                全部人數 {shiftQueue.length}　完診人數 {finishedCount}　缺診人數 {noShowCount}　候診人數 {waiting}
                {inProgress ? `　暫診 ${inProgress}` : ""}
              </span>
            </div>
            {!loading && shiftQueue.length === 0 && (
              <div className="shrink-0 border-b border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-950">
                <p className="font-bold">{currentDate} 沒有掛號紀錄</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {queueHints.nearestBefore && (
                    <button
                      type="button"
                      className="rounded border border-amber-600 bg-white px-2 py-0.5 font-bold text-amber-900 hover:bg-amber-100"
                      onClick={() => {
                        setCurrentDate(queueHints.nearestBefore!.date);
                        saveClinicSession({
                          date: queueHints.nearestBefore!.date,
                          pharmacist: session?.pharmacist || "",
                          shift: session?.shift || "上午",
                          dept: session?.dept || "皮膚科",
                        });
                        setSession((s) =>
                          s
                            ? { ...s, date: queueHints.nearestBefore!.date }
                            : {
                                date: queueHints.nearestBefore!.date,
                                pharmacist: "",
                                shift: "上午",
                                dept: "皮膚科",
                              },
                        );
                      }}
                    >
                      上一有診日 {queueHints.nearestBefore.date}（
                      {queueHints.nearestBefore.count} 人）
                    </button>
                  )}
                  {queueHints.nearestAfter && (
                    <button
                      type="button"
                      className="rounded border border-amber-600 bg-white px-2 py-0.5 font-bold text-amber-900 hover:bg-amber-100"
                      onClick={() => {
                        setCurrentDate(queueHints.nearestAfter!.date);
                        saveClinicSession({
                          date: queueHints.nearestAfter!.date,
                          pharmacist: session?.pharmacist || "",
                          shift: session?.shift || "上午",
                          dept: session?.dept || "皮膚科",
                        });
                        setSession((s) =>
                          s
                            ? { ...s, date: queueHints.nearestAfter!.date }
                            : {
                                date: queueHints.nearestAfter!.date,
                                pharmacist: "",
                                shift: "上午",
                                dept: "皮膚科",
                              },
                        );
                      }}
                    >
                      下一有診日 {queueHints.nearestAfter.date}（
                      {queueHints.nearestAfter.count} 人）
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded border border-slate-500 bg-white px-2 py-0.5 font-bold text-slate-700 hover:bg-slate-100"
                    onClick={() => setGateOpen(true)}
                  >
                    換日／換藥師
                  </button>
                </div>
              </div>
            )}
            <EncounterQueuePanel
              entries={queueForPanel}
              selectedId={selectedEncounterId}
              onSelect={setSelectedEncounterId}
              onOpen={openListPatient}
              onStatusChange={onStatusChange}
              mode="table"
              variant="page"
              showChrome={false}
              columnLabels={queueColumns}
              columnKeys={queueColumnKeys}
              fontSizePx={sections.queuePanel?.fontSizePx ?? HIS.fs.primary}
              highlighted={activeShortcutKey === "F4"}
              panelRef={queuePanelRef}
            />
          </div>
        ) : clinicTab === "history" ? (
          <div
            className="flex min-h-0 w-full flex-1 flex-col overflow-hidden gap-0 p-0"
            style={{ background: HIS.chrome }}
          >
            <div className="shrink-0">
              <PatientHeaderWidget
                clinicalProfile={clinicalProfile}
                selected={selected}
                patientResource={patientResource}
                apiMode={apiMode}
                showDevPanels={showDevPanels}
                setShowDevPanels={setShowDevPanels}
              />
            </div>
            <div
              className="min-h-0 flex-1 overflow-hidden border bg-white"
              style={{ borderColor: HIS.chromeDark }}
            >
              {historyRxPanel}
            </div>
          </div>
        ) : clinicTab === "alerts" ? (
          <div className="min-h-0 w-full flex-1 overflow-hidden bg-white">
            <ClinicalAlertsPanel
              open
              embedded
              onClose={closeChart}
              patientDisplay={selected?.patientDisplay}
              allergies={allergies}
              allergyEmpty={allergyEmpty}
              reasonText={selected?.reasonText ?? ccText}
              preVisitCompleted={selected?.preVisitCompleted}
              hasAllergyAlert={selected?.hasAllergyAlert}
            />
          </div>
        ) : clinicTab === "radiology" ? (
          <div className="min-h-0 w-full flex-1 overflow-y-auto bg-white p-4 text-sm">
            <h2 className="text-sm font-bold text-slate-900">F6 放射科檢查</h2>
            <p className="mt-2 text-slate-600">
              病患：<span className="font-semibold text-slate-900">{selected?.patientDisplay ?? "—"}</span>
            </p>
            <p className="mt-4 rounded border border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-500">
              無放射檢查資料（—）。不編造報告、不上傳健保。
            </p>
          </div>
        ) : (
          <>
            <main
              ref={mainPanelRef}
              className="flex min-w-0 flex-[65] flex-col gap-0 overflow-hidden border-r p-0"
              style={{
                background: "#FFFFFF",
                borderColor: HIS.chromeDark,
                ...hisFontStyle,
              }}
            >
              {/* 醫聖：主訴+vitals → 病名 → 藥名 → 數量鍵盤 → 底列 */}
              <div className="flex min-h-0 flex-1 flex-col gap-0">
                <div className="flex h-auto min-h-[4.25rem] max-h-[6rem] shrink-0 gap-0.5 px-0.5 pt-0.5">
                  <div className="min-w-0 flex-1">
                    <ChiefComplaintWidget
                      apiMode={apiMode}
                      saving={saving}
                      ccText={ccText}
                      setCcText={(v) => {
                        ccDirtyRef.current = true;
                        chartDirtyRef.current = true; setSaveSpent(false);
                        setCcText(v);
                      }}
                      ccChips={ccChips}
                      saveCc={saveCc}
                      active={chartFocus === "cc"}
                      onActivate={() => activateChartZone("cc")}
                    />
                  </div>
                  <ChartVitalsColumn
                    value={chartVitals}
                    onChange={(patch) => {
                      chartDirtyRef.current = true; setSaveSpent(false);
                      setChartVitals((prev) => ({ ...prev, ...patch }));
                    }}
                  />
                </div>
                <div className="h-auto min-h-[5.25rem] max-h-[8rem] shrink-0 px-0.5">
                  <DiagnosesWidget
                    maxDiagnoses={CLAIM_DX_LIMIT}
                    catalog={catalog.diagnoses}
                    displayDiagnoses={displayDiagnoses}
                    addDiagnosis={addDiagnosis}
                    onChangeDiagnosis={changeDiagnosisAt}
                    onChiefNote={(note) => setCcText((prev) => appendChiefNotes(prev, [note]))}
                    onRemove={removeDiagnosisAt}
                    historyFontPx={HIS.fs.body}
                    active={chartFocus === "dx"}
                    onActivate={() => activateChartZone("dx")}
                    selectedIndex={selectedDxIndex}
                    onSelectIndex={(i) => {
                      setSelectedDxIndex(i);
                    }}
                  />
                </div>
                <div className="min-h-0 flex-1 px-0.5">
                  <CurrentRxWidget
                    catalog={catalog}
                    addRxLines={(lines) => {
                      addRxLines(lines);
                    }}
                    currentRx={currentRx}
                    currentRxColumns={currentRxColumns}
                    apiMode={apiMode}
                    historyFontPx={HIS.fs.body}
                    mockCurrentRx={apiMode ? currentRx : mockCurrentRx}
                    setMockCurrentRx={(lines) => {
                      chartDirtyRef.current = true; setSaveSpent(false);
                      if (apiMode) setApiRxOverlay(lines);
                      else setMockCurrentRx(lines);
                    }}
                    onChangeLine={(id, patch) => {
                      chartDirtyRef.current = true; setSaveSpent(false);
                      const apply = (rows: RxLine[]) => rows.map((l) => (l.id === id ? { ...l, ...patch } : l));
                      if (apiMode) setApiRxOverlay((prev) => apply(prev ?? apiCurrentRx ?? []));
                      else if (selectedEncounterId) {
                        setCurrentRxByEncounter((prev) => ({
                          ...prev,
                          [selectedEncounterId]: apply(prev[selectedEncounterId] || []),
                        }));
                      }
                    }}
                    sections={sections}
                    prefs={prefs}
                    selectedEncounterId={selectedEncounterId}
                    commandFocusBump={commandFocusBump}
                    defaultUsages={defaultUsages}
                    usages={catalog.usages || []}
                    routes={catalog.routes || []}
                    onOpenPalette={() => setPaletteOpen(true)}
                    active={chartFocus === "rx"}
                    onActivate={() => activateChartZone("rx")}
                    selectedIndex={selectedRxIndex}
                    onSelectIndex={(i) => {
                      setSelectedRxIndex(i);
                    }}
                    rxQuery={rxQuery}
                    setRxQuery={setRxQuery}
                  />
                </div>
                <ChartQtyPad onInsert={applyQtyPadToken} />
              </div>
              {lesionOpen && (
                <div className="h-28 shrink-0">
                  <LesionPhotosWidget
                    lesionEnabled
                    lesionSectionRef={lesionSectionRef}
                    lesionMedia={lesionMedia}
                    selectedMediaId={selectedMediaId}
                    setSelectedMediaId={setSelectedMediaId}
                    selectedMedia={selectedMedia}
                  />
                </div>
              )}
              <div
                className="flex shrink-0 items-center gap-3 border-t px-2 py-0.5 text-[11px]"
                style={{ borderColor: HIS.chromeDark, background: HIS.chrome }}
              >
                <button
                  type="button"
                  className="border border-[#808080] bg-[#FFFF80] px-2 py-0 font-bold"
                  onClick={() => openNhiCloudRx()}
                  title="開啟健保雲端藥歷"
                >
                  {selected?.patientDisplay || "—"}
                </button>
                <span className="font-mono font-bold">年齡 {ageYearsMonths(selected?.age || selected?.ageSex) || "—"}</span>
                <span
                  className={`px-2 py-0 font-extrabold ${allergyBannerClass}`}
                  style={{
                    background: allergies.length ? HIS.allergyBar : "#808080",
                    color: "#fff",
                    minWidth: 120,
                  }}
                >
                  過敏　{allergies.length ? allergies.map((a) => a.text).join("、") : allergyEmpty}
                </span>
                <span className="ml-auto font-mono">{clockText}</span>
              </div>
            </main>
            <div
              ref={historyPanelRef}
              tabIndex={-1}
              className={`flex w-[35%] min-w-[18rem] shrink-0 flex-col overflow-hidden border-l bg-white outline-none ${
                activeShortcutKey === "F4" || chartRailTab === "history"
                  ? "ring-1 ring-inset ring-[#808080]"
                  : ""
              }`}
              style={{ borderColor: HIS.chromeDark }}
            >
              <div
                className="flex shrink-0 border-b"
                style={{ borderColor: HIS.chromeDark, background: HIS.chrome }}
              >
                {(
                  [
                    { id: "common" as const, label: "\u5e38\u7528" },
                    { id: "full" as const, label: "\u5b8c\u5168" },
                    { id: "oral" as const, label: "\u5167\u670d" },
                    { id: "waiting" as const, label: "\u5019\u8a3a/\u5bb6\u65cf" },
                    { id: "history" as const, label: "\u6b77\u53f2\u75c5\u6b77" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="flex-1 px-0.5 py-1 text-[12px] font-bold leading-none"
                    style={{
                      background:
                        chartRailTab === t.id ? HIS.tabActive : HIS.tabIdle,
                      color:
                        chartRailTab === t.id ? HIS.tabActiveText : HIS.tabIdleText,
                      borderRight: `1px solid ${HIS.chromeDark}`,
                      minHeight: 24,
                    }}
                    onMouseDown={(e) => {
                      // Prevent focus bounce: left CC/dx onFocus would force rail →「常用」.
                      e.preventDefault();
                      railTabClickGuardRef.current = Date.now() + 400;
                      setChartRailTab(t.id);
                      if (t.id === "oral") setChartFocus("rx");
                      else if (t.id === "waiting" || t.id === "history") {
                        historyPanelRef.current?.focus({ preventScroll: true });
                      }
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {chartRailTab === "waiting" && (
                  <OutpatientSidebarQueue
                    queue={filteredQueue}
                    selectedEncounterId={selectedEncounterId}
                    setSelectedEncounterId={setSelectedEncounterId}
                    onOpenChart={openChart}
                    currentDate={currentDate}
                    patientId={selected?.patientId}
                  />
                )}
                {chartRailTab === "history" && historyRxPanel}
                {(chartRailTab === "common" ||
                  chartRailTab === "full" ||
                  chartRailTab === "oral") && (
                  <ChartContextRail
                    focus={chartFocus === "history" ? "dx" : chartFocus}
                    railMode={chartRailTab}
                    diagnoses={catalog.diagnoses}
                    drugs={catalog.drugs}
                    packages={catalog.packages}
                    ccChips={ccChips}
                    dxQuery={dxQuery}
                    setDxQuery={setDxQuery}
                    rxQuery={rxQuery}
                    setRxQuery={setRxQuery}
                    onAddDx={(row) => {
                      addDiagnosis(row);
                      const next =
                        displayDiagnoses.length + 1 < CLAIM_DX_LIMIT
                          ? displayDiagnoses.length + 1
                          : displayDiagnoses.length;
                      setSelectedDxIndex(next);
                      setChartFocus("dx");
                    }}
                    onReject={setActionError}
                    onAddRx={(lines) => {
                      addRxLines(lines);
                      setSelectedRxIndex(currentRx.length + Math.max(lines.length, 1));
                      setChartFocus("rx");
                    }}
                    onAddCc={(text) => {
                      ccDirtyRef.current = true;
                      chartDirtyRef.current = true; setSaveSpent(false);
                      setCcText((prev) => (prev.trim() ? `${prev.trim()}; ${text}` : text));
                      setChartFocus("cc");
                    }}
                    fontSizePx={14}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <ClinicShortcutBar
        items={isChart ? [] : barItems}
        activeKey={activeShortcutKey}
        disabledKeys={[]}
        onActivate={runShortcut}
        trailing={
          <div className="flex items-center gap-1">
            {isChart ? (
              <>
                <button
                  type="button"
                  className="border px-2 py-1 text-xs font-extrabold"
                  style={{ borderColor: HIS.chromeDark, background: "#D4D0C8" }}
                  onClick={() => runShortcut("printVisit")}
                >
                  {"F6 \u5217\u5370"}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  className="border px-2 py-1 text-xs font-extrabold text-[#004000] disabled:text-[#808080]"
                  style={{ borderColor: HIS.chromeDark, background: "#C8F0C8" }}
                  onClick={() => onF9()}
                >
                  F9 存檔
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="border px-2 py-1 text-xs font-semibold text-black hover:bg-[#E8E4DC]"
              style={{ borderColor: HIS.chromeDark, background: HIS.chrome }}
              onClick={() => setCertificateOpen(true)}
            >
              其他功能
            </button>
          </div>
        }
        thinBar={
          isList ? (
            <>
              <span>F7</span>
              <span>F8</span>
              <span>F11</span>
              <span>F12</span>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center justify-center border border-[#808080] bg-[#D4D0C8] px-1 text-[13px] font-bold"
                onClick={() => {
                  if (!selectedEncounterId) {
                    setActionError("請先在清單選一位病人");
                    return;
                  }
                  setLookOpen(true);
                }}
              >
                LOOK
              </button>
              <button type="button" className="flex min-w-0 flex-1 items-center justify-center border border-[#808080] bg-[#D4D0C8] px-1 text-[13px] font-bold" onClick={() => openNhiCloudRx()}>
                雲端藥歷
              </button>
              <button type="button" className="flex min-w-0 flex-1 items-center justify-center border border-[#808080] bg-[#D4D0C8] px-1 text-[13px] font-bold" onClick={() => setPaletteOpen(true)}>
                藥組
              </button>
              <button type="button" className="flex min-w-0 flex-1 items-center justify-center border border-[#808080] bg-[#D4D0C8] px-1 text-[13px] font-bold" onClick={() => setIcInfoOpen(true)}>
                IC資訊
              </button>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center justify-center border border-[#808080] bg-[#D4D0C8] px-1 text-[13px] font-bold"
                onClick={() => {
                  if (selectedEncounterId) handleClinicTabChange("alerts");
                }}
              >
                過敏藥物
              </button>
              <button type="button" className="flex min-w-0 flex-1 items-center justify-center border border-[#808080] bg-[#D4D0C8] px-1 text-[13px] font-bold" onClick={() => setReferralOpen(true)}>
                轉診作業
              </button>
              <span>F9</span>
              <span>Esc</span>
            </>
          ) : (
            <>
              <button type="button" className="flex min-w-0 flex-1 items-center justify-center border border-[#808080] bg-[#D4D0C8] px-1 text-[13px] font-bold" onClick={() => setLookOpen(true)}>
                LOOK
              </button>
              <button type="button" className="flex min-w-0 flex-1 items-center justify-center border border-[#808080] bg-[#D4D0C8] px-1 text-[13px] font-bold" onClick={() => setPaletteOpen(true)}>
                建議
              </button>
              <button type="button" className="flex min-w-0 flex-1 items-center justify-center border border-[#808080] bg-[#D4D0C8] px-1 text-[13px] font-bold" onClick={() => setPaletteOpen(true)}>
                藥組
              </button>
              <button type="button" className="flex min-w-0 flex-1 items-center justify-center border border-[#808080] bg-[#D4D0C8] px-1 text-[13px] font-bold" onClick={() => setIcInfoOpen(true)}>
                IC資訊
              </button>
              <button type="button" className="flex min-w-0 flex-1 items-center justify-center border border-[#808080] bg-[#D4D0C8] px-1 text-[13px] font-bold" onClick={() => setReferralOpen(true)}>
                轉診
              </button>
              <button
                type="button"
                disabled={saving}
                className="flex min-w-0 flex-1 items-center justify-center border border-[#808080] px-1 text-[13px] font-extrabold text-[#004000] disabled:text-[#808080]"
                style={{ background: "#C8F0C8" }}
                onClick={() => onF9()}
              >
                F9 存檔
              </button>
              <button type="button" className="flex min-w-0 flex-1 items-center justify-center border border-[#808080] bg-[#FFFF80] px-1 text-[13px] font-bold" onClick={closeChart}>
                {searchParams.get("from") === "emr" ? "回調閱" : "Esc 回清單"}
              </button>
            </>
          )
        }
      />

      <ReferralSlipDialog
        open={referralOpen}
        encounterId={selectedEncounterId || ""}
        onClose={() => setReferralOpen(false)}
        seed={{
          name: selected?.patientDisplay || "",
          sex: selected?.sex === "M" ? "男" : selected?.sex === "F" ? "女" : selected?.sex || "",
          birthday: String((patientResource as { birthDate?: string } | null)?.birthDate || ""),
          medicalNo: selected?.medicalNo || "",
          idNo: selected?.idNo || "",
          phone: selected?.phone || "",
          address: selected?.address || "",
          chief: ccText,
          diagnoses: displayDiagnoses
            .map((d) => [d.icd10 || d.nhiIcd10 || "", d.text].filter((part) => part.trim()).join(" ").trim())
            .filter(Boolean)
            .join("\n"),
          meds: "",
          doctorName: selected?.doctorName || "",
          allergy: allergies.map((a) => a.text).filter(Boolean).join("、"),
        }}
      />
      <SameDayFlash open={sameDayFlash} onClose={() => setSameDayFlash(false)} />
      <SameDayRegisterDialog
        open={dupAsk != null}
        hits={dupAsk || []}
        onConfirm={() => dupGo.current?.()}
        onCancel={() => setDupAsk(null)}
      />
      <PatientLookDialog
        open={lookOpen}
        patientId={selected?.patientId ?? null}
        patientName={selected?.patientDisplay || ""}
        medicalNo={selected?.medicalNo || ""}
        onClose={() => setLookOpen(false)}
      />

      {incoming.dialog}
      {replyAsk ? (
        <ReferralReplyDialog
          serial={replyAsk.serial}
          hosp={replyAsk.hosp}
          patientName={replyAsk.patientName}
          diagnosis={replyAsk.dx}
          meds={replyAsk.meds}
          note={replyAsk.note}
          encounterId={selectedEncounterId || ""}
          busy={replyBusy}
          error={replyError}
          onSkip={finishReply}
          onSend={(draft) => {
            if (!selectedEncounterId) return;
            setReplyBusy(true);
            setReplyError("");
            void saveReferralSlip({
              kind: "reply",
              encounterId: selectedEncounterId,
              patientName: selected?.patientDisplay || "",
              medicalNo: selected?.medicalNo || "",
              idNo: selected?.idNo || "",
              destHosp: replyAsk.hosp,
              serial: draft.serial,
              diagnosis: draft.diagnosis,
              note: draft.note,
              treatText: draft.drugs || replyAsk.meds,
              historyText: draft.aux,
              drugs: draft.drugs,
              aux: draft.aux,
              handoff: draft.note,
              purpose: draft.purpose,
              doctor: selected?.doctorName || "",
              status: "\u5df2\u5b58\u6a94",
            })
              .then(() => {
                setCardNote("\u8f49\u8a3a\u56de\u8986\u5df2\u5b58\u6a94\u3002\u4e0a\u50b3\u8acb\u5230\u53e6\u4e00\u53f0\u96fb\u8166\u7528\u8f49\u8a3a\u4e0a\u50b3\u5de5\u5177\u3002");
                finishReply();
              })
              .catch((err: unknown) => {
                setReplyError(err instanceof Error ? err.message : "\u56de\u8986\u5b58\u6a94\u5931\u6557");
              })
              .finally(() => setReplyBusy(false));
          }}
        />
      ) : null}
      {cloudAgainAsk ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35"
          style={{ fontFamily: HIS_FONT }}
          onKeyDown={(ev) => {
            if (ev.key === "Escape") {
              ev.preventDefault();
              setCloudAgainAsk(false);
            }
          }}
        >
          <div className="w-[min(28rem,94vw)] border border-black bg-[#F4F1EA] p-3 text-[14px] shadow-lg">
            <div className="mb-2 text-[16px] font-bold">{"\u9019\u7b46\u5df2\u7d93\u5beb\u5165\u904e\u96f2\u7aef"}</div>
            <p className="mb-3 leading-snug">
              {"\u82e5\u9019\u6b21\u53ea\u6539\u81ea\u8cbb\u6216\u7528\u6cd5\uff0c\u53ef\u4ee5\u4e0d\u518d\u4e0a\u50b3\u3002\u9078\u5426\u5c31\u4e0d\u5fc5\u63d2\u5065\u4fdd\u5361\uff0c\u4e5f\u4e0d\u6703\u518d\u5beb\u4e00\u6b21\u3002"}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="border border-[#808080] bg-white px-3 py-1 font-bold"
                onClick={() => {
                  setSaveDraft((d) => ({ ...d, writeCard: false }));
                  setCloudAgainAsk(false);
                  setSaveLayerOpen(true);
                }}
              >
                {"\u4e0d\u7528\u518d\u4e0a\u50b3"}
              </button>
              <button
                type="button"
                className="border border-[#004d00] bg-[#C8F0C8] px-3 py-1 font-bold"
                onClick={() => {
                  setSaveDraft((d) => ({ ...d, writeCard: true }));
                  setCloudAgainAsk(false);
                  setSaveLayerOpen(true);
                }}
              >
                {"\u8981\u518d\u4e0a\u50b3"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <VisitSaveConfirmPanel
        open={saveLayerOpen}
        locked={saveSpent}
        saving={saving}
        cardNote={cardNote}
        selected={selected}
        ccText={ccText}
        currentRx={currentRx}
        draft={saveDraft}
        waiting={shiftQueue
          .filter((e) => !e.prebook && (e.queueStatus === "waiting" || e.queueStatus === "in_progress"))
          .slice()
          .sort((a, b) => (Number(a.queueNumber) || 0) - (Number(b.queueNumber) || 0))
          .map((e) => ({
            encounterId: e.encounterId,
            queueNumber: e.queueNumber,
            patientDisplay: e.patientDisplay,
            queueStatus: e.queueStatus,
          }))}
        onChange={(patch) => {
          setSaveDraft((d) => ({ ...d, ...patch }));
        }}
        onClose={closeSaveLayer}
        onConfirm={() => void confirmSave()}
        onPrint={printVisitReceipt}
        printNote={printNote}
        onPickWaiting={(id) => {
          setSaveLayerOpen(false);
          openChart(id);
        }}
      />

      <ClinicBigPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        drugs={catalog.drugs}
        diagnoses={catalog.diagnoses}
        packages={catalog.packages}
        onAddRx={addRxLines}
        onAddDx={addDiagnosis}
      />
      <RegisterOptionsDialog
        open={registerOptionsOpen}
        onClose={() => setRegisterOptionsOpen(false)}
        initialQuery={queueSearch}
        pharmacist={session?.pharmacist || lastPharmacist()}
        selectedLabel={
          selected
            ? `${selected.patientDisplay || ""} [${selected.medicalNo || ""}] \u6848\u4ef6:${selected.caseNo || "\u2014"} \u5e8f:${selected.queueNumber ?? "\u2014"}`
            : undefined
        }
        onIcRegister={() => goRegisterByCard()}
        onSearchPatients={(q) => openFinder(q)}
        onPatientPicked={onPatientPickedForRegister}
        onNoCardRegister={(q) => {
          openFinder(q || queueSearch);
        }}
        onEditSelected={() => openF3RegisterEdit()}
        onIcRelated={applyRegisterHub}
        onOtherQuery={applyRegisterHub}
      />
      <PatientEditDialog
        open={patientEditOpen}
        onClose={closePatientEdit}
        seed={patientEditSeed}
        onSaved={() => {
          setLeaveAsk(false);
          if (clinicTab !== "list") closeChartNow(false);
          else void refreshQueue();
        }}
      />
      <CertificateDialog
        open={certificateOpen}
        onClose={() => setCertificateOpen(false)}
        onOpenReferral={() => {
          setCertificateOpen(false);
          setReferralOpen(true);
        }}
        seed={certificateSeed}
      />
      <PatientFinderDialog
        open={finderOpen}
        paused={patientEditOpen}
        initialQuery={finderSeed}
        onClose={() => setFinderOpen(false)}
        onSelect={onPatientPickedForRegister}
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
          onPatientPickedForRegister(hit);
        }}
      />
      <PrebookArriveDialog
        open={prebookAskId != null}
        onYes={() => {
          const id = prebookAskId;
          setPrebookAskId(null);
          if (id) setNoCardAskId(id);
        }}
        onNo={() => setPrebookAskId(null)}
      />
      <PrebookNoCardDialog
        open={noCardAskId != null}
        onDeposit={() => openPrebookChoice("deposit")}
        onSelfPay={() => openPrebookChoice("selfPay")}
        onNo={() => setNoCardAskId(null)}
      />
      <AppointmentCheckInDialog
        open={checkInAsk != null}
        onYes={() => {
          const cur = checkInAsk;
          setCheckInAsk(null);
          if (!cur) return;
          const row = queue.find((e) => e.encounterId === cur.encounterId);
          openConfirmFromSeed({
            ...(row ? seedFromEntry(row) : {}),
            ...cur.seed,
            encounterId: cur.encounterId,
            queueNumber: cur.queueNumber,
            visitClock: cur.visitClock || cur.seed.visitClock,
            prebook: false,
            payType: "4",
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
        busy={registerBusy}
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
        onConfirm={confirmNewRegister}
        lockedShift={session?.shift}
        onReadCard={async () => {
          try {
            setConfirmError(null);
            setCardDiagnose(null);
            await fillConfirmFromCard();
          } catch (e) {
            setConfirmError(e instanceof Error ? e.message : "讀卡失敗");
            setCardDiagnose(e instanceof CardReadError ? e.diagnose : null);
          }
        }}
      />
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
          setPrintMenuOpen(false);
          printVisitReceipt();
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
                style={{ borderColor: "#808080", background: "#FFFFC0" }}
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
                      medicalNo: depositAsk.medicalNo || "",
                      idNo: depositAsk.idNo,
                      birthday: depositAsk.birthday,
                      date: depositAsk.date,
                      deposit: depositAsk.deposit,
                      ...depositPrintOptions(findPrintSetup(loadPrintSettings(), "deposit")),
                    }),
                  });
                  setDepositAsk(null);
                }}
              >
                是，印押金單
              </button>
              <button
                type="button"
                className="border px-3 py-1 text-[12px] font-bold"
                style={{ borderColor: "#808080", background: "#fff" }}
                onClick={() => setDepositAsk(null)}
              >
                否
              </button>
            </div>
          </div>
        </div>
      )}
      {leaveAsk && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35">
          <div
            className="w-[min(26rem,92vw)] border bg-[#F0F0F0] shadow-lg"
            style={{ borderColor: HIS.chromeDark, fontFamily: HIS_FONT }}
          >
            <div className="bg-[#2060A0] px-2 py-1 text-xs font-bold text-white">
              資料有異動您確定要離開嗎？
            </div>
            <p className="px-3 py-4 text-[13px] leading-relaxed text-black">
              資料有異動你確定不存檔離開嗎
            </p>
            <div ref={leaveBoxRef} className="flex justify-end gap-1 border-t px-2 py-2" style={{ borderColor: HIS.chromeDark }}>
              <button
                type="button"
                className="border px-2 py-0.5 text-xs font-bold"
                style={{ borderColor: "#404040", background: "#FFFF80" }}
                onClick={() => {
                  const intent = leaveIntentRef.current;
                  setLeaveAsk(false);
                  afterSaveLeaveRef.current = () => {
                    leaveIntentRef.current = null;
                    if (intent?.kind === "open") {
                      leaveBypassRef.current = true;
                      openChart(intent.encounterId, intent.opts);
                      return;
                    }
                    closeChartNow(true);
                  };
                  void openSaveLayer();
                }}
              >
                存檔離開
              </button>
              <button
                type="button"
                className="border px-2 py-0.5 text-xs font-bold"
                style={{ borderColor: "#404040", background: "#F0F0F0" }}
                onClick={() => runLeaveIntent(true)}
              >
                不存檔離開
              </button>
              <button
                type="button"
                className="border px-2 py-0.5 text-xs"
                style={{ borderColor: "#404040", background: "#F0F0F0" }}
                onClick={() => {
                  leaveIntentRef.current = null;
                  afterSaveLeaveRef.current = null;
                  setLeaveAsk(false);
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
      <DeleteRegisterDialog
        open={deleteOpen}
        busy={deleteBusy}
        error={deleteError}
        patientDisplay={selected?.patientDisplay}
        hasTreatSeq={Boolean(selected?.treatSeq)}
        onClose={() => setDeleteOpen(false)}
        onDelete={handleDeleteRegister}
      />
      {gateOpen && entered && (
        <ClinicSessionGate
          initial={session}
          onConfirm={(next) => {
            gateLeaveRef.current = false;
            setLeaveToLobby(false);
            applySession(next, false);
          }}
          onCancel={() => {
            if (gateLeaveRef.current) {
              gateLeaveRef.current = false;
              setLeaveToLobby(false);
              navigate("/");
              return;
            }
            setLeaveToLobby(false);
            setGateOpen(false);
          }}
        />
      )}
      <IcCardInfoDialog
        open={icInfoOpen}
        onClose={() => setIcInfoOpen(false)}
        treatSeq={selected?.treatSeq}
        treatmentNumber={selected?.treatmentNumber}
        treatDateTime={selected?.treatDateTime}
        cardNo={selected?.hcId}
      />
      <HisStubDialog
        stubId={stubId}
        patientDisplay={selected?.patientDisplay}
        values={stubValues}
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
