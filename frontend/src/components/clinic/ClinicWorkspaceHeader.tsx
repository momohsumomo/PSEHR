import { useI18n } from "@/i18n/I18nContext";
import type { QueueEntry } from "@/mocks";

interface Props {
  entries: QueueEntry[];
  clinicName?: string;
  physicianName?: string;
}

export function ClinicWorkspaceHeader({
  entries,
  clinicName = "皮膚科 101 診",
  physicianName = "王醫師",
}: Props) {
  const t = useI18n();
  const waiting = entries.filter((e) => e.queueStatus === "waiting").length;
  const inProgress = entries.filter((e) => e.queueStatus === "in_progress").length;

  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-slate-300 bg-slate-800 px-4 py-2 text-sm text-white">
      <span className="font-bold">{clinicName}</span>
      <span className="opacity-80">{physicianName}</span>
      <span className="rounded bg-slate-700 px-2 py-0.5">
        今日掛號 {entries.length}
      </span>
      <span className="rounded bg-slate-600 px-2 py-0.5">候診 {waiting}</span>
      <span className="rounded bg-green-700 px-2 py-0.5">看診中 {inProgress}</span>
      <span className="ml-auto rounded bg-violet-900/80 px-2 py-0.5 text-xs">
        {t.app.localFirst} · 沙盒1 Mock
      </span>
    </div>
  );
}
