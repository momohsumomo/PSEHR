/** Hand one claim visit to the chart lookup. Stays in this browser. */

export const CLAIMS_EMR_KEY = "psehr-claims-emr";

export type ClaimsEmrSeed = {
  date: string;
  chartPatientId: string;
  encounterId: string;
  medicalNo: string;
  patientName: string;
};

export function stageClaimsEmr(seed: ClaimsEmrSeed): void {
  sessionStorage.setItem(CLAIMS_EMR_KEY, JSON.stringify(seed));
}

export function takeClaimsEmr(): ClaimsEmrSeed | null {
  const raw = sessionStorage.getItem(CLAIMS_EMR_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(CLAIMS_EMR_KEY);
  try {
    const data = JSON.parse(raw) as ClaimsEmrSeed;
    if (!data || typeof data.date !== "string") return null;
    return data;
  } catch {
    return null;
  }
}
