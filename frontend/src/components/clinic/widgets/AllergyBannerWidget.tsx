import { useI18n } from "@/i18n/I18nContext";

interface AllergyBannerWidgetProps {
  allergies: Array<{
    text: string;
    substance: string;
    manifestation: string;
    level: string;
  }>;
  allergyBannerClass: string;
  allergyEmpty: string;
}

export function AllergyBannerWidget({
  allergies,
  allergyBannerClass,
  allergyEmpty,
}: AllergyBannerWidgetProps) {
  const t = useI18n();

  return (
    <div className={`shrink-0 border-b-2 px-3 py-2 ${allergyBannerClass} rounded border shadow-sm flex flex-col justify-center h-full`}>
      <div className="text-[11px] font-bold uppercase tracking-wide opacity-90">
        過敏藥物
      </div>
      {allergies.length > 0 ? (
        <ul className="mt-0.5 space-y-0.5 text-sm font-semibold overflow-y-auto">
          {allergies.map((a) => (
            <li key={a.text}>
              {a.text} · {a.substance} · {a.manifestation}
              {a.level === "high" && (
                <span className="ml-2 rounded bg-red-900 px-1 text-[10px] text-white">
                  {t.allergy.highRisk}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-0.5 text-sm">{allergyEmpty}</p>
      )}
    </div>
  );
}
