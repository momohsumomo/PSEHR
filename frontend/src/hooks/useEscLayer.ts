import { useEffect, useRef } from "react";

export type EscLayer = { open: boolean; close: () => void };

type OpenLayer = { open: boolean; close: () => void; stamp: number };
type StackEntry = { id: number; getLayers: () => OpenLayer[] };

let nextId = 1;
let stampSeq = 1;
const stack: StackEntry[] = [];
let listening = false;

function onEscape(ev: KeyboardEvent) {
  if (ev.key !== "Escape") return;
  if (ev.isComposing || ev.keyCode === 229) return;
  if (document.querySelector("[data-print-preview]")) return;
  let best: OpenLayer | null = null;
  for (const entry of stack) {
    for (const layer of entry.getLayers()) {
      if (!layer.open || layer.stamp <= 0) continue;
      if (!best || layer.stamp > best.stamp) best = layer;
    }
  }
  if (!best) return;
  ev.preventDefault();
  ev.stopPropagation();
  ev.stopImmediatePropagation();
  best.close();
}

function ensureListener() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("keydown", onEscape, true);
}

/**
 * Call with ordered closers: first open overlay in this group wins when they open together.
 * A dialog that opens later closes before the page under it.
 */
export function popEscLayer(layers: EscLayer[]): boolean {
  const hit = layers.find((l) => l.open);
  if (!hit) return false;
  hit.close();
  return true;
}

/** Escape closes only the topmost open step. List the deepest step first. */
export function useEscLayer(layers: EscLayer[], enabled = true): void {
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const prevOpen = useRef<boolean[]>([]);
  const stamps = useRef<number[]>([]);
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const open = Boolean(layers[i]?.open);
    if (open && !prevOpen.current[i]) stamps.current[i] = stampSeq++;
    if (!open) stamps.current[i] = 0;
    prevOpen.current[i] = open;
  }
  if (stamps.current.length > layers.length) {
    stamps.current.length = layers.length;
    prevOpen.current.length = layers.length;
  }

  useEffect(() => {
    if (!enabled) return;
    ensureListener();
    const id = nextId;
    nextId += 1;
    const entry: StackEntry = {
      id,
      getLayers: () =>
        layersRef.current.map((layer, i) => ({
          open: layer.open,
          close: layer.close,
          stamp: stamps.current[i] || 0,
        })),
    };
    stack.push(entry);
    return () => {
      const idx = stack.findIndex((item) => item.id === id);
      if (idx >= 0) stack.splice(idx, 1);
    };
  }, [enabled]);
}
