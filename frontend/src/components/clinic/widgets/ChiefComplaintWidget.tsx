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

  /** 點在某一行右側空白：接那一行。只有點在最後一行下面，才另起一行。 */
  function placeCaretFromClick(clientX: number, clientY: number) {
    const area = areaRef.current;
    const pre = preRef.current;
    if (!area) return;
    const text = area.value;
    if (!text.trim()) return;
    const node = pre?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE || !node.textContent) return;
    const cs = window.getComputedStyle(area);
    const fontPx = Number.parseFloat(cs.fontSize) || 16;
    const lineHeight = Number.parseFloat(cs.lineHeight) || fontPx * 1.25;
    const parts = text.split("\n");
    let offset = 0;
    let lastBottom = area.getBoundingClientRect().top;
    for (let i = 0; i < parts.length; i += 1) {
      const line = parts[i];
      const start = offset;
      const end = start + line.length;
      const range = document.createRange();
      const at = Math.min(start, node.textContent.length);
      const to = Math.min(end, node.textContent.length);
      range.setStart(node, at);
      range.setEnd(node, Math.max(at, to));
      const rects = Array.from(range.getClientRects());
      const top = rects.length ? rects[0].top : lastBottom;
      const bottom = rects.length ? rects[rects.length - 1].top + lineHeight : top + lineHeight;
      lastBottom = Math.max(lastBottom, bottom);
      if (clientY >= top - 2 && clientY < bottom + 2) {
        const row = rects.find((r) => clientY >= r.top - 2 && clientY < r.top + lineHeight + 2);
        const rowRight = row ? row.right : rects.length ? rects[rects.length - 1].right : 0;
        if (clientX > rowRight + 2) {
          area.selectionStart = end;
          area.selectionEnd = end;
          setCaret(end);
        }
        return;
      }
      offset = end + 1;
    }
    if (clientY < lastBottom - 2) return;
    const next = text.endsWith("\n") ? text : `${text}\n`;
    setCcText(next);
    setCaret(next.length);
    window.requestAnimationFrame(() => {
      area.selectionStart = next.length;
      area.selectionEnd = next.length;
      area.scrollTop = area.scrollHeight;
      syncMirror();
    });
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
            placeCaretFromClick(e.clientX, e.clientY);
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
