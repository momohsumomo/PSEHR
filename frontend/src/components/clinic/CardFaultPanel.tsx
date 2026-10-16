import type { CardFaultReport } from "@/api/clinicApi";
import { CardConsoleDebugButton } from "@/components/clinic/CardConsoleDebugButton";

type Props = {
  diagnose: CardFaultReport;
};

function deskCopy(diagnose: CardFaultReport): { title: string; action: string } {
  const action = diagnose.deskAction || diagnose.humanAction || "";
  const title = (diagnose.deskTitle || diagnose.humanActionLabel || diagnose.headline || "").trim();
  return { title, action };
}

/** 櫃台只看三件事：拔卡、拔哪一台讀卡機、啟動／重開健保讀卡軟體。 */
export function CardFaultPanel({ diagnose }: Props) {
  const { title, action } = deskCopy(diagnose);
  const tone =
    action === "restart_software" || action === "start_software"
      ? "border-sky-500 bg-sky-50 text-sky-950"
      : action === "unplug_reader"
        ? "border-orange-500 bg-orange-50 text-orange-950"
        : "border-amber-500 bg-amber-50 text-amber-950";

  if (!title) return null;

  const showDebug = action === "restart_software" || action === "start_software";

  return (
    <div className={`shrink-0 border-b px-3 py-2.5 ${tone}`}>
      <p className="text-sm font-bold leading-snug">{title}</p>
      {showDebug ? (
        <CardConsoleDebugButton compact variant="light" />
      ) : (
        <p className="mt-1 text-[11px]">做完再按一次 IC讀卡。</p>
      )}
    </div>
  );
}
