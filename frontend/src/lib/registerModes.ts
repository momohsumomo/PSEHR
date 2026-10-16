import type { IcException } from "@/components/clinic/RegisterEditDialog";

export const NHI_NOCARD_REASONS = [
  "\u8b80\u5361\u8a2d\u5099\u6545\u969c",
  "\u8b80\u5361\u6a5f\u6545\u969c",
  "\u7db2\u8def\u8a2d\u5099\u6545\u969c",
  "\u5b89\u5168\u6a21\u7d44\u6545\u969c",
  "\u505c\u96fb",
  "\u91ab\u7642\u7cfb\u7d71\u7576\u6a5f",
  "\u9662\u6240\u96fb\u8166\u6545\u969c",
  "\u504f\u9060\u5340\u7121\u6cd5\u4e0a\u7db2",
  "\u5361\u672a\u9818\u5230",
  "\u5df2\u52a0\u4fdd\u672a\u9818\u5230\u5361",
  "\u907a\u5931\u6216\u640d\u6bc0\u63db\u767c\u671f\u9593",
  "\u7121\u6cd5\u914d\u5408\u5efa\u7f6e",
  "\u5065\u4fdd\u5c40\u7576\u6a5f",
  "\u7121\u5361\u4f8b\u5916\u5c31\u91ab",
  "\u5b55\u5a66\u7121\u5361\u4f8b\u5916",
  "\u5152\u5c11\u7121\u5361\u4f8b\u5916",
  "\u5c45\u5bb6\u85cd\u7259\u7db2\u8def\u7570\u5e38",
  "\u65b0\u51a0\u9694\u96e2\u53d6\u5361\u7570\u5e38",
  "\u7121\u5065\u4fdd\u884c\u653f\u5354\u52a9",
  "\u4ee3\u8b1d\u9632\u6cbb\u8a08\u756b",
  "\u5728\u5b85\u8a08\u756b\u8996\u8a0a\u672a\u53d6\u5f97\u5361\u865f",
] as const;

export function needsNhiNoCardReason(ex: IcException | string): boolean {
  return ["noCard", "childNoCard", "pregnantNoCard", "badCard", "paper"].includes(ex);
}

export function isDepositHold(form: {
  icException?: string;
  prebook?: boolean;
  caseNo?: string;
}): boolean {
  if (form.prebook) return false;
  if (form.icException === "selfPay" || form.caseNo === "9X") return false;
  return form.icException === "deposit";
}
