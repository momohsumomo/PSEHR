const RAIL_KEY = "wundadi.chart.railPct";

export const RAIL_PCT_DEFAULT = 35;

export function clampRailPct(value: number): number {
  if (!Number.isFinite(value)) return RAIL_PCT_DEFAULT;
  return Math.min(65, Math.max(15, Math.round(value * 10) / 10));
}

export function loadRailPct(): number {
  try {
    const raw = window.localStorage.getItem(RAIL_KEY);
    return raw ? clampRailPct(Number(raw)) : RAIL_PCT_DEFAULT;
  } catch {
    return RAIL_PCT_DEFAULT;
  }
}

export function saveRailPct(value: number): void {
  try {
    window.localStorage.setItem(RAIL_KEY, String(clampRailPct(value)));
  } catch {
    // Private mode or full storage: the split just resets next time.
  }
}

const INTAKE_KEY = "wundadi.chart.intakePct";

/** Width of the waiting-room intake box, as a share of the chief complaint row. */
export const INTAKE_PCT_DEFAULT = 33;

export function clampIntakePct(value: number): number {
  if (!Number.isFinite(value)) return INTAKE_PCT_DEFAULT;
  return Math.min(60, Math.max(12, Math.round(value * 10) / 10));
}

export function loadIntakePct(): number {
  try {
    const raw = window.localStorage.getItem(INTAKE_KEY);
    return raw ? clampIntakePct(Number(raw)) : INTAKE_PCT_DEFAULT;
  } catch {
    return INTAKE_PCT_DEFAULT;
  }
}

export function saveIntakePct(value: number): void {
  try {
    window.localStorage.setItem(INTAKE_KEY, String(clampIntakePct(value)));
  } catch {
    // Private mode or full storage: the split just resets next time.
  }
}
