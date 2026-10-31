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

export const CLAIMS_RETURN_KEY = "psehr-claims-return";

export type ClaimSlipFilter = "all" | "issue" | "block" | "warn";

/** Where the claim check was when someone left to fix a chart. Read again when the check page opens. */
export type ClaimsReturn = {
  job: "check" | "build";
  month: string;
  submitType: "songhe" | "bubao";
  filter: ClaimSlipFilter;
  encounterId: string;
};

export function stageClaimsReturn(back: ClaimsReturn): void {
  sessionStorage.setItem(CLAIMS_RETURN_KEY, JSON.stringify(back));
}

export function peekClaimsReturn(): ClaimsReturn | null {
  const raw = sessionStorage.getItem(CLAIMS_RETURN_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as ClaimsReturn;
    if (!data || (data.job !== "check" && data.job !== "build") || !/^\d{4}-\d{2}$/.test(data.month)) return null;
    return data;
  } catch {
    return null;
  }
}

export function takeClaimsReturn(): ClaimsReturn | null {
  const data = peekClaimsReturn();
  sessionStorage.removeItem(CLAIMS_RETURN_KEY);
  return data;
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
