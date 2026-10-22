/** Browser print helpers for receipt / drug bag (best-effort). */
import {
  findPrintSetup,
  loadPrintSettings,
  paperCssSize,
  resolveDocPrint,
  setupFeed,
  setupPageCss,
  type PrintDocKind,
  type PrinterFeed,
  type PrintSetupId,
} from "@/lib/printSettings";

export type PrintLine = { label: string; value: string };

export type PrintJob = {
  kind: PrintDocKind;
  title: string;
  clinicName?: string;
  patientName?: string;
  medicalNo?: string;
  lines: PrintLine[];
  bodyHtml?: string;
  /** 院所列印設定的那一列。有設就用該列的長寬。 */
  setupId?: PrintSetupId;
  /** 簡式收據：左右同寬、內容不同。paged：每一段各佔一張紙。sheet：bodyHtml 就是這一張，不再另包標題。 */
  layout?: "simple-split" | "paged" | "sheet";
};

export type PrintSendResult = { printed: boolean; printer: string };

export type PreparedPrint = {
  title: string;
  html: string;
  printerName: string;
  widthMm: number;
  heightMm: number;
  feed: PrinterFeed;
};

type PreviewRequest = PreparedPrint & {
  resolve: (result: PrintSendResult) => void;
  reject: (err: Error) => void;
};

let previewHandler: ((req: PreviewRequest) => void) | null = null;

export function bindPrintPreview(handler: (req: PreviewRequest) => void): () => void {
  previewHandler = handler;
  return () => {
    if (previewHandler === handler) previewHandler = null;
  };
}

export function preparePrint(job: PrintJob): PreparedPrint {
  const settings = loadPrintSettings();
  const resolved = resolveDocPrint(settings, job.kind);
  const setupId =
    job.setupId ||
    (job.kind === "receipt" ? "simple" : job.kind === "bag" ? "bag" : undefined);
  const setup = setupId ? findPrintSetup(settings, setupId) : undefined;
  const paper = setup ? setupPageCss(setup) : paperCssSize(resolved.paper);
  const widthMm = setup?.widthMm || 210;
  const heightMm = setup?.heightMm || 297;
  const insetMm = setup ? Number(setup.insetMm) || 0 : 0;
  const html = buildPrintHtml(
    job,
    paper,
    resolved.fontSizePx,
    resolved.marginMm,
    resolved.paper === "order_dual",
    widthMm,
    heightMm,
    insetMm,
  );
  return {
    title: job.title,
    html,
    printerName: setup?.printerName.trim() || "",
    widthMm,
    heightMm,
    feed: setup ? setupFeed(setup) : "portrait",
  };
}

export function openPrintPreview(job: PrintJob): Promise<PrintSendResult> {
  const prepared = preparePrint(job);
  const pending = new Promise<PrintSendResult>((resolve, reject) => {
    if (!previewHandler) {
      reject(new Error("\u9810\u89bd\u756b\u9762\u9084\u6c92\u6e96\u5099\u597d\u3002\u8acb\u91cd\u65b0\u6574\u7406\u5f8c\u518d\u6309\u5217\u5370\u3002"));
      return;
    }
    previewHandler({ ...prepared, resolve, reject });
  });
  return pending.catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : "\u9001\u5230\u5370\u8868\u6a5f\u5931\u6557";
    window.alert(msg);
    throw err instanceof Error ? err : new Error(msg);
  });
}

