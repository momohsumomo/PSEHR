import { useEffect, useState } from "react";

/** A note that stays until the next click or key, then goes away. */
export function useFlashNote() {
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!note) return;
    const clear = () => setNote("");
    const id = window.setTimeout(() => {
      window.addEventListener("pointerdown", clear, true);
      window.addEventListener("keydown", clear, true);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("pointerdown", clear, true);
      window.removeEventListener("keydown", clear, true);
    };
  }, [note]);
  return [note, setNote] as const;
}
