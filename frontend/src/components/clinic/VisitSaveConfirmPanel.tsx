import { useEffect, useRef, useState } from "react";
import { useListNav } from "@/hooks/useListNav";
import { thisPcPrintsOnSave, thisPcUploadsCloudOnSave } from "@/lib/clinicDevice";
import type { DiagnosisRow, QueueEntry, RxLine } from "@/mocks/clinicMocks";

export type VisitSaveDraft = {
  caseNo: string;
  copayCode: string;
  payType: string;
  dispense: string;
  rxDays: string;
  treatSeq: string;
  cardNo: string;
  aCode: string;
  doctor: string;
  dept: string;
  dxText: string;
  icd10: string;
  regFee: string;
  drugFee: string;
  materialFee: string;
  consultFee: string;
  burden: string;
  orderCode: string;
  orderStaff: string;
  orderTime: string;
  surgeryCode: string;
  writeCard: boolean;
  writeDx: boolean;
  writeOrders: boolean;
  printRx: boolean;
};

const DASH = "—";

function dash(v: unknown): string {
  const s = String(v ?? "").trim();
  return s.length ? s : DASH;
}

export function buildVisitSaveDraft(args: {
  selected: QueueEntry | null;
  diagnoses: DiagnosisRow[];
  currentRx: RxLine[];
  doctor?: string;
  doctorId?: string;
  consultFeeDefault?: string;
}): VisitSaveDraft {
  const dx0 = args.diagnoses[0];
  const days = args.currentRx.reduce((m, r) => Math.max(m, r.days || 0), 0);
  const drugSum = args.currentRx.reduce((s, r) => {
    const up = typeof r.unitPrice === "number" ? r.unitPrice : Number(r.unitPrice);
    const qty = typeof r.qty === "number" ? r.qty : Number(r.qty) || 1;
    if (!Number.isFinite(up)) return s;
    return s + up * qty;
  }, 0);
  const regFee =
    args.selected?.regFee && args.selected.regFee !== DASH ? String(args.selected.regFee) : DASH;
  const consult =
    args.selected?.consultFee && args.selected.consultFee !== DASH
      ? String(args.selected.consultFee)
      : args.consultFeeDefault || DASH;
  const burden =
    args.selected?.burdenFee && args.selected.burdenFee !== DASH
      ? String(args.selected.burdenFee)
      : args.selected?.copayAmt && args.selected.copayAmt !== DASH
        ? String(args.selected.copayAmt)
        : DASH;
  const doctorLabel =
    args.doctor?.trim() ||
    (args.selected as { doctorName?: string } | null)?.doctorName ||
    DASH;
  return {
    caseNo: args.selected?.caseNo && args.selected.caseNo !== DASH ? args.selected.caseNo : "01",
    copayCode:
      args.selected?.copayCode && args.selected.copayCode !== DASH
        ? String(args.selected.copayCode)
        : DASH,
    payType:
      args.selected?.payType && args.selected.payType !== DASH
        ? String(args.selected.payType)
        : "4",
    dispense:
      args.selected?.dispense && args.selected.dispense !== DASH
        ? String(args.selected.dispense)
        : "自行調劑",
    rxDays: days > 0 ? String(days) : DASH,
    treatSeq:
      args.selected?.treatSeq && args.selected.treatSeq !== DASH ? args.selected.treatSeq : DASH,
    cardNo: args.selected?.hcId && args.selected.hcId !== DASH ? String(args.selected.hcId) : DASH,
    aCode: DASH,
    doctor: doctorLabel,
    dept: "皮膚科",
    dxText: dx0?.text || DASH,
    icd10: dx0?.icd10 || dx0?.nhiIcd10 || DASH,
    regFee,
    drugFee:
      args.selected?.drugFee && args.selected.drugFee !== DASH
        ? String(args.selected.drugFee)
        : drugSum > 0
          ? String(Math.round(drugSum * 100) / 100)
          : DASH,
    materialFee:
      args.selected?.materialFee && args.selected.materialFee !== DASH
        ? String(args.selected.materialFee)
        : DASH,
    consultFee: consult,
    burden,
    orderCode: DASH,
    orderStaff: "",
    orderTime: "",
    surgeryCode: "",
    writeCard: thisPcUploadsCloudOnSave(),
    writeDx: true,
    writeOrders: true,
    printRx: thisPcPrintsOnSave(),
  };
}

