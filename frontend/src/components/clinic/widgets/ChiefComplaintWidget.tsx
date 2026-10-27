import { useEffect, useLayoutEffect, useState, useRef } from "react";
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

/** 游標那一行超出可見範圍時，捲動量。四個邊界都是視窗座標。 */
export function nextCaretScrollTop(
  scrollTop: number,
  viewTop: number,
  viewBottom: number,
  caretTop: number,
  caretBottom: number,
): number {
  if (caretBottom > viewBottom) return scrollTop + (caretBottom - viewBottom);
  if (caretTop < viewTop) return Math.max(0, scrollTop - (viewTop - caretTop));
  return scrollTop;
}

/** 結尾的換行在畫面上要佔一排，游標才有空白行可閃。 */
function mirrorBody(text: string): string {
  return text.endsWith("\n") ? `${text}\u200b` : text;
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

  /** 游標在哪一排，那一排就要完整出現在框裡。第幾排都一樣。 */
  const revealCaretLine = () => {
    const area = areaRef.current;
    const pre = preRef.current;
    if (!area || !pre) return;
    pre.style.width = `${area.clientWidth}px`;
    pre.scrollTop = area.scrollTop;
    const pos = area.selectionStart ?? 0;
    const node = pre.firstChild;
    let next = area.scrollTop;
    if (node && node.nodeType === Node.TEXT_NODE && node.textContent) {
      const text = node.textContent;
      const len = text.length;
      const cs = window.getComputedStyle(area);
      const fontPx = Number.parseFloat(cs.fontSize) || 16;
      const lineHeight = Number.parseFloat(cs.lineHeight) || fontPx * 1.25;
      const box = area.getBoundingClientRect();
      const viewTop = box.top + (Number.parseFloat(cs.paddingTop) || 0);
      const viewBottom = box.bottom - (Number.parseFloat(cs.paddingBottom) || 0);
      const glyph = (index: number) => {
        if (index < 0 || index >= len || text[index] === "\n") return null;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect = range.getBoundingClientRect();
        return rect.height > 0 ? rect : null;
      };
      const at = Math.min(pos, len);
      let caretTop: number | null = null;
      let caretBottom: number | null = null;
      const here = at < len ? glyph(at) : null;
      if (here) {
        caretTop = here.top;
        caretBottom = here.bottom;
      } else {
        let prev = at - 1;
        while (prev >= 0 && text[prev] === "\n") prev -= 1;
        const steps = at - (prev + 1);
        const prevRect = glyph(prev);
        if (prevRect) {
          caretTop = prevRect.top + steps * lineHeight;
          caretBottom = caretTop + lineHeight;
        } else {
          const origin =
            pre.getBoundingClientRect().top +
            (Number.parseFloat(window.getComputedStyle(pre).paddingTop) || 0) -
            pre.scrollTop;
          caretTop = origin + steps * lineHeight;
          caretBottom = caretTop + lineHeight;
        }
      }
      if (caretTop != null && caretBottom != null) {
        next = nextCaretScrollTop(area.scrollTop, viewTop, viewBottom, caretTop, caretBottom);
      }
    }
    if (pos >= area.value.length) {
      const limit = Math.max(0, area.scrollHeight - area.clientHeight);
      if (next < limit) next = limit;
    }
    if (area.scrollTop !== next) area.scrollTop = next;
    pre.scrollTop = area.scrollTop;
  };

  useLayoutEffect(() => {
    revealCaretLine();
    const frame = window.requestAnimationFrame(() => revealCaretLine());
    return () => window.cancelAnimationFrame(frame);
  }, [ccText, caret, suffix]);

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    syncMirror();
    const watch = new ResizeObserver(() => {
      syncMirror();
      revealCaretLine();
    });
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
      revealCaretLine();
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
      <div className="relative min-h-0 flex-1">
        <pre
          ref={preRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre-wrap break-words p-0.5"
          style={{ ...textStyle, color: HIS.ccText }}
        >
          {mirrorBody(ccText)}
          <span style={{ color: "#9a86b0", fontWeight: 500 }}>{suffix}</span>
        </pre>
        <textarea
          ref={areaRef}
          className="absolute inset-0 h-full w-full resize-none border-0 bg-transparent p-0.5 focus:outline-none"
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
              revealCaretLine();
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
