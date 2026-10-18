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
  const lineStart = ccText.lastIndexOf("\n") + 1;
  const frag = ccText.slice(lineStart);
  const prev = lineStart > 0 ? (ccText.slice(0, lineStart - 1).split("\n").pop() ?? "") : "";

  useEffect(() => {
    if (!atEnd) {
      setSuffix("");
      return;
    }
    let cancel = false;
    const timer = window.setTimeout(() => {
      void fetchCcSuggest(frag, prev)
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
  }, [atEnd, frag, prev]);
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
          aria-label={"\u4e3b\u8a34\uff08\u6253\u5b57\u5f8c Tab \u88dc\u5b8c\uff09"}
          title={"\u4e3b\u8a34\uff1a\u6253\u5e7e\u500b\u5b57\uff0cTab \u88dc\u4e0a\u7247\u8a9e\uff1bF9 \u5b58\u6a94"}
        />
      </div>
    </section>
  );
}
