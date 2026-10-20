import { fetchPatientVisits, fetchPatients, fetchWorkspace } from "@/api/clinicApi";

function orderLines(
  rows: Array<{ indexMeta?: Record<string, unknown>; resource?: Record<string, unknown> }>,
): string {
  return rows
    .map((row) => {
      const meta = row.indexMeta ?? {};
      const resource = row.resource ?? {};
      const dosage = (resource.dosageInstruction as Array<{ text?: string }> | undefined)?.[0]?.text || "";
      const name = String(meta.drugText || "");
      const sig = String(meta.useage || dosage || "");
      const days = Number(meta.daysSupply || 0);
      const dayText = days > 0 ? `${days}\u5929` : "";
      return [name, sig, dayText].filter((part) => part.trim()).join(" ");
    })
    .filter(Boolean)
    .join("\n");
}

export async function chartDittoText(encounterId: string, part: "drugs" | "chief"): Promise<string> {
  const id = encounterId.trim();
  if (!id) throw new Error("\u9019\u7b46\u6c92\u6709\u5c0d\u5230\u770b\u8a3a\u3002");
  const ws = await fetchWorkspace(id, { historyLimit: 0 });
  if (part === "chief") {
    const text = (ws.chiefComplaint || "").trim();
    if (!text) throw new Error("\u9019\u6b21\u770b\u8a3a\u6c92\u6709\u4e3b\u8ff0\u53ef\u6284\u3002");
    return text;
  }
  const text = orderLines(ws.currentMedications || []);
  if (!text) throw new Error("\u9019\u6b21\u770b\u8a3a\u6c92\u6709\u91ab\u4ee4\u53ef\u6284\u3002");
  return text;
}

function toIso(text: string): string {
  const raw = text.trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const roc = raw.match(/^(\d{2,3})[./](\d{1,2})[./](\d{1,2})/);
  if (!roc) return "";
  const y = String(Number(roc[1]) + 1911);
  const m = roc[2].padStart(2, "0");
  const d = roc[3].padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dxLines(rows: Array<{ indexMeta?: Record<string, unknown> }>): string {
  return rows
    .map((row) => {
      const meta = row.indexMeta ?? {};
      const code = String(meta.icd10Code || meta.nhiIcd10Code || "");
      const text = String(meta.summaryText || "");
      return [code, text].filter((part) => part.trim()).join(" ");
    })
    .filter(Boolean)
    .join("\n");
}

/** First visit on or after the referral arrived. If that date is unknown, the latest visit. */
export async function autoDittoReplyChart(opts: {
  idNo?: string;
  medicalNo?: string;
  receivedOn?: string;
}): Promise<{ drugs: string; chief: string; diagnosis: string } | null> {
  const key = (opts.idNo || opts.medicalNo || "").trim();
  if (!key) return null;
  const found = await fetchPatients({ idNo: key, _count: 5 });
  const patientId = found.entry?.[0]?.resource?.id || "";
  if (!patientId) return null;
  const hist = await fetchPatientVisits(patientId, 80, { light: true });
  const visits = (hist.entry || [])
    .map((row) => ({
      encounterId: String(row.encounterId || ""),
      visitDate: String(row.visitDate || "").slice(0, 10),
    }))
    .filter((row) => row.encounterId && row.visitDate)
    .sort((a, b) => a.visitDate.localeCompare(b.visitDate));
  if (!visits.length) return null;
  const anchor = toIso(opts.receivedOn || "");
  const after = anchor ? visits.filter((row) => row.visitDate >= anchor) : [];
  const picked = after[0] || visits[visits.length - 1];
  const ws = await fetchWorkspace(picked.encounterId, { historyLimit: 0 });
  return {
    drugs: orderLines(ws.currentMedications || []),
    chief: (ws.chiefComplaint || "").trim(),
    diagnosis: dxLines(ws.diagnoses || []),
  };
}
