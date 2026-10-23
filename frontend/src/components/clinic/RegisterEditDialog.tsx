import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fetchStaff, type ApiStaffRecord } from "@/api/clinicApi";
import { CardFaultPanel } from "@/components/clinic/CardFaultPanel";
import type { CardFaultReport } from "@/api/clinicApi";
import { HisWinTitle } from "@/components/clinic/HisPageFrame";
import { HIS, HIS_FONT } from "@/lib/hisTheme";
import { HisFixedClockInput } from "@/components/clinic/HisFixedClockInput";
import { RocBirthdayInput } from "@/components/clinic/RocBirthdayInput";
import { applyVisitIdentity, visitIdentityChoice } from "@/lib/cardIdentity";
import { pharmacistDisplayName } from "@/lib/doctorName";
import { NHI_NOCARD_REASONS, needsNhiNoCardReason } from "@/lib/registerModes";

export type IcException =
  | "ic"
  | "deposit"
  | "afterCheck"
  | "noCard"
  | "childNoCard"
  | "pregnantNoCard"
  | "badCard"
  | "paper"
  | "selfPay";

export type RegisterEditForm = {
  encounterId?: string;
  patientId?: string;
  idNo: string;
  birthday: string;
  sex: string;
  patientName: string;
  reasonText: string;
  caseNo: string;
  copayCode: string;
  payType: string;
  dispense: string;
  shift: string;
  room: string;
  treatmentItem: string;
  afterCheck: "1" | "2";
  icException: IcException;
  noCardReason: string;
  pharmacist: string;
  doctorId: string;
  doctorName: string;
  paperCard: boolean;
  treatSeq: string;
  treatmentNumber: string;
  treatDateTime: string;
  securitySign?: string;
  cardId: string;
  /** 健保卡身分註記。1 福保、2 榮民、4 中低收入、8 災民。 */
  cardIdentity?: string;
  regFee: string;
  copayAmt: string;
  /** 部分負擔優待。實收＝部分負擔－這個數字。 */
  copayDiscAmt?: string;
  deposit: string;
  consultFee: string;
  drugFee: string;
  materialFee: string;
  burdenFee: string;
  /** 預約掛號；無卡存檔時不走押金單 */
  prebook?: boolean;
  confirmDuplicate?: boolean;
  /** 當日就診序號，空白＝存檔時自動取號 */
  queueNumber?: string;
  /** 清單上的就診時間 HH:MM */
  visitClock?: string;
  acceptReferral?: string;
  referralSeq?: string;
  referralHospId?: string;
  referralHospName?: string;
  referralDate?: string;
};

const IC_OPTIONS: { value: IcException; label: string }[] = [
  { value: "ic", label: "正常 IC 讀卡" },
  { value: "deposit", label: "押單（欠卡，直接存檔）" },
  { value: "afterCheck", label: "補卡" },
  { value: "noCard", label: "無卡例外就醫" },
  { value: "childNoCard", label: "兒少無卡例外" },
  { value: "pregnantNoCard", label: "孕婦無卡例外" },
  { value: "badCard", label: "卡片不良" },
  { value: "paper", label: "紙卡" },
  { value: "selfPay", label: "自費（不取號）" },
];

export function emptyRegisterForm(): RegisterEditForm {
  const hour = new Date().getHours();
  const shift = hour < 12 ? "上午" : hour < 18 ? "下午" : "晚上";
  return {
    idNo: "",
    birthday: "",
    sex: "F",
    patientName: "",
    reasonText: "",
    caseNo: "01",
    copayCode: "",
    payType: "4",
    dispense: "自行調劑",
    shift,
    room: "",
    treatmentItem: "01",
    afterCheck: "1",
    icException: "ic",
    noCardReason: "",
    pharmacist: "",
    doctorId: "",
    doctorName: "",
    paperCard: false,
    treatSeq: "",
    treatmentNumber: "",
    treatDateTime: "",
    cardId: "",
    cardIdentity: "",
    regFee: "",
    copayAmt: "",
    copayDiscAmt: "0",
    deposit: "",
    consultFee: "",
    drugFee: "",
    materialFee: "",
    burdenFee: "",
  };
}

