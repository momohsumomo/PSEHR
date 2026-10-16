import type { DiagnosisRow, RxLine } from "@/mocks/clinicMocks";

export type SimpleSlipInput = {
  medicalNo: string;
  name: string;
  sex: string;
  idNo: string;
  birthday: string;
  age: string;
  visitDate: string;
  dept: string;
  caseNo: string;
  cardNo: string;
  doctor: string;
  pharmacist: string;
  chief: string;
  diagnoses: DiagnosisRow[];
  drugs: RxLine[];
  room: string;
  queueNo: string;
  deposit: string;
  regFee: string;
  burden: string;
  selfPay: string;
  clinicName: string;
  address: string;
  clinicCode: string;
  phone: string;
  dispenseDate: string;
  pharmacy: string;
  consultFee: string;
  drugFee: string;
  materialFee: string;
  footer: string;
};

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function show(v: string | number | undefined | null): string {
  const s = String(v ?? "").trim();
  if (!s || s === "\u2014" || s === "-") return "\u2014";
  return s;
}

function asNumber(v: string): number | null {
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && String(v).trim() && String(v).trim() !== "\u2014" ? n : null;
}

function payable(regFee: string, burden: string): string {
  const reg = asNumber(regFee);
  const copay = asNumber(burden);
  if (reg == null || copay == null) return "\u2014";
  return String(reg + copay);
}

function drugLeft(row: RxLine): string {
  const name = show(row.name);
  const qty = row.qty == null ? "" : String(row.qty);
  const sig = show(row.sig) === "\u2014" ? "" : show(row.sig);
  const days = row.days ? String(row.days) : "";
  const total = show(row.totalAmount) === "\u2014" ? "" : show(row.totalAmount);
  const site = (row.bodySite || "").trim();
  return esc([name, qty, sig, days, total, site].filter(Boolean).join("  "));
}

function drugRight(row: RxLine): string {
  const name = esc(show(row.name));
  const qty = esc(row.qty == null ? "\u2014" : String(row.qty));
  const total = esc(show(row.totalAmount));
  const use = esc(
    [show(row.sig), row.days ? row.days + "\u5929" : "", (row.bodySite || "").trim()]
      .filter((x) => x && x !== "\u2014")
      .join(" "),
  );
  return `<tr><td style="font-size:12px;">${name}</td><td>${qty}</td><td>${total}</td><td>${use || "\u2014"}</td></tr>`;
}

