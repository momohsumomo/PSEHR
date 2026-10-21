import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HisXpDialog } from "@/components/clinic/HisPageFrame";
import type { ApiClaimsPreview, ClaimsSubmitType } from "@/api/clinicApi";
import { stageClaimsEmr } from "@/lib/claimsEmr";
import { isoToRoc } from "@/components/clinic/HisRocDatePicker";

export type ClaimSlipRecord = NonNullable<ApiClaimsPreview["records"]>[number];

type Line = {
  kind: string;
  code: string;
  name: string;
  dose: string;
  freq: string;
  route: string;
  days: string;
  qty: string;
  price: string;
  points: string;
};

type Row = {
  record: ClaimSlipRecord;
  serial: number;
};

const T = {
  title: "\u7533\u5831\u55ae\u7b46",
  ym: "\u8cbb\u7528\u5e74\u6708",
  serial: "\u6d41\u6c34\u865f",
  kind: "\u7533\u5831",
  songhe: "\u9001\u6838",
  bubao: "\u88dc\u5831",
  caseNo: "\u6848\u4ef6",
  visit: "\u5c31\u91ab\u65e5",
  days: "\u7d66\u85e5\u65e5\u4efd",
  seq: "\u5c31\u91ab\u5e8f\u865f",
  copay: "\u90e8\u4efd\u8ca0\u64d4",
  dispense: "\u8abf\u5291",
  dx: "\u75be\u75c5",
  name: "\u59d3\u540d",
  birth: "\u751f\u65e5",
  chart: "\u75c5\u6b77\u865f",
  treat: "\u5c31\u91ab\u8b58\u5225\u78bc",
  order: "\u5e8f",
  cat: "\u985e",
  code: "\u4ee3\u865f",
  item: "\u540d\u7a31",
  dose: "\u6b21\u91cf",
  freq: "\u983b\u7387",
  route: "\u9014\u5f91",
  dayCol: "\u5929\u6578",
  qty: "\u7e3d\u91cf",
  price: "\u55ae\u50f9",
  points: "\u9ede\u6578",
  consult: "\u8a3a\u5bdf",
  drug: "\u85e5\u54c1",
  pharmacy: "\u85e5\u4e8b",
  tx: "\u8655\u7f6e",
  sum: "\u5408\u8a08",
  apply: "\u7533\u8acb",
  lookup: "\u8abf\u95b1\u75c5\u6b77",
  close: "\u96e2\u958b",
  empty: "\u9019\u500b\u6708\u6c92\u6709\u9032\u7533\u5831\u6a94\u7684\u770b\u8a3a",
  again: "\u6539\u5b8c\u75c5\u6b77\u5f8c\uff0c\u56de\u4f86\u518d\u7522\u4e00\u6b21\u7533\u5831\u6a94\u3002",
  list: "\u540d\u55ae",
};

function n(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return "";
  return String(Math.round(Number(value)));
}

function money(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return "";
  return Number(value).toFixed(2);
}

function linesOf(record: ClaimSlipRecord): Line[] {
  const out: Line[] = [];
  if (record.consultCode || (record.consultationPoints || 0) > 0) {
    out.push({
      kind: "0",
      code: record.consultCode || "",
      name: T.consult,
      dose: "",
      freq: "",
      route: "",
      days: "",
      qty: "1.0",
      price: money(record.consultBase),
      points: n(record.consultationPoints),
    });
  }
  if (record.pharmacyCode) {
    out.push({
      kind: "9",
      code: record.pharmacyCode,
      name: T.pharmacy,
      dose: "",
      freq: "",
      route: "",
      days: "",
      qty: "1.0",
      price: money(record.pharmacyBase),
      points: n(record.pharmacyPoints),
    });
  }
  for (const med of record.medications || []) {
    const pts = Number(med.linePoints || 0);
    const upper = (med.nhiCode || "").trim().toUpperCase();
    const order = /^\d{5}[A-Z]$/.test(upper) && !upper.startsWith("00") && !upper.startsWith("052");
    let kind = "1";
    if (/^R00[1-8]$|^S00[1-4]$/.test(upper)) kind = "G";
    else if (order) kind = pts > 0 ? "2" : "4";
    else if (med.billable === false) kind = "4";
    out.push({
      kind,
      code: med.nhiCode || "",
      name: med.drugText || "",
      dose: med.doseEach != null ? String(med.doseEach) : "",
      freq: med.useage || "",
      route: med.routeCode || "",
      days: med.daysSupply ? String(med.daysSupply) : "",
      qty: med.quantity != null ? String(med.quantity) : "",
      price: money(med.unitPrice),
      points: n(pts),
    });
  }
  return out;
}

function Field({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <label className="flex items-center gap-1" style={{ minWidth: wide ? 280 : 140 }}>
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 flex-1 truncate border bg-white px-1" style={{ borderColor: "#808080" }}>
        {value || "\u00a0"}
      </span>
    </label>
  );
}

