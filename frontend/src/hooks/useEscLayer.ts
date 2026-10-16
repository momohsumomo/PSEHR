import { useEffect, useRef } from "react";

export type EscLayer = { open: boolean; close: () => void };

type StackEntry = { id: number; getLayers: () => EscLayer[] };

let nextId = 1;
const stack: StackEntry[] = [];
let listening = false;

function onEscape(ev: KeyboardEvent) {
  if (ev.key !== "Escape") return;
  if (document.querySelector("[data-print-preview]")) return;
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const hit = stack[i].getLayers().find((layer) => layer.open);
    if (!hit) continue;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    hit.close();
    return;
  }
}

function ensureListener() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("keydown", onEscape, true);
}

/**
 * Call with ordered closers: first open overlay in this group wins.
 * A group mounted later (a dialog on top) is closed before the page under it.
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
  const openSig = layers.map((layer) => (layer.open ? "1" : "0")).join("");

  useEffect(() => {
    if (!enabled) return;
    ensureListener();
    const id = nextId;
    nextId += 1;
    const entry: StackEntry = { id, getLayers: () => layersRef.current };
    stack.push(entry);
    return () => {
      const idx = stack.findIndex((item) => item.id === id);
      if (idx >= 0) stack.splice(idx, 1);
    };
  }, [enabled, openSig]);
}
