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


export type ReferralDocInput = {
  clinicName: string;
  clinicCode: string;
  clinicAddress: string;
  clinicPhone: string;
  name: string;
  sex: string;
  birthday: string;
  idNo: string;
  medicalNo: string;
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
  const K = 25.4 / 72;
  const mm = (pt: number) => (pt * K).toFixed(2) + "mm";
  const roc3 = (raw: string): [string, string, string] => {
    const s = (raw || "").trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return [String(Number(iso[1]) - 1911), iso[2], iso[3]];
    const roc = s.match(/(\d+)\D+(\d+)\D+(\d+)/);
    return roc ? [roc[1], roc[2].padStart(2, "0"), roc[3].padStart(2, "0")] : ["", "", ""];
  };
  const rocWords = (raw: string, tail: string) => {
    const p = roc3(raw);
    if (!p[0]) return (raw || "").trim();
    return "民國" + Number(p[0]) + "年" + Number(p[1]) + "月" + Number(p[2]) + "日" + tail;
  };
  const birth = roc3(input.birthday);
  const birthText = birth[0] ? birth[0] + "." + birth[1] + "." + birth[2] : "";
  const sexRaw = (input.sex || "").trim().toUpperCase();
  const sex = sexRaw === "M" || sexRaw === "1" ? "男" : sexRaw === "F" || sexRaw === "2" ? "女" : (input.sex || "");
  const dx = input.diagnoses.split(/\n/).map((line) => line.trim()).filter(Boolean).slice(0, 4);
  const dxHtml = dx.map((line) => {
    const hit = line.match(/^([A-Za-z][A-Za-z0-9.]*)\s*[:：]?\s*(.*)$/);
    if (!hit) return esc(line);
    return esc(hit[1].replace(/\./g, "")) + "&nbsp;&nbsp;:" + esc(hit[2]);
  }).join("<br>");
  const purpose = input.purpose;
  const mark = (code: string, label: string) => (purpose === code ? "✓" : "") + label;
  const other = purpose === "6" ? esc(input.purposeOther || "") : "";
  const copies = input.copies.length
    ? input.copies
    : ([["第一聯：接受轉診醫院、診所留存（藍色）", ""]] as Array<[string, string]>);
  const v = (x: number, y0: number, y1: number) =>
    `<div style="position:absolute;left:${mm(x)};top:${mm(y0)};width:0;height:${mm(y1 - y0)};border-left:0.6pt solid #000;"></div>`;
  const h = (y: number, x0: number, x1: number) =>
    `<div style="position:absolute;left:${mm(x0)};top:${mm(y)};width:${mm(x1 - x0)};height:0;border-top:0.6pt solid #000;"></div>`;
  const at = (x: number, y: number, w: number, ht: number, html: string, extra = "") =>
    `<div style="position:absolute;left:${mm(x)};top:${mm(y)};width:${mm(w)};height:${mm(ht)};box-sizing:border-box;overflow:hidden;${extra}">${html}</div>`;
  const mid = "display:flex;align-items:center;justify-content:center;text-align:center;font-size:12pt;line-height:1.15;";
  const top = "font-size:12pt;line-height:1.25;padding:0.4mm 0.8mm;";
  const rail = "writing-mode:vertical-rl;text-orientation:upright;display:flex;align-items:center;justify-content:center;font-size:12pt;letter-spacing:0.35em;";
  const lines = [
    v(34.0, 48.4, 756.7),
    v(62.3, 48.4, 516.1),
    v(79.3, 487.8, 756.7),
    v(96.4, 728.8, 756.7),
    v(144.5, 487.8, 516.1),
    v(147.4, 48.4, 127.8),
    v(153.0, 728.8, 756.7),
    v(161.5, 487.8, 516.1),
    v(170.0, 728.8, 756.7),
    v(226.7, 487.8, 516.1),
    v(226.7, 728.8, 756.7),
    v(232.4, 48.4, 127.8),
    v(246.6, 544.4, 587.0),
    v(249.4, 516.1, 544.4),
    v(260.8, 728.8, 756.7),
    v(317.4, 48.4, 127.8),
    v(317.4, 700.4, 756.7),
    v(325.9, 516.1, 587.0),
    v(340.1, 459.5, 516.1),
    v(394.0, 700.4, 756.7),
    v(396.8, 459.5, 516.1),
    h(68.3, 62.3, 552.6),
    h(88.1, 62.3, 552.6),
    h(108.0, 62.3, 552.6),
    h(127.8, 34.0, 552.6),
    h(416.9, 34.0, 552.6),
    h(459.5, 34.0, 552.6),
    h(487.8, 34.0, 552.6),
    h(516.1, 34.0, 552.6),
    h(544.4, 34.0, 552.6),
    h(587.0, 14.2, 552.6),
    h(657.8, 34.0, 552.6),
    h(700.4, 34.0, 552.6),
    h(728.8, 34.0, 552.6),
  ].join("");
  const face = `
    ${at(14.2, 48.1, 19.8, 538.9, "原診療醫院診所", rail)}
    ${at(34.0, 48.1, 28.3, 79.7, "保險對象基本資料", rail + "letter-spacing:0.15em;font-size:11pt;")}
    ${at(62.3, 48.1, 85.1, 20.2, "姓　名", mid)}
    ${at(147.4, 48.1, 85.0, 20.2, "性　別", mid)}
    ${at(232.4, 48.1, 85.0, 20.2, "出生日期", mid)}
    ${at(317.4, 48.1, 235.2, 20.2, "病　歷　號　碼", mid)}
    ${at(62.3, 68.3, 85.1, 19.8, esc(input.name || ""), mid)}
    ${at(147.4, 68.3, 85.0, 19.8, esc(sex), mid)}
    ${at(232.4, 68.3, 85.0, 19.8, esc(birthText), mid)}
    ${at(317.4, 68.3, 235.2, 19.8, esc(input.medicalNo || ""), mid + "font-size:14pt;")}
    ${at(62.3, 88.1, 85.1, 19.9, "身分證號", mid)}
    ${at(147.4, 88.1, 85.0, 19.9, "聯絡電話", mid)}
    ${at(232.4, 88.1, 85.0, 19.9, "聯絡人", mid)}
    ${at(317.4, 88.1, 235.2, 19.9, "聯絡地址", mid)}
    ${at(62.3, 108.0, 85.1, 19.8, esc(input.idNo || ""), mid + "font-size:11pt;")}
    ${at(147.4, 108.0, 85.0, 19.8, esc(input.phone || ""), mid + "font-size:11pt;")}
    ${at(232.4, 108.0, 85.0, 19.8, "", mid)}
    ${at(317.4, 108.0, 235.2, 19.8, esc(input.address || ""), mid + "font-size:11pt;justify-content:flex-start;padding:0 1.5mm;")}
    ${at(34.0, 127.8, 28.3, 289.1, "病歷摘要", rail)}
    ${at(66, 130.6, 240, 16, "A.病情摘要(主訴及簡短病史)", "font-size:12pt;")}
    ${at(76, 148, 230, 165, esc(input.chief || ""), "font-size:12pt;line-height:1.35;white-space:pre-wrap;")}
    ${at(66, 320.5, 240, 16, "B.診斷:ICD-10-CM/PCS　病名", "font-size:12pt;")}
    ${at(76, 338, 230, 74, dxHtml, "font-size:12pt;line-height:1.35;")}
    ${at(312, 130.6, 230, 16, "C.檢查及治療摘要:", "font-size:12pt;")}
    ${at(317, 148, 110, 48, "1.最近一次檢查結果<div>日期:" + esc(input.examOn || "") + "</div><div>" + esc(input.exam || "") + "</div>", "font-size:11pt;line-height:1.3;")}
    ${at(431, 148, 115, 48, "2.最近一次用藥或手術名稱<div>日期:" + esc(input.medOn || "") + "</div><div>" + esc(input.meds || "") + "</div>", "font-size:11pt;line-height:1.3;")}
    ${at(312, 201.5, 230, 16, "D.藥物過敏史:" + esc(input.allergy || ""), "font-size:12pt;")}
    ${at(312, 216.4, 230, 16, "E.交班注意事項:", "font-size:12pt;")}
    ${at(34, 416.9, 28.3, 42.6, "轉診\n目的", mid + "white-space:pre-line;")}
    ${at(70, 418, 475, 41, [
      mark("1", "１.急診治療"),
      mark("4", "４.進一步檢查,檢查項目"),
      mark("9", "９.COVID-19個案(含疑似)轉診治療"),
      mark("2", "２.住院治療"),
      mark("5", "５.轉回轉出或適當之院所繼續追蹤"),
      "",
      mark("3", "３.門診治療"),
      mark("6", "６.其它 <span style=\"display:inline-block;min-width:28mm;border-bottom:0.6pt solid #000;\">" + other + "</span>"),
      "",
    ].map((item) => `<div style="white-space:nowrap">${item}</div>`).join(""), "display:grid;grid-template-columns:108pt 176pt 1fr;font-size:9.5pt;line-height:13pt;align-content:center;")}
    ${at(34, 459.5, 28.3, 28.3, "院所\n住址", mid + "white-space:pre-line;")}
    ${at(64, 459.5, 274, 28.3, esc(input.clinicAddress || ""), top + "display:flex;align-items:center;")}
    ${at(342, 459.5, 52, 28.3, "傳真號碼:" + esc(input.fax || "") + "<div>電子信箱:" + esc(input.email || "") + "</div>", "font-size:11pt;line-height:1.25;padding-top:1mm;")}
    ${at(34, 487.8, 28.3, 28.3, "診治\n醫師", mid + "white-space:pre-line;")}
    ${at(62.3, 487.8, 17, 28.3, "姓\n名", mid + "white-space:pre-line;")}
    ${at(79.3, 487.8, 65.2, 28.3, esc(input.doctor || ""), mid)}
    ${at(144.5, 487.8, 17, 28.3, "科\n別", mid + "white-space:pre-line;")}
    ${at(161.5, 487.8, 65.2, 28.3, esc(input.ourDept || ""), mid)}
    ${at(226.7, 487.8, 113.4, 28.3, "聯絡\n電話", mid + "white-space:pre-line;")}
    ${at(340.1, 487.8, 56.7, 28.3, esc(input.tel || input.clinicPhone || ""), mid + "font-size:11pt;")}
    ${at(396.8, 487.8, 40, 28.3, "醫師\n簽章", mid + "white-space:pre-line;font-size:11pt;")}
    ${at(34, 516.1, 28, 28.3, "開單\n日期", mid + "white-space:pre-line;")}
    ${at(80, 516.1, 165, 28.3, esc(rocWords(input.opened, "")), mid)}
    ${at(249.4, 516.1, 76.5, 28.3, "安排就醫日期", mid + "font-size:11pt;")}
    ${at(325.9, 516.1, 220, 28.3, esc(rocWords(input.valid, "前")), mid)}
    ${at(34, 544.4, 28, 42.6, "建議轉診\n院所科別\n及醫師", mid + "white-space:pre-line;font-size:11pt;")}
    ${at(66, 546, 176, 38, esc(input.hosp || "") + "<div>" + esc(input.dept || "") + " 醫師 " + esc(input.suggestDoc || "") + "</div>", top)}
    ${at(246.6, 544.4, 79.3, 42.6, "轉診院所地址\n及專線電話", mid + "white-space:pre-line;font-size:11pt;")}
    ${at(328, 546, 218, 38, "地址:" + esc(input.hospAddr || "") + "<div>電話:" + esc(input.hospTel || "") + "</div>", top)}
    ${at(14.2, 587, 19.8, 169.7, "接受轉診醫院診所", rail)}
    ${at(34, 587, 45.3, 70.8, "處理\n情形", mid + "white-space:pre-line;")}
    ${at(82, 589, 460, 66, [
      "1.□已予急診處置並轉至______醫院",
      "2.□已予急診處置並住本院______病房治療中",
      "3.□已予安排住本院______病房治療中",
      "4.□已予安排本院______科門診療中",
      "5.□已予適當安排並轉回原院所　建議事項如下",
      "",
    ].map((item) => `<div style="white-space:nowrap">${item}</div>`).join(""), "display:grid;grid-template-columns:1fr 1fr;font-size:10pt;line-height:14pt;align-content:center;")}
    ${at(34, 657.8, 45.3, 42.6, "治療\n摘要", mid + "white-space:pre-line;")}
    ${at(82, 660, 150, 38, "1.主診斷<div>ICD-10-CM/PCS :</div><div>病名 :</div>", "font-size:11pt;line-height:1.3;")}
    ${at(233, 660, 180, 38, "2.治療藥物或手術名稱", "font-size:11pt;")}
    ${at(425, 660, 120, 38, "3.輔助診斷之結果檢查", "font-size:11pt;")}
    ${at(34, 700.4, 45.3, 28.4, "院所\n名稱", mid + "white-space:pre-line;")}
    ${at(317.4, 700.4, 76.6, 28.4, "電話或傳真<div>電子信箱</div>", mid + "font-size:11pt;flex-direction:column;")}
    ${at(34, 728.8, 45.3, 27.9, "診治\n醫師", mid + "white-space:pre-line;")}
    ${at(79.3, 728.8, 17.1, 27.9, "姓\n名", mid + "white-space:pre-line;font-size:11pt;")}
    ${at(153, 728.8, 17, 27.9, "科\n別", mid + "white-space:pre-line;font-size:11pt;")}
    ${at(226.7, 728.8, 34.1, 27.9, "醫師\n簽章", mid + "white-space:pre-line;font-size:11pt;")}
    ${at(317.4, 728.8, 76.6, 27.9, "回覆日期", mid)}
    ${at(400, 728.8, 145, 27.9, "年　月　日", mid)}
    ${at(16.9, 762.7, 360, 16, "※本轉診單限使用乙次　※以上欄位均屬必填，如無則填無", "font-size:10pt;")}
  `;
  return copies.map(([which]) => `
      <section class="slip-page" style="position:relative;box-sizing:border-box;width:210mm;height:297mm;margin:0;padding:0;overflow:hidden;background:#fff;color:#000;font-family:'DFKai-SB','標楷體','PMingLiU',serif;">
        <div style="position:absolute;left:0;top:${mm(8)};width:210mm;text-align:center;font-size:14pt;white-space:nowrap;overflow:hidden;">全民健康保險${esc(input.clinicName || "")}　轉診單（轉診至${esc(input.hosp || "")}）</div>
        <div style="position:absolute;left:${mm(14.2)};top:${mm(30)};font-size:12pt;">保險醫事服務機構代號：${esc(input.clinicCode || "")}</div>
        <div style="position:absolute;left:${mm(14.2)};top:${mm(48.1)};width:${mm(538.4)};height:${mm(708.6)};border:0.6pt solid #000;box-sizing:border-box;"></div>
        ${lines}
        ${face}
        <div style="position:absolute;left:${mm(552.6)};top:${mm(78)};width:${mm(40)};height:${mm(480)};${rail}letter-spacing:0.42em;font-size:12pt;">${esc(which)}</div>
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
