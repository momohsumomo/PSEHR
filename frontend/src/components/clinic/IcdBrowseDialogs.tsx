import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { CatalogDiagnosis } from "@/types/clinicCatalog";
import { diagnosisLabel } from "@/utils/catalogSearch";
import { briefDiagnoses, splitToDiagnosis, splitsFor, useIcdSplits, type IcdSplit } from "@/utils/icdSplit";
import { FullIcdSearchDialog } from "@/components/clinic/FullIcdSearchDialog";
import { useEscLayer } from "@/hooks/useEscLayer";
import { HIS_FONT } from "@/lib/hisTheme";

export type IcdField = "icd9" | "name" | "icd10";

type Props = {
  catalog: CatalogDiagnosis[];
  field: IcdField;
  query: string;
  onClose: () => void;
  onPick: (row: CatalogDiagnosis, query?: string) => void | string;
  onBrowseChapters?: () => void;
};

function icd9Of(row: CatalogDiagnosis): string {
  return (row.icd9 || row.aCode || "").trim();
}

function SplitList({
  rows,
  activeIcd10,
  onPick,
}: {
  rows: IcdSplit[];
  activeIcd10: string;
  onPick: (row: IcdSplit) => void;
}) {
  const active = activeIcd10.replace(/\./g, "").trim().toUpperCase();
  return (
    <div className="max-h-40 shrink-0 overflow-auto border-t border-[#A0A0A0] bg-[#FFF8DC]">
      <div className="px-2 py-0.5 text-[11px]">{"\u7d30\u5206"}</div>
      <table className="w-full border-collapse text-left text-[12px]">
        <thead className="sticky top-0 bg-[#E7D89A]">
          <tr>
            <th className="border border-[#C8B56A] px-1">ICD-9</th>
            <th className="border border-[#C8B56A] px-1">ICD-10</th>
            <th className="border border-[#C8B56A] px-1">{"\u82f1\u6587"}</th>
            <th className="border border-[#C8B56A] px-1">{"\u4e2d\u6587"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.icd9}-${row.icd10}`}
              className={row.icd10 === active ? "bg-[#FFF2A8]" : "bg-white"}
              onClick={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                onPick(row);
              }}
            >
              <td className="border border-[#E0E0E0] px-1 font-mono">{row.icd9}</td>
              <td className="border border-[#E0E0E0] px-1 font-mono">{row.icd10}</td>
              <td className="border border-[#E0E0E0] px-1">{row.nameEn}</td>
              <td className="border border-[#E0E0E0] px-1">{row.nameZh}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function IcdShortcutDialog({
  catalog,
  field,
  query,
  onClose,
  onPick,
  onBrowseChapters,
}: Props) {
  const [text, setText] = useState(query);
  const [index, setIndex] = useState(0);
  const [armed, setArmed] = useState(false);
  const [pickError, setPickError] = useState("");
  const [fullOpen, setFullOpen] = useState(false);
  const splitMap = useIcdSplits();
  void field;
  const rows = useMemo(
    () => briefDiagnoses(catalog, text, text.trim() ? 2000 : 800, splitMap),
    [catalog, splitMap, text],
  );
  const current = rows[index] ?? null;
  const detail = useMemo(() => (current ? splitsFor(splitMap, icd9Of(current)) : []), [current, splitMap]);
  useEscLayer([{ open: true, close: onClose }]);

  const pick = (row: CatalogDiagnosis) => {
    const msg = onPick(row, text);
    setPickError(typeof msg === "string" ? msg : "");
  };

  useEffect(() => {
    setIndex(0);
    setArmed(false);
  }, [text]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (fullOpen) return;
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        ev.stopPropagation();
        setArmed(true);
        setIndex((i) => Math.min(i + 1, Math.max(rows.length - 1, 0)));
      }
      if (ev.key === "ArrowUp") {
        ev.preventDefault();
        ev.stopPropagation();
        setArmed(true);
        setIndex((i) => Math.max(i - 1, 0));
      }
      if (ev.key === "Enter" && armed && current) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        pick(current);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [armed, current, fullOpen, onPick, rows.length]);

  return createPortal(
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-black/35"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        className="flex h-[min(34rem,88vh)] w-[min(64rem,96vw)] flex-col border-2 border-[#003C74] bg-[#F0F0F0] shadow-lg"
        style={{ fontFamily: HIS_FONT }}
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <div className="bg-[#003C74] px-2 py-1 text-[12px] font-bold text-white">病名</div>
        <div className="grid min-h-0 flex-1 grid-cols-[16rem_1fr]">
          <div className="space-y-1 overflow-auto border-r border-[#A0A0A0] p-2 text-[12px]">
            <label className="block">
              <span className="mb-0.5 block text-[#000080]">簡稱</span>
              <input className="w-full border border-[#7F9DB9] bg-white px-1" value={current?.short || ""} readOnly />
            </label>
            <label className="block">
              <span className="mb-0.5 block">名稱（英）</span>
              <input className="w-full border border-[#7F9DB9] bg-white px-1" value={current?.nameEn || ""} readOnly />
            </label>
            <label className="block">
              <span className="mb-0.5 block">名稱（中）</span>
              <input className="w-full border border-[#7F9DB9] bg-white px-1" value={current?.nameZh || current?.text || ""} readOnly />
            </label>
            <label className="block">
              <span className="mb-0.5 block">ICD-10 名稱</span>
              <input className="w-full border border-[#7F9DB9] bg-white px-1" value={current?.text || ""} readOnly />
            </label>
            <div className="grid grid-cols-2 gap-1">
              <label>
                <span className="mb-0.5 block">ICD-9</span>
                <input className="w-full border border-[#7F9DB9] bg-white px-1 font-mono" value={current ? icd9Of(current) : ""} readOnly />
              </label>
              <label>
                <span className="mb-0.5 block">A-CODE</span>
                <input className="w-full border border-[#7F9DB9] bg-white px-1 font-mono" value={current?.aCode || ""} readOnly />
              </label>
            </div>
            <label className="block">
              <span className="mb-0.5 block">ICD-10</span>
              <input className="w-full border border-[#7F9DB9] bg-white px-1 font-mono" value={current?.icd10 || ""} readOnly />
            </label>
          </div>
          <div className="flex min-h-0 flex-col">
            <label className="flex items-center gap-2 border-b border-[#A0A0A0] px-2 py-1 text-[12px]">
              <span>病名、ICD-9、ICD-10</span>
              <input
                autoFocus
                className="flex-1 border border-[#7F9DB9] bg-white px-1 font-mono"
                value={text}
                onChange={(ev) => setText(ev.target.value)}
              />
              <span className="text-[11px] text-slate-600">{rows.length} 筆</span>
            </label>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full border-collapse text-left text-[12px]">
                <thead className="sticky top-0 bg-[#D8D4C8]">
                  <tr>
                    <th className="border border-[#A0A0A0] px-1">簡稱</th>
                    <th className="border border-[#A0A0A0] px-1">ICD-9</th>
                    <th className="border border-[#A0A0A0] px-1">病名</th>
                    <th className="border border-[#A0A0A0] px-1">ICD-10</th>
                  </tr>
                </thead>
                <tbody key={text}>
                  {rows.map((row, i) => (
                    <tr
                      key={`${row.short || ""}-${row.icd10}-${i}`}
                      className={i === index ? "bg-[#316AC5] text-white" : i % 2 ? "bg-[#FFF8DC]" : "bg-white"}
                      onClick={(ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        pick(row);
                      }}
                    >
                      <td className="border border-[#E0E0E0] px-1 font-mono">{row.short || ""}</td>
                      <td className="border border-[#E0E0E0] px-1 font-mono">{icd9Of(row)}</td>
                      <td className="border border-[#E0E0E0] px-1">{diagnosisLabel(row, text)}</td>
                      <td className="border border-[#E0E0E0] px-1 font-mono">{row.icd10}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SplitList rows={detail} activeIcd10={current?.icd10 || ""} onPick={(row) => pick(splitToDiagnosis(row))} />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#A0A0A0] p-2">
          {onBrowseChapters ? (
            <button type="button" className="border border-[#003C74] bg-[#E8E8E8] px-3 py-1 text-[12px]" onClick={onBrowseChapters}>
              沒有代碼，用分類找
            </button>
          ) : null}
                    <button type="button" className="mr-auto border border-[#003C74] bg-[#FFF3C4] px-3 py-1 text-[12px]" onClick={() => setFullOpen(true)}>
            完整搜尋
          </button>
          {pickError ? <span className="mr-auto self-center text-[12px] text-red-700">{pickError}</span> : null}
          <button type="button" className="border border-[#003C74] bg-[#C8F7C8] px-3 py-1 text-[12px] font-bold" onClick={() => current && pick(current)}>
            寫入
          </button>
          <button type="button" className="border border-[#003C74] bg-white px-3 py-1 text-[12px]" onClick={onClose}>
            離開
          </button>
        </div>
      </div>
      {fullOpen ? (
        <FullIcdSearchDialog query={text} onClose={() => setFullOpen(false)} onPick={onPick} />
      ) : null}
    </div>,
    document.body,
  );
}

export function Icd10ConditionDialog({
  catalog,
  query,
  onClose,
  onPick,
}: Omit<Props, "field" | "onBrowseChapters">) {
  const [text, setText] = useState(query);
  const [index, setIndex] = useState(0);
  const [armed, setArmed] = useState(false);
  const [pickError, setPickError] = useState("");
  const [fullOpen, setFullOpen] = useState(false);
  const splitMap = useIcdSplits();
  const rows = useMemo(
    () => briefDiagnoses(catalog, text, text.trim() ? 2000 : 800, splitMap),
    [catalog, splitMap, text],
  );
  const current = rows[index] ?? null;
  const detail = useMemo(() => (current ? splitsFor(splitMap, icd9Of(current)) : []), [current, splitMap]);

  useEffect(() => {
    setIndex(0);
    setArmed(false);
  }, [text]);

  useEscLayer([{ open: true, close: onClose }]);

  const pick = (row: CatalogDiagnosis) => {
    const msg = onPick(row, text);
    setPickError(typeof msg === "string" ? msg : "");
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (fullOpen) return;
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        ev.stopPropagation();
        setArmed(true);
        setIndex((i) => Math.min(i + 1, Math.max(rows.length - 1, 0)));
      }
      if (ev.key === "ArrowUp") {
        ev.preventDefault();
        ev.stopPropagation();
        setArmed(true);
        setIndex((i) => Math.max(i - 1, 0));
      }
      if (ev.key === "Enter" && armed && current) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        pick(current);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [armed, current, fullOpen, onPick, rows.length]);

  return createPortal(
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-black/35"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        className="flex h-[min(34rem,88vh)] w-[min(68rem,96vw)] flex-col border-2 border-[#003C74] bg-[#F4F4F4] shadow-lg"
        style={{ fontFamily: HIS_FONT }}
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <div className="bg-[#003C74] px-2 py-1 text-[12px] font-bold text-white">國際疾病名稱</div>
        <div className="flex flex-wrap items-center gap-3 border-b border-[#A0A0A0] px-2 py-1 text-[12px]">
          <label>
            病名、ICD-9、ICD-10
            <input
              autoFocus
              className="ml-1 border border-[#7F9DB9] bg-white px-1 font-mono"
              value={text}
              onChange={(ev) => setText(ev.target.value)}
            />
          </label>
          
          <span className="text-[11px] text-slate-600">{rows.length} 筆</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-[12px]">
            <thead className="sticky top-0 bg-[#D8D4C8]">
              <tr>
                <th className="border border-[#A0A0A0] px-1">ICD-9</th>
                <th className="border border-[#A0A0A0] px-1">ICD-10</th>
                <th className="border border-[#A0A0A0] px-1">英文</th>
                <th className="border border-[#A0A0A0] px-1">中文</th>
                <th className="border border-[#A0A0A0] px-1">簡稱</th>
              </tr>
            </thead>
            <tbody key={text}>
              {rows.map((row, i) => (
                <tr
                  key={`${row.icd10}-${row.short || i}`}
                  className={i === index ? "bg-[#316AC5] text-white" : "bg-white"}
                  onClick={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    pick(row);
                  }}
                >
                  <td className="border border-[#E0E0E0] px-1 font-mono">{icd9Of(row)}</td>
                  <td className="border border-[#E0E0E0] px-1 font-mono">{row.icd10}</td>
                  <td className="border border-[#E0E0E0] px-1">{row.nameEn || ""}</td>
                  <td className="border border-[#E0E0E0] px-1">{row.nameZh || row.text}</td>
                  <td className="border border-[#E0E0E0] px-1 font-mono">{row.short || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SplitList rows={detail} activeIcd10={current?.icd10 || ""} onPick={(row) => pick(splitToDiagnosis(row))} />
        <div className="flex justify-end gap-2 border-t border-[#A0A0A0] p-2">
                    <button type="button" className="mr-auto border border-[#003C74] bg-[#FFF3C4] px-3 py-1 text-[12px]" onClick={() => setFullOpen(true)}>
            完整搜尋
          </button>
          {pickError ? <span className="mr-auto self-center text-[12px] text-red-700">{pickError}</span> : null}
          <button type="button" className="border border-[#003C74] bg-[#C8F7C8] px-3 py-1 text-[12px] font-bold" onClick={() => current && pick(current)}>
            確定
          </button>
          <button type="button" className="border border-[#003C74] bg-white px-3 py-1 text-[12px]" onClick={onClose}>
            離開
          </button>
        </div>
      </div>
      {fullOpen ? (
        <FullIcdSearchDialog query={text} onClose={() => setFullOpen(false)} onPick={onPick} />
      ) : null}
    </div>,
    document.body,
  );
}

import type { RxLine } from "@/mocks/clinicMocks";

function money(line: RxLine): { price: string; amount: string } {
  const price = Number(line.unitPrice);
  if (!Number.isFinite(price)) return { price: "\u2014", amount: "\u2014" };
  const raw = String(line.totalAmount || "");
  const matched = raw.match(/[\d.]+/);
  const qty = matched ? Number(matched[0]) : Number(line.qty || 0);
  const amount = qty > 0 ? price * qty : price;
  return { price: price.toFixed(2), amount: amount.toFixed(2) };
}

export function RxDetailSheet({ lines, onClose }: { lines: RxLine[]; onClose: () => void }) {
  useEscLayer([{ open: true, close: onClose }]);
  const rows = lines.filter((line) => (line.name || "").trim() || (line.nhiCode || "").trim());
  let sum = 0;
  for (const line of rows) {
    const amount = Number(money(line).amount);
    if (Number.isFinite(amount)) sum += amount;
  }
  return createPortal(
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-black/35"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[80vh] w-[min(72rem,96vw)] flex-col border-2 border-[#003C74] bg-[#F0F0F0] shadow-lg"
        style={{ fontFamily: HIS_FONT }}
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <div className="bg-[#003C74] px-2 py-1 text-[12px] font-bold text-white">{"\u85e5\u54c1\u8655\u7f6e\u660e\u7d30"}</div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-[12px]">
            <thead className="sticky top-0 bg-[#D8D4C8]">
              <tr>
                {["No", "\u7c21\u7a31", "\u8655\u7f6e\u540d\u7a31", "\u6578\u91cf", "\u7528\u6cd5", "\u5929\u6578", "\u7e3d\u91cf", "\u85e5\u54c1\u78bc", "\u55ae\u50f9", "\u8a08\u8cbb", "\u91d1\u984d"].map((label) => (
                  <th key={label} className="border border-[#A0A0A0] px-1">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((line, i) => {
                const cost = money(line);
                const mark = line.payMark || (line.selfPay ? "\u81ea" : "");
                return (
                  <tr key={line.id} className="bg-white">
                    <td className="border border-[#E0E0E0] px-1">{i + 1}</td>
                    <td className="border border-[#E0E0E0] px-1">{line.shortName || ""}</td>
                    <td className="border border-[#E0E0E0] px-1">{line.name}</td>
                    <td className="border border-[#E0E0E0] px-1 text-right">{line.qty ?? ""}</td>
                    <td className="border border-[#E0E0E0] px-1">{line.sig}</td>
                    <td className="border border-[#E0E0E0] px-1 text-right">{line.days || ""}</td>
                    <td className="border border-[#E0E0E0] px-1">{line.totalAmount || ""}</td>
                    <td className="border border-[#E0E0E0] px-1 font-mono">{line.nhiCode}</td>
                    <td className="border border-[#E0E0E0] px-1 text-right">{cost.price}</td>
                    <td className="border border-[#E0E0E0] px-1">{mark || "\u5065\u4fdd"}</td>
                    <td className="border border-[#E0E0E0] px-1 text-right">{cost.amount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-[#A0A0A0] px-2 py-1 text-[12px]">
          <span>{"\u91d1\u984d\u5408\u8a08"} {sum.toFixed(2)}</span>
          <button type="button" className="border border-[#003C74] bg-white px-3 py-1" onClick={onClose}>{"\u95dc\u9589"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
