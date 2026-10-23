import type { SciniRow } from "@/api/clinicApi";
import {
  SIMPLE_PRINT_PARTS,
  type PrintPart,
  type PrintSetup,
  type PrintSetupId,
} from "@/lib/printSettings";

const USED: Record<PrintSetupId, string[]> = {
  simple: [
    "\u57f7\u884c ORDER \u5217\u5370\u4e3b\u8ff0",
    "\u57f7\u884c ORDER \u5217\u5370\u75c5\u540d",
    "\u85e5\u55ae\u6536\u64da\u7684\u81ea\u8cbb\u8655\u7f6e\u662f\u5426\u5217\u5370(\u81ea)",
    "\u57f7\u884c ORDER \u5217\u5370\u6536\u8cbb\u9805\u76ee",
    "\u57f7\u884c ORDER \u7684\u61c9\u6536\u662f\u5426\u5217\u5370",
    "\u85e5\u55ae\u6536\u64da\u662f\u5426\u5217\u5370\u6536\u8cbb\u9805\u76ee",
    "\u85e5\u55ae\u5167\u5bb9\u53ca\u9580\u8a3a\u6536\u64da\u5217\u5370\u8b66\u8a9e",
    "\u770b\u8a3a\u6536\u64da\u7684\u8868\u5c3e\u6587\u5b57",
    "\u85e5\u55ae\u5167\u5bb9\u8207\u9580\u8a3a\u6536\u64da\u62ac\u982d",
  ],
  formal: [],
  bag: [],
  audit: [],
  deposit: [
    "\u62bc\u91d1\u6536\u64da\u8868\u5c3e\u7684\u8b66\u8a9e\u5167\u5bb9",
    "\u62bc\u91d1\u6536\u64da\u662f\u5426\u5217\u5370\u75c5\u60a3ID\u548c\u751f\u65e5",
    "\u62bc\u91d1\u6536\u64da\u7684\u9000\u62bc\u671f\u9650",
    "\u62bc\u91d1\u6536\u64da\u5167\u5bb9\u662f\u5426\u52a0\u5370(\u4e0d\u542b\u4f8b\u5047\u65e5)",
    "\u516d\u7b49\u4efd\u62bc\u91d1\u6536\u64da\u5167\u5bb9\u662f\u5426\u53ea\u5370\u55ae\u908aY/N",
    "\u516d\u7b49\u4efd\u62bc\u91d1\u6536\u64da\u662f\u5426\u53ea\u5370\u55ae\u908aY/N",
  ],
  certificate: [],
  referral: [],
  releaseRx: [],
};

const PRINT_ON_BY_DEFAULT = new Set([
  "\u57f7\u884c ORDER \u5217\u5370\u4e3b\u8ff0",
  "\u57f7\u884c ORDER \u5217\u5370\u75c5\u540d",
  "\u57f7\u884c ORDER \u5217\u5370\u6536\u8cbb\u9805\u76ee",
  "\u57f7\u884c ORDER \u7684\u61c9\u6536\u662f\u5426\u5217\u5370",
  "\u85e5\u55ae\u6536\u64da\u662f\u5426\u5217\u5370\u6536\u8cbb\u9805\u76ee",
  "\u85e5\u55ae\u5167\u5bb9\u53ca\u9580\u8a3a\u6536\u64da\u5217\u5370\u8b66\u8a9e",
]);

const SIMPLE_PART_ENTRY: Record<string, string> = {
  chief: "\u57f7\u884c ORDER \u5217\u5370\u4e3b\u8ff0",
  diagnoses: "\u57f7\u884c ORDER \u5217\u5370\u75c5\u540d",
  marks: "\u85e5\u55ae\u6536\u64da\u7684\u81ea\u8cbb\u8655\u7f6e\u662f\u5426\u5217\u5370(\u81ea)",
  leftMoney: "\u57f7\u884c ORDER \u5217\u5370\u6536\u8cbb\u9805\u76ee",
  due: "\u57f7\u884c ORDER \u7684\u61c9\u6536\u662f\u5426\u5217\u5370",
  feeTable: "\u85e5\u55ae\u6536\u64da\u662f\u5426\u5217\u5370\u6536\u8cbb\u9805\u76ee",
  warning: "\u85e5\u55ae\u5167\u5bb9\u53ca\u9580\u8a3a\u6536\u64da\u5217\u5370\u8b66\u8a9e",
};

