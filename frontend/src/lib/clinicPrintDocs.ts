/** The same HTML the clinic sends to the printer. Settings preview calls these too. */

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function show(v: string | undefined): string {
  const s = String(v ?? "").trim();
  return s || "\u2014";
}

export type CertificateDocInput = {
  clinicCode: string;
  clinicName: string;
  licenseNo: string;
  clinicAddress: string;
  docNo: string;
  name: string;
  sex: string;
  medicalNo: string;
  age: string;
  birthday: string;
  idNo: string;
  address: string;
  visitDate: string;
  dept: string;
  diagnosis: string;
  order: string;
  doctor: string;
  printDate: string;
  english: boolean;
};

export function buildCertificateHtml(input: CertificateDocInput): string {
  const en = input.english
    ? `<div style="text-align:center;font-size:12px;">Medical Certificate</div>`
    : "";
  const stamp =
    "\u672c\u8b49\u660e\u66f8\u9808\u52a0\u84cb\u672c\u9662\u6240\u5370\u7ae0\u5426\u5247\u7121\u6548\u25ce\ufe3b\u5175\u5f79\u8a34\u8a1f\u7121\u6548\ufe3c";
  return `<div style="box-sizing:border-box;height:100%;display:flex;flex-direction:column;font-family:'PMingLiU','Microsoft JhengHei',serif;font-size:16px;color:#000;line-height:1.5;padding:12mm 14mm;">
      <div>\u91ab\u4e8b\u6a5f\u69cb\u4ee3\u865f\uff1a${esc(show(input.clinicCode))}</div>
      <div style="text-align:center;font-size:26px;font-weight:bold;margin-top:4px;">${esc(show(input.clinicName))}</div>
      <div style="text-align:center;font-size:22px;letter-spacing:0.35em;margin-top:2px;">\u8a3a\u3000\u65b7\u3000\u8b49\u3000\u660e\u3000\u66f8</div>
      ${en}
      <div style="text-align:right;margin:8px 0;">\u8a3a\u65b7\u6587\u865f\uff1a${esc(show(input.docNo))}</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #000;flex:1;">
        <tr>
          <td style="border:1px solid #000;padding:4px;">\u59d3\u540d ${esc(show(input.name))}</td>
          <td style="border:1px solid #000;padding:4px;">\u6027 \u5225 ${esc(show(input.sex))}</td>
          <td style="border:1px solid #000;padding:4px;">\u75c5\u6b77\u865f ${esc(show(input.medicalNo))}</td>
          <td rowspan="5" style="border:1px solid #000;width:28px;text-align:center;writing-mode:vertical-rl;letter-spacing:2px;">${stamp}</td>
        </tr>
        <tr>
          <td colspan="3" style="border:1px solid #000;padding:4px;">\u5e74\u9f61 ${esc(show(input.age))} \u51fa\u751f ${esc(show(input.birthday))} \u8eab\u5206\u8b49\u5b57\u865f ${esc(show(input.idNo))}</td>
        </tr>
        <tr>
          <td colspan="3" style="border:1px solid #000;padding:4px;">\u4f4f\u5740 ${esc(show(input.address))}</td>
        </tr>
        <tr>
          <td colspan="3" style="border:1px solid #000;padding:4px;">\u61c9\u8a3a\u65e5\u671f ${esc(show(input.visitDate))} \u79d1\u5225 ${esc(show(input.dept))}</td>
        </tr>
        <tr>
          <td colspan="3" style="border:1px solid #000;padding:8px;height:100%;vertical-align:top;">
            <div style="font-weight:bold;">\u75c5\u540d</div>
            <div style="white-space:pre-wrap;min-height:28mm;">${esc(show(input.diagnosis))}</div>
            <div style="font-weight:bold;margin-top:6mm;">\u91ab\u5e2b\u56d1\u8a00</div>
            <div style="white-space:pre-wrap;">${esc(show(input.order))}</div>
          </td>
        </tr>
      </table>
      <div style="margin-top:8px;">\u4ee5\u4e0a\u75c5\u4eba\u7d93\u672c\u9662\u6240\u91ab\u5e2b\u8a3a\u65b7\u5c6c\u5be6\u7279\u4e88\u8b49\u660e</div>
      <div style="margin-top:8px;font-size:16px;">\u8a3a \u6cbb \u91ab \u5e2b\uff1a${esc(show(input.doctor))}</div>
      <div>\u91ab\u5e2b\u8b49\u66f8\u5b57\u865f\uff1a${esc(show(input.licenseNo))}</div>
      <div>\u5730\u5740\uff1a${esc(show(input.clinicAddress))}</div>
      <div style="text-align:center;margin-top:10px;">\u4e2d \u83ef \u6c11 \u570d ${esc(show(input.printDate))}</div>
    </div>`;
}

