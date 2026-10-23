/** Mark on the NHI card. 1 low-income, 2 veteran, 3 ordinary, 4 lower-middle, 8 disaster. */

export type CardIdentityBenefit = {
  mark: string;
  label: string;
  waiveBasic: boolean;
  waiveDrug: boolean;
  copayCode: string;
};

export function cardIdentityBenefit(raw: string | undefined | null): CardIdentityBenefit | null {
  const mark = String(raw ?? "").trim();
  if (mark === "1") {
    return { mark, label: "\u798f\u4fdd", waiveBasic: true, waiveDrug: true, copayCode: "003" };
  }
  if (mark === "2") {
    return { mark, label: "\u69ae\u6c11", waiveBasic: true, waiveDrug: true, copayCode: "004" };
  }
  if (mark === "4") {
    return { mark, label: "\u4e2d\u4f4e\u6536\u5165", waiveBasic: false, waiveDrug: true, copayCode: "" };
  }
  if (mark === "8") {
    return { mark, label: "\u707d\u6c11", waiveBasic: true, waiveDrug: true, copayCode: "" };
  }
  return null;
}
