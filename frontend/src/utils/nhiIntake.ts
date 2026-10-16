import type { DiagnosisRow, RxLine } from "@/mocks/clinicMocks";

const ICD10_RE = /^[A-Z]\d{2}(\.\d{1,4})?$/i;
const NHI_ICD_RE = /^[A-Z0-9]{3,10}$/i;
const NHI_MED_RE = /^[A-Z0-9]{4,16}$/i;
const RXNORM_RE = /^\d{1,10}$/;

export function extractPatientIdNo(
  patient: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!patient) return undefined;
  const identifiers = patient.identifier as Array<{ value?: string }> | undefined;
  const value = identifiers?.[0]?.value?.trim();
  return value || undefined;
}

export function buildConditionIntake(
  encounterId: string,
  dx: DiagnosisRow,
  _patientIdNo?: string,
): Record<string, string | undefined> {
  // Do not send patientIdNo: encounterId already binds the patient;
  // clinic-imported IDs often fail checksum and block clinical writes.
  void _patientIdNo;
  const summaryText = dx.text.trim();
  const body: Record<string, string | undefined> = {
    encounterId,
    summaryText,
  };
  const icd = dx.icd10?.trim();
  if (icd && ICD10_RE.test(icd)) {
    body.icd10Code = icd.toUpperCase();
  }
  const nhiRaw = (dx.nhiIcd10 || icd || "").replace(/\./g, "").trim();
  if (nhiRaw && NHI_ICD_RE.test(nhiRaw)) {
    body.nhiIcd10Code = nhiRaw.toUpperCase();
  }
  if (!body.icd10Code && !body.nhiIcd10Code && icd) {
    const stripped = icd.replace(/\./g, "");
    if (NHI_ICD_RE.test(stripped)) {
      body.nhiIcd10Code = stripped.toUpperCase();
    }
  }
  return body;
}

export function buildMedicationIntake(
  encounterId: string,
  line: RxLine,
  patientIdNo?: string,
): Record<string, string | number | undefined> {
  const nhiCode = line.nhiCode.trim().toUpperCase();
  if (!NHI_MED_RE.test(nhiCode)) {
    throw new Error(`健保碼格式無效：${line.nhiCode}`);
  }
  void patientIdNo;
  const body: Record<string, string | number | undefined> = {
    encounterId,
    drugText: line.name.trim(),
    nhiCode,
    sig: line.sig?.trim() || "\u4f9d\u91ab\u56d1",
    daysSupply: line.days > 0 ? line.days : 1,
    quantity: (line.qty ?? 0) > 0 ? Number(line.qty) : 1,
    bodySite: line.bodySite?.trim() || "",
  };
  if (line.rxnorm && RXNORM_RE.test(line.rxnorm)) {
    body.rxnormCode = line.rxnorm;
  }
  return body;
}

export function buildSoapIntake(
  encounterId: string,
  chiefComplaint: string,
  assessment?: string,
  plan?: string,
  patientIdNo?: string,
): Record<string, string | undefined> {
  void patientIdNo;
  return {
    encounterId,
    chiefComplaint: chiefComplaint.trim(),
    assessment: (assessment?.trim() || "\u81e8\u5e8a\u8a55\u4f30").slice(0, 8000),
    plan: (plan?.trim() || "\u4f9d\u75c5\u6cc1\u8655\u7f6e").slice(0, 8000),
    subjective: "",
    objective: "",
  };
}
