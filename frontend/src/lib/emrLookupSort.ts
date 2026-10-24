export type SortKey = "name" | "date" | "serno" | "case" | "card" | "makeup" | "done";
export type SortDir = "asc" | "desc";

export type EmrSortRow = {
  resource?: { id?: string };
  queueMeta?: {
    patientDisplay?: string;
    encounterDate?: string;
    queueNumber?: number;
    caseNo?: string;
    cardWritten?: boolean;
    afterCheck?: string;
    queueStatus?: string;
    fhirStatus?: string;
  };
};

function cmpName(a: string, b: string): number {
  return a.localeCompare(b, "zh-Hant-u-co-zhuyin", { numeric: true, sensitivity: "base" });
}

function rowFinished(q: EmrSortRow["queueMeta"]): boolean {
  return q?.queueStatus === "finished" || q?.fhirStatus === "finished";
}

export function compareEmrRows(a: EmrSortRow, b: EmrSortRow, key: SortKey): number {
  const qa = a.queueMeta || {};
  const qb = b.queueMeta || {};
  const byName = () => cmpName(String(qa.patientDisplay || ""), String(qb.patientDisplay || ""));
  const byDate = () => String(qa.encounterDate || "").localeCompare(String(qb.encounterDate || ""));
  const bySerno = () => Number(qa.queueNumber || 0) - Number(qb.queueNumber || 0);
  let primary = 0;
  if (key === "name") primary = byName();
  else if (key === "date") primary = byDate();
  else if (key === "serno") primary = bySerno();
  else if (key === "case") primary = cmpName(String(qa.caseNo || ""), String(qb.caseNo || ""));
  else if (key === "card") primary = Number(!!qa.cardWritten) - Number(!!qb.cardWritten);
  else if (key === "makeup") primary = Number(String(qa.afterCheck) === "2") - Number(String(qb.afterCheck) === "2");
  else primary = Number(rowFinished(qa)) - Number(rowFinished(qb));
  if (primary !== 0) return primary;
  if (key !== "name") {
    const name = byName();
    if (name !== 0) return name;
  }
  if (key !== "date") {
    const date = byDate();
    if (date !== 0) return date;
  }
  if (key !== "serno") {
    const serno = bySerno();
    if (serno !== 0) return serno;
  }
  return String(a.resource?.id || "").localeCompare(String(b.resource?.id || ""));
}
