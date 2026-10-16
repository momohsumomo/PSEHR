import { useI18n } from "@/i18n/I18nContext";
import { MedblocksFhirForm } from "./MedblocksFhirForm";

type EncounterResource = Record<string, unknown>;

interface Props {
  encounter: EncounterResource | null;
  className?: string;
}

export function MedblocksEncounterForm({ encounter, className }: Props) {
  const t = useI18n();
  return (
    <MedblocksFhirForm
      resource={encounter}
      hint={t.chart.medblocksEncounterHint}
      className={className}
    />
  );
}
