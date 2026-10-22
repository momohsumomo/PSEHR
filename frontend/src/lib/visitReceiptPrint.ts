import { fetchStaff, fetchWorkspace, type WorkspaceResponse } from "@/api/clinicApi";
import { pharmacistDisplayName } from "@/lib/doctorName";
import { buildDepositSlipHtml } from "@/lib/clinicPrintDocs";
import { readLocalClinicBundle } from "@/lib/clinicProfile";
import { lastClinicDept } from "@/lib/clinicSession";
import { openPrintPreview } from "@/lib/printJob";
import { depositPrintOptions, findPrintSetup, loadPrintSettings, partOn } from "@/lib/printSettings";
import { openReleaseRxIfWanted } from "@/lib/releaseRx";
import { buildSimpleSlipHtml, visitCashParts } from "@/lib/simpleSlip";
import type { DiagnosisRow, QueueEntry, RxLine, RxPayMark } from "@/mocks/clinicMocks";

export function openDepositSlip(entry: QueueEntry, visitDate: string): void {
  const clinic = readLocalClinicBundle().profile;
  const opts = depositPrintOptions(findPrintSetup(loadPrintSettings(), "deposit"));
  void openPrintPreview({
    kind: "receipt",
    layout: "sheet",
    setupId: "deposit",
    title: "\u62bc\u91d1\u55ae",
    lines: [],
    bodyHtml: buildDepositSlipHtml({
      clinicName: clinic.clinicName,
      patientName: entry.patientDisplay || "",
      medicalNo: entry.medicalNo || "",
      idNo: entry.idNo,
      birthday: entry.birthday,
      date: visitDate,
      deposit: entry.deposit || "",
      ...opts,
    }),
  });
}

function diagnosesOf(ws: WorkspaceResponse): DiagnosisRow[] {
  return (ws.diagnoses || []).map((row) => {
    const meta = row.indexMeta ?? {};
    const resource = (row.resource ?? {}) as { id?: string };
    return {
      id: resource.id,
      icd10: String(meta.icd10Code ?? ""),
      nhiIcd10: meta.nhiIcd10Code ? String(meta.nhiIcd10Code) : undefined,
      text: String(meta.summaryText ?? ""),
    };
  });
}

function marksOf(resource: Record<string, unknown>): { payMark: string; memo: string; bodySite: string } {
  const exts = (resource.extension as Array<Record<string, unknown>> | undefined) || [];
  let payMark = "";
  let memo = "";
  let bodySite = "";
  for (const ext of exts) {
    const url = String(ext.url || "");
    if (url.endsWith("/payMark")) payMark = String(ext.valueString || "");
    if (url.endsWith("/memoMark")) memo = String(ext.valueString || "");
    if (url.endsWith("/bodySite")) bodySite = String(ext.valueString || "");
  }
  return { payMark, memo, bodySite };
}

function drugsOf(ws: WorkspaceResponse): RxLine[] {
  return (ws.currentMedications || []).map((row, index) => {
    const meta = row.indexMeta ?? {};
    const resource = (row.resource ?? {}) as Record<string, unknown>;
    const dosage = (resource.dosageInstruction as Array<{ text?: string }> | undefined)?.[0];
    const marks = marksOf(resource);
    const mark = (marks.payMark || String(meta.payMark || "")) as RxPayMark;
    const days = Number(meta.daysSupply);
    const qty = Number(meta.quantity);
    return {
      id: String(resource.id ?? `rx-${index}`),
      name: String(meta.drugText ?? ""),
      sig: String(meta.useage || dosage?.text || ""),
      days: Number.isFinite(days) && days > 0 ? days : 0,
      qty: Number.isFinite(qty) && qty > 0 ? qty : undefined,
      nhiCode: String(meta.nhiCode ?? ""),
      route: "po",
      payMark: mark,
      selfPay: mark === "\u81ea" || mark === "\u6750",
      memo: marks.memo || String((meta as { memo?: string }).memo || ""),
      bodySite: marks.bodySite,
      unitPrice: meta.unitPrice == null ? undefined : Number(meta.unitPrice),
    };
  });
}

/** Saved visit, same dual receipt as the chart print. */
export async function openSavedVisitReceipt(entry: QueueEntry, visitDate: string): Promise<void> {
  const ws = await fetchWorkspace(entry.encounterId, { historyLimit: 0 });
  let people: { id: string; name: string }[] = [];
  try {
    people = await fetchStaff();
  } catch {
    people = [];
  }
  const pharmacistName = pharmacistDisplayName(entry.pharmacist, people, "");
  const clinic = readLocalClinicBundle();
  const setup = findPrintSetup(loadPrintSettings(), "simple");
  const profile = clinic.profile;
  const sent = await openPrintPreview({
    kind: "receipt",
    layout: "paged",
    setupId: "simple",
    title: "\u7c21\u5f0f\u4ea4\u4ed8\u8655\u65b9\u7c3d",
    lines: [],
    bodyHtml: buildSimpleSlipHtml({
      medicalNo: entry.medicalNo || "",
      name: entry.patientDisplay || "",
      sex: entry.sex || entry.ageSex || "",
      idNo: entry.idNo || "",
      birthday: entry.birthday || "",
      age: entry.age || "",
      visitDate,
      dept: profile.mainDept || lastClinicDept(),
      caseNo: entry.caseNo || "",
      cardNo: entry.treatSeq || "",
      doctor: entry.doctorName || "",
      pharmacist: pharmacistName,
      chief: ws.chiefComplaint || entry.reasonText || "",
      diagnoses: diagnosesOf(ws),
      drugs: drugsOf(ws),
      room: entry.room || "",
      queueNo: entry.queueNumber != null ? String(entry.queueNumber) : "",
      deposit: visitCashParts(entry).deposit,
      regFee: visitCashParts(entry).regFee,
      burden: visitCashParts(entry).burden,
      selfPay: entry.selfPay || "",
      clinicName: profile.clinicName,
      address: profile.address,
      clinicCode: profile.clinicCode,
      phone: profile.phone,
      dispenseDate: visitDate,
      pharmacy: entry.dispense || "\u672c\u9662\u6240",
      consultFee: entry.consultFee || "",
      drugFee: entry.drugFee || "",
      materialFee: entry.materialFee || "",
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
  });
  if (!sent.printed) return;
  await openReleaseRxIfWanted({
    caseNo: entry.caseNo || "",
    clinicName: profile.clinicName,
    clinicCode: profile.clinicCode,
    address: profile.address,
    phone: profile.phone,
    name: entry.patientDisplay || "",
    idNo: entry.idNo || "",
    sex: entry.sex || entry.ageSex || "",
    birthday: entry.birthday || "",
    medicalNo: entry.medicalNo || "",
    dept: profile.mainDept || lastClinicDept(),
    visitDate,
    cardNo: entry.treatSeq || "",
    queueNo: entry.queueNumber != null ? String(entry.queueNumber) : "",
    doctor: entry.doctorName || "",
    pharmacist: pharmacistName,
    diagnoses: diagnosesOf(ws).map((row) => ({
      code: row.icd10 || row.nhiIcd10 || "",
      text: row.text || "",
    })),
    drugs: drugsOf(ws).map((row) => ({
      name: row.name,
      sig: row.sig,
      days: row.days || 0,
      qty: row.qty == null ? "" : String(row.qty),
      total: row.totalAmount == null ? "" : String(row.totalAmount),
    })),
  });
}
