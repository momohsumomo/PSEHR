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

/** This visit's identity. 001 is major illness and is not a card mark. */
export function visitCopayBenefit(
  cardIdentity: string | undefined | null,
  copayCode: string | undefined | null,
): CardIdentityBenefit | null {
  const card = cardIdentityBenefit(cardIdentity);
  if (card) return card;
  if (String(copayCode || "").trim() === "001") {
    return { mark: "", label: "\u91cd\u5927\u50b7\u75c5", waiveBasic: true, waiveDrug: true, copayCode: "001" };
  }
  return null;
}

export function visitIdentityChoice(cardIdentity?: string, copayCode?: string): string {
  const mark = String(cardIdentity || "").trim();
  if (mark === "1" || mark === "2" || mark === "4" || mark === "8") return mark;
  if (String(copayCode || "").trim() === "001") return "001";
  return "";
}

const _OWNED_COPAY = new Set(["001", "003", "004"]);

/** Manual choice on this registration. Does not change the patient master. */
export function applyVisitIdentity(
  choice: string,
  form: { copayAmt: string; copayDiscAmt?: string; copayCode: string },
): { cardIdentity: string; copayCode: string; copayAmt: string; copayDiscAmt: string } {
  const paid = Number(form.copayAmt) || 0;
  const disc = Number(form.copayDiscAmt) || 0;
  const gross = paid > 0 ? String(paid) : disc > 0 ? String(disc) : "";
  const benefit = choice === "001" ? visitCopayBenefit("", "001") : cardIdentityBenefit(choice);
  if (!benefit) {
    return {
      cardIdentity: "",
      copayCode: _OWNED_COPAY.has(form.copayCode) ? "" : form.copayCode,
      copayAmt: paid <= 0 && disc > 0 ? String(disc) : form.copayAmt,
      copayDiscAmt: "0",
    };
  }
  const code = benefit.copayCode || (_OWNED_COPAY.has(form.copayCode) ? "" : form.copayCode);
  if (!benefit.waiveBasic) {
    return {
      cardIdentity: benefit.mark,
      copayCode: code,
      copayAmt: paid > 0 ? form.copayAmt : gross || form.copayAmt,
      copayDiscAmt: "0",
    };
  }
  return {
    cardIdentity: benefit.mark,
    copayCode: code,
    copayAmt: "0",
    copayDiscAmt: gross || "0",
  };
}
