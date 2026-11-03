/** What the open chart may show for the encounter that is selected right now. */

export type ChartDraftBody = {
  cc: string;
  dx: unknown[];
  rx: unknown[];
  /** Present only when this draft was saved for this encounter id. */
  bound?: string;
  /** Saved dx/rx on the server when the draft was held; see serverChartSig. */
  base?: string;
};

type SigDx = { icd10?: string; nhiIcd10?: string; text?: string };
type SigRx = { nhiCode?: string; name?: string; qty?: number | string; days?: number | string };

/** Saved diagnoses and orders as the server returned them. */
export function serverChartSig(dx: readonly SigDx[], rx: readonly SigRx[]): string {
  return JSON.stringify({
    dx: dx.map((d) => (d.nhiIcd10 || d.icd10 || d.text || "").trim()),
    rx: rx.map((r) => `${(r.nhiCode || r.name || "").trim()}|${r.qty ?? ""}|${r.days ?? ""}`),
  });
}

const EMPTY_SIG = serverChartSig([], []);

export function textForEncounter(slotId: string, selectedId: string, text: string): string {
  return slotId === selectedId ? text : "";
}

export function overlayForEncounter<T>(slotId: string, selectedId: string, value: T | null): T | null {
  return slotId === selectedId ? value : null;
}

/**
 * A loaded chart shows that encounter's saved ùDùD, including a blank one.
 * A draft is shown only when this visit is still unfinished and the draft
 * was written for this same encounter. Older drafts without that mark are dropped.
 */
export function chartPaint(input: {
  finished: boolean;
  serverCc: string;
  selectedId: string;
  draft: ChartDraftBody | null;
  serverSig: string;
}): { cc: string; restoreDraft: boolean; dropDraft: boolean } {
  const draft = input.draft;
  // Another PC may have saved the visit after this draft was held; its saved chart wins.
  const serverUnchanged =
    !!draft && (draft.base !== undefined ? draft.base === input.serverSig : input.serverSig === EMPTY_SIG);
  const own =
    !input.finished &&
    !!draft &&
    draft.bound === input.selectedId &&
    serverUnchanged &&
    Boolean((draft.cc || "").trim() || draft.dx.length || draft.rx.length);
  if (own && draft) return { cc: draft.cc, restoreDraft: true, dropDraft: false };
  return { cc: input.serverCc, restoreDraft: false, dropDraft: draft != null };
}
