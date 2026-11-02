import { useEffect } from "react";

/** Closing the window or tab asks first. The browser shows its own wording and ignores custom text. */
export function useLeaveGuard(on = true): void {
  useEffect(() => {
    if (!on) return;
    const ask = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
      ev.returnValue = "";
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [on]);
}
