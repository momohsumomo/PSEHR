import { crosswalkDiagnosis } from "@/api/clinicApi";
import type { DiagnosisRow } from "@/mocks/clinicMocks";

/** A finished ICD-9 the doctor has stopped inside, not a half-typed category. */
export function readyIcd9(code: string): boolean {
  const t = code.trim().toUpperCase();
  if (/^\d{3}\.\d{1,2}$/.test(t)) return true;
  if (/^\d{4,5}$/.test(t)) return true;
  if (/^[VE]\d{3,4}$/.test(t)) return true;
  if (/^[VE]\d{2,3}\.\d{1,2}$/.test(t)) return true;
  return false;
}

export type IcdChoice = { icd10: string; nhiIcd10: string; text: string };

export async function resolveIcd9Row(
  row: DiagnosisRow,
): Promise<{ rows: DiagnosisRow[]; note: string; choices: IcdChoice[] }> {
  const code = (row.icd10 || row.nhiIcd10 || "").trim();
  if (!readyIcd9(code)) return { rows: [row], note: "", choices: [] };
  const mapped = await crosswalkDiagnosis(code, row.text);
  if (!mapped.icd10) return { rows: [row], note: "", choices: [] };
  if (mapped.inputKind !== "icd9") {
    return {
      rows: [
        {
          ...row,
          icd10: mapped.icd10,
          nhiIcd10: mapped.nhiIcd10 || mapped.icd10.replace(/\./g, ""),
        },
      ],
      note: "",
      choices: [],
    };
  }
  const primary: IcdChoice = {
    icd10: mapped.icd10,
    nhiIcd10: mapped.nhiIcd10,
    text: row.text?.trim() || mapped.title,
  };
  const choices: IcdChoice[] = [
    primary,
    ...(mapped.secondary || []).map((sec) => ({
      icd10: sec.icd10,
      nhiIcd10: sec.nhiIcd10,
      text: sec.title || sec.icd10,
    })),
  ];
  if (choices.length > 1) {
    return { rows: [], note: mapped.chiefNote || "", choices };
  }
  return {
    rows: [{ ...row, ...primary }],
    note: mapped.chiefNote || "",
    choices: [],
  };
}

export async function mapDiagnosisList(
  rows: DiagnosisRow[],
): Promise<{ rows: DiagnosisRow[]; notes: string[]; needsChoice: boolean }> {
  const out: DiagnosisRow[] = [];
  const notes: string[] = [];
  let needsChoice = false;
  for (const row of rows) {
    try {
      const resolved = await resolveIcd9Row(row);
      if (resolved.choices.length > 1) {
        out.push(row);
        needsChoice = true;
        continue;
      }
      out.push(...resolved.rows);
      if (resolved.note) notes.push(resolved.note);
    } catch {
      out.push(row);
    }
  }
  return { rows: out, notes, needsChoice };
}

export function appendChiefNotes(current: string, notes: string[]): string {
  let text = current;
  for (const note of notes) {
    const line = note.trim();
    if (!line || text.includes(line)) continue;
    text = text.trim() ? `${text.trim()} ${line}` : line;
  }
  return text;
}