/** Two halves, same width. Drug lines stay up top. Money sits on the bottom with a gap. */
export function buildSimpleSlipHtml(input: SimpleSlipInput): string {
  const half =
    "flex:1 1 0;display:flex;flex-direction:column;box-sizing:border-box;min-width:0;height:100%;padding:2mm 3mm;";
  const gap = "flex:1 1 auto;min-height:8mm;";
  const dx = input.diagnoses
    .map((d) => esc(`${show(d.icd10 || d.nhiIcd10)}:${show(d.text)}`))
    .join("<br/>");
  const leftDrugs = input.drugs.map((r) => drugLeft(r)).join("<br/>") || "\u2014";
  const rightDrugs = input.drugs.map((r) => drugRight(r)).join("") || `<tr><td colspan="4">\u2014</td></tr>`;
  const due = payable(input.regFee, input.burden);
  const cell = "padding:1px 4px;white-space:nowrap;";
  return `<div style="display:flex;width:100%;height:100%;box-sizing:border-box;padding:6mm 10mm;font-size:11px;line-height:1.3;color:#111;">
    <section style="${half}border-right:1px solid #222;">
      <div>${esc(show(input.medicalNo))}:${esc(show(input.name))}(${esc(show(input.sex))})${esc(show(input.idNo))}\u751f\u65e5${esc(show(input.birthday))}(${esc(show(input.age))})</div>
      <div>&lt;${esc(show(input.visitDate))}&gt;\u79d1\u5225:${esc(show(input.dept))}\u6848\u4ef6:${esc(show(input.caseNo))}\u5361\u865f:${esc(show(input.cardNo))}</div>
      <div>\u91ab\u5e2b:${esc(show(input.doctor))}\u3000\u85e5\u5e2b:${esc(show(input.pharmacist))}</div>
      <div style="border:1px solid #000;min-height:14px;margin-top:2px;padding:2px;">${esc(show(input.chief))}</div>
      <div>${dx || "\u2014"}</div>
      <div style="border-top:1px dashed #000;margin-top:3px;padding-top:2px;font-size:12px;line-height:1.3;">${leftDrugs}</div>
      <div style="${gap}"></div>
      <div>\u8a3a\u9593:${esc(show(input.room))}\u3000\u554f\u8a3a\u865f:${esc(show(input.queueNo))}\u3000\u85e5\u90e8:\u2014\u3000\u6aa2\u9a57\u90e8:\u2014</div>
      <div>\u62bc\u91d1:${esc(show(input.deposit))}\u3000\u639b\u865f\u8cbb:${esc(show(input.regFee))}\u3000\u90e8\u4efd\u8ca0\u64d4:${esc(show(input.burden))}\u3000\u81ea\u8cbb:${esc(show(input.selfPay))}</div>
      <div>\u61c9\u6536:${esc(due)}</div>
    </section>
    <section style="${half}">
      <div style="text-align:center;font-weight:bold;">\u85e5\u55ae\u5167\u5bb9\u8207\u9580\u8a3a\u8cbb\u7528\u660e\u7d30</div>
      <div>${esc(show(input.clinicName))} (${esc(show(input.address))})</div>
      <div>\u9662\u4ee3:${esc(show(input.clinicCode))}\u3000\u96fb\u8a71:${esc(show(input.phone))}</div>
      <div>\u59d3\u540d:${esc(show(input.name))}\u3000\u8eab\u5206\u8b49:${esc(show(input.idNo))}</div>
      <div>\u5c31\u8a3a\u65e5\u671f:${esc(show(input.visitDate))}\u3000\u8abf\u5291\u65e5:${esc(show(input.dispenseDate))}</div>
      <div>\u85e5\u5c40\u5730\u9ede:${esc(show(input.pharmacy))}\u3000\u8abf\u5291\u8005:${esc(show(input.pharmacist))}</div>
      <table style="width:100%;border-collapse:collapse;border-top:1px solid #000;margin-top:2px;">
        <tr><td>\u85e5\u54c1\u540d\u7a31</td><td>\u6578\u91cf</td><td>\u7e3d\u91cf</td><td>\u670d\u7528\u65b9\u6cd5</td></tr>
        ${rightDrugs}
      </table>
      <div style="margin-top:3px;">\uff0a\u8b66\u8a9e\u8207\u5efa\u8b70\u6a19\u793a\u9805\u76ee\uff0a</div>
      <div>${esc(show(input.footer))}</div>
      <div style="${gap}"></div>
      <table style="width:100%;border-collapse:collapse;border-top:1px solid #222;">
        <tr><td style="${cell}">\u57fa\u672c\u8ca0\u64d4:${esc(show(input.burden))}</td><td style="${cell}">\u85e5\u8cbb\u8ca0\u64d4:\u2014</td><td style="${cell}">\u6aa2\u9a57\u8ca0\u64d4:\u2014</td></tr>
        <tr><td style="${cell}">\u8a3a\u5bdf\u8cbb\u7528:${esc(show(input.consultFee))}</td><td style="${cell}">\u85e5\u54c1\u8cbb\u7528:${esc(show(input.drugFee))}</td><td style="${cell}">\u8a3a\u7642\u8cbb\u7528:\u2014</td></tr>
        <tr><td style="${cell}">\u6aa2\u9a57\u8cbb\u7528:${esc(show(input.materialFee))}</td><td style="${cell}">\u85e5\u4e8b\u8cbb\u7528:\u2014</td><td style="${cell}">\u5408\u8a08:\u2014</td></tr>
        <tr><td style="${cell}">\u8ca0\u64d4\u5408\u8a08:${esc(show(input.burden))}</td><td style="${cell}">\u7533\u8acb\u8cbb\u7528:\u2014</td><td style="${cell}">\u639b\u865f\u8cbb\u7528:${esc(show(input.regFee))}</td></tr>
        <tr><td style="${cell}">\u62bc\u91d1\u8cbb\u7528:${esc(show(input.deposit))}</td><td style="${cell}">\u81ea\u8cbb:${esc(show(input.selfPay))}</td><td style="${cell}">\u8ca0\u64d4\u512a\u5f85:\u2014</td></tr>
        <tr><td style="${cell}">\u5be6\u6536:${esc(due)}</td><td></td><td></td></tr>
      </table>
    </section>
  </div>`;
}
