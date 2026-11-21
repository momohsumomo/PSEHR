import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { HIS, HIS_FONT } from "@/lib/hisTheme";
import { INTAKE_PCT_DEFAULT, clampIntakePct, loadIntakePct, saveIntakePct } from "@/lib/chartSplit";

const COSMETIC_BG = "#FDE4EF";
const MEDICAL_BG = "#EEF4FA";

/**
 * Waiting-room intake beside the chief complaint. Read only: it is not the chief complaint,
 * is not saved with it and is not printed.
 */
export function PrevisitSplit({
  text,
  cosmetic,
  children,
}: {
  text: string;
  cosmetic: boolean;
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(loadIntakePct);

  const startDrag = useCallback(
    (ev: ReactMouseEvent) => {
      const row = rowRef.current;
      if (!row) return;
      ev.preventDefault();
      const box = row.getBoundingClientRect();
      let last = pct;
      const move = (e: MouseEvent) => {
        last = clampIntakePct(((box.right - e.clientX) / box.width) * 100);
        setPct(last);
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        document.body.style.cursor = "";
        saveIntakePct(last);
      };
      document.body.style.cursor = "col-resize";
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [pct],
  );

  if (!text.trim()) return <>{children}</>;

  return (
    <div ref={rowRef} className="absolute inset-0 flex min-w-0">
      <div className="relative h-full min-w-0 flex-1">{children}</div>
      <div
        className="w-1 shrink-0 cursor-col-resize bg-[#ACA899] hover:bg-[#0A5AD6]"
        title={"\u62d6\u66f3\u8abf\u6574\u5bec\u5ea6\uff0c\u9019\u53f0\u96fb\u8166\u6703\u8a18\u4f4f\u3002\u96d9\u64ca\u9084\u539f\u3002"}
        onMouseDown={startDrag}
        onDoubleClick={() => {
          setPct(INTAKE_PCT_DEFAULT);
          saveIntakePct(INTAKE_PCT_DEFAULT);
        }}
      />
      <section
        className="flex h-full min-w-0 shrink-0 flex-col overflow-hidden p-0.5"
        style={{
          width: `${pct}%`,
          background: cosmetic ? COSMETIC_BG : MEDICAL_BG,
          border: `1px solid ${HIS.chromeDark}`,
          fontFamily: HIS_FONT,
        }}
        aria-label={"\u5019\u8a3a\u9810\u554f\u8a3a"}
      >
        <div className="shrink-0 leading-none" style={{ fontSize: HIS.fs.tertiary, color: "#555555" }}>
          {cosmetic ? "\u9810\u554f\u8a3a\uff08\u91ab\u7f8e\uff09" : "\u9810\u554f\u8a3a"}
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words"
          style={{ fontSize: HIS.fs.body, lineHeight: 1.25, color: "#102030" }}
        >
          {text}
        </div>
      </section>
    </div>
  );
}
