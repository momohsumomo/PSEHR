import { CLINIC_MODULE_TABS, type ClinicTab } from "@/lib/clinicShortcutSets";
import { HIS, HIS_FONT } from "@/lib/hisTheme";

type Props = {
  active: ClinicTab;
  onChange: (tab: ClinicTab) => void;
  hasPatient?: boolean;
  /** F3 tab suffix e.g. medical number */
  chartSuffix?: string | null;
};

export function ClinicModuleTabs({
  active,
  onChange,
  hasPatient = false,
  chartSuffix,
}: Props) {
  // Compact: rarely used (prefer F-keys); keep short so it is harder to mis-click
  const tabH = 18;
  const tabFs = HIS.fs.tertiary;
  return (
    <div
      className="flex shrink-0 items-stretch gap-0 border-b px-0"
      style={{
        borderColor: HIS.chromeDark,
        background: "#C0C0C0",
        minHeight: tabH,
        fontFamily: HIS_FONT,
      }}
    >
      {CLINIC_MODULE_TABS.map((tab) => {
        const needsPatient = tab.id !== "list";
        const locked = needsPatient && !hasPatient;
        const isActive = active === tab.id;
        const label =
          tab.id === "chart" && chartSuffix
            ? `${tab.label} / ${chartSuffix}`
            : tab.label;
        return (
          <button
            key={tab.id}
            type="button"
            disabled={locked}
            className="flex flex-1 items-center justify-center gap-0.5 border border-b-0 px-1 font-semibold leading-none"
            style={{
              height: tabH,
              fontFamily: HIS_FONT,
              fontSize: tabFs,
              borderColor: isActive ? "#104040" : HIS.chromeDark,
              borderRadius: "2px 2px 0 0",
              background: isActive
                ? "#206868"
                : locked
                  ? "#B0B0B0"
                  : "#D4D0C8",
              color: isActive
                ? "#FFFFFF"
                : locked
                  ? "#E8E8E8"
                  : "#000000",
              cursor: locked ? "not-allowed" : "pointer",
              opacity: locked ? 0.75 : 1,
            }}
            onClick={() => {
              if (!locked) onChange(tab.id);
            }}
            title={locked ? "請先在清單選病患" : undefined}
          >
            <span className="font-mono opacity-80" style={{ fontSize: 9 }}>
              {tab.key}
            </span>
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