export function ClaimSlipDialog({
  open,
  onClose,
  records,
  yearMonthRoc,
  submitType,
}: {
  open: boolean;
  onClose: () => void;
  records: ClaimSlipRecord[];
  yearMonthRoc: string;
  submitType: ClaimsSubmitType;
}) {
  const navigate = useNavigate();
  const rows = useMemo(() => {
    const counters: Record<string, number> = {};
    const out: Row[] = [];
    for (const record of records) {
      if (record.claimable === false) continue;
      const caseNo = record.caseNo || "01";
      counters[caseNo] = (counters[caseNo] || 0) + 1;
      out.push({ record, serial: counters[caseNo] });
    }
    return out;
  }, [records]);
  const [index, setIndex] = useState(0);
  const safe = rows.length === 0 ? 0 : Math.min(index, rows.length - 1);
  const current = rows[safe];
  const record = current?.record;
  const grid = record ? linesOf(record) : [];
  const dx = (record?.diagnosisCodes || []).filter(Boolean).join(" ") || record?.diagnoses || "";

  const openChart = () => {
    if (!record?.encounterDate) return;
    stageClaimsEmr({
      date: record.encounterDate.slice(0, 10),
      chartPatientId: record.chartPatientId || "",
      encounterId: record.encounterId,
      medicalNo: record.medicalNo || "",
      patientName: record.patientName || "",
    });
    navigate("/emr-lookup");
  };

  return (
    <HisXpDialog open={open} title={T.title} onClose={onClose} width={1080}>
      {!current || !record ? (
        <p className="px-2 py-6 text-center">{T.empty}</p>
      ) : (
        <div className="flex min-h-[28rem] gap-2 text-[12px] text-black">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <Field label={T.ym} value={yearMonthRoc} />
              <Field label={T.serial} value={String(current.serial)} />
              <Field label={T.kind} value={submitType === "bubao" ? T.bubao : T.songhe} />
              <Field label={T.caseNo} value={record.caseNo || ""} />
              <Field label={T.visit} value={isoToRoc(record.encounterDate || "") || ""} />
              <Field label={T.days} value={record.daysSupply ? String(record.daysSupply) : ""} />
              <Field label={T.seq} value={record.treatSeq || ""} />
              <Field label={T.copay} value={record.copayCode || ""} />
              <Field label={T.dispense} value={record.dispense || ""} />
              <Field label={T.name} value={record.patientName || ""} />
              <Field label={T.birth} value={record.birthdayRoc || ""} />
              <Field label={T.chart} value={record.medicalNo || ""} />
              <Field label={T.dx} value={dx} wide />
              <Field label={T.treat} value={record.treatmentId || ""} wide />
            </div>
            <div className="min-h-0 flex-1 overflow-auto border bg-white" style={{ borderColor: "#808080" }}>
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 bg-[#d4e8c8]">
                  <tr>
                    {[T.order, T.cat, T.code, T.item, T.dose, T.freq, T.route, T.dayCol, T.qty, T.price, T.points].map((label) => (
                      <th key={label} className="border-b px-1 py-0.5 font-bold" style={{ borderColor: "#808080" }}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.map((line, i) => (
                    <tr key={`${line.code}-${i}`} className="odd:bg-[#f4f8ef]">
                      <td className="px-1">{i + 1}</td>
                      <td className="px-1 font-mono">{line.kind}</td>
                      <td className="px-1 font-mono">{line.code}</td>
                      <td className="max-w-[16rem] truncate px-1">{line.name}</td>
                      <td className="px-1 text-right font-mono">{line.dose}</td>
                      <td className="px-1">{line.freq}</td>
                      <td className="px-1">{line.route}</td>
                      <td className="px-1 text-right font-mono">{line.days}</td>
                      <td className="px-1 text-right font-mono">{line.qty}</td>
                      <td className="px-1 text-right font-mono">{line.price}</td>
                      <td className="px-1 text-right font-mono">{line.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 border bg-[#eef6e6] px-2 py-1" style={{ borderColor: "#808080" }}>
              <span>{T.consult} {n(record.consultationPoints)}</span>
              <span>{T.drug} {n(record.drugPoints)}</span>
              <span>{T.pharmacy} {n(record.pharmacyPoints)}</span>
              <span>{T.tx} {n(record.treatmentPoints)}</span>
              <span>{T.sum} {n(record.totalPoints)}</span>
              <span>{T.copay} {n(record.copayPoints)}</span>
              <span>{T.apply} {n(record.applyPoints)}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="border px-3 py-1 font-bold"
                style={{ borderColor: "#404040", background: "#ece9d8" }}
                onClick={openChart}
              >
                {T.lookup}
              </button>
              <button
                type="button"
                className="border px-3 py-1 font-bold"
                style={{ borderColor: "#404040", background: "#ece9d8" }}
                onClick={onClose}
              >
                {T.close}
              </button>
              <span className="text-[11px]">{T.again}</span>
            </div>
          </div>
          <div className="flex w-52 shrink-0 flex-col border bg-white" style={{ borderColor: "#808080" }}>
            <div className="border-b px-1 py-0.5 font-bold" style={{ borderColor: "#808080" }}>{T.list}</div>
            <div className="min-h-0 flex-1 overflow-auto">
              {rows.map((row, i) => (
                <button
                  key={row.record.encounterId}
                  type="button"
                  className="flex w-full gap-1 px-1 text-left"
                  style={{ background: i === safe ? "#000080" : "transparent", color: i === safe ? "#fff" : "#000" }}
                  onClick={() => setIndex(i)}
                >
                  <span className="w-8 font-mono">{row.serial}</span>
                  <span className="min-w-0 flex-1 truncate">{row.record.patientName || ""}</span>
                  <span className="font-mono">{row.record.medicalNo || ""}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </HisXpDialog>
  );
}