type Props = {
  open: boolean;
  title?: string;
  busy?: boolean;
  seqBusy?: boolean;
  seqNote?: string | null;
  error?: string | null;
  diagnose?: CardFaultReport | null;
  form: RegisterEditForm;
  onChange: (patch: Partial<RegisterEditForm>) => void;
  onClose: () => void;
  onReadCard: () => Promise<void>;
  onConfirm: () => Promise<void>;
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-1 text-[11px] leading-none">
      <span
        className="w-[4.5rem] shrink-0 border px-1 py-0.5 text-right font-bold"
        style={{ borderColor: "#808080", background: "#C0C0C0" }}
      >
        {label}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

const inputCls =
  "w-full border border-[#808080] bg-white px-1 py-0.5 text-[12px] leading-none outline-none focus:border-[#000080]";

function needsNoCardReason(ex: IcException): boolean {
  return needsNhiNoCardReason(ex) && ex !== "badCard";
}

/**
 * 醫聖「掛號編輯」：從診療作業進來的此次掛號資料。
 * 費用未批到顯示空白，不編造。正常 IC 必須打健保局取號。
 */
export function RegisterEditDialog({
  open,
  title,
  busy,
  seqBusy,
  seqNote,
  error,
  diagnose,
  form,
  onChange,
  onClose,
  onReadCard,
  onConfirm,
}: Props) {
  const [pharmacists, setPharmacists] = useState<ApiStaffRecord[]>([]);

  useEffect(() => {
    if (!open) return;
    void fetchStaff()
      .then((rows) => {
        const list = rows.filter(
          (s) =>
            /藥師|pharmacist|pharm/i.test(s.role || "") &&
            (s.status === "在職" || s.status === "active" || !s.status),
        );
        setPharmacists(list);
        if (!(form.pharmacist ?? "").trim() && list[0]?.name) {
          onChange({ pharmacist: list[0].name });
        }
      })
      .catch(() => setPharmacists([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const header = title || "掛號編輯";

  const setException = (icException: IcException) => {
    onChange({
      icException,
      paperCard: icException === "paper",
      afterCheck: icException === "afterCheck" ? "2" : "1",
      caseNo: icException === "selfPay" ? "9X" : form.caseNo === "9X" ? "01" : form.caseNo,
      regFee: icException === "selfPay" && !form.regFee ? "300" : form.regFee,
      noCardReason:
        icException === "badCard"
          ? "\u5361\u7247\u4e0d\u826f"
          : needsNhiNoCardReason(icException)
            ? form.noCardReason
            : "",
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40">
      <div
        className="flex max-h-[94%] w-[min(56rem,98%)] flex-col overflow-hidden border-2 text-[12px] shadow"
        style={{ borderColor: "#404040", background: HIS.chrome, fontFamily: HIS_FONT }}
      >
        <HisWinTitle
          title={header.includes("F3") ? header : `掛號修編 (F3) — ${header}`}
          trailing={
            <span className="text-[10px] font-normal opacity-90">Esc 取消</span>
          }
        />

        {seqBusy && (
          <p className="shrink-0 bg-[#FFFFCC] px-2 py-0.5 text-[11px] font-semibold">
            {"\u9023\u7dda\u5065\u4fdd\u5c40\u53d6\u865f\u4e2d\u2026"}
          </p>
        )}
        {seqNote && !seqBusy && (
          <p className="shrink-0 bg-[#E0F0FF] px-2 py-0.5 text-[11px]">{seqNote}</p>
        )}
        {diagnose ? (
          <CardFaultPanel diagnose={diagnose} />
        ) : (
          error && (
            <p className="shrink-0 bg-[#FFCCCC] px-2 py-0.5 text-[11px]">{error}</p>
          )
        )}

        <div className="min-h-0 flex-1 overflow-auto p-1">
          <div className="grid grid-cols-2 gap-1">
            <section className="border bg-white p-1" style={{ borderColor: "#808080" }}>
              <h3 className="mb-1 border-b pb-0.5 text-[11px] font-bold" style={{ borderColor: "#808080" }}>
                {"\u75c5\u60a3"}
              </h3>
              <div className="space-y-0.5">
                <Field label={"\u59d3\u540d"}>
                  <input className={inputCls} value={form.patientName} onChange={(e) => onChange({ patientName: e.target.value })} />
                </Field>
                <Field label={"\u8eab\u5206\u8b49"}>
                  <span className="flex gap-1">
                    <input className={`${inputCls} font-mono`} maxLength={10} value={form.idNo} onChange={(e) => onChange({ idNo: e.target.value.toUpperCase() })} />
                    <button
                      type="button"
                      disabled={busy || seqBusy || (form.icException !== "ic" && form.icException !== "afterCheck")}
                      className="shrink-0 border px-1 py-0.5 text-[11px] font-bold disabled:opacity-50"
                      style={{ borderColor: "#808080", background: "#D4D0C8" }}
                      onClick={() => void onReadCard()}
                    >
                      IC{"\u8b80\u5361"}
                    </button>
                  </span>
                </Field>
                <Field label={"\u6c11\u570b\u751f\u65e5"}>
                  <RocBirthdayInput className={`${inputCls} font-mono`} value={form.birthday} readOnly={busy} onChange={(birthday) => onChange({ birthday })} />
                </Field>
                <Field label={"\u6027\u5225"}>
                  <select className={`${inputCls} bg-[#b6f5b6] font-bold`} value={form.sex} onChange={(e) => onChange({ sex: e.target.value })}>
                    <option value="F">{"\u5973"}</option>
                    <option value="M">{"\u7537"}</option>
                  </select>
                </Field>
                <Field label={"\u6642\u6bb5"}>
                  <select className={`${inputCls} bg-[#b6f5b6] font-bold`} value={form.shift} onChange={(e) => onChange({ shift: e.target.value })}>
                    <option value={"\u4e0a\u5348"}>{"\u4e0a\u5348"}</option>
                    <option value={"\u4e0b\u5348"}>{"\u4e0b\u5348"}</option>
                    <option value={"\u665a\u4e0a"}>{"\u665a\u4e0a"}</option>
                  </select>
                </Field>
                <Field label={"\u5c31\u8a3a\u6642\u9593"}>
                  <span className={`${inputCls} inline-flex items-center`}>
                    <HisFixedClockInput
                      value={form.visitClock || ""}
                      onChange={(visitClock) => onChange({ visitClock })}
                    />
                  </span>
                </Field>
                <Field label={"\u5c31\u8a3a\u5e8f\u865f"}>
                  <input
                    className={`${inputCls} font-mono`}
                    value={form.queueNumber || ""}
                    onChange={(e) => onChange({ queueNumber: e.target.value.replace(/\D/g, "") })}
                  />
                </Field>
                <Field label={"\u8a3a\u9593"}>
                  <input className={inputCls} value={form.room} onChange={(e) => onChange({ room: e.target.value })} />
                </Field>
                <Field label={"\u4e3b\u8ff0"}>
                  <input className={inputCls} value={form.reasonText} onChange={(e) => onChange({ reasonText: e.target.value })} />
                </Field>
              </div>
            </section>

            <section className="border bg-white p-1" style={{ borderColor: "#808080" }}>
              <h3 className="mb-1 border-b pb-0.5 text-[11px] font-bold" style={{ borderColor: "#808080" }}>
                {"\u639b\u865f\u7a2e\u985e\uff0f\u8b80\u5361\u4f8b\u5916"}
              </h3>
              <div className="space-y-0.5">
                <Field label={"\u8b80\u5361\u4f8b\u5916"}>
                  <select
                    className={inputCls}
                    value={form.icException}
                    onChange={(e) => setException(e.target.value as IcException)}
                  >
                    {IC_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {needsNoCardReason(form.icException) && (
                  <Field label="無卡原因">
                    <select
                      className={inputCls}
                      value={form.noCardReason}
                      onChange={(e) => onChange({ noCardReason: e.target.value })}
                    >
                      <option value="">請選擇（未選押單時必填）</option>
                      {NHI_NOCARD_REASONS.map((reason) => (
                        <option key={reason} value={reason}>
                          {reason}
                        </option>
                      ))}
                      {form.noCardReason &&
                      !NHI_NOCARD_REASONS.includes(form.noCardReason as (typeof NHI_NOCARD_REASONS)[number]) ? (
                        <option value={form.noCardReason}>{form.noCardReason}</option>
                      ) : null}
                    </select>
                  </Field>
                )}
                <Field label={"\u88dc\u5361\u8a3b\u8a18"}>
                  <select
                    className={inputCls}
                    value={form.afterCheck}
                    onChange={(e) => onChange({ afterCheck: e.target.value as "1" | "2" })}
                  >
                    <option value="1">1 {"\u6b63\u5e38"}</option>
                    <option value="2">2 {"\u88dc\u5361"}</option>
                  </select>
                </Field>
                <Field label={"IC\u5361\u865f"}>
                  <input className={`${inputCls} bg-[#E8E8E8] font-mono`} readOnly value={form.cardId} />
                </Field>
                <p className="pt-0.5 text-[10px] leading-snug text-[#404040]">
                  {"\u6b63\u5e38 IC\uff1aSequelNumber/Next\u3002\u7121\u5361\uff0f\u5361\u7247\u4e0d\u826f\uff0f\u7d19\u5361\uff1aTreatmentNumber/NoCard\u3002\u81ea\u8cbb\u4e0d\u53d6\u865f\u3002"}
                </p>
              </div>
            </section>

            <section className="border bg-white p-1" style={{ borderColor: "#808080" }}>
              <h3 className="mb-1 border-b pb-0.5 text-[11px] font-bold" style={{ borderColor: "#808080" }}>
                {"\u7533\u5831\uff0f\u8abf\u5291\uff0f\u85e5\u5e2b"}
              </h3>
              <div className="space-y-0.5">
                <Field label={"\u6848\u4ef6\u5206\u985e"}>
                  <select className={`${inputCls} bg-[#b6f5b6] font-bold`} value={form.caseNo} onChange={(e) => onChange({ caseNo: e.target.value })}>
                    <option value="01">01 {"\u897f\u91ab\u9580\u8a3a"}</option>
                    <option value="02">02</option>
                    <option value="04">04</option>
                    <option value="08">08 {"\u6162\u7b8b"}</option>
                    <option value="09">09</option>
                    <option value="A3">A3 {"\u9810\u9632\u4fdd\u5065"}</option>
                    <option value="9X">9X {"\u81ea\u8cbb"}</option>
                  </select>
                </Field>
                <Field label={"\u5c31\u91ab\u985e\u5225"}>
                  <select className={`${inputCls} bg-[#b6f5b6] font-bold`} value={form.treatmentItem} onChange={(e) => onChange({ treatmentItem: e.target.value })}>
                    <option value="01">01 {"\u897f\u91ab\u9580\u8a3a"}</option>
                    <option value="02">02 {"\u7259\u91ab\u9580\u8a3a"}</option>
                    <option value="03">03 {"\u4e2d\u91ab\u9580\u8a3a"}</option>
                    <option value="04">04 {"\u6025\u8a3a"}</option>
                    <option value="08">08 {"\u9810\u9632\u4fdd\u5065"}</option>
                    <option value="09">09 {"\u5176\u4ed6"}</option>
                  </select>
                </Field>
                <Field label={"\u672c\u6b21\u8eab\u5206"}>
                  <select
                    className={`${inputCls} bg-[#b6f5b6] font-bold`}
                    value={visitIdentityChoice(form.cardIdentity, form.copayCode)}
                    onChange={(e) => onChange(applyVisitIdentity(e.target.value, form))}
                  >
                    <option value="">{ "\u4e00\u822c" }</option>
                    <option value="1">{ "\u798f\u4fdd" }</option>
                    <option value="2">{ "\u69ae\u6c11" }</option>
                    <option value="4">{ "\u4e2d\u4f4e\u6536\u5165" }</option>
                    <option value="8">{ "\u707d\u6c11" }</option>
                    <option value="001">{ "\u91cd\u5927\u50b7\u75c5" }</option>
                  </select>
                </Field>
                <p className="text-[10px] leading-snug text-[#404040]">
                  {"\u9019\u6b21\u639b\u8658\u7684\u8eab\u5206\uff0c\u4e0d\u6539\u75c5\u60a3\u4e3b\u6a94\u3002\u798f\u4fdd 003\u3001\u69ae\u6c11 004\u3001\u91cd\u5927\u50b7\u75c5 001 \u5beb\u9032\u90e8\u5206\u8ca0\u64d4\u4ee3\u865f\uff0c\u75c5\u4eba\u9019\u6b21\u4e0d\u6536\uff0c\u9ede\u6578\u7533\u5831\u5411\u5065\u4fdd\u5c40\u8acb\u3002"}
                </p>
                <Field label={"\u90e8\u4efd\u8ca0\u64d4"}>
                  <input className={`${inputCls} font-mono`} placeholder={"\u4ee3\u865f"} value={form.copayCode} onChange={(e) => onChange({ copayCode: e.target.value })} />
                </Field>
                <Field label={"\u7d66\u4ed8\u985e\u5225"}>
                  <input className={`${inputCls} font-mono`} value={form.payType} onChange={(e) => onChange({ payType: e.target.value })} />
                </Field>
                <Field label={"\u8abf\u5291\u65b9\u5f0f"}>
                  <select className={`${inputCls} bg-[#b6f5b6] font-bold`} value={form.dispense} onChange={(e) => onChange({ dispense: e.target.value })}>
                    <option value={"\u81ea\u884c\u8abf\u5291"}>{"\u81ea\u884c\u8abf\u5291"}</option>
                    <option value={"\u4ea4\u4ed8\u8abf\u5291"}>{"\u4ea4\u4ed8\u8abf\u5291"}</option>
                    <option value={"\u7121\u9700\u8abf\u5291"}>{"\u7121\u9700\u8abf\u5291"}</option>
                  </select>
                </Field>
                <Field label={"\u85e5\u5e2b"}>
                  <div className="flex gap-1">
                    <select className={`${inputCls} bg-[#b6f5b6] font-bold`} value={pharmacistDisplayName(form.pharmacist, pharmacists, "") || form.pharmacist} onChange={(e) => onChange({ pharmacist: e.target.value })}>
                      <option value="">{"\uff08\u5fc5\u586b\uff09"}</option>
                      {pharmacists.map((p) => (
                        <option key={p.id} value={p.name}>
                          {p.name} {p.certNo ? `\uff0f${p.certNo}` : ""}
                        </option>
                      ))}
                    </select>
                    {pharmacists.length === 0 && (
                      <input
                        className={inputCls}
                        placeholder={"\u8f38\u5165\u85e5\u5e2b\u59d3\u540d"}
                        value={form.pharmacist}
                        onChange={(e) => onChange({ pharmacist: e.target.value })}
                      />
                    )}
                  </div>
                </Field>
              </div>
            </section>

            <section className="border bg-white p-1" style={{ borderColor: "#808080" }}>
              <h3 className="mb-1 border-b pb-0.5 text-[11px] font-bold" style={{ borderColor: "#808080" }}>
                {"\u8cbb\u7528\uff08Recive.Set\uff09"}
              </h3>
              <p className="mb-0.5 text-[10px] text-[#404040]">{"\u672a\u6279\u5230\u7684\u91d1\u984d\u7559\u7a7a\uff0c\u4e0d\u7de8\u9020\u3002"}</p>
              <div className="space-y-0.5">
                <Field label={"\u639b\u865f\u8cbb\u7528"}>
                  <input className={`${inputCls} font-mono`} value={form.regFee} onChange={(e) => onChange({ regFee: e.target.value })} />
                </Field>
                <Field label={"\u81ea\u4ed8"}>
                  <input className={`${inputCls} font-mono`} value={form.copayAmt} onChange={(e) => onChange({ copayAmt: e.target.value })} />
                </Field>
                <Field label={"\u62bc\u91d1"}>
                  <input className={`${inputCls} font-mono`} value={form.deposit} onChange={(e) => onChange({ deposit: e.target.value })} />
                </Field>
                <Field label={"\u8a3a\u5bdf\u8cbb\u7528"}>
                  <input className={`${inputCls} font-mono`} value={form.consultFee} onChange={(e) => onChange({ consultFee: e.target.value })} />
                </Field>
                <Field label={"\u85e5\u54c1\u8cbb\u7528"}>
                  <input className={`${inputCls} font-mono`} value={form.drugFee} onChange={(e) => onChange({ drugFee: e.target.value })} />
                </Field>
                <Field label={"\u6750\u6599\u8cbb\u7528"}>
                  <input className={`${inputCls} font-mono`} value={form.materialFee} onChange={(e) => onChange({ materialFee: e.target.value })} />
                </Field>
                <Field label={"\u8a3a\u7642\u8ca0\u64d4"}>
                  <input className={`${inputCls} font-mono`} value={form.burdenFee} onChange={(e) => onChange({ burdenFee: e.target.value })} />
                </Field>
              </div>
            </section>
          </div>

          <section className="mt-1 border bg-white p-1" style={{ borderColor: "#808080" }}>
            <h3 className="mb-1 border-b pb-0.5 text-[11px] font-bold" style={{ borderColor: "#808080" }}>
              {"\u5065\u4fdd\u5c40\u56de\u8986"}
            </h3>
            <div className="grid grid-cols-3 gap-1">
              <Field label={"\u5c31\u91ab\u5e8f\u865f"}>
                <input className={`${inputCls} font-mono`} value={form.treatSeq} onChange={(e) => onChange({ treatSeq: e.target.value })} />
              </Field>
              <Field label={"\u5c31\u91ab\u8b58\u5225\u78bc"}>
                <input className={`${inputCls} font-mono`} value={form.treatmentNumber} onChange={(e) => onChange({ treatmentNumber: e.target.value })} />
              </Field>
              <Field label={"\u5065\u4fdd\u5c31\u8a3a\u6642\u9593"}>
                <input className={`${inputCls} font-mono`} value={form.treatDateTime} onChange={(e) => onChange({ treatDateTime: e.target.value })} />
              </Field>
            </div>
          </section>
        </div>

        <footer
          className="flex shrink-0 items-center gap-1 border-t px-1 py-1"
          style={{ borderColor: "#808080", background: "#D4D0C8" }}
        >
          <button
            type="button"
            disabled={busy || seqBusy || !form.idNo.trim() || !form.birthday.trim()}
            className="border px-2 py-0.5 text-[11px] font-bold disabled:opacity-50"
            style={{ borderColor: "#808080", background: "#7FFFD4" }}
            onClick={() => void onConfirm()}
          >
            <span className="font-mono text-[10px]">Y</span> {"\u78ba\u5b9a"}
          </button>
          <button
            type="button"
            className="border px-2 py-0.5 text-[11px] font-bold"
            style={{ borderColor: "#808080", background: "#fff" }}
            onClick={onClose}
          >
            <span className="font-mono text-[10px]">Esc</span> {"\u53d6\u6d88"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
