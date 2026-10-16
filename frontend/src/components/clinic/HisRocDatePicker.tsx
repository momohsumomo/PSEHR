import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEscLayer } from "@/hooks/useEscLayer";
import { HIS, HIS_FONT } from "@/lib/hisTheme";

const MONTHS = [
  "\u4e00\u6708",
  "\u4e8c\u6708",
  "\u4e09\u6708",
  "\u56db\u6708",
  "\u4e94\u6708",
  "\u516d\u6708",
  "\u4e03\u6708",
  "\u516b\u6708",
  "\u4e5d\u6708",
  "\u5341\u6708",
  "\u5341\u4e00\u6708",
  "\u5341\u4e8c\u6708",
];

const WEEKDAYS = [
  "\u65e5",
  "\u4e00",
  "\u4e8c",
  "\u4e09",
  "\u56db",
  "\u4e94",
  "\u516d",
];

/** ???????G115.10.05?]????s?A????t?^?C */
export function formatRoc(yearRoc: number, month: number, day: number): string {
  return `${yearRoc}.${String(month).padStart(2, "0")}.${String(day).padStart(2, "0")}`;
}

export function rocToIso(roc: string): string {
  const raw = roc.trim();
  let yearRoc = 0;
  let month = 0;
  let day = 0;
  const dotted = raw.match(/^(\d{1,3})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (dotted) {
    yearRoc = Number(dotted[1]);
    month = Number(dotted[2]);
    day = Number(dotted[3]);
  } else if (/^\d{7}$/.test(raw)) {
    yearRoc = Number(raw.slice(0, 3));
    month = Number(raw.slice(3, 5));
    day = Number(raw.slice(5, 7));
  } else {
    return "";
  }
  if (!yearRoc || month < 1 || month > 12 || day < 1 || day > 31) return "";
  const y = yearRoc + 1911;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isoToRoc(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return formatRoc(Number(m[1]) - 1911, Number(m[2]), Number(m[3]));
}

/** ???????u????v?]???? UTC?A??K?x?W?b?]??t?^?C */
export function todayRoc(): string {
  const n = new Date();
  return formatRoc(n.getFullYear() - 1911, n.getMonth() + 1, n.getDate());
}

export function addDaysRoc(roc: string, deltaDays: number): string {
  const iso =
    rocToIso(roc) ||
    (() => {
      const n = new Date();
      return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
    })();
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return formatRoc(d.getFullYear() - 1911, d.getMonth() + 1, d.getDate());
}

export function monthStartRoc(): string {
  const n = new Date();
  return formatRoc(n.getFullYear() - 1911, n.getMonth() + 1, 1);
}

export function normalizeRoc(roc: string): string {
  const iso = rocToIso(roc);
  return iso ? isoToRoc(iso) : roc.trim();
}

export type RocDatePart = "year" | "month" | "day";

/** 游標在年／月／日哪一段。沒有游標時當成日（上下鍵預設改日）。 */
export function rocPartAtCaret(value: string, caret: number | null): RocDatePart {
  if (caret == null || caret < 0) return "day";
  const a = value.indexOf(".");
  if (a < 0) return "day";
  const b = value.indexOf(".", a + 1);
  if (caret <= a) return "year";
  if (b < 0 || caret <= b) return "month";
  return "day";
}

function daysInRocMonth(yearRoc: number, month: number): number {
  return new Date(yearRoc + 1911, month, 0).getDate();
}

/** 依正在編輯的那一段加減。日會跨月；月跨年；年只改年。 */
export function spinRoc(roc: string, part: RocDatePart, delta: number): string {
  const iso = rocToIso(roc);
  const base = iso ? new Date(`${iso}T00:00:00`) : new Date();
  let y = base.getFullYear() - 1911;
  let m = base.getMonth() + 1;
  let d = base.getDate();
  if (part === "year") {
    y = Math.max(1, y + delta);
  } else if (part === "month") {
    m += delta;
    while (m < 1) {
      m += 12;
      y = Math.max(1, y - 1);
    }
    while (m > 12) {
      m -= 12;
      y += 1;
    }
  } else {
    const dt = new Date(y + 1911, m - 1, d);
    dt.setDate(dt.getDate() + delta);
    return formatRoc(dt.getFullYear() - 1911, dt.getMonth() + 1, dt.getDate());
  }
  const dim = daysInRocMonth(y, m);
  if (d > dim) d = dim;
  return formatRoc(y, m, d);
}

/** ?I????i????_?l??G?^???????I???]???n????_?l??^?C */
export function clampRocEnd(dateFrom: string, dateTo: string): string {
  const a = rocToIso(dateFrom);
  const b = rocToIso(dateTo);
  if (a && b && b < a) return normalizeRoc(dateFrom);
  return normalizeRoc(dateTo) || dateTo;
}

type Props = {
  open: boolean;
  value: string;
  onClose: () => void;
  onConfirm: (roc: string) => void;
};

/** YiSheng-style ROC date menu: year/month + calendar + month radios. */
export function HisRocDatePicker({ open, value, onClose, onConfirm }: Props) {
  const initialIso = rocToIso(value) || (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  })();
  const init = new Date(`${initialIso}T00:00:00`);
  const [yearRoc, setYearRoc] = useState(init.getFullYear() - 1911);
  const [month, setMonth] = useState(init.getMonth() + 1);
  const [day, setDay] = useState(init.getDate());

  useEffect(() => {
    if (!open) return;
    const iso =
      rocToIso(value) ||
      (() => {
        const n = new Date();
        return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
      })();
    const d = new Date(`${iso}T00:00:00`);
    setYearRoc(d.getFullYear() - 1911);
    setMonth(d.getMonth() + 1);
    setDay(d.getDate());
  }, [open, value]);

  const cells = useMemo(() => {
    const first = new Date(yearRoc + 1911, month - 1, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(yearRoc + 1911, month, 0).getDate();
    const grid: Array<number | null> = [];
    for (let i = 0; i < startPad; i++) grid.push(null);
    for (let d = 1; d <= daysInMonth; d++) grid.push(d);
    while (grid.length % 7 !== 0) grid.push(null);
    return grid;
  }, [yearRoc, month]);

  useEscLayer([{ open, close: onClose }]);

  if (!open) return null;

  const headerRoc = formatRoc(yearRoc, month, day);
  const years = Array.from({ length: 30 }, (_, i) => yearRoc - 10 + i).filter((y) => y > 0);

  return createPortal(
    <div data-roc-date-picker="" className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/40">
      <div
        className="w-[min(28rem,96vw)] overflow-hidden border-2 shadow-xl"
        style={{
          borderColor: "#404040",
          background: HIS.chrome,
          fontFamily: HIS_FONT,
          fontSize: HIS.fs.body,
        }}
      >
        <div
          className="flex items-center justify-between px-2 py-0.5 font-bold text-white"
          style={{ background: "linear-gradient(90deg,#000080,#1084d0)" }}
        >
          <span>{"\u65e5\u671f\u9078\u55ae\u7cfb\u7d71"}</span>
          <button type="button" className="px-1" onClick={onClose}>
            {"\u2715"}
          </button>
        </div>

        <div className="space-y-2 p-2">
          <div className="flex items-center gap-2">
            <span className="font-bold" style={{ color: HIS.labelText }}>
              {"\u65e5\u671f"}
            </span>
            <input
              className="w-28 border border-[#808080] bg-white px-1 font-mono"
              style={{ height: HIS.row.formField }}
              value={headerRoc}
              readOnly
            />
          </div>

          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex gap-1">
                <select
                  className="border border-[#808080] bg-white px-1"
                  style={{ height: HIS.row.formField }}
                  value={yearRoc}
                  onChange={(e) => setYearRoc(Number(e.target.value))}
                >
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {"\u6c11\u570b "}
                      {y}
                      {" \u5e74"}
                    </option>
                  ))}
                </select>
                <select
                  className="border border-[#808080] bg-white px-1"
                  style={{ height: HIS.row.formField }}
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                >
                  {MONTHS.map((label, idx) => (
                    <option key={label} value={idx + 1}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="border border-[#808080] bg-white px-1 font-bold"
                  style={{ height: HIS.row.formField }}
                  onClick={() => {
                    const n = new Date();
                    setYearRoc(n.getFullYear() - 1911);
                    setMonth(n.getMonth() + 1);
                    setDay(n.getDate());
                  }}
                >
                  {"\u4eca\u5929\u65e5\u671f"}
                </button>
              </div>

              <table className="w-full border-collapse text-center text-[12px]">
                <thead>
                  <tr className="bg-[#C0C0C0]">
                    {WEEKDAYS.map((w, i) => (
                      <th
                        key={w}
                        className="border border-[#808080] px-1 py-0.5"
                        style={{ color: i === 0 ? "#c00" : i === 6 ? "#060" : "#000" }}
                      >
                        {w}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: cells.length / 7 }, (_, row) => (
                    <tr key={row}>
                      {cells.slice(row * 7, row * 7 + 7).map((d, col) => {
                        const selected = d === day;
                        return (
                          <td key={col} className="border border-[#A0A0A0] p-0">
                            {d == null ? (
                              <span className="block px-1 py-0.5">&nbsp;</span>
                            ) : (
                              <button
                                type="button"
                                className="block w-full px-1 py-0.5"
                                style={{
                                  background: selected ? "#000080" : "#fff",
                                  color: selected
                                    ? "#fff"
                                    : col === 0
                                      ? "#c00"
                                      : col === 6
                                        ? "#060"
                                        : "#000",
                                }}
                                onClick={() => setDay(d)}
                                onDoubleClick={() => onConfirm(formatRoc(yearRoc, month, d))}
                              >
                                {d}
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="w-20 shrink-0 space-y-0.5 border border-[#808080] bg-white p-1">
              {MONTHS.map((label, idx) => (
                <label key={label} className="flex items-center gap-1 text-[11px]">
                  <input
                    type="radio"
                    checked={month === idx + 1}
                    onChange={() => setMonth(idx + 1)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              className="border px-3 py-1 font-bold"
              style={{ borderColor: "#808080", background: HIS.chrome }}
              onClick={() => onConfirm(formatRoc(yearRoc, month, day))}
            >
              <span className="text-sky-700">{"\u2713"}</span> {"\u78ba\u5b9a[Ok]"}
            </button>
            <button
              type="button"
              className="border px-3 py-1 font-bold"
              style={{ borderColor: "#808080", background: HIS.chrome }}
              onClick={onClose}
            >
              <span className="text-red-600">{"\u2715"}</span> {"\u96e2\u958b[C]"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

type FieldProps = {
  value: string;
  onChange: (roc: string) => void;
  className?: string;
};

/**
 * 民國日期欄：可打年月日。
 * 游標在年 → 右側上下改年；在月 → 改月；沒選或在日 → 改日。
 * 再右邊打開日曆選單（不是瀏覽器內建日期框）。
 */
export function HisRocDateField({ value, onChange, className = "" }: FieldProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const [part, setPart] = useState<RocDatePart>("day");
  const inputEl = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setText(value);
  }, [value]);

  const rememberPart = (el: HTMLInputElement | null) => {
    if (!el) {
      setPart("day");
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start == null || end == null || start !== end) {
      if (start == null) setPart("day");
      else setPart(rocPartAtCaret(el.value, start));
      return;
    }
    setPart(rocPartAtCaret(el.value, start));
  };

  const commit = (roc: string) => {
    const n = normalizeRoc(roc);
    if (!n || !rocToIso(n)) return;
    setText(n);
    onChange(n);
  };

  const spin = (delta: number) => {
    const next = spinRoc(text || value, part, delta);
    commit(next);
    const keep = part;
    requestAnimationFrame(() => {
      const el = inputEl.current;
      if (!el) return;
      el.focus();
      const a = next.indexOf(".");
      const b = next.indexOf(".", a + 1);
      const pos = keep === "year" ? 0 : keep === "month" ? a + 1 : b >= 0 ? b + 1 : next.length;
      el.setSelectionRange(pos, pos);
      setPart(keep);
    });
  };

  const fieldH = HIS.row.formField;

  return (
    <span className={`inline-flex items-stretch ${className}`}>
      <input
        ref={inputEl}
        className="w-[6.5rem] border border-[#808080] bg-white px-1 font-mono outline-none focus:border-[#000080]"
        style={{ height: fieldH, fontSize: HIS.fs.body, fontFamily: HIS_FONT, color: HIS.inputBlue }}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          rememberPart(e.target);
        }}
        onClick={(e) => rememberPart(e.currentTarget)}
        onKeyUp={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter") return;
          rememberPart(e.currentTarget);
        }}
        onSelect={(e) => rememberPart(e.currentTarget)}
        onBlur={() => {
          setPart("day");
          const n = normalizeRoc(text);
          if (n && rocToIso(n)) {
            setText(n);
            if (n !== value) onChange(n);
          } else {
            setText(value);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            spin(1);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            spin(-1);
          }
        }}
        placeholder="115.10.05"
        title={"\u5e74.\u6708.\u65e5\uff1b\u6e38\u6a19\u5728\u54ea\u4e00\u6bb5\uff0c\u53f3\u5074\u4e0a\u4e0b\u5c31\u6539\u90a3\u4e00\u6bb5\u3002\u6c92\u9078\u6642\u6539\u65e5\u3002"}
      />
      <span className="flex flex-col" style={{ width: 16 }}>
        <button
          type="button"
          className="flex flex-1 items-center justify-center border border-l-0 border-[#808080] bg-[#F0F0F0] text-[8px] leading-none"
          title={part === "year" ? "\u6539\u5e74" : part === "month" ? "\u6539\u6708" : "\u6539\u65e5"}
          onMouseDown={(e) => {
            e.preventDefault();
            spin(1);
          }}
        >
          {"\u25b2"}
        </button>
        <button
          type="button"
          className="flex flex-1 items-center justify-center border border-l-0 border-t-0 border-[#808080] bg-[#F0F0F0] text-[8px] leading-none"
          title={part === "year" ? "\u6539\u5e74" : part === "month" ? "\u6539\u6708" : "\u6539\u65e5"}
          onMouseDown={(e) => {
            e.preventDefault();
            spin(-1);
          }}
        >
          {"\u25bc"}
        </button>
      </span>
      <button
        type="button"
        className="border border-l-0 border-[#808080] bg-[#ECE9D8] px-1 text-[11px] font-bold leading-none"
        style={{ height: fieldH }}
        title={"\u65e5\u671f\u9078\u55ae"}
        onClick={() => setOpen(true)}
      >
        {"\u25bc"}
      </button>
      <HisRocDatePicker
        open={open}
        value={rocToIso(text) ? text : value}
        onClose={() => setOpen(false)}
        onConfirm={(roc) => {
          commit(roc);
          setOpen(false);
        }}
      />
    </span>
  );
}
