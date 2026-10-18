import type { ApiPatient } from "@/api/clinicApi";

/** 櫃台共用選人結果（掛號／調閱病歷同一個找人窗）。 */
export type PatientHit = {
  id: string;
  name: string;
  idNo: string;
  birthdayRoc: string;
  birthDateIso: string;
  sex: string;
  medicalNo: string;
  phone: string;
};

export function isoBirthDateToRoc(isoDate: string | undefined): string {
  if (!isoDate) return "";
  const parts = isoDate.split("-");
  if (parts.length < 3) return isoDate.replace(/\D/g, "").slice(0, 7);
  const ceYear = parseInt(parts[0], 10);
  if (!Number.isFinite(ceYear)) return "";
  const rocYear = ceYear - 1911;
  return `${String(rocYear).padStart(3, "0")}${parts[1]}${parts[2]}`;
}

export function rocBirthdayToIso(roc: string): string {
  const digits = roc.replace(/\D/g, "");
  if (digits.length < 7) return "";
  const y = parseInt(digits.slice(0, 3), 10) + 1911;
  const m = digits.slice(3, 5);
  const d = digits.slice(5, 7);
  if (!Number.isFinite(y) || !m || !d) return "";
  return `${y}-${m}-${d}`;
}

/** 0820117、82.1.17、1982-01-17 都顯示成 82.01.17。湊不齊就原樣。 */
export function formatBirthdayRoc(raw: string | undefined): string {
  const text = (raw || "").trim();
  if (!text) return "";
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const y = Number(iso[1]) - 1911;
    if (y > 0) return `${y}.${iso[2]}.${iso[3]}`;
  }
  const dotted = text.match(/^(\d{1,3})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (dotted) {
    const y = Number(dotted[1]);
    const m = Number(dotted[2]);
    const d = Number(dotted[3]);
    if (y > 0 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}`;
    }
  }
  const digits = text.replace(/\D/g, "");
  if (digits.length >= 7) {
    const y = Number(digits.slice(0, 3));
    const m = Number(digits.slice(3, 5));
    const d = Number(digits.slice(5, 7));
    if (y > 0 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}.${m}.${d}`;
    }
  }
  return text;
}

/** 顯示用的點號日期收回七碼，給存檔和年齡計算。 */
export function birthdayToStored(raw: string): string {
  const text = (raw || "").trim();
  const dotted = text.match(/^(\d{1,3})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (dotted) {
    return `${dotted[1].padStart(3, "0")}${dotted[2].padStart(2, "0")}${dotted[3].padStart(2, "0")}`.slice(0, 7);
  }
  return text.replace(/\D/g, "").slice(0, 7);
}

/** 從 FHIR Patient 抽出櫃台列表用欄位。 */
export function mapApiPatientToHit(p: ApiPatient): PatientHit {
  const family = p.name?.[0]?.family || "";
  const given = p.name?.[0]?.given?.join("") || "";
  const name = p.name?.[0]?.text || `${family}${given}` || "無姓名";
  const idNo =
    p.identifier?.find((i) => i.use === "official" || i.system?.includes("id"))?.value || "";
  const medicalNo =
    p.identifier?.find(
      (i) =>
        i.use === "secondary" ||
        i.system?.includes("chart") ||
        i.system?.includes("chart-number"),
    )?.value || "";
  const nhiBasic = p.extension?.find((e) => e.url?.includes("nhi-card-basic"));
  let birthdayRoc =
    nhiBasic?.extension?.find((sub) => sub.url === "birthdayRoc")?.valueString || "";
  if (!birthdayRoc && p.birthDate) {
    birthdayRoc = isoBirthDateToRoc(p.birthDate);
  }
  const sexCode =
    nhiBasic?.extension?.find((sub) => sub.url === "sex")?.valueString ||
    (p.gender === "female" ? "F" : p.gender === "male" ? "M" : "");
  const phone =
    p.telecom?.find((t) => t.system === "phone" && t.use === "mobile")?.value ||
    p.telecom?.find((t) => t.system === "phone")?.value ||
    "";
  return {
    id: p.id,
    name,
    idNo,
    birthdayRoc,
    birthDateIso: p.birthDate || rocBirthdayToIso(birthdayRoc),
    sex: sexCode === "女" ? "F" : sexCode === "男" ? "M" : sexCode || "",
    medicalNo,
    phone,
  };
}

/** 掛號預設：轉出口至 clinicProfile（影子庫權威＋本機快取）。 */
export { loadClinicRegisterDefaults, PROFILE_KEY } from "@/lib/clinicProfile";
