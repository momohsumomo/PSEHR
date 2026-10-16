import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HIS_FONT } from "@/lib/hisTheme";

export type CatalogDropdownItem = {
  key: string;
  primary: string;
  secondary?: string;
};

type Props = {
  open: boolean;
  anchorEl: HTMLElement | null;
  items: CatalogDropdownItem[];
  activeIndex: number;
  onActiveIndexChange: (i: number) => void;
  onPick: (index: number) => void;
  maxHeight?: number;
};

/** ���I�U�誺²���U�ԡ]�I�����L����^ */
export function CatalogDropdown({
  open,
  anchorEl,
  items,
  activeIndex,
  onActiveIndexChange,
  onPick,
  maxHeight = 220,
}: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorEl) {
      setPos(null);
      return;
    }
    const update = () => {
      const r = anchorEl.getBoundingClientRect();
      setPos({
        left: r.left,
        top: r.bottom + 1,
        width: Math.max(r.width, 240),
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, anchorEl, items.length]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-dd-i="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  if (!open || !pos || items.length === 0) return null;

  return createPortal(
    <ul
      ref={listRef}
      role="listbox"
      className="fixed z-[300] overflow-auto border-2 border-[#003C74] bg-[#FFFFF0] shadow-lg"
      style={{
        left: pos.left,
        top: pos.top,
        width: pos.width,
        maxHeight,
        fontFamily: HIS_FONT,
        fontSize: 12,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <li key={it.key}>
          <button
            type="button"
            role="option"
            data-dd-i={i}
            aria-selected={i === activeIndex}
            className="flex w-full items-baseline gap-2 px-1.5 py-0.5 text-left"
            style={{
              background: i === activeIndex ? "#316AC5" : undefined,
              color: i === activeIndex ? "#fff" : "#000",
            }}
            onMouseEnter={() => onActiveIndexChange(i)}
            onClick={() => onPick(i)}
          >
            <span className="min-w-0 flex-1 truncate font-bold">{it.primary}</span>
            {it.secondary ? (
              <span
                className="shrink-0 font-mono text-[11px] opacity-80"
                style={{ color: i === activeIndex ? "#CFE0FF" : "#004080" }}
              >
                {it.secondary}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>,
    document.body,
  );
}
