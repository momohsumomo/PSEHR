import { useState } from "react";

type TabId = "A" | "B" | "C" | "D" | "E";

type Props = {
  open: boolean;
  onClose: () => void;
  patientDisplay?: string;
  allergies: { text: string; substance: string; manifestation: string }[];
  allergyEmpty: string;
  reasonText?: string;
  preVisitCompleted?: boolean;
  hasAllergyAlert?: boolean;
  /** 內嵌模式：不蓋 modal，直接當分頁內容 */
  embedded?: boolean;
};

const TABS: { id: TabId; label: string }[] = [
  { id: "A", label: "A 過敏" },
  { id: "B", label: "B 檢查" },
  { id: "C", label: "C 醫囑" },
  { id: "D", label: "D 提醒" },
  { id: "E", label: "E 其他" },
];

/** 診療頂部 F5：過敏／檢查／醫囑／提醒（A–E 殼；過敏接既有資料） */
export function ClinicalAlertsPanel({
  open,
  onClose,
  patientDisplay,
  allergies,
  allergyEmpty,
  reasonText,
  preVisitCompleted,
  hasAllergyAlert,
  embedded = false,
}: Props) {
  const [tab, setTab] = useState<TabId>("A");

  if (!open) return null;

  const body = (
    <>
      <div className="flex shrink-0 items-center gap-1 border-b border-[#80C080] bg-[#E8F8E8] px-2 py-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`rounded px-2 py-0.5 text-[11px] font-bold ${
              tab === t.id ? "bg-[#004D00] text-white" : "text-[#004D00] hover:bg-white"
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        {!embedded && (
          <button
            type="button"
            className="ml-auto rounded px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
            onClick={onClose}
          >
            關閉 ESC
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        <p className="text-slate-600">
          病患：<span className="font-semibold text-slate-900">{patientDisplay ?? "—"}</span>
        </p>
        {tab === "A" && (
          <section>
            <h3 className="text-xs font-bold uppercase text-red-800">過敏</h3>
            {allergies.length > 0 ? (
              <ul className="mt-1 space-y-1">
                {allergies.map((a) => (
                  <li key={a.text} className="rounded border border-red-200 bg-red-50 px-2 py-1">
                    {a.text} · {a.substance} · {a.manifestation}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-slate-600">{allergyEmpty}</p>
            )}
            {hasAllergyAlert && (
              <p className="mt-1 text-xs font-bold text-red-700">掛號清單已標示過敏警示</p>
            )}
          </section>
        )}
        {tab === "B" && (
          <section>
            <h3 className="text-xs font-bold uppercase text-slate-700">檢查</h3>
            <p className="mt-1 text-xs text-slate-500">頂部 F6 開啟放射科。無資料顯示 —，不編造。</p>
          </section>
        )}
        {tab === "C" && (
          <section>
            <h3 className="text-xs font-bold uppercase text-slate-700">醫囑 / 主述</h3>
            <p className="mt-1 text-slate-800">{reasonText?.trim() || "—"}</p>
          </section>
        )}
        {tab === "D" && (
          <section>
            <h3 className="text-xs font-bold uppercase text-slate-700">提醒</h3>
            <ul className="mt-1 space-y-1 text-xs text-slate-600">
              {preVisitCompleted ? (
                <li className="rounded bg-violet-50 px-2 py-1 text-violet-900">預診已完成</li>
              ) : (
                <li className="rounded bg-amber-50 px-2 py-1 text-amber-900">預診未完成</li>
              )}
            </ul>
          </section>
        )}
        {tab === "E" && (
          <section>
            <h3 className="text-xs font-bold uppercase text-slate-700">其他</h3>
            <p className="mt-1 text-xs text-slate-500">殼層保留；診斷證明請由右下「其他功能」進入。</p>
          </section>
        )}
      </div>
    </>
  );

  if (embedded) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">{body}</div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-slate-400 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <h2 className="text-sm font-bold text-slate-900">F5 過敏 / 檢查 / 醫囑 / 提醒</h2>
        </div>
        {body}
      </div>
    </div>
  );
}
