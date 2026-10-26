/** What the open chart may show for the encounter that is selected right now. */

export type ChartDraftBody = {
  cc: string;
  dx: unknown[];
  rx: unknown[];
  /** Present only when this draft was saved for this encounter id. */
  bound?: string;
};

export function textForEncounter(slotId: string, selectedId: string, text: string): string {
  return slotId === selectedId ? text : "";
}

export function overlayForEncounter<T>(slotId: string, selectedId: string, value: T | null): T | null {
  return slotId === selectedId ? value : null;
}

/**
 * A loaded chart shows that encounter's saved ¥D¶D, including a blank one.
 * A draft is shown only when this visit is still unfinished and the draft
 * was written for this same encounter. Older drafts without that mark are dropped.
 */
export function chartPaint(input: {
  finished: boolean;
  serverCc: string;
  selectedId: string;
  draft: ChartDraftBody | null;
}): { cc: string; restoreDraft: boolean; dropDraft: boolean } {
  const draft = input.draft;
  const own =
    !input.finished &&
    !!draft &&
    draft.bound === input.selectedId &&
    Boolean((draft.cc || "").trim() || draft.dx.length || draft.rx.length);
  if (own && draft) return { cc: draft.cc, restoreDraft: true, dropDraft: false };
  return { cc: input.serverCc, restoreDraft: false, dropDraft: draft != null };
}
