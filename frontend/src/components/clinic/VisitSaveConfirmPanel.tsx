import { useEffect, useRef, useState } from "react";
import { fetchStaff, type ApiStaffRecord } from "@/api/clinicApi";
import { useListNav } from "@/hooks/useListNav";
import { thisPcPrintsOnSave, thisPcUploadsCloudOnSave } from "@/lib/clinicDevice";
import { doctorDisplayName } from "@/lib/doctorName";
import { HIS, HIS_FONT } from "@/lib/hisTheme";
import { skipsCloudWrite } from "@/lib/queueOrder";
import type { DiagnosisRow, QueueEntry, RxLine } from "@/mocks/clinicMocks";
import { formatBirthdayRoc } from "@/lib/patientSearch";
import { displayCase } from "@/lib/caseMark";
import { cardIdentityBenefit } from "@/lib/cardIdentity";
import { basicCopayYuan, nhiDrugPoints, visitCopayParts } from "@/lib/drugCopay";
import { chargedSelfPay, selfPayCeiling } from "@/lib/selfPayMoney";
import type { CatalogDrug } from "@/types/clinicCatalog";
import type { CatalogUsage } from "@/utils/rxTotal";

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
  doctorId: string;
  pharmacist: string;
  dept: string;
  dxText: string;
  icd10: string;
  regFee: string;
  drugFee: string;
  materialFee: string;
  consultFee: string;
  burden: string;
  /** Drug copay only. The basic copay stays in burden. */
  drugCopay: string;
  /** Ceiled sum of self-pay drugs and procedures. Shown in parentheses. */
  selfPayBasis: string;
  /** Amount actually charged. Starts as the ceiling and can be typed over. */
  selfPay: string;
  orderCode: string;
  orderStaff: string;
  orderTime: string;
  surgeryCode: string;
  writeCard: boolean;
  writeDx: boolean;
  writeOrders: boolean;
  printRx: boolean;
};

const DASH = "\u2014";