type WaitingRow = {
  encounterId: string;
  queueNumber: number;
  patientDisplay: string;
  queueStatus: string;
};

type Props = {
  open: boolean;
  locked: boolean;
  saving: boolean;
  cardNote?: string | null;
  selected: QueueEntry | null;
  ccText: string;
  currentRx: RxLine[];
  draft: VisitSaveDraft;
  waiting?: WaitingRow[];
  onChange: (patch: Partial<VisitSaveDraft>) => void;
  onClose: () => void;
  onConfirm: () => void;
  onPrint?: () => void;
  printNote?: string | null;
  onPickWaiting?: (encounterId: string) => void;
};

function Field({
  label,
  value,
  onChange,
  readOnly,
  mono,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  mono?: boolean;
}) {
  return (
    <label className="flex items-center gap-1 text-[11px]">
      <span className="w-20 shrink-0 text-slate-600">{label}</span>
      <input
        className={`min-w-0 flex-1 rounded border px-1.5 py-0.5 ${
          readOnly ? "border-slate-200 bg-slate-50 text-slate-600" : "border-slate-300 bg-white"
        } ${mono ? "font-mono" : ""}`}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </label>
  );
}

/**
 * 醫聖 F9 下一層：批價／重要醫令／寫健保雲端確認。
 * 沒有的金額與就醫序號顯示 —，不編造。
 */