export const PRESCRIPTION_FONT_ENTRY = "\u516d\u7b49\u4efd\u7c21\u5f0f\u8655\u65b9\u5b57\u5f62\u5927\u5c0f";

const TRUE_FLAG = new Set(["Y", ".T.", ".Y.", "T", "TRUE"]);
const FALSE_FLAG = new Set(["N", ".F.", ".N.", "F", "FALSE"]);

export function rowKey(row: Pick<SciniRow, "section" | "entry">): string {
  return `${row.section}\n${row.entry}`;
}

export function canonSection(
  section: string,
  values: Record<string, Record<string, string>>,
): string {
  const want = section.toLowerCase();
  for (const key of Object.keys(values)) {
    if (key.toLowerCase() === want) return key;
  }
  return section;
}

export function flagState(value: string): boolean | null {
  const v = value.trim().toUpperCase();
  if (TRUE_FLAG.has(v)) return true;
  if (FALSE_FLAG.has(v)) return false;
  return null;
}

export function flagToStored(on: boolean, original: string): string {
  const v = original.trim().toUpperCase();
  if (v.startsWith(".")) return on ? ".T." : ".F.";
  return on ? "Y" : "N";
}

export function isCheckbox(row: SciniRow, value: string): boolean {
  if (flagState(value) !== null || flagState(row.value || "") !== null) return true;
  const blob = `${row.entry} ${row.desc || ""} ${row.combox || ""}`;
  if (/Y\/N|N\/Y/i.test(blob)) return true;
  if (!value.trim() && row.entry.includes("\u662f\u5426")) return true;
  return false;
}

export type FieldChoice = { value: string; label: string };

export type FieldGuide = {
  kind: "check" | "select" | "text";
  options: FieldChoice[];
  fallback: string;
  hint: string;
};

