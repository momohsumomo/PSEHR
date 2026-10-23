const CHART_DRAFT_KEY = "psehr.chartDrafts.v1";

/** Drop one visit's unsaved screen copy. The chart on disk is unchanged. */
export function dropChartDraft(encounterId: string): void {
  const id = (encounterId || "").trim();
  if (!id) return;
  try {
    const raw = localStorage.getItem(CHART_DRAFT_KEY);
    if (!raw) return;
    const all = JSON.parse(raw) as Record<string, unknown>;
    if (!all || typeof all !== "object" || !(id in all)) return;
    delete all[id];
    localStorage.setItem(CHART_DRAFT_KEY, JSON.stringify(all));
  } catch {
    /* this computer could not update the draft */
  }
}
