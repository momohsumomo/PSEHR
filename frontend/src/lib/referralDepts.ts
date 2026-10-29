/** NHI consultation departments, effective 2024-05-27. Referral uses these two-character codes. */
export const REFERRAL_DEPT_CODES: Array<[string, string]> = [
  ["00", "\u4e0d\u5206\u79d1"],
  ["01", "\u5bb6\u91ab\u79d1"],
  ["02", "\u5167\u79d1"],
  ["03", "\u5916\u79d1"],
  ["04", "\u5152\u79d1"],
  ["05", "\u5a66\u7522\u79d1"],
  ["06", "\u9aa8\u79d1"],
  ["07", "\u795e\u7d93\u5916\u79d1"],
  ["08", "\u6ccc\u5c3f\u79d1"],
  ["09", "\u8033\u9f3b\u5589\u79d1"],
  ["10", "\u773c\u79d1"],
  ["11", "\u76ae\u819a\u79d1"],
  ["12", "\u795e\u7d93\u79d1"],
  ["13", "\u7cbe\u795e\u79d1"],
  ["14", "\u5fa9\u5065\u79d1"],
  ["15", "\u6574\u5f62\u5916\u79d1"],
  ["22", "\u6025\u8a3a\u91ab\u5b78\u79d1"],
  ["23", "\u8077\u696d\u91ab\u5b78\u79d1"],
  ["2A", "\u7d50\u6838\u79d1"],
  ["2B", "\u6d17\u814e\u79d1"],
  ["40", "\u7259\u79d1"],
  ["60", "\u4e2d\u91ab\u79d1"],
  ["81", "\u9ebb\u9154\u79d1"],
  ["82", "\u653e\u5c04\u7dda\u79d1"],
  ["83", "\u75c5\u7406\u79d1"],
  ["84", "\u6838\u91ab\u79d1"],
  ["AA", "\u6d88\u5316\u5167\u79d1"],
  ["AB", "\u5fc3\u81df\u8840\u7ba1\u5167\u79d1"],
  ["AC", "\u80f8\u8154\u5167\u79d1"],
  ["AD", "\u814e\u81df\u5167\u79d1"],
  ["AE", "\u98a8\u6fd5\u514d\u75ab\u79d1"],
  ["AF", "\u8840\u6db2\u816b\u7624\u79d1"],
  ["AG", "\u5167\u5206\u6ccc\u79d1"],
  ["AH", "\u611f\u67d3\u79d1"],
  ["AI", "\u6f5b\u91ab\u79d1"],
  ["AJ", "\u80f8\u8154\u66a8\u91cd\u75c7\u52a0\u8b77"],
  ["AK", "\u8001\u4eba\u91ab\u5b78\u79d1"],
  ["BA", "\u76f4\u8178\u5916\u79d1"],
  ["BB", "\u5fc3\u81df\u8840\u7ba1\u5916\u79d1"],
  ["BC", "\u80f8\u8154\u5916\u79d1"],
  ["BD", "\u6d88\u5316\u5916\u79d1"],
  ["CA", "\u5c0f\u5152\u5916\u79d1"],
  ["CB", "\u65b0\u751f\u5152\u79d1"],
  ["DA", "\u75bc\u75db\u79d1"],
  ["EA", "\u5c45\u5bb6\u7167\u8b77"],
  ["FA", "\u653e\u5c04\u8a3a\u65b7\u79d1"],
  ["FB", "\u653e\u5c04\u816b\u7624\u79d1"],
  ["GA", "\u53e3\u8154\u984f\u9762\u5916\u79d1"],
  ["HA", "\u810a\u690e\u9aa8\u79d1"],
  ["TB", "\u80ba\u7d50\u6838"],
];

const DEPT_NAME = new Map(REFERRAL_DEPT_CODES.map(([code, name]) => [code.toUpperCase(), name]));

/** Dermatology first, then the rest in code order. */
export function referralDeptOptions(): string[] {
  const rows = REFERRAL_DEPT_CODES.map(([code, name]) => `${code} ${name}`);
  const skin = rows.find((row) => row.startsWith("11 "));
  return skin ? [skin, ...rows.filter((row) => row !== skin)] : rows;
}

export function referralDeptName(code: string | undefined): string {
  const key = (code || "").trim().toUpperCase();
  if (!key) return "";
  return DEPT_NAME.get(key) || "";
}

/** Prepend after a successful upload. Do not add a second suffix when the name already has one. */
export function referralChiefLead(current: string, hosp: string): string {
  const name = hosp.trim();
  if (!name) return current;
  const place = /\u91ab\u9662|\u8a3a\u6240|\u91ab\u5c40/.test(name) ? name : `${name}\u91ab\u9662`;
  const lead = `\u8a72\u75c5\u60a3\u5efa\u8b70\u8f49\u8a3a\u81f3${place}`;
  const body = current.trim();
  if (!body) return lead;
  if (body.startsWith("\u8a72\u75c5\u60a3\u5efa\u8b70\u8f49\u8a3a\u81f3")) {
    const rest = body.replace(/^\u8a72\u75c5\u60a3\u5efa\u8b70\u8f49\u8a3a\u81f3\S+/, "").trim();
    return rest ? `${lead} ${rest}` : lead;
  }
  return `${lead} ${body}`;
}