export type DepositDocInput = {
  clinicName: string;
  patientName: string;
  medicalNo: string;
  date: string;
  deposit: string;
  regFee?: string;
  note?: string;
  idNo?: string;
  birthday?: string;
  days?: number;
  showIdBirthday?: boolean;
  excludeHoliday?: boolean;
  singleSide?: boolean;
  warning?: string;
  printDate?: string;
  focusBits?: string[];
};

function rocParts(raw: string): [string, string, string] | null {
  const text = (raw || "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return [String(Number(iso[1]) - 1911), iso[2], iso[3]];
  const digits = text.replace(/\D/g, "");
  if (digits.length === 7) return [digits.slice(0, 3), digits.slice(3, 5), digits.slice(5, 7)];
  const dotted = text.match(/(\d+)\D+(\d+)\D+(\d+)/);
  if (dotted) return [dotted[1], dotted[2].padStart(2, "0"), dotted[3].padStart(2, "0")];
  return null;
}

function rocDot(raw: string): string {
  const parts = rocParts(raw);
  if (!parts) return show(raw);
  return `${Number(parts[0])}.${parts[1]}.${parts[2]}`;
}

function rocLong(raw: string): string {
  const parts = rocParts(raw);
  if (!parts) return show(raw);
  return `\u6c11\u570b${Number(parts[0])}\u5e74${Number(parts[1])}\u6708${Number(parts[2])}\u65e5`;
}

function todayIso(): string {
  const n = new Date();
  const p = (v: number) => String(v).padStart(2, "0");
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
}

function yuanWhole(raw: string): string {
  const text = String(raw ?? "").trim();
  if (!text || text === "\u2014" || text === "-") return "\u2014";
  const n = Number(text.replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(n)) return show(raw);
  return `${Math.round(n)}\u5143\u6574`;
}

export function buildDepositSlipHtml(input: DepositDocInput): string {
  const glow = (bit: string) =>
    (input.focusBits || []).includes(bit) ? "outline:2px solid #E6A800;background:#FFF6CC;" : "";
  const days = input.days && input.days > 0 ? Math.round(input.days) : 7;
  const holiday = input.excludeHoliday ? "\uff08\u4e0d\u542b\u4f8b\u5047\u65e5\uff09" : "";
  const chart = (input.medicalNo || "").trim();
  const who = chart ? `${esc(show(input.patientName))} (${esc(chart)})` : esc(show(input.patientName));
  const idLine = input.showIdBirthday
    ? `<div style="${glow("idno")}${glow("birthday")}">\u8eab\u5206\u8b49:${esc(show(input.idNo))} \u751f\u65e5:${esc(show(input.birthday))}</div>`
    : "";
  const warning =
    (input.warning || input.note || "").trim() ||
    "\u6ce8 \u610f !!  \u672a\u84cb\u672c\u8a3a\u6240\u5370\u7ae0\u8005\u7121\u6548\uff0e";
  const holdDate = rocDot(input.date);
  const printed = rocLong(input.printDate || todayIso());
  const half = `<div style="text-align:center;font-weight:bold;font-size:15px;letter-spacing:0.25em;">\u8332\u6536\u5230</div>
    <div style="margin-top:1mm;">${who} \u5065\u4fdd\u5361\u62bc\u91d1 ${esc(yuanWhole(input.deposit))}</div>
    ${idLine}
    <div style="${glow("days")}">\u7279\u6b64\u8b49\u660e\uff0c\u8acb\u65bc${days}\u65e5\u5167${holiday}\uff0c\u6301</div>
    <div style="${glow("days")}">\u5065\u4fdd\u5361\u53ca\u672c\u6536\u64da\u8fa6\u7406\u9000\u6b3e\uff0c\u903e\u671f\u4e0d\u4e88\u53d7\u7406\uff0e</div>
    <div style="margin-top:4mm;text-align:center;${glow("days")}">
      <div>\u62bc\u55ae\u65e5\u671f:${esc(holdDate)}</div>
      <div>\u5217\u5370\u65e5\u671f:${esc(printed)}</div>
      <div>${esc(show(input.clinicName))}</div>
    </div>
    <div style="margin-top:1mm;${glow("warning")}">${esc(warning)}</div>`;
  const col = "flex:1 1 0;min-width:0;box-sizing:border-box;padding:1.5mm 2mm;font-size:12px;line-height:1.35;";
  const right = input.singleSide ? "" : half;
  return `<div class="slip-page" style="box-sizing:border-box;height:100%;display:flex;background:#fff;color:#000;font-family:'PMingLiU','Microsoft JhengHei',serif;">
    <section style="${col}${input.singleSide ? "" : "border-right:1px dashed #222;"}">${half}</section>
    <section style="${col}">${right}</section>
  </div>`;
}

const REFERRAL_PURPOSES: Array<[string, string]> = [
  ["1", "\u6025\u8a3a\u6cbb\u7642"],
  ["2", "\u4f4f\u9662\u6cbb\u7642"],
  ["3", "\u9580\u8a3a\u6cbb\u7642"],
  ["4", "\u9032\u4e00\u6b65\u6aa2\u67e5"],
  ["5", "\u8f49\u56de\u8f49\u51fa\u6216\u9069\u7576\u4e4b\u9662\u6240\u7e7c\u7e8c"],
  ["9", "COVID-19\u500b\u6848\uff08\u542b\u7591\u4f3c\uff09\u8f49\u8a3a\u6cbb\u7642"],
  ["6", "\u5176\u4ed6\u76ee\u7684"],
  ["A", "\u8f49\u4ecb\u5176\u4ed6\u8a66\u8fa6\u8a08\u756b\u6216\u65b9\u6848"],
];

export type ReferralDocInput = {
  clinicName: string;
  clinicCode: string;
  clinicAddress: string;
  clinicPhone: string;
  name: string;
  sex: string;
  birthday: string;
  idNo: string;
  phone: string;
  address: string;
  chief: string;
  allergy: string;
  diagnoses: string;
  examOn: string;
  exam: string;
  meds: string;
  medOn: string;
  purpose: string;
  purposeOther: string;
  doctor: string;
  ourDept: string;
  tel: string;
  fax: string;
  email: string;
  opened: string;
  hosp: string;
  hospCode: string;
  dept: string;
  suggestDoc: string;
  hospAddr: string;
  hospTel: string;
  valid: string;
  copies: Array<[string, string]>;
};

export function buildReferralSlipHtml(input: ReferralDocInput): string {
  const mark = (on: boolean) => (on ? "\u25a0" : "\u25a1");
  const birth = (() => {
    const s = (input.birthday || "").trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return [String(Number(iso[1]) - 1911), iso[2], iso[3]];
    const roc = s.match(/(\d+)\D+(\d+)\D+(\d+)/);
    return roc ? [roc[1], roc[2], roc[3]] : ["", "", ""];
  })();
  const opened = (input.opened || "").split(".");
  const dx = input.diagnoses.split(/\n/).map((line) => line.trim()).filter(Boolean).slice(0, 3);
  const splitDx = (line: string) => {
    const m = line.match(/^([A-Za-z][A-Za-z0-9.]*)\s*(.*)$/);
    return m ? [m[1], m[2]] : ["", line];
  };
  const purpose = input.purpose;
  const td = "border:1px solid #000;padding:1px 3px;vertical-align:top;overflow:hidden;";
  const rail = "border:1px solid #000;writing-mode:vertical-rl;text-align:center;letter-spacing:2px;font-size:13px;padding:2px 0;";
  const copies = input.copies.length ? input.copies : ([["\u8f49\u8a3a\u55ae", ""]] as Array<[string, string]>);
  const dxLines = [0, 1, 2].map((i) => {
    const pair = splitDx(dx[i] || "");
    return `<div>${i + 1}. ${esc(pair[0])} ${esc(pair[1])}</div>`;
  }).join("");
  const face = REFERRAL_PURPOSES.filter(([code]) => "12345".includes(code))
    .map(([code, label]) => `${mark(purpose === code)}${code}.${label}`)
    .join("\u3000");
  const extra = REFERRAL_PURPOSES.find(([code]) => code === purpose && !"12345".includes(code));
  const extraLine = extra
    ? `<div>${mark(true)}${esc(extra[0])}.${esc(extra[1])}${purpose === "6" && input.purposeOther ? "\uff08" + esc(input.purposeOther) + "\uff09" : ""}</div>`
    : "";
  const allergy = (input.allergy || "").trim()
    ? `<div>\u85e5\u7269\u904e\u654f\u53f2\uff1a${esc(input.allergy)}</div>`
    : "";
  const validBit = (input.valid || "").trim() ? `\u3000\u6709\u6548\u671f\u9650\uff1a${esc(input.valid)}` : "";
  const cols = `<col style="width:8mm">${Array.from({ length: 12 }, () => "<col>").join("")}<col style="width:8mm">`;
  return copies.map(([which, side]) => `
      <section class="slip-page" style="box-sizing:border-box;height:100%;width:100%;padding:5mm 6mm 4mm;display:flex;flex-direction:column;font-family:'PMingLiU','MingLiU','Microsoft JhengHei',serif;font-size:12px;line-height:1.25;color:#000;background:#fff;">
        <div style="flex:0 0 auto;text-align:center;font-size:18px;font-weight:700;letter-spacing:1px;">\u5168\u6c11\u5065\u5eb7\u4fdd\u96aa\u3000\u9662(\u6240)\u8f49\u8a3a\u55ae(\u8f49\u8a3a\u81f3 ${esc(input.hosp || "\u3000\u3000\u3000")} \u9662\u6240)</div>
        <div style="flex:0 0 auto;margin:0 0 1mm;">\u4fdd\u96aa\u91ab\u4e8b\u670d\u52d9\u6a5f\u69cb\u4ee3\u865f\uff1a${esc(input.clinicCode || "")}</div>
        <div style="flex:1 1 auto;min-height:0;">
          <table style="width:100%;border-collapse:collapse;table-layout:fixed;border:2px solid #000;">
            <colgroup>${cols}</colgroup>
            <tr style="height:16mm">
              <td rowspan="7" style="${rail}">\u539f\u8a3a\u7642\u91ab\u9662\u6458\u8981</td>
              <td colspan="3" style="${td}">\u59d3\u540d ${esc(input.name || "")}</td>
              <td colspan="2" style="${td}">\u6027\u5225 ${mark(input.sex === "\u7537")}\u7537 ${mark(input.sex === "\u5973")}\u5973</td>
              <td colspan="4" style="${td}">\u51fa\u751f\u65e5\u671f\u3000\u6c11\u570b ${esc(birth[0])} \u5e74 ${esc(birth[1])} \u6708 ${esc(birth[2])} \u65e5</td>
              <td colspan="3" style="${td}">\u8eab\u5206\u8b49\u7d71\u4e00\u7de8\u865f ${esc(input.idNo || "")}</td>
              <td rowspan="10" style="${rail}">${esc(which)}\uff1a${esc(side)}</td>
            </tr>
            <tr style="height:14mm">
              <td colspan="3" style="${td}">\u806f\u7d61\u4eba</td>
              <td colspan="3" style="${td}">\u806f\u7d61\u96fb\u8a71 ${esc(input.phone || "")}</td>
              <td colspan="6" style="${td}">\u5730\u5740 ${esc(input.address || "")}</td>
            </tr>
            <tr style="height:46mm">
              <td colspan="6" style="${td}">A.\u75c5\u60c5\u6458\u8981(\u4e3b\u8a34\u53ca\u7c21\u77ed\u75c5\u53f2)<div style="white-space:pre-wrap;">${esc(input.chief || "")}</div>${allergy}</td>
              <td colspan="6" style="${td}">B.\u8a3a\u65b7\u3000ICD-10-CM/PCS\u3000\u75c5\u540d${dxLines}</td>
            </tr>
            <tr style="height:38mm">
              <td colspan="6" style="${td}">C.\u6aa2\u67e5\u53ca\u6cbb\u7642\u6458\u8981<div>1.\u6700\u8fd1\u4e00\u6b21\u6aa2\u67e5\u7d50\u679c</div><div>\u65e5\u671f\uff1a${esc(input.examOn || "")}</div><div style="white-space:pre-wrap;">\u5831\u544a\uff1a${esc(input.exam || "")}</div></td>
              <td colspan="6" style="${td}"><div>2.\u6700\u8fd1\u4e00\u6b21\u958b\u85e5\u6216\u624b\u8853\u540d\u7a31</div><div style="white-space:pre-wrap;">${esc(input.meds || "")}</div><div>\u65e5\u671f\uff1a${esc(input.medOn || input.opened || "")}</div></td>
            </tr>
            <tr style="height:26mm">
              <td colspan="12" style="${td}">\u8f49\u8a3a\u76ee\u7684\uff1a<div>${face}</div>${extraLine}</td>
            </tr>
            <tr style="height:24mm">
              <td colspan="12" style="${td}">\u8f49\u8a3a\u9662\u6240 ${esc(input.clinicName || "")}\u3000\u79d1\u5225 ${esc(input.ourDept)}\u3000\u91ab\u5e2b ${esc(input.doctor || "")}\u3000\u806f\u7d61\u96fb\u8a71 ${esc(input.tel || input.clinicPhone || "")}<div>\u50b3\u771f\u865f\u78bc ${esc(input.fax || "")}\u3000\u96fb\u5b50\u4fe1\u7bb1 ${esc(input.email || "")}\u3000\u5730\u5740 ${esc(input.clinicAddress || "")}</div><div>\u958b\u55ae\u65e5\u671f ${esc(opened[0] || "")} \u5e74 ${esc(opened[1] || "")} \u6708 ${esc(opened[2] || "")} \u65e5\u3000\u5b89\u6392\u5c31\u91ab\u65e5\u671f\u3000\u5e74\u3000\u6708\u3000\u65e5${validBit}</div></td>
            </tr>
            <tr style="height:20mm">
              <td colspan="12" style="${td}">\u5efa\u8b70\u8f49\u8a3a\u9662\u6240\u79d1\u5225\uff1a\u91ab\u9662 ${esc(input.hosp || "")} ${esc(input.hospCode)}\u3000\u79d1\u5225 ${esc(input.dept)}\u3000\u91ab\u5e2b ${esc(input.suggestDoc || "")}<div>\u8f49\u8a3a\u9662\u6240\u5730\u5740\u53ca\u96fb\u8a71\uff1a\u5730\u5740 ${esc(input.hospAddr)}\u3000\u96fb\u8a71 ${esc(input.hospTel)}</div></td>
            </tr>
            <tr style="height:40mm">
              <td rowspan="3" style="${rail}">\u63a5\u53d7\u8f49\u8a3a\u91ab\u9662\u8a3a\u7642\u6458\u8981</td>
              <td colspan="12" style="${td}">\u8655\u7406\u60c5\u5f62\uff1a<div>${mark(false)}1.\u5df2\u4e88\u6025\u8a3a\u8655\u7f6e\uff0c\u4e26\u4f4f\u9662\u6cbb\u7642</div><div>${mark(false)}2.\u5df2\u4e88\u6025\u8a3a\u8655\u7f6e\uff0c\u4e26\u8f49\u8a3a\u81f3________\u91ab\u9662</div><div>${mark(false)}3.\u5df2\u5b89\u6392\u672c\u9662________\u75c5\u623f\u6cbb\u7642\u4e2d</div><div>${mark(false)}4.\u5df2\u5b89\u6392\u672c\u9662________\u9580\u8a3a\u6cbb\u7642\u4e2d</div><div>${mark(false)}5.\u5df2\u4e88\u9069\u7576\u8655\u7406\u4e26\u8f49\u56de\u539f\u9662\u6240\uff0c\u5efa\u8b70\u4e8b\u9805\u5982\u4e0b</div></td>
            </tr>
            <tr style="height:22mm">
              <td colspan="4" style="${td}">1.\u4e3b\u8a3a\u65b7 ICD-10-CM/PCS\uff1a<div>\u75c5\u540d\uff1a</div></td>
              <td colspan="4" style="${td}">2.\u6cbb\u7642\u85e5\u7269\u6216\u624b\u8853\u540d\u7a31</td>
              <td colspan="4" style="${td}">3.\u8f14\u52a9\u8a3a\u65b7\u4e4b\u6aa2\u67e5\u7d50\u679c</td>
            </tr>
            <tr style="height:16mm">
              <td colspan="4" style="${td}">\u8a3a\u7642\u91ab\u5e2b\u59d3\u540d\u3000\u79d1\u5225\u3000\u91ab\u5e2b\u7c3d\u7ae0</td>
              <td colspan="4" style="${td}">\u96fb\u8a71\u6216\u50b3\u771f\uff1a<div>\u96fb\u5b50\u4fe1\u7bb1\uff1a</div></td>
              <td colspan="4" style="${td}">\u56de\u8986\u65e5\u671f\u3000\u5e74\u3000\u6708\u3000\u65e5</td>
            </tr>
          </table>
        </div>
        <div style="flex:0 0 auto;margin-top:1mm;font-size:10px;">\u203b2014\u5e7412\u67082\u65e5\u4ee5\u5f8c\u6539\u7528 ICD-10-CM/PCS\u3002\u672c\u8f49\u8a3a\u55ae\u9650\u4f7f\u7528\u4e59\u6b21\u3002\u4ee5\u4e0a\u6b04\u4f4d\u5747\u5c6c\u5fc5\u586b\uff0c\u5982\u7121\u5247\u586b\u7121\u3002</div>
      </section>`).join("");
}

export type AuditDocInput = {
  clinicName: string;
  clinicCode: string;
  name: string;
  medicalNo: string;
  sex: string;
  birthday: string;
  visitDate: string;
  doctor: string;
  chief: string;
  diagnoses: string;
  orders: string;
  regFee: string;
  burden: string;
  selfPay: string;
};

export function buildAuditSheetHtml(input: AuditDocInput): string {
  return `<div style="box-sizing:border-box;height:100%;padding:10mm;font-family:'PMingLiU','Microsoft JhengHei',serif;font-size:13px;color:#111;line-height:1.45;">
    <div style="text-align:center;font-size:20px;font-weight:bold;">\u62bd\u5be9\u75c5\u6b77\u8868</div>
    <div style="text-align:center;margin-bottom:4mm;">${esc(input.clinicName || "")} ${esc(input.clinicCode || "")}</div>
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="border:1px solid #000;padding:2mm;">\u59d3\u540d ${esc(show(input.name))}</td>
        <td style="border:1px solid #000;padding:2mm;">\u6027\u5225 ${esc(show(input.sex))}</td>
        <td style="border:1px solid #000;padding:2mm;">\u75c5\u6b77\u865f ${esc(show(input.medicalNo))}</td>
        <td style="border:1px solid #000;padding:2mm;">\u51fa\u751f ${esc(show(input.birthday))}</td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:2mm;" colspan="2">\u5c31\u8a3a\u65e5 ${esc(show(input.visitDate))}</td>
        <td style="border:1px solid #000;padding:2mm;" colspan="2">\u8a3a\u6cbb\u91ab\u5e2b ${esc(show(input.doctor))}</td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:2mm;height:28mm;vertical-align:top;" colspan="4"><b>\u4e3b\u8a34</b><div style="white-space:pre-wrap;">${esc(show(input.chief))}</div></td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:2mm;height:28mm;vertical-align:top;" colspan="4"><b>\u75c5\u540d</b><div style="white-space:pre-wrap;">${esc(show(input.diagnoses))}</div></td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:2mm;height:70mm;vertical-align:top;" colspan="4"><b>\u8655\u7f6e</b><div style="white-space:pre-wrap;">${esc(show(input.orders))}</div></td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:2mm;" colspan="4">\u639b\u865f\u8cbb ${esc(input.regFee)} \u3000\u90e8\u4efd\u8ca0\u64d4 ${esc(input.burden)} \u3000\u81ea\u8cbb ${esc(input.selfPay)}</td>
      </tr>
    </table>
  </div>`;
}
