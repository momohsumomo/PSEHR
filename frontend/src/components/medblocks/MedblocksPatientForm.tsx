import { useI18n } from "@/i18n/I18nContext";
import { MedblocksFhirForm } from "./MedblocksFhirForm";

type PatientResource = Record<string, unknown>;

interface Props {
  patient: PatientResource | null;
  className?: string;
}

/** 封裝 mb-fhir-form（FHIR Patient）；欄位由 Medblocks 維護，我們注入資料與繁中外框。 */
export function MedblocksPatientForm({ patient, className }: Props) {
  const t = useI18n();
  return (
    <MedblocksFhirForm
      resource={patient}
      hint={t.chart.medblocksHint}
      className={className}
    />
  );
}
