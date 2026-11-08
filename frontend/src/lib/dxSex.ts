/** ICD-10-CM codes NHI rejects for the other sex (W2 female only, W1 male only). Same list as src/claims/media_check.py. */
const FEMALE_ONLY = [
  "N7", "N8", "N90", "N91", "N92", "N93", "N94", "N95", "N96", "N97", "N98", "O",
  "C51", "C52", "C53", "C54", "C55", "C56", "C57", "C58", "D06", "D25", "D26", "D27", "D28",
];
const MALE_ONLY = [
  "N40", "N41", "N42", "N43", "N44", "N45", "N46", "N47", "N48", "N49", "N50", "N51", "N52", "N53",
  "C60", "C61", "C62", "C63", "D29",
];

export function patientSexOf(sex?: string, ageSex?: string, idNo?: string): "M" | "F" | "" {
  const raw = (sex || "").trim().toUpperCase();
  if (raw === "M" || raw === "\u7537" || raw === "1") return "M";
  if (raw === "F" || raw === "\u5973" || raw === "2") return "F";
  const tail = (ageSex || "").trim().toUpperCase().slice(-1);
  if (tail === "M" || tail === "F") return tail;
  const id = (idNo || "").trim().toUpperCase();
  if (/^[A-Z][12]\d{8}$/.test(id)) return id[1] === "1" ? "M" : "F";
  return "";
}

/** Empty when the code fits the patient; otherwise the sentence to show. */
export function dxSexProblem(code: string, sex: "M" | "F" | ""): string {
  const text = (code || "").replace(/\./g, "").trim().toUpperCase();
  if (!text || !sex) return "";
  if (sex === "M" && FEMALE_ONLY.some((p) => text.startsWith(p))) {
    return `\u75c5\u540d ${text} \u9650\u5973\u6027\uff0c\u9019\u4f4d\u662f\u7537\u6027\uff0c\u6c92\u6709\u5beb\u5165\u3002\u5065\u4fdd\u6703\u9000\u4ef6\uff0c\u8acb\u6539\u9078\u75c5\u540d\u3002`;
  }
  if (sex === "F" && MALE_ONLY.some((p) => text.startsWith(p))) {
    return `\u75c5\u540d ${text} \u9650\u7537\u6027\uff0c\u9019\u4f4d\u662f\u5973\u6027\uff0c\u6c92\u6709\u5beb\u5165\u3002\u5065\u4fdd\u6703\u9000\u4ef6\uff0c\u8acb\u6539\u9078\u75c5\u540d\u3002`;
  }
  return "";
}
