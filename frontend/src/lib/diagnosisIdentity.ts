/** One diagnosis on a visit. Dots and spaces in the code do not make it a different disease. */

export type DiagnosisIdentity = {
  nhiIcd10?: string;
  icd10?: string;
  text?: string;
};

export function diagnosisCode(row: DiagnosisIdentity): string {
  return (row.nhiIcd10 || row.icd10 || "").replace(/[.\s]/g, "").toUpperCase();
}

export function diagnosisText(row: DiagnosisIdentity): string {
  return (row.text || "").replace(/\s/g, "").toUpperCase();
}

export function diagnosisKey(row: DiagnosisIdentity): string {
  return diagnosisCode(row) || diagnosisText(row);
}

export function sameDiagnosis(a: DiagnosisIdentity, b: DiagnosisIdentity): boolean {
  const codeA = diagnosisCode(a);
  const codeB = diagnosisCode(b);
  if (codeA && codeB && codeA === codeB) return true;
  const textA = diagnosisText(a);
  const textB = diagnosisText(b);
  return Boolean(textA && textB && textA === textB);
}

export function diagnosisTaken(
  rows: DiagnosisIdentity[],
  row: DiagnosisIdentity,
  except?: number,
): boolean {
  if (!diagnosisCode(row) && !diagnosisText(row)) return false;
  return rows.some((item, index) => index !== except && sameDiagnosis(item, row));
}
