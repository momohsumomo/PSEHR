/**
 * Chart top patient meta bar (YiSheng chart-head parity).
 */
import { HIS, HIS_FONT } from "@/lib/hisTheme";
import type { QueueEntry } from "@/mocks/clinicMocks";

type Props = {
  selected: QueueEntry | null;
  patientResource?: Record<string, unknown> | null;
  visitDate: string;
};

function pickIdNo(patient: Record<string, unknown> | null | undefined, fallback?: string): string {
  if (fallback) return fallback;
  const idents = (patient?.identifier as Array<{ system?: string; value?: string }> | undefined) || [];
  for (const id of idents) {
    const v = (id.value || "").trim();
    if (/^[A-Z][0-9]{9}$/i.test(v)) return v.toUpperCase();
  }
  return "\u2014";
}

function pickBirthday(patient: Record<string, unknown> | null | undefined): string {
  const birth = String(patient?.birthDate || "").trim();
  if (!birth) return "\u2014";
  const m = birth.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return birth;
  const y = Number(m[1]) - 1911;
  return `${String(y).padStart(3, "0")}.${m[2]}.${m[3]}`;
}

function ageLabel(selected: QueueEntry | null): string {
  if (!selected) return "\u2014";
  if (selected.age) return selected.age;
  const raw = (selected.ageSex || "").replace(/[MF\u7537\u5973]$/, "");
  return raw || "\u2014";
}

function sexLabel(selected: QueueEntry | null): string {
  if (!selected) return "";
  if (selected.sex === "M" || selected.ageSex?.endsWith("M")) return "\u7537";
  if (selected.sex === "F" || selected.ageSex?.endsWith("F")) return "\u5973";
  if (selected.ageSex?.endsWith("\u7537")) return "\u7537";
  if (selected.ageSex?.endsWith("\u5973")) return "\u5973";
  return "";
}

export function ChartPatientHead({ selected, patientResource, visitDate }: Props) {
  const medicalNo = selected?.medicalNo || "\u2014";
  const name = selected?.patientDisplay || "\u2014";
  const sex = sexLabel(selected);
  const bits = [
    `\u75c5\u6b77 ${medicalNo}`,
    `${name}${sex ? ` (${sex})` : ""}`,
    `\u751f\u65e5 ${pickBirthday(patientResource)}`,
    `\u5e74\u9f61 ${ageLabel(selected)}`,
    `ID ${pickIdNo(patientResource, selected?.idNo)}`,
    `\u770b\u8a3a\u65e5 ${visitDate}`,
    selected?.queueNumber != null ? `\u5e8f\u865f ${selected.queueNumber}` : null,
    selected?.caseNo ? `\u6848 ${selected.caseNo}` : null,
    selected?.cardWritten ? "\u5361 \u2713" : null,
  ].filter(Boolean) as string[];

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0 border-b px-2 py-0 leading-none text-black"
      style={{
        borderColor: HIS.chromeDark,
        background: "#F0F0F0",
        fontFamily: HIS_FONT,
        fontSize: HIS.fs.tertiary,
        minHeight: 16,
      }}
    >
      {bits.map((b) => (
        <span key={b}>{b}</span>
      ))}
    </div>
  );
}
