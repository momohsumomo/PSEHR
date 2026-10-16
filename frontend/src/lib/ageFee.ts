/** Age rules for the registration fee and the copay. Amounts come from clinic fees. */

export type AgeFeePolicy = {
  /** Under this age: copay becomes 0. Registration fee stays. */
  copayFreeUnder: number;
  studentDiscount: number;
  /** From copayFreeUnder up to but not including this age: subtract automatically. */
  studentAutoUntil: number;
  /** From studentAutoUntil through this age, inclusive: ask before subtracting. */
  studentAskUntil: number;
  seniorAge: number;
  seniorDiscount: number;
};

export type AgeFeeQuote = {
  regFee: string;
  copayAmt: string;
  copayDiscAmt: string;
  askStudent: boolean;
  note: string;
};

export function policyFromFees(fees: {
  childFreeAge?: number;
  studentDiscount?: number;
  studentAutoUntil?: number;
  studentAskUntil?: number;
  seniorAge?: number;
  seniorDiscount?: number;
}): AgeFeePolicy {
  return {
    copayFreeUnder: fees.childFreeAge && fees.childFreeAge > 0 ? fees.childFreeAge : 3,
    studentDiscount: fees.studentDiscount != null ? fees.studentDiscount : 100,
    studentAutoUntil: fees.studentAutoUntil && fees.studentAutoUntil > 0 ? fees.studentAutoUntil : 18,
    studentAskUntil: fees.studentAskUntil && fees.studentAskUntil > 0 ? fees.studentAskUntil : 25,
    seniorAge: fees.seniorAge && fees.seniorAge > 0 ? fees.seniorAge : 70,
    seniorDiscount: fees.seniorDiscount != null ? fees.seniorDiscount : 100,
  };
}

/** ROC yyyMMdd (dots allowed). Returns completed years, or null when the date is unusable. */
export function ageYearsFromRoc(roc: string, today = new Date()): number | null {
  const d = roc.replace(/\D/g, "");
  if (d.length < 7) return null;
  const y = Number(d.slice(0, 3)) + 1911;
  const mo = Number(d.slice(3, 5));
  const day = Number(d.slice(5, 7));
  if (!y || mo < 1 || mo > 12 || day < 1 || day > 31) return null;
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < day)) age -= 1;
  return age >= 0 ? age : null;
}

function money(n: number): string {
  return String(Math.max(0, Math.round(n)));
}

export function applyAgeFees(args: {
  age: number | null;
  baseReg: number;
  baseCopay: number;
  baseDisc: number;
  selfPay: boolean;
  student: boolean | null;
  policy: AgeFeePolicy;
}): AgeFeeQuote {
  const p = args.policy;
  let reg = args.baseReg;
  let disc = args.baseDisc;
  const copay = args.baseCopay;
  const notes: string[] = [];
  let askStudent = false;
  const age = args.age;

  if (age != null && !args.selfPay && age < p.copayFreeUnder) {
    disc = Math.max(disc, copay);
    notes.push(
      `\u672a\u6eff${p.copayFreeUnder}\u6b72\uff0c\u90e8\u5206\u8ca0\u64d4 0\uff0c\u639b\u865f\u8cbb\u7167\u6536`,
    );
  } else if (age != null && age >= p.copayFreeUnder && age < p.studentAutoUntil) {
    reg = Math.max(0, reg - p.studentDiscount);
    notes.push(
      `\u6eff${p.copayFreeUnder}\u6b72\u3001\u672a\u6eff${p.studentAutoUntil}\u6b72\uff0c\u639b\u865f\u8cbb\u6e1b ${p.studentDiscount}`,
    );
  } else if (age != null && age >= p.studentAutoUntil && age <= p.studentAskUntil) {
    if (args.student === true) {
      reg = Math.max(0, reg - p.studentDiscount);
      notes.push(`\u5b78\u751f\uff0c\u639b\u865f\u8cbb\u6e1b ${p.studentDiscount}`);
    } else if (args.student === false) {
      notes.push(`\u4e0d\u662f\u5b78\u751f\uff0c\u639b\u865f\u8cbb\u4e0d\u6e1b`);
    } else {
      askStudent = true;
      notes.push(
        `\u6eff${p.studentAutoUntil}\u6b72\u5230${p.studentAskUntil}\u6b72\uff0c\u8acb\u554f\u662f\u5426\u5b78\u751f\uff0c\u662f\u624d\u6e1b\u639b\u865f\u8cbb ${p.studentDiscount}`,
      );
    }
  }

  if (age != null && age >= p.seniorAge) {
    reg = Math.max(0, args.baseReg - p.seniorDiscount);
    notes.push(`\u6eff${p.seniorAge}\u6b72\uff0c\u639b\u865f\u8cbb\u6e1b ${p.seniorDiscount}`);
  }

  return {
    regFee: money(reg),
    copayAmt: money(copay),
    copayDiscAmt: money(disc),
    askStudent,
    note: notes.join("\u3000"),
  };
}