export function VisitSaveConfirmPanel({
  open,
  locked,
  saving,
  cardNote,
  selected,
  ccText,
  currentRx,
  draft,
  waiting = [],
  onChange,
  onClose,
  onConfirm,
  onPrint,
  printNote,
  onPickWaiting,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "p" && ev.key !== "P") return;
      if (ev.repeat) return;
      if (document.querySelector("[data-print-preview]")) return;
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      ev.preventDefault();
      onPrint?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onPrint]);

  const [waitIdx, setWaitIdx] = useState(0);
  const waitRef = useRef<HTMLUListElement>(null);
  const waitIndex = waiting.length ? Math.min(waitIdx, waiting.length - 1) : -1;
  useListNav({
    active: open && waiting.length > 0,
    length: waiting.length,
    index: waitIndex,
    onIndex: setWaitIdx,
    scrollerRef: waitRef,
    scopeRef: waitRef,
  });

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-slate-200">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-400 bg-slate-800 px-3 py-1.5 text-xs text-white">
        <span className="font-bold">F9 存檔確認（批價／重要醫令／寫健保雲端）</span>
        <span className="text-slate-300">
          {locked ? "已存檔" : "再按 F9 確定存檔 · Esc 回診療"}
        </span>
      </header>

      {cardNote && (
        <p className="shrink-0 bg-red-100 px-3 py-1 text-xs text-red-900">{cardNote}</p>
      )}

      <div className="flex min-h-0 flex-1">
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <div className="grid grid-cols-2 gap-2">
          <section className="rounded border border-slate-300 bg-white p-2">
            <h3 className="mb-2 border-b pb-1 text-xs font-bold">病患</h3>
            <div className="space-y-1">
              <Field label="姓名" value={dash(selected?.patientDisplay)} readOnly />
              <Field label="病歷號" value={dash(selected?.medicalNo)} readOnly mono />
              <Field label="身分證" value={dash(selected?.id)} readOnly mono />
              <Field label="生日" value={dash(selected?.birthday)} readOnly mono />
              <Field label="性別" value={dash(selected?.sex || selected?.ageSex)} readOnly />
              <Field label="序號" value={selected ? String(selected.queueNumber) : DASH} readOnly mono />
            </div>
          </section>

          <section className="rounded border border-slate-300 bg-white p-2">
            <h3 className="mb-2 border-b pb-1 text-xs font-bold">申報必要</h3>
            <div className="space-y-1">
              <Field label="案件分類" value={draft.caseNo} onChange={(v) => onChange({ caseNo: v })} mono />
              <Field label="部份負擔" value={draft.copayCode} onChange={(v) => onChange({ copayCode: v })} mono />
              <Field label="給付類別" value={draft.payType} onChange={(v) => onChange({ payType: v })} mono />
              <Field label="調劑方式" value={draft.dispense} onChange={(v) => onChange({ dispense: v })} />
              <Field label="給藥天數" value={draft.rxDays} onChange={(v) => onChange({ rxDays: v })} mono />
              <Field label="就醫序號" value={draft.treatSeq} onChange={(v) => onChange({ treatSeq: v })} mono />
              <Field label="IC卡號" value={draft.cardNo} onChange={(v) => onChange({ cardNo: v })} mono />
              <Field label="A_Code" value={draft.aCode} onChange={(v) => onChange({ aCode: v })} mono />
              <Field label="醫師" value={draft.doctor} onChange={(v) => onChange({ doctor: v })} />
              <Field label="科別" value={draft.dept} onChange={(v) => onChange({ dept: v })} />
              <Field label="主診斷" value={draft.dxText} onChange={(v) => onChange({ dxText: v })} />
              <Field label="ICD" value={draft.icd10} onChange={(v) => onChange({ icd10: v })} mono />
            </div>
          </section>

          <section className="rounded border border-slate-300 bg-white p-2">
            <h3 className="mb-2 border-b pb-1 text-xs font-bold">費用（Recive.Set）</h3>
            <p className="mb-1 text-[10px] text-slate-500">
              可改；存檔會寫回本次 Encounter。沒有值可留 —。
            </p>
            <div className="space-y-1">
              <Field label="掛號費用" value={draft.regFee} onChange={(v) => onChange({ regFee: v })} mono />
              <Field label="藥品費用" value={draft.drugFee} onChange={(v) => onChange({ drugFee: v })} mono />
              <Field label="材料費用" value={draft.materialFee} onChange={(v) => onChange({ materialFee: v })} mono />
              <Field label="診察費用" value={draft.consultFee} onChange={(v) => onChange({ consultFee: v })} mono />
              <Field label="診療負擔" value={draft.burden} onChange={(v) => onChange({ burden: v })} mono />
            </div>
          </section>

          <section className="rounded border border-slate-300 bg-white p-2">
            <h3 className="mb-2 border-b pb-1 text-xs font-bold">重要醫令</h3>
            <div className="space-y-1">
              <Field label="醫令代碼" value={draft.orderCode} onChange={(v) => onChange({ orderCode: v })} mono />
              <Field label="執行人員" value={draft.orderStaff} onChange={(v) => onChange({ orderStaff: v })} />
              <Field label="執行時間" value={draft.orderTime} onChange={(v) => onChange({ orderTime: v })} />
              <Field label="手術碼" value={draft.surgeryCode} onChange={(v) => onChange({ surgeryCode: v })} mono />
            </div>
            <h3 className="mb-1 mt-3 border-b pb-1 text-xs font-bold">存檔勾選</h3>
            <div className="space-y-1 text-[11px]">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.writeCard}
                  disabled={locked}
                  onChange={(e) => onChange({ writeCard: e.target.checked })}
                />
                {"\u5beb\u5165\u5065\u4fdd\u96f2\u7aef\uff086.0\uff1b\u975e\u5beb\u6676\u7247\uff09"}
              </label>
              <p className="pl-5 text-[10px] leading-snug text-slate-600">
                {"\u9019\u53f0\u96fb\u8166\u7684\u9810\u8a2d\u5728\u9662\u6240\u8cc7\u6599\u2192\u672c\u6a5f\u5de5\u4f5c\u7ad9\u3002\u770b\u8a3a\u4e0d\u52fe\uff0c\u6ac3\u53f0\u63d2\u5361\u518d\u5b58\u6a94\u6642\u624d\u52fe\u3002\u9019\u88e1\u6539\u7684\u53ea\u5f71\u97ff\u9019\u4e00\u6b21\u3002"}
              </p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.writeDx}
                  disabled={locked || !draft.writeCard}
                  onChange={(e) => onChange({ writeDx: e.target.checked })}
                />
                連同診斷＋費用（WriteCodeFee）
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.writeOrders}
                  disabled={locked || !draft.writeCard}
                  onChange={(e) => onChange({ writeOrders: e.target.checked })}
                />
                連同處方醫令（Prescription/Write）
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.printRx}
                  disabled={locked}
                  onChange={(e) => onChange({ printRx: e.target.checked })}
                />
                印處方簽（印表機未接則不印）
              </label>
              <p className="pl-5 text-[10px] leading-snug text-slate-600">
                {"\u9019\u53f0\u96fb\u8166\u7684\u9810\u8a2d\u5728\u9662\u6240\u8cc7\u6599\u2192\u672c\u6a5f\u5de5\u4f5c\u7ad9\u3002\u770b\u8a3a\u3001\u85e5\u5c40\u9810\u8a2d\u8981\u8df3\u5217\u5370\uff0c\u639b\u865f\u53f0\u9810\u8a2d\u53ea\u5b58\u6a94\u3002\u9019\u88e1\u6539\u7684\u53ea\u5f71\u97ff\u9019\u4e00\u6b21\u3002"}
              </p>
            </div>
          </section>
        </div>

        <section className="mt-2 rounded border border-slate-300 bg-white p-2">
          <h3 className="mb-1 text-xs font-bold">主述／處方摘要</h3>
          <pre className="max-h-16 overflow-auto whitespace-pre-wrap text-[11px] text-slate-700">
            {ccText.trim() || DASH}
          </pre>
          <ul className="mt-1 max-h-24 overflow-auto text-[11px]">
            {currentRx.length === 0 ? (
              <li className="text-slate-400">{DASH}</li>
            ) : (
              currentRx.map((r) => (
                <li key={r.id} className="font-mono">
                  {r.nhiCode || DASH} {r.name} {r.sig} {r.days}天 ×{r.qty ?? 1}
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
      <aside className="flex w-52 shrink-0 flex-col border-l border-slate-400 bg-slate-100">
        <div className="border-b border-slate-400 bg-slate-300 px-2 py-1 text-xs font-bold">
          候診名單（{waiting.length}）
        </div>
        <ul
          ref={waitRef}
          tabIndex={0}
          data-list-scope=""
          className="min-h-0 flex-1 overflow-auto outline-none"
          onKeyDown={(ev) => {
            if (ev.key !== "Enter") return;
            const row = waiting[waitIndex];
            if (!row) return;
            ev.preventDefault();
            onPickWaiting?.(row.encounterId);
          }}
        >
          {waiting.length === 0 ? (
            <li className="px-2 py-3 text-[11px] text-slate-500">這個時段沒有待診</li>
          ) : (
            waiting.map((row, i) => (
              <li key={row.encounterId} data-list-row="">
                <button
                  type="button"
                  className={`flex w-full items-center gap-1 px-2 py-1 text-left text-[12px] hover:bg-amber-100 ${
                    i === waitIndex
                      ? "bg-[#000080] font-bold text-white"
                      : row.encounterId === selected?.encounterId
                        ? "bg-amber-200 font-bold"
                        : ""
                  }`}
                  onClick={() => {
                    setWaitIdx(i);
                    onPickWaiting?.(row.encounterId);
                  }}
                >
                  <span className="w-6 font-mono">{row.queueNumber}</span>
                  <span className="min-w-0 flex-1 truncate">{row.patientDisplay}</span>
                </button>
              </li>
            ))
          )}
        </ul>
        <p className="border-t border-slate-300 px-2 py-1 text-[10px] text-slate-600">
          點名就切到下一位看診
        </p>
      </aside>
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-slate-400 bg-slate-300 px-3 py-1.5">
        <button
          type="button"
          disabled={locked || saving}
          className="rounded border border-slate-500 bg-white px-3 py-1 text-xs font-bold disabled:bg-slate-200 disabled:text-slate-400"
          onClick={onConfirm}
        >
          <span className="font-mono text-[10px]">F9</span> {locked ? "已存檔" : "存檔"}
        </button>
        <button
          type="button"
          className="rounded border border-slate-700 bg-[#ffe14a] px-3 py-1 text-xs font-bold"
          onClick={onPrint}
        >
          <span className="font-mono text-[10px]">P</span> 列印
        </button>
        {printNote ? <span className="min-w-0 flex-1 text-[12px] font-bold text-slate-900">{printNote}</span> : null}
        <button
          type="button"
          className="rounded border border-slate-500 bg-white px-3 py-1 text-xs"
          onClick={onClose}
        >
          Esc 離開
        </button>
        {saving && <span className="text-[11px] text-sky-800">寫入中…</span>}
      </footer>
    </div>
  );
}