function buildPrintHtml(
  job: PrintJob,
  paper: string,
  fontSizePx: number,
  marginMm: number,
  orderDual: boolean,
  widthMm: number,
  heightMm: number,
  insetMm: number,
): string {
  const rows = job.lines
    .map(
      (l) =>
        `<tr><td style="padding:1px 4px;color:#444;width:38%">${escapeHtml(l.label)}</td>` +
        `<td style="padding:1px 4px;font-family:monospace">${escapeHtml(l.value)}</td></tr>`,
    )
    .join("");
  const oneCopy = `<h1>${escapeHtml(job.title)}</h1>
  <div class="meta">${escapeHtml(job.clinicName || "")}</div>
  <div class="meta">${escapeHtml(job.patientName || "")} ${escapeHtml(job.medicalNo || "")}</div>
  <table>${rows}</table>
  <div class="body">${job.bodyHtml || ""}</div>`;
  const ownPage =
    (job.layout === "simple-split" || job.layout === "paged" || job.layout === "sheet") && !!job.bodyHtml;
  const dual = !ownPage && (job.kind === "receipt" || orderDual);
  const body = ownPage
    ? job.bodyHtml || ""
    : dual
      ? `<div class="sheet"><section class="half">${oneCopy}</section><section class="half">${oneCopy}</section></div>`
      : oneCopy;
  const lockOnePage = job.layout === "simple-split" || job.layout === "sheet";
  const paged = job.layout === "paged";
  const pageSize = paper.trim().split(/\s+/);
  const pageW = pageSize[0] || "210mm";
  const pageH = pageSize[1] || "297mm";
  const pageMargin = lockOnePage || paged ? 0 : marginMm;
  const pageBox = lockOnePage
    ? `width:${pageW};height:${pageH};overflow:hidden;`
    : "";
  const pagedCss = paged
    ? `.slip-page{box-sizing:border-box;width:${pageW};height:${pageH};margin:0;padding:0;overflow:hidden;display:flex;flex-direction:column;break-after:page;page-break-after:always;}
  .slip-page:last-child{break-after:auto;page-break-after:auto;}`
    : "";
  const minSide = Math.min(widthMm, heightMm);
  const canInset =
    (lockOnePage || paged) &&
    insetMm > 0 &&
    minSide > insetMm * 2 + 8 &&
    pageW.endsWith("mm") &&
    pageH.endsWith("mm");
  const fitCss = canInset
    ? `.slip-page{box-sizing:border-box !important;width:calc(${pageW} - ${insetMm * 2}mm) !important;height:calc(${pageH} - ${insetMm * 2}mm) !important;margin:${insetMm}mm !important;}`
    : "";
  return `<!doctype html><html style="color-scheme:only light;background:#fff;color:#000;forced-color-adjust:none"><head><meta charset="utf-8"/>
<meta name="color-scheme" content="only light"/>
<title>${escapeHtml(job.title)}</title>
<style>
  @page { size: ${paper}; margin: ${pageMargin}mm; }
  html { color-scheme: only light; }
  html, body {
    margin: 0; padding: 0; ${pageBox}
    background: #fff !important; color: #000 !important;
    forced-color-adjust: none;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  body { font-family: "Microsoft JhengHei", sans-serif; font-size: ${fontSizePx}px; }
  .slip-page { background: #fff; color: #000; }
  h1 { font-size: ${fontSizePx + 2}px; margin: 0 0 4px; }
  .meta { color: #555; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; }
  .body { margin-top: 6px; white-space: pre-wrap; }
  .sheet { display: flex; gap: 3mm; align-items: stretch; }
  .half { flex: 1 1 0; border: 1px dashed #666; padding: 2mm; box-sizing: border-box; }
  ${pagedCss}
  ${fitCss}
</style></head><body>
  ${body}
</body></html>`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Draw the slip inside this page. A separate frame gets repainted by Chrome dark mode. */
export function previewSheetMarkup(html: string): string {
  const raw = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi))
    .map((match) => match[1])
    .join("\n");
  const styles = raw.replace(/([^{}@]+)\{/g, (match, selector: string) => {
    const trimmed = selector.trim();
    if (!trimmed || trimmed.startsWith("@")) return match;
    const scoped = trimmed
      .split(",")
      .map((part) => {
        const one = part.trim().replace(/^(html|body)\b/, ".his-paper");
        return one.startsWith(".his-paper") ? one : `.his-paper ${one}`;
      })
      .join(",");
    return `${scoped}{`;
  });
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return `<style>${styles}</style>${body ? body[1] : html}`;
}
