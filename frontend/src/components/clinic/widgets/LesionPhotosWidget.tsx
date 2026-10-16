import { useI18n } from "@/i18n/I18nContext";

interface LesionPhotosWidgetProps {
  lesionEnabled: boolean;
  lesionSectionRef: React.RefObject<HTMLElement | null>;
  lesionMedia: Array<{
    id: string;
    site: string;
    capturedAt: string;
  }>;
  selectedMediaId: string | null;
  setSelectedMediaId: (id: string | null) => void;
  selectedMedia: any;
}

export function LesionPhotosWidget({
  lesionEnabled,
  lesionSectionRef,
  lesionMedia,
  selectedMediaId,
  setSelectedMediaId,
  selectedMedia,
}: LesionPhotosWidgetProps) {
  const t = useI18n();

  if (!lesionEnabled) return null;

  return (
    <section
      ref={lesionSectionRef as any}
      className="rounded border border-violet-200 bg-violet-50/40 p-2 flex flex-col justify-between h-full"
    >
      <h2 className="text-xs font-bold text-violet-900">{t.chart.lesionPhotos}</h2>
      <div className="mt-1 flex gap-2 overflow-hidden flex-1 min-h-0">
        <div className="flex flex-1 gap-1 overflow-x-auto">
          {lesionMedia.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setSelectedMediaId(m.id)}
              className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded border bg-white text-[9px] ${
                selectedMediaId === m.id
                  ? "border-violet-600 ring-1 ring-violet-400"
                  : "border-violet-200"
              }`}
            >
              <span className="font-bold text-violet-800">{m.site}</span>
              <span className="text-slate-500">{m.capturedAt}</span>
            </button>
          ))}
        </div>
        <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded border border-violet-200 bg-white text-center text-[10px] text-violet-800">
          {selectedMedia ? selectedMedia.label : "病灶"}
        </div>
      </div>
    </section>
  );
}