function yuanNumber(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!s || s === DASH || s === "-") return null;
  const n = Number(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function moneyText(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function dash(v: unknown): string {
  const s = String(v ?? "").trim();
  return s.length ? s : DASH;
}

function yuanOrNull(raw: string | undefined): number | null {
  const text = String(raw ?? "").trim();
  if (!text || text === DASH || text === "-") return null;
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function buildVisitSaveDraft(args: {
  selected: QueueEntry | null;
  diagnoses: DiagnosisRow[];
  currentRx: RxLine[];
  doctor?: string;
  doctorId?: string;
  consultFeeDefault?: string;
  drugs?: CatalogDrug[];
  usages?: CatalogUsage[];
}): VisitSaveDraft {
  const dx0 = args.diagnoses[0];
  const days = args.currentRx.reduce((m, r) => Math.max(m, r.days || 0), 0);
  const drugPoints = nhiDrugPoints(args.currentRx, args.drugs || [], args.usages);
  const regFee =
    args.selected?.regFee && args.selected.regFee !== DASH ? String(args.selected.regFee) : DASH;
  const consult =
    args.selected?.consultFee && args.selected.consultFee !== DASH
      ? String(args.selected.consultFee)
      : args.consultFeeDefault || DASH;
  const caseShown = displayCase(args.selected?.caseNo);
  const dispense =
    args.selected?.dispense && args.selected.dispense !== DASH
      ? String(args.selected.dispense)
      : "自行調劑";
  const storedCopay = yuanOrNull(args.selected?.copayAmt);
  const storedBurden = yuanOrNull(args.selected?.burdenFee);
  const card = cardIdentityBenefit(args.selected?.cardIdentity);
  const exempt =
    storedCopay === 0 ||
    (storedCopay == null && storedBurden === 0) ||
    Boolean(card?.waiveBasic);
  const parts = args.selected
    ? visitCopayParts({
        selfPay:
          caseShown === "\u81ea" ||
          args.selected.payType === "\u81ea\u8cbb" ||
          args.selected.icException === "selfPay",
        exempt,
        outsideDispense: dispense.includes("\u4ea4\u4ed8"),
        waiveDrug: Boolean(card?.waiveDrug),
        basic: basicCopayYuan(storedCopay, storedBurden),
        lines: args.currentRx,
        drugs: args.drugs || [],
        usages: args.usages,
      })
    : null;
  const burden = parts ? String(parts.basic) : DASH;
  const drugCopay = parts ? String(parts.drug) : DASH;
  const doctorLabel =
    args.doctor?.trim() ||
    (args.selected as { doctorName?: string } | null)?.doctorName ||
    DASH;
  const storedSelf = yuanNumber(args.selected?.selfPay);
  const selfBasis = selfPayCeiling(args.currentRx, args.drugs || [], args.usages);
  const selfCharged = chargedSelfPay(
    args.currentRx,
    storedSelf,
    args.drugs || [],
    args.usages,
  );
  return {
    caseNo: caseShown || "01",
    copayCode:
      args.selected?.copayCode && args.selected.copayCode !== DASH
        ? String(args.selected.copayCode)
        : DASH,
    payType:
      args.selected?.payType && args.selected.payType !== DASH
        ? String(args.selected.payType)
        : "4",
    dispense,
    rxDays: days > 0 ? String(days) : DASH,
    treatSeq:
      args.selected?.treatSeq && args.selected.treatSeq !== DASH ? args.selected.treatSeq : DASH,
    cardNo: args.selected?.hcId && args.selected.hcId !== DASH ? String(args.selected.hcId) : DASH,
    aCode: DASH,
    doctor: doctorLabel,
    doctorId: args.doctorId || "",
    pharmacist:
      args.selected?.pharmacist && args.selected.pharmacist !== DASH
        ? String(args.selected.pharmacist)
        : "",
    dept: "皮膚科",
    dxText: dx0?.text || DASH,
    icd10: dx0?.icd10 || dx0?.nhiIcd10 || DASH,
    regFee,
    drugFee: args.currentRx.length
      ? String(drugPoints)
      : args.selected?.drugFee && args.selected.drugFee !== DASH
        ? String(args.selected.drugFee)
        : DASH,
    materialFee:
      args.selected?.materialFee && args.selected.materialFee !== DASH
        ? String(args.selected.materialFee)
        : DASH,
    consultFee: consult,
    burden,
    drugCopay,
    selfPayBasis: String(selfBasis),
    selfPay: String(selfCharged),
    orderCode: DASH,
    orderStaff: "",
    orderTime: "",
    surgeryCode: "",
    writeCard: args.selected && skipsCloudWrite(args.selected) ? false : thisPcUploadsCloudOnSave(),
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

function workingStaff(rows: ApiStaffRecord[], kind: "doctor" | "pharmacist"): ApiStaffRecord[] {
  const role = kind === "pharmacist" ? /\u85e5\u5e2b|pharmacist|pharm/i : /\u9662\u9577|\u91ab\u5e2b|doctor/i;
  return rows.filter(
    (row) => role.test(row.role || "") && (row.status === "\u5728\u8077" || row.status === "active" || !row.status),
  );
}

function patientIdText(selected: QueueEntry | null): string {
  const raw = String(selected?.idNo || "").trim();
  if (!raw || raw.startsWith("local-") || raw.includes("encounter")) return DASH;
  return raw;
}

function boxCh(minChars: number, value: string): number {
  let units = 0;
  for (const ch of String(value ?? "")) {
    const code = ch.codePointAt(0) || 0;
    units += code > 255 ? 2 : 1;
  }
  return Math.max(minChars, units) + 1.5;
}

function Field({
  label,
  value,
  onChange,
  readOnly,
  chars = 8,
  highlight,
  big,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  chars?: number;
  highlight?: boolean;
  big?: boolean;
}) {
  return (
    <label className="inline-flex items-center" style={{ gap: "0.3em", fontSize: big ? "1.5em" : "1em" }}>
      <span className="shrink-0">{label}</span>
      <input
        className="border border-[#808080] px-[0.35em]"
        style={{
          boxSizing: "content-box",
          width: `${boxCh(chars, value)}ch`,
          height: "1.35em",
          fontSize: "1em",
          lineHeight: 1.15,
          color: HIS.inputBlue,
          background: highlight ? "#7EC8F0" : readOnly ? "#F4F4F4" : "#fff",
        }}
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
  const [doctors, setDoctors] = useState<ApiStaffRecord[]>([]);
  const [pharmacists, setPharmacists] = useState<ApiStaffRecord[]>([]);
  useEffect(() => {
    if (!open) return;
    void fetchStaff()
      .then((rows) => {
        setDoctors(workingStaff(rows, "doctor"));
        setPharmacists(workingStaff(rows, "pharmacist"));
      })
      .catch(() => {
        setDoctors([]);
        setPharmacists([]);
      });
  }, [open]);
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
  const noCloud = selected ? skipsCloudWrite(selected) : false;
  const charged = yuanNumber(draft.selfPay) ?? 0;
  const deposit = yuanNumber(selected?.deposit) ?? 0;
  const total =
    (yuanNumber(draft.regFee) ?? 0) +
    (yuanNumber(draft.burden) ?? 0) +
    (yuanNumber(draft.drugCopay) ?? 0) +
    deposit +
    charged;
  const head = "mb-0.5 border-b border-[#808080] pb-0.5 font-bold leading-tight";
  const zone = "border border-[#808080] bg-white px-1.5 py-1";
  const row = "flex flex-wrap items-center gap-x-3 gap-y-0.5";

  return (
    <div className="absolute inset-0 z-30 flex flex-col" style={{ fontFamily: HIS_FONT, background: HIS.chrome, fontSize: 24 }}>
      <header className="flex shrink-0 items-center justify-between px-2 py-1 text-white" style={{ background: HIS.titleBarFrom }}>
        <span className="font-bold">{"F9 \u5b58\u6a94\u78ba\u8a8d"}</span>
        <span>
          {locked ? "\u5df2\u5b58\u6a94 \u00b7 Esc \u56de\u5019\u8a3a\u6e05\u55ae" : "\u518d\u6309 F9 \u78ba\u5b9a\u5b58\u6a94 \u00b7 Esc \u56de\u8a3a\u7642"}
        </span>
      </header>

      {cardNote && (
        <p className="shrink-0 bg-red-100 px-3 py-1 text-red-900">{cardNote}</p>
      )}

      <div className="flex min-h-0 flex-1">
      <div className="min-h-0 flex-1 overflow-auto p-1">
        <div className="grid grid-cols-2 items-start gap-1">
          <section className={zone}>
            <h3 className={head}>{"\u75c5\u60a3"}</h3>
            <div className={row}>
              <Field label={"\u59d3\u540d"} value={dash(selected?.patientDisplay)} readOnly chars={8} />
              <Field label={"\u75c5\u6b77\u865f"} value={dash(selected?.medicalNo)} readOnly chars={8} />
              <Field label={"\u8eab\u5206\u8b49"} value={patientIdText(selected)} readOnly chars={12} />
              <Field label={"\u751f\u65e5"} value={dash(selected?.birthday ? formatBirthdayRoc(selected.birthday) : "")} readOnly chars={9} />
              <Field label={"\u6027\u5225"} value={dash(selected?.sex || selected?.ageSex)} readOnly chars={3} />
              <Field label={"\u5e8f\u865f"} value={selected ? String(selected.queueNumber) : DASH} readOnly chars={3} />
            </div>
          </section>
          <section className={zone}>
            <h3 className={head}>{"\u7533\u5831\u5fc5\u8981"}</h3>
            <div className={row}>
              <Field label={"\u6848\u4ef6"} value={draft.caseNo} onChange={(v) => onChange({ caseNo: v })} chars={4} />
              <Field label={"\u90e8\u8ca0"} value={draft.copayCode} onChange={(v) => onChange({ copayCode: v })} chars={4} />
              <Field label={"\u7d66\u4ed8"} value={draft.payType} onChange={(v) => onChange({ payType: v })} chars={3} />
              <Field label={"\u8abf\u5291"} value={draft.dispense} onChange={(v) => onChange({ dispense: v })} chars={6} />
              <Field label={"\u5929\u6578"} value={draft.rxDays} onChange={(v) => onChange({ rxDays: v })} chars={3} />
              <Field label={"\u5c31\u91ab\u5e8f\u865f"} value={draft.treatSeq} onChange={(v) => onChange({ treatSeq: v })} chars={6} />
              <Field label={"IC\u5361\u865f"} value={draft.cardNo} onChange={(v) => onChange({ cardNo: v })} chars={14} />
              <label className="inline-flex items-center" style={{ gap: "0.3em" }}>
                <span>{"\u91ab\u5e2b"}</span>
                <select
                  className="border border-[#808080] bg-white px-1"
                  style={{ height: "1.35em", color: HIS.inputBlue, minWidth: "8ch" }}
                  value={draft.doctorId}
                  onChange={(e) => {
                    const picked = doctors.find((row) => row.id === e.target.value);
                    onChange({
                      doctorId: e.target.value,
                      doctor: picked ? doctorDisplayName(picked.name, picked.id) || picked.name : draft.doctor,
                    });
                  }}
                >
                  <option value="">{"\u2014"}</option>
                  {draft.doctorId && !doctors.some((row) => row.id === draft.doctorId) ? (
                    <option value={draft.doctorId}>{draft.doctor || draft.doctorId}</option>
                  ) : null}
                  {doctors.map((row) => (
                    <option key={row.id} value={row.id}>
                      {doctorDisplayName(row.name, row.id) || row.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-flex items-center" style={{ gap: "0.3em" }}>
                <span>{"\u85e5\u5e2b"}</span>
                <select
                  className="border border-[#808080] bg-white px-1"
                  style={{ height: "1.35em", color: HIS.inputBlue, minWidth: "8ch" }}
                  value={draft.pharmacist}
                  onChange={(e) => onChange({ pharmacist: e.target.value })}
                >
                  <option value="">{"\u8acb\u9078\u64c7"}</option>
                  {draft.pharmacist && !pharmacists.some((row) => row.name === draft.pharmacist) ? (
                    <option value={draft.pharmacist}>{draft.pharmacist}</option>
                  ) : null}
                  {pharmacists.map((row) => (
                    <option key={row.id} value={row.name}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
              <Field label={"\u79d1\u5225"} value={draft.dept} onChange={(v) => onChange({ dept: v })} chars={6} />
              <Field label={"\u4e3b\u8a3a\u65b7"} value={draft.dxText} onChange={(v) => onChange({ dxText: v })} chars={16} />
              <Field label="ICD" value={draft.icd10} onChange={(v) => onChange({ icd10: v })} chars={8} />
            </div>
          </section>
          <section className={zone}>
            <h3 className={head}>{"\u8cbb\u7528"}</h3>
            <div className={row}>
              <Field label={"\u639b\u865f\u8cbb"} value={draft.regFee} readOnly chars={5} />
              <Field label={"\u85e5\u8cbb"} value={draft.drugFee} readOnly chars={5} />
              <Field label={"\u6750\u6599"} value={draft.materialFee} readOnly chars={5} />
              <Field label={"\u8a3a\u5bdf"} value={draft.consultFee} readOnly chars={5} />
              <Field label={"\u90e8\u5206\u8ca0\u64d4"} value={draft.burden} readOnly chars={5} />
              <Field label={"\u85e5\u90e8"} value={draft.drugCopay} readOnly chars={5} />
              <Field label={"\u62bc\u91d1"} value={dash(selected?.deposit)} readOnly chars={5} />
              <Field label={"\u81ea\u8cbb"} value={draft.selfPay} onChange={(v) => onChange({ selfPay: v })} chars={6} highlight big />
              <span className="inline-flex items-center font-bold" style={{ gap: "0.3em", fontSize: "1.5em" }}>
                {"\u7e3d\u50f9"}
                <span style={{ color: HIS.inputBlue }}>{moneyText(total)}</span>
              </span>
            </div>
            <p className="mt-0.5 leading-tight" style={{ fontSize: "0.8em" }}>
              {"\u9032\u4f4d "}
              {draft.selfPayBasis}
              {"\u3002\u9019\u88e1\u53ea\u6539\u81ea\u8cbb\uff0c\u7e3d\u50f9\u8ddf\u8457\u8b8a\u3002\u639b\u865f\u3001\u90e8\u5206\u8ca0\u64d4\u3001\u62bc\u91d1\u5230 F3 \u6539\u3002"}
            </p>
          </section>
          <section className={zone}>
            <h3 className={head}>{"\u91cd\u8981\u91ab\u4ee4"}</h3>
            <div className={row}>
              <Field label={"\u91ab\u4ee4"} value={draft.orderCode} onChange={(v) => onChange({ orderCode: v })} chars={8} />
              <Field label={"\u4eba\u54e1"} value={draft.orderStaff} onChange={(v) => onChange({ orderStaff: v })} chars={6} />
              <Field label={"\u6642\u9593"} value={draft.orderTime} onChange={(v) => onChange({ orderTime: v })} chars={12} />
              <Field label={"\u624b\u8853"} value={draft.surgeryCode} onChange={(v) => onChange({ surgeryCode: v })} chars={8} />
            </div>
            <h3 className={`${head} mt-1`}>{"\u5b58\u6a94\u52fe\u9078"}</h3>
            <div className="space-y-0.5">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={noCloud ? false : draft.writeCard}
                  disabled={locked || noCloud}
                  onChange={(e) => onChange({ writeCard: e.target.checked })}
                />
                {"\u5beb\u5165\u5065\u4fdd\u96f2\u7aef\uff086.0\uff1b\u975e\u5beb\u6676\u7247\uff09"}
              </label>
              <p className="pl-5 leading-tight" style={{ fontSize: "0.8em" }}>
                {noCloud
                  ? "\u62bc\u91d1\u548c\u81ea\u8cbb\u53ea\u7559\u5728\u9019\u53f0\u96fb\u8166\uff0c\u52fe\u4e86\u4e5f\u4e0d\u5beb\u5065\u4fdd\u96f2\u7aef\u3002"
                  : "\u9019\u53f0\u96fb\u8166\u7684\u9810\u8a2d\u5728\u9662\u6240\u8cc7\u6599\u2192\u672c\u6a5f\u5de5\u4f5c\u7ad9\u3002\u9019\u88e1\u6539\u7684\u53ea\u5f71\u97ff\u9019\u4e00\u6b21\u3002"}
              </p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.writeDx}
                  disabled={locked || noCloud || !draft.writeCard}
                  onChange={(e) => onChange({ writeDx: e.target.checked })}
                />
                連同診斷＋費用（WriteCodeFee）
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.writeOrders}
                  disabled={locked || noCloud || !draft.writeCard}
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
              <p className="pl-5 leading-tight text-slate-600" style={{ fontSize: "0.8em" }}>
                {"\u9019\u53f0\u96fb\u8166\u7684\u9810\u8a2d\u5728\u9662\u6240\u8cc7\u6599\u2192\u672c\u6a5f\u5de5\u4f5c\u7ad9\u3002\u770b\u8a3a\u3001\u85e5\u5c40\u9810\u8a2d\u8981\u8df3\u5217\u5370\uff0c\u639b\u865f\u53f0\u9810\u8a2d\u53ea\u5b58\u6a94\u3002\u9019\u88e1\u6539\u7684\u53ea\u5f71\u97ff\u9019\u4e00\u6b21\u3002"}
              </p>
            </div>
          </section>
        </div>

        <section className={`${zone} mt-1`}>
          <div className={head}>{"\u4e3b\u8ff0\uff0f\u8655\u65b9"}</div>
          <pre className="max-h-12 overflow-auto whitespace-pre-wrap leading-tight" style={{ fontSize: "0.9em" }}>
            {ccText.trim() || DASH}
          </pre>
          <ul className="mt-0.5 max-h-16 overflow-auto leading-tight" style={{ fontSize: "0.9em" }}>
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
      <aside className="flex w-64 shrink-0 flex-col border-l border-slate-400 bg-slate-100">
        <div className="border-b border-slate-400 bg-slate-300 px-2 py-1 font-bold">
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
            <li className="px-2 py-3 text-slate-500">這個時段沒有待診</li>
          ) : (
            waiting.map((row, i) => (
              <li key={row.encounterId} data-list-row="">
                <button
                  type="button"
                  className={`flex w-full items-center gap-1 px-2 py-1 text-left hover:bg-amber-100 ${
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
        <p className="border-t border-slate-300 px-2 py-1 text-slate-600" style={{ fontSize: "0.85em" }}>
          點名就切到下一位看診
        </p>
      </aside>
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-slate-400 bg-slate-300 px-3 py-2">
        <button
          type="button"
          className="rounded border border-slate-500 bg-white px-3 py-1"
          onClick={onClose}
        >
          Esc 離開
        </button>
        {printNote ? <span className="min-w-0 flex-1 font-bold text-slate-900">{printNote}</span> : <span className="flex-1" />}
        {saving && <span className="text-sky-800">寫入中…</span>}
        <button
          type="button"
          disabled={locked || saving}
          className="rounded border-2 border-slate-600 bg-white px-8 py-3 text-[30px] font-bold leading-none disabled:bg-slate-200 disabled:text-slate-400"
          onClick={onConfirm}
        >
          <span className="font-mono" style={{ fontSize: "0.8em" }}>F9</span> {locked ? "已存檔" : "存檔"}
        </button>
        <button
          type="button"
          className="rounded border-2 border-slate-800 bg-[#ffe14a] px-8 py-3 text-[30px] font-bold leading-none"
          onClick={onPrint}
        >
          <span className="font-mono" style={{ fontSize: "0.8em" }}>P</span> 列印
        </button>
      </footer>
    </div>
  );
}