function comboxOptions(combox: string): string[] {
  return combox
    .split(/[,\uFF0C]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parenChoices(entry: string): FieldChoice[] {
  const out: FieldChoice[] = [];
  const re = /\(([A-Za-z0-9])\)([^()]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(entry))) {
    const code = match[1];
    const words = match[2].replace(/^[\s.,\u3001]+/, "").trim();
    out.push({ value: code, label: words ? `${code} ${words}` : code });
  }
  return out;
}

function presetFlag(row: SciniRow): "Y" | "N" | "" {
  const blob = `${row.group || ""} ${row.entry || ""}`;
  if (blob.includes("\u9810\u8a2dY")) return "Y";
  if (blob.includes("\u9810\u8a2dN")) return "N";
  return "";
}

export function fieldGuide(row: SciniRow): FieldGuide {
  const entry = row.entry || "";
  const box = comboxOptions(row.combox || "");
  const yesNo = box.length > 0 && box.every((token) => token.toUpperCase() === "Y" || token.toUpperCase() === "N");
  const preset = presetFlag(row);
  const named = parenChoices(entry);
  if (box.length >= 2 && !yesNo) {
    const options = box.map((value) => {
      const hit = named.find((choice) => choice.value.toUpperCase() === value.toUpperCase());
      return { value, label: hit ? hit.label : value };
    });
    const fallback = options.some((choice) => choice.value === preset) ? preset : options[0].value;
    const label = options.find((choice) => choice.value === fallback)?.label || fallback;
    return { kind: "select", options, fallback, hint: `\u9810\u8a2d\uff1a${label}` };
  }
  const storedFlag = flagState(row.value || "") !== null;
  if (yesNo || /Y\/N|N\/Y/i.test(entry) || (entry.includes("\u662f\u5426") && (!(row.value || "").trim() || storedFlag))) {
    const fallback = preset || (PRINT_ON_BY_DEFAULT.has(entry) ? "Y" : "N");
    const remindHint =
      entry === SIMPLE_PART_ENTRY.warning
        ? "\u5370\u85e5\u54c1\u4e3b\u6a94\u7684\u63d0\u9192\u75c5\u60a3\u5167\u5bb9\u3002\u7a7a\u767d\u7684\u85e5\u4e0d\u5370\u3002"
        : "";
    return {
      kind: "check",
      options: [],
      fallback,
      hint: remindHint || (fallback === "Y" ? "\u9810\u8a2d\uff1a\u8981\u5370" : "\u9810\u8a2d\uff1a\u4e0d\u5370"),
    };
  }
  if (named.length >= 2) {
    const fallback = named[0].value;
    return { kind: "select", options: named, fallback, hint: `\u9810\u8a2d\uff1a${named[0].label}` };
  }
  let hint = "";
  if (/mm/i.test(entry)) hint = "\u4f8b\u5982 10\uff08\u516c\u91d0\uff09";
  else if (/cm/i.test(entry)) hint = "\u4f8b\u5982 1\uff08\u516c\u5206\uff09";
  else if (/\(in\)/i.test(entry)) hint = "\u4f8b\u5982 1\uff08\u82f1\u540b\uff09";
  else if (/\u5929\u6578|\u65e5\u6578|\u671f\u9650/.test(entry)) hint = "\u4f8b\u5982 7";
  else if (/\u5b57\u5f62|\u5b57\u578b/.test(entry)) hint = "\u4f8b\u5982 10";
  else if (/\u5f35\u6578/.test(entry)) hint = "\u4f8b\u5982 1";
  else if (/\u62ac\u982d|\u8868\u5c3e|\u8b66\u8a9e|\u7b26\u865f|\u540d\u7a31/.test(entry)) hint = "\u586b\u6587\u5b57";
  return { kind: "text", options: [], fallback: "", hint };
}

export function applyFieldFallback(items: SciniRow[], draft: Record<string, string>): Record<string, string> {
  const next = { ...draft };
  for (const item of items) {
    const key = rowKey(item);
    if ((next[key] || "").trim()) continue;
    const guide = fieldGuide(item);
    if (guide.fallback) next[key] = guide.fallback;
  }
  return next;
}

export function rowsForFormat(id: PrintSetupId, rows: SciniRow[]): SciniRow[] {
  const allow = USED[id] || [];
  const want = new Set(allow);
  const best = new Map<string, SciniRow>();
  for (const row of rows) {
    if (!want.has(row.entry || "")) continue;
    const prev = best.get(row.entry);
    if (!prev || (!(prev.value || "").trim() && (row.value || "").trim())) best.set(row.entry, row);
  }
  return allow.map((name) => best.get(name)).filter((row): row is SciniRow => !!row);
}

export function simpleFlagOn(items: SciniRow[], draft: Record<string, string>, partId: string): boolean {
  const entry = SIMPLE_PART_ENTRY[partId];
  if (!entry) return true;
  const item = items.find((row) => row.entry === entry);
  const state = flagState(item ? draft[rowKey(item)] ?? "" : "");
  if (state === null) return PRINT_ON_BY_DEFAULT.has(entry);
  return state;
}

function fontFrom(value: string): number | null {
  const n = Math.abs(Number.parseFloat(value));
  if (!Number.isFinite(n) || n < 7 || n > 16) return null;
  return n;
}

export function simplePatchFromFlags(
  setup: PrintSetup,
  draft: Record<string, string>,
  items: SciniRow[],
): Partial<PrintSetup> {
  if (setup.id !== "simple") return {};
  const parts: PrintPart[] = (setup.parts && setup.parts.length ? setup.parts : SIMPLE_PRINT_PARTS).map(
    (part) => ({ ...part }),
  );
  for (const part of parts) {
    const entry = SIMPLE_PART_ENTRY[part.id];
    if (!entry) continue;
    const item = items.find((row) => row.entry === entry);
    if (!item) continue;
    const state = flagState(draft[rowKey(item)] ?? "");
    if (state !== null) part.on = state;
    else part.on = PRINT_ON_BY_DEFAULT.has(entry);
  }
  const patch: Partial<PrintSetup> = { parts };
  const fontItem = items.find((row) => row.entry === PRESCRIPTION_FONT_ENTRY);
  if (fontItem) {
    const size = fontFrom(draft[rowKey(fontItem)] ?? "");
    if (size) patch.fontSizePx = size;
  }
  const tailItem = items.find((row) => row.entry === "\u770b\u8a3a\u6536\u64da\u7684\u8868\u5c3e\u6587\u5b57");
  const tail = tailItem ? (draft[rowKey(tailItem)] || "").trim() : "";
  if (tail) patch.footer = tail;
  const titleItem = items.find((row) => row.entry === "\u85e5\u55ae\u5167\u5bb9\u8207\u9580\u8a3a\u6536\u64da\u62ac\u982d");
  const title = titleItem ? (draft[rowKey(titleItem)] || "").trim() : "";
  if (title) patch.receiptTitle = title;
  return patch;
}

const DEPOSIT_TAIL = "\u62bc\u91d1\u6536\u64da\u8868\u5c3e\u7684\u8b66\u8a9e\u5167\u5bb9";
const DEPOSIT_ID = "\u62bc\u91d1\u6536\u64da\u662f\u5426\u5217\u5370\u75c5\u60a3ID\u548c\u751f\u65e5";
const DEPOSIT_DAYS = "\u62bc\u91d1\u6536\u64da\u7684\u9000\u62bc\u671f\u9650";
const DEPOSIT_HOLIDAY = "\u62bc\u91d1\u6536\u64da\u5167\u5bb9\u662f\u5426\u52a0\u5370(\u4e0d\u542b\u4f8b\u5047\u65e5)";
const DEPOSIT_SIDE_BODY = "\u516d\u7b49\u4efd\u62bc\u91d1\u6536\u64da\u5167\u5bb9\u662f\u5426\u53ea\u5370\u55ae\u908aY/N";
const DEPOSIT_SIDE = "\u516d\u7b49\u4efd\u62bc\u91d1\u6536\u64da\u662f\u5426\u53ea\u5370\u55ae\u908aY/N";

export type DepositSlipFlags = {
  days: number;
  showIdBirthday: boolean;
  excludeHoliday: boolean;
  singleSide: boolean;
  warning: string;
};

function draftFlag(
  items: SciniRow[],
  draft: Record<string, string>,
  entry: string,
  fallback: boolean,
): boolean {
  const item = items.find((row) => row.entry === entry);
  if (!item) return fallback;
  const state = flagState(draft[rowKey(item)] ?? item.value ?? "");
  return state === null ? fallback : state;
}

export function depositFlagsFromDraft(
  items: SciniRow[],
  draft: Record<string, string>,
  warningFallback = "",
): DepositSlipFlags {
  const daysItem = items.find((row) => row.entry === DEPOSIT_DAYS);
  const daysRaw = daysItem ? (draft[rowKey(daysItem)] || daysItem.value || "").trim() : "";
  const daysNum = Number.parseInt(daysRaw, 10);
  const tailItem = items.find((row) => row.entry === DEPOSIT_TAIL);
  const warning = (tailItem ? (draft[rowKey(tailItem)] || tailItem.value || "") : warningFallback).trim();
  return {
    days: Number.isFinite(daysNum) && daysNum > 0 ? daysNum : 7,
    showIdBirthday: draftFlag(items, draft, DEPOSIT_ID, false),
    excludeHoliday: draftFlag(items, draft, DEPOSIT_HOLIDAY, false),
    singleSide:
      draftFlag(items, draft, DEPOSIT_SIDE, false) || draftFlag(items, draft, DEPOSIT_SIDE_BODY, false),
    warning,
  };
}

export function depositPatchFromFlags(
  setup: PrintSetup,
  draft: Record<string, string>,
  items: SciniRow[],
): Partial<PrintSetup> {
  if (setup.id !== "deposit") return {};
  const flags = depositFlagsFromDraft(items, draft, setup.footer);
  return {
    footer: flags.warning || setup.footer,
    depositDays: flags.days,
    depositShowId: flags.showIdBirthday,
    depositHolidayNote: flags.excludeHoliday,
    depositSingleSide: flags.singleSide,
  };
}
