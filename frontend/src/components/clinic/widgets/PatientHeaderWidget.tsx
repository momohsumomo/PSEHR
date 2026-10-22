import { ageYearsMonths } from "@/lib/ageLabel";
import { HIS, HIS_FONT } from "@/lib/hisTheme";

interface PatientHeaderWidgetProps {
  clinicalProfile: any;
  selected: any;
  patientResource: any;
  apiMode: boolean;
  showDevPanels: boolean;
  setShowDevPanels: (v: boolean | ((prev: boolean) => boolean)) => void;
}

/** 單列薄 meta（醫聖病患標題列） */
export function PatientHeaderWidget({
  clinicalProfile: _clinicalProfile,
  selected,
  patientResource,
  apiMode,
  showDevPanels,
  setShowDevPanels,
}: PatientHeaderWidgetProps) {
  void _clinicalProfile;
  const medicalNo =
    selected?.medicalNo ?? patientResource?.identifier?.[0]?.value ?? "—";
  const bits: Array<{ label?: string; value: string }> = [
    { value: selected?.patientDisplay ?? "—" },
    { value: ageYearsMonths(selected?.age || selected?.ageSex) || "" },
    { label: "病歷", value: medicalNo },
    selected?.queueNumber != null
      ? { label: "序", value: String(selected.queueNumber) }
      : { value: "" },
    selected?.slotTime ? { label: "時段", value: selected.slotTime } : { value: "" },
    selected?.phone ? { label: "電話", value: selected.phone } : { value: "" },
    selected?.weight ? { label: "體重", value: selected.weight } : { value: "" },
    apiMode ? { value: "API" } : { value: "" },
  ].filter((b) => Boolean(b.value));

  return (
    <header
      className="flex items-center gap-1.5 border bg-white px-1 py-0 leading-none"
      style={{
        borderColor: HIS.chromeDark,
        height: HIS.row.list,
        fontFamily: HIS_FONT,
        fontSize: HIS.fs.secondary,
      }}
    >
      <div className="min-w-0 flex-1 truncate text-black">
        {bits.map((b, i) => (
          <span key={`${b.label ?? ""}-${b.value}-${i}`}>
            {i > 0 ? "　" : ""}
            {b.label ? (
              <>
                <span style={{ fontSize: HIS.fs.tertiary, color: "#666666" }}>
                  {b.label}{" "}
                </span>
                <span style={{ fontSize: HIS.fs.secondary }}>{b.value}</span>
              </>
            ) : (
              <span style={{ fontSize: HIS.fs.secondary }}>{b.value}</span>
            )}
          </span>
        ))}
      </div>
      <button
        type="button"
        className="shrink-0 underline"
        style={{ fontSize: HIS.fs.tertiary, color: "#808080" }}
        onClick={() => setShowDevPanels((v) => !v)}
      >
        {showDevPanels ? "隱藏" : "FHIR"}
      </button>
    </header>
  );
}
