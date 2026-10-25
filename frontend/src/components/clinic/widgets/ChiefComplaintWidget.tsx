import { useEffect, useState, useRef } from "react";
import { HIS, HIS_FONT } from "@/lib/hisTheme";
import { hisTextareaStyle } from "@/components/clinic/HisPageFrame";
import { fetchCcSuggest } from "@/api/clinicApi";

interface ChiefComplaintWidgetProps {
  apiMode: boolean;
  saving: boolean;
  ccText: string;
  setCcText: (v: string | ((prev: string) => string)) => void;
  ccChips: string[];
  /** @deprecated kept for call-site compat; CC saves with F9 only */
  saveCc?: () => void;
  active?: boolean;
  onActivate?: () => void;
}

/** CC box: purple border; no blur auto-save (F9 persists) */
export function ChiefComplaintWidget({
  apiMode: _apiMode,
  saving: _saving,
  ccText,
  setCcText,
  ccChips: _ccChips,
  saveCc: _saveCc,
  active = false,
  onActivate,
}: ChiefComplaintWidgetProps) {
  void _apiMode;
  void _saving;
  void _ccChips;
  void _saveCc;
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const [caret, setCaret] = useState(0);
  const [suffix, setSuffix] = useState("");
  const atEnd = caret === ccText.length;
  const word = /(?:^|[^A-Za-z])([A-Za-z][A-Za-z'-]*)$/.exec(ccText);
  const frag = atEnd && word ? word[1] : "";

  useEffect(() => {
    if (!atEnd || frag.length < 2) {
      setSuffix("");
      return;
    }
    let cancel = false;
    const timer = window.setTimeout(() => {
      void fetchCcSuggest(frag, "")
        .then((next) => {
          if (!cancel) setSuffix(next);
        })
        .catch(() => {
          if (!cancel) setSuffix("");
        });
    }, 80);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [atEnd, frag]);
  const syncMirror = () => {
    const area = areaRef.current;
    const pre = preRef.current;
    if (!area || !pre) return;
    pre.style.width = `${area.clientWidth}px`;
    pre.scrollTop = area.scrollTop;
  };

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    syncMirror();
    const watch = new ResizeObserver(() => syncMirror());
    watch.observe(area);
    return () => watch.disconnect();
  }, [ccText, suffix]);

  function clickLandsOnText(area: HTMLTextAreaElement, clientX: number, clientY: number): boolean {
  const text = area.value;
  const pos = area.selectionStart ?? text.length;
  const lineStart = text.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
  const breakAt = text.indexOf("\n", pos);
  const line = text.slice(lineStart, breakAt === -1 ? text.length : breakAt);
  const cs = window.getComputedStyle(area);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return true;
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const padL = Number.parseFloat(cs.paddingLeft) || 0;
  const padT = Number.parseFloat(cs.paddingTop) || 0;
  const fontPx = Number.parseFloat(cs.fontSize) || 16;
  const lineHeight = Number.parseFloat(cs.lineHeight) || fontPx * 1.25;
  const rect = area.getBoundingClientRect();
  const x = clientX - rect.left - padL + area.scrollLeft;
  const y = clientY - rect.top - padT + area.scrollTop;
  const lineIndex = text.slice(0, lineStart).split("\n").length - 1;
  if (y < lineIndex * lineHeight - 2 || y > (lineIndex + 1) * lineHeight + 2) return false;
  const width = ctx.measureText(line).width;
  const slop = Math.max(ctx.measureText("\u5b57").width, fontPx);
  return x >= -2 && x <= width + slop;
}

const textStyle = {
    ...hisTextareaStyle,
    fontWeight: 700,
    fontSize: HIS.fs.body,
    lineHeight: 1.25,
    fontFamily: HIS_FONT,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflowWrap: "break-word",
  } as const;

  return (
    <section
      className="flex h-full flex-col overflow-hidden p-0.5"
      style={{
        background: HIS.ccBg,
        border: `2px solid ${HIS.ccBorder}`,
        outline: active ? `1px solid ${HIS.ccBorder}` : undefined,
        outlineOffset: 0,
        fontFamily: HIS_FONT,
      }}
      onMouseDown={() => {
        onActivate?.();
        areaRef.current?.focus();
      }}
    >
      <div className="relative h-full min-h-0 flex-1">
        <pre
          ref={preRef}
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 m-0 h-full overflow-hidden whitespace-pre-wrap break-words p-0.5"
          style={{ ...textStyle, color: HIS.ccText }}
        >
          {ccText}
          <span style={{ color: "#9a86b0", fontWeight: 500 }}>{suffix}</span>
        </pre>
        <textarea
          ref={areaRef}
          className="relative h-full w-full min-h-0 flex-1 resize-none border-0 bg-transparent p-0.5 focus:outline-none"
          style={{
            ...textStyle,
            background: "transparent",
            color: "transparent",
            caretColor: HIS.ccText,
            WebkitTextFillColor: "transparent",
            overflowY: "auto",
            scrollbarGutter: "stable",
          }}
          value={ccText}
          onChange={(e) => {
            setCcText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
          }}
          onScroll={() => syncMirror()}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onClick={(e) => {
            const area = areaRef.current;
            if (!area) return;
            const text = area.value;
            if (!text.trim()) return;
            if (clickLandsOnText(area, e.clientX, e.clientY)) return;
            const next = text.endsWith("\n") ? text : `${text}\n`;
            setCcText(next);
            setCaret(next.length);
            window.requestAnimationFrame(() => {
              area.selectionStart = next.length;
              area.selectionEnd = next.length;
              area.scrollTop = area.scrollHeight;
              syncMirror();
            });
          }}
          onKeyDown={(e) => {
            if (e.key !== "Tab" || e.shiftKey || !suffix) return;
            e.preventDefault();
            e.stopPropagation();
            const base = areaRef.current?.value ?? ccText;
            const next = base + suffix;
            if (next.length < base.length) return;
            setSuffix("");
            setCcText(next);
            setCaret(next.length);
            window.requestAnimationFrame(() => {
              const area = areaRef.current;
              if (!area) return;
              area.selectionStart = next.length;
              area.selectionEnd = next.length;
              area.scrollTop = area.scrollHeight;
              syncMirror();
            });
          }}
          placeholder=""
          aria-label={"\u4e3b\u8a34\uff08\u6253\u5230\u4e00\u500b\u8a5e\u7684\u4e00\u534a\uff0cTab \u88dc\u5b8c\u9019\u500b\u8a5e\uff09"}
          title={"\u4e3b\u8a34\uff1a\u6253\u9019\u500b\u8a5e\u7684\u524d\u5e7e\u500b\u5b57\u6bcd\uff0cTab \u88dc\u5b8c\u9019\u500b\u8a5e\uff1bF9 \u5b58\u6a94"}
        />
      </div>
    </section>
  );
}
