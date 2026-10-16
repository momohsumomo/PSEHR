import { useEffect, type RefObject } from "react";
import {
  isListNavKey,
  isPageListNavKey,
  listPageSize,
  scrollListToIndex,
  stepListIndex,
  type ListNavKey,
} from "@/lib/listNav";

type Options = {
  /** When false, keys and the wheel do not move this list. */
  active: boolean;
  length: number;
  index: number;
  onIndex: (index: number) => void;
  scrollerRef: RefObject<HTMLElement | null>;
  /** Fixed row height for virtual lists that do not render every row. */
  rowPx?: number;
  /** Only this subtree receives keys. The wheel still follows the scroller. */
  scopeRef?: RefObject<HTMLElement | null>;
  /** Arrow / Page / Home / End still move the list while an input is focused. */
  moveWhileTyping?: boolean;
  /** How many rows one wheel notch moves. */
  wheelRows?: number;
};

function typingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** Arrow keys, Page Up/Down, Home, End, and the wheel move the highlighted row. */
export function useListNav({
  active,
  length,
  index,
  onIndex,
  scrollerRef,
  rowPx,
  scopeRef,
  moveWhileTyping = false,
  wheelRows = 1,
}: Options): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (ev: KeyboardEvent) => {
      if (!isListNavKey(ev.key)) return;
      const scope = scopeRef?.current;
      const focused = document.activeElement;
      if (scope) {
        const target = ev.target as Node | null;
        const inside =
          (!!target && scope.contains(target)) || (!!focused && scope.contains(focused));
        if (!inside) return;
      } else if (focused instanceof HTMLElement) {
        const owner = focused.closest("[data-list-scope]");
        if (owner && owner !== scrollerRef.current) return;
      }
      if (typingTarget(ev.target) && !moveWhileTyping && !isPageListNavKey(ev.key)) return;
      if (length <= 0) return;
      ev.preventDefault();
      const scroller = scrollerRef.current;
      const next = stepListIndex(ev.key, index, length, listPageSize(scroller, rowPx));
      if (next !== index) onIndex(next);
      if (scroller) scrollListToIndex(scroller, next, ev.key as ListNavKey, rowPx, index);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, index, length, moveWhileTyping, onIndex, rowPx, scopeRef, scrollerRef]);

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || !active) return;
    const onWheel = (ev: WheelEvent) => {
      if (length <= 0) return;
      if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
        root.scrollLeft += ev.deltaX;
        return;
      }
      const hop = Math.max(1, wheelRows);
      const step = ev.deltaY > 0 ? hop : ev.deltaY < 0 ? -hop : 0;
      if (!step) return;
      ev.preventDefault();
      const next =
        index < 0
          ? step > 0
            ? 0
            : length - 1
          : Math.min(length - 1, Math.max(0, index + step));
      if (next !== index) onIndex(next);
      scrollListToIndex(root, next, step > 0 ? "ArrowDown" : "ArrowUp", rowPx, index);
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [active, index, length, onIndex, rowPx, scrollerRef, wheelRows]);
}
