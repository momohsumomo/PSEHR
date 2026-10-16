import type { ClinicalBuff, PatientClinicalProfile } from "@/mocks/clinicMocks";

export interface ListAvatarBadges {
  preVisit?: boolean;
  allergy?: boolean;
}

const toneClass: Record<ClinicalBuff["tone"], string> = {
  red: "border-red-200 bg-red-50 text-red-800",
  gold: "border-amber-300 bg-amber-50 text-amber-900",
  blue: "border-sky-200 bg-sky-50 text-sky-800",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

interface Props {
  profile: PatientClinicalProfile;
  size?: 40 | 48;
  listBadges?: ListAvatarBadges;
  showBuffTags?: boolean;
}

/** 病患臨床狀態化身 — 檢傷用輕量頭像，不佔大版面 */
export function PatientClinicalAvatar({
  profile,
  size = 40,
  listBadges,
  showBuffTags = false,
}: Props) {
  const px = size;
  const textSize = size === 40 ? "text-sm" : "text-base";

  return (
    <div className={showBuffTags ? "flex min-w-0 items-center gap-2" : "relative shrink-0"}>
      <div className="relative" style={{ width: px, height: px }}>
        <div
          className={`flex items-center justify-center rounded-full border-2 font-bold text-white shadow-sm ${profile.bgClass} ${profile.ringClass} ${textSize}`}
          style={{ width: px, height: px }}
          aria-hidden
        >
          {profile.initials}
        </div>
        {listBadges?.preVisit && (
          <span
            className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-white bg-sky-500 text-[9px] leading-none shadow"
            title="已完成預診"
          >
            💬
          </span>
        )}
        {listBadges?.allergy && (
          <span
            className="absolute -left-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-white bg-red-600 text-[9px] leading-none shadow"
            title="藥物過敏"
          >
            ⚠️
          </span>
        )}
      </div>
      {showBuffTags && profile.activeBuffs.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-1">
          {profile.activeBuffs.map((buff) => (
            <span
              key={buff.id}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-tight ${toneClass[buff.tone]}`}
            >
              {buff.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
