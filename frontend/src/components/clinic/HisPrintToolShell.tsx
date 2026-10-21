import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { fetchThisPcPrinters, printToNamedPrinter } from "@/api/clinicApi";
import { HIS_FONT } from "@/lib/hisTheme";
import { loadPrinterFeed, savePrinterFeed, type PrinterFeed } from "@/lib/printSettings";
import {
  coerceHisPaperId,
  resolveHisPaper,
  type HisPaperId,
} from "@/lib/hisPaper";

export type HisPrintToolAction =
  | "print"
  | "saveText"
  | "saveExcel"
  | "prevPage"
  | "nextPage"
  | "zoomIn"
  | "zoomOut"
  | "zoom100"
  | "close";

/** @deprecated 用 HisPaperId；保留舊字串相容 */
export type HisPaperKind = "A4" | "A5" | "slip" | HisPaperId;

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  exportText?: string;
  exportCsv?: string;
  /** Real xlsx bytes. When set, \u8f49Excel downloads this instead of a csv. */
  exportXlsx?: Uint8Array;
  fileBaseName?: string;
  /** Window chrome size (almost fullscreen for reports). */
  size?: "report" | "slip" | "wide";
  /**
   * 紙張設定檔：A4 直／橫、ORDER 左右雙欄、掛號簿橫式…（見 hisPaper.ts）
   * 舊值 "A4"|"A5"|"slip" 仍可傳。
   */
  paper?: HisPaperKind;
  statusText?: string;
  disabledActions?: Partial<Record<HisPrintToolAction, boolean>>;
  /**
   * 已切好的頁（例如現金帳明細）。有傳時上頁／下頁換這一頁，列印印出每一頁。
   * 沒傳時依紙張高度把整份內容往下翻。
   */
  pages?: ReactNode[];
};

const TOOLS: { id: HisPrintToolAction; label: string }[] = [
  { id: "saveText", label: "存檔" },
  { id: "print", label: "列印" },
  { id: "saveExcel", label: "轉Excel" },
  { id: "zoomOut", label: "縮小" },
  { id: "zoom100", label: "100%" },
  { id: "zoomIn", label: "放大" },
  { id: "prevPage", label: "上頁" },
  { id: "nextPage", label: "下頁" },
  { id: "close", label: "離開" },
];

function downloadBlob(filename: string, mime: string, body: BlobPart) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function showPage(node: ReactNode): ReactNode {
  return isValidElement(node) ? cloneElement(node) : node;
}

function shellClass(size: Props["size"], landscape: boolean): string {
  if (size === "slip") return "w-[min(36rem,96vw)] h-[min(40rem,94vh)]";
  if (landscape) return "w-[min(98vw,1280px)] h-[min(96vh,820px)]";
  return "w-[min(96vw,1100px)] h-[min(96vh,900px)]";
}

/**
 * 醫聖預覽列印殼：灰舞台 + 依報表紙張設定檔的白紙比例（可橫／可訂製，非固定 A4）。
 */
export function HisPrintToolShell({
  open,
  title,
  onClose,
  children,
  exportText = "",
  exportCsv = "",
  exportXlsx,
  fileBaseName = "wundadi-print",
  size = "wide",
  paper = "a4",
  statusText,
  disabledActions,
  pages,
}: Props) {
  const paperRef = useRef<HTMLDivElement>(null);
  const aliveRef = useRef(true);
  const innerRef = useRef<HTMLDivElement>(null);
  const printRootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const paperId = coerceHisPaperId(paper);
  const profile = resolveHisPaper(paperId);
  const landscape = profile.widthMm > profile.heightMm;
  const [zoom, setZoom] = useState(profile.defaultZoom);
  const [page, setPage] = useState(0);
  const [hint, setHint] = useState("");
  const [printerName, setPrinterName] = useState("");
  const [feed, setFeed] = useState<PrinterFeed | "">("");
  const [fitPages, setFitPages] = useState(1);
  const [viewH, setViewH] = useState(0);
  const explicit = !!pages && pages.length > 0;

  const scale = zoom / 100;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setZoom(profile.defaultZoom);
    setPage(0);
    setHint("");
    void fetchThisPcPrinters().then((rows) => {
      const named =
        rows.find((row) => row.default && row.device !== false && row.name) ||
        rows.find((row) => row.default && row.name) ||
        rows.find((row) => row.device && row.name);
      const name = named?.name || "";
      setPrinterName(name);
      setFeed(name ? loadPrinterFeed(name) : "");
    });
  }, [open, title, profile.defaultZoom, paperId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useLayoutEffect(() => {
    if (!open || explicit) return;
    const paperEl = paperRef.current;
    const inner = innerRef.current;
    if (!paperEl || !inner) return;
    const cs = getComputedStyle(paperEl);
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const view = Math.max(1, paperEl.clientHeight - pad);
    const n = inner.scrollHeight <= view + 2 ? 1 : Math.ceil(inner.scrollHeight / view);
    setViewH(view);
    setFitPages(n);
    setPage((p) => Math.min(p, n - 1));
  }, [open, explicit, children, zoom, paperId, title]);

  const pageCount = explicit ? pages!.length : Math.max(1, fitPages);
  const pageSafe = Math.min(page, pageCount - 1);
  const pageCountRef = useRef(pageCount);
  pageCountRef.current = pageCount;

  useEffect(() => {
    if (!open) return;
    const el = stageRef.current;
    if (!el) return;
    let acc = 0;
    let lockedUntil = 0;
    const onWheel = (ev: WheelEvent) => {
      if (pageCountRef.current <= 1) return;
      ev.preventDefault();
      const now = Date.now();
      if (now < lockedUntil) return;
      acc += ev.deltaY;
      if (Math.abs(acc) < 30) return;
      const dir = acc > 0 ? 1 : -1;
      acc = 0;
      lockedUntil = now + 140;
      setPage((p) => Math.min(pageCountRef.current - 1, Math.max(0, p + dir)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open]);

  if (!open) return null;

  const run = (id: HisPrintToolAction) => {
    if (disabledActions?.[id] && id !== "close") {
      setHint("此動作尚未接（按鈕位保留）。");
      return;
    }
    if (id === "close") {
      onClose();
      return;
    }
    if (id === "zoomIn") {
      setZoom((z) => Math.min(140, z + 10));
      return;
    }
    if (id === "zoomOut") {
      setZoom((z) => Math.max(50, z - 10));
      return;
    }
    if (id === "zoom100") {
      setZoom(100);
      return;
    }
    if (id === "prevPage") {
      if (pageCount <= 1) {
        setHint("本預覽 1 頁。");
        return;
      }
      setPage((p) => Math.max(0, p - 1));
      return;
    }
    if (id === "nextPage") {
      if (pageCount <= 1) {
        setHint("已經無下一頁。");
        return;
      }
      setPage((p) => Math.min(pageCount - 1, p + 1));
      return;
    }
    if (id === "saveText") {
      const body = exportText || paperRef.current?.innerText || "";
      if (!body.trim()) {
        setHint("沒有可存的內容。");
        return;
      }
      downloadBlob(`${fileBaseName}.txt`, "text/plain;charset=utf-8", body);
      setHint(`已下載 ${fileBaseName}.txt`);
      return;
    }
    if (id === "saveExcel") {
      if (exportXlsx && exportXlsx.length) {
        downloadBlob(
          `${fileBaseName}.xlsx`,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          exportXlsx,
        );
        setHint(`\u5df2\u4e0b\u8f09 ${fileBaseName}.xlsx`);
        return;
      }
      const body = exportCsv || exportText || paperRef.current?.innerText || "";
      if (!body.trim()) {
        setHint("\u6c92\u6709\u53ef\u532f\u51fa\u7684\u5167\u5bb9\u3002");
        return;
      }
      downloadBlob(`${fileBaseName}.csv`, "text/csv;charset=utf-8", "\uFEFF" + body);
      setHint(`\u5df2\u4e0b\u8f09 ${fileBaseName}.csv\uff08Excel \u53ef\u958b\uff09`);
      return;
    }
    if (id === "print") {
      const el = paperRef.current;
      if (!el) return;
      const bodyHtml = explicit
        ? printRootRef.current?.innerHTML || ""
        : innerRef.current?.innerHTML || el.innerHTML;
      const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title>
<style>
  @page { size: ${profile.pageCss}; margin: ${profile.padYMm}mm ${profile.padXMm}mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: "Consolas","Microsoft JhengHei",monospace; font-size: 11pt; color:#000; }
  table { border-collapse: collapse; width: 100%; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  td, th { padding: 1px 2px; }
  .wundadi-print-page { break-after: page; page-break-after: always; }
  .wundadi-print-page:last-child { break-after: auto; page-break-after: auto; }
</style></head><body>${bodyHtml}</body></html>`;
      const widthMm = profile.widthMm;
      const heightMm = profile.heightMm;
      if (!printerName) {
        setHint("\u9019\u53f0\u96fb\u8166\u9084\u6c92\u6709\u9810\u8a2d\u5370\u8868\u6a5f\u3002");
        return;
      }
      const job = {
        printerName,
        html,
        widthMm,
        heightMm,
        feed,
      };
      setHint("\u6b63\u5728\u9001\u5230\u9019\u53f0\u7684\u5370\u8868\u6a5f\u2026");
      void printToNamedPrinter(job)
        .then((sent) => {
          if (!aliveRef.current) return;
          setHint(
            "\u5df2\u9001\u5230 " +
              (sent.printer || printerName) +
              "\uff08" +
              profile.label +
              " " +
              widthMm +
              "\u00d7" +
              heightMm +
              "mm\uff09\u3002",
          );
        })
        .catch((err: unknown) => {
          if (!aliveRef.current) return;
          const msg = err instanceof Error ? err.message : "\u9001\u5230\u5370\u8868\u6a5f\u5931\u6557";
          setHint(msg);
        });
    }
  };

  const layoutW = `${profile.widthMm * scale}mm`;
  const layoutH = `${profile.heightMm * scale}mm`;

  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 p-1">
      <div
        className={`flex flex-col overflow-hidden border border-[#404040] ${shellClass(size, landscape)}`}
        style={{ background: "#D4D0C8", fontFamily: HIS_FONT, boxShadow: "0 8px 32px rgba(0,0,0,.45)" }}
      >
        <header
          className="flex shrink-0 items-center justify-between border-b border-[#808080] px-2 py-0.5 text-[12px] font-bold"
          style={{ background: "linear-gradient(180deg,#fff,#D4D0C8)" }}
        >
          <span className="text-black">{title}</span>
          <button type="button" className="px-1 text-black" onClick={onClose}>
            {"\u2715"}
          </button>
        </header>

        <div
          className="flex shrink-0 gap-3 border-b border-[#808080] px-2 py-0.5 text-[11px] text-black"
          style={{ background: "#D4D0C8" }}
        >
          <span>檔案(F)</span>
          <span>頁面(P)</span>
        </div>

        <div
          className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[#808080] px-1.5 py-1"
          style={{ background: "#D4D0C8" }}
        >
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="border border-[#808080] bg-[#E8E8E8] px-2 py-0.5 text-[11px] font-bold text-black hover:bg-[#F5F5F5]"
              style={{ fontFamily: HIS_FONT }}
              onClick={() => run(t.id)}
            >
              {t.label}
            </button>
          ))}
          <span className="ml-2 font-mono text-[11px] text-[#000080]">
            頁次: {pageSafe + 1} / {pageCount}
          </span>
          <span className="font-mono text-[11px] text-[#000080]">{zoom}%</span>
          <span className="ml-auto flex items-center gap-1">
            <span className="max-w-[10rem] truncate font-mono text-[10px] text-[#333]">{printerName || "\u9810\u8a2d\u5370\u8868\u6a5f"}</span>
            {(
              [
                ["", "\u8ddf\u7d19\u5f35"],
                ["portrait", "\u76f4\u5411\u9032\u7d19"],
                ["landscape", "\u6a6b\u5411\u9032\u7d19"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                className="border border-[#808080] px-1.5 py-0.5 text-[11px] font-bold text-black"
                style={{ background: feed === value ? "#FFF3C4" : "#E8E8E8", fontFamily: HIS_FONT }}
                onClick={() => {
                  const next = value;
                  setFeed(next);
                  if (printerName) savePrinterFeed(printerName, next);
                }}
              >
                {label}
              </button>
            ))}
          </span>
        </div>

        {explicit ? (
          <div
            ref={printRootRef}
            aria-hidden
            style={{ display: "none" }}
          >
            {pages!.map((node, i) => (
              <div key={i} className="wundadi-print-page">
                {showPage(node)}
              </div>
            ))}
          </div>
        ) : null}

        <div
          ref={stageRef}
          className={`min-h-0 flex-1 ${pageCount > 1 ? "overflow-hidden" : "overflow-auto"}`}
          style={{
            background: "linear-gradient(180deg,#7A7A7A,#5E5E5E)",
            boxShadow: "inset 0 2px 8px rgba(0,0,0,.35)",
          }}
        >
          <div className="flex justify-center px-4 py-6">
            <div style={{ width: layoutW, height: layoutH, position: "relative" }}>
              <div
                ref={paperRef}
                className="his-paper bg-white text-black"
                style={{
                  width: `${profile.widthMm}mm`,
                  height: `${profile.heightMm}mm`,
                  padding: `${profile.padYMm}mm ${profile.padXMm}mm`,
                  boxSizing: "border-box",
                  overflow: "hidden",
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                  boxShadow: "0 1px 0 #fff inset, 0 0 0 1px #9a9a9a, 4px 6px 18px rgba(0,0,0,.55)",
                  fontFamily: "Consolas, 'Courier New', " + HIS_FONT,
                  fontSize: 12,
                  position: "absolute",
                  left: 0,
                  top: 0,
                }}
              >
                {explicit ? (
                  showPage(pages![pageSafe])
                ) : (
                  <div
                    ref={innerRef}
                    style={
                      pageSafe > 0 && viewH > 0
                        ? { transform: `translateY(-${pageSafe * viewH}px)` }
                        : undefined
                    }
                  >
                    {children}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <footer
          className="flex shrink-0 items-center border-t border-[#808080] px-2 py-0.5 text-[11px] text-black"
          style={{ background: "#D4D0C8" }}
        >
          <span className="min-w-0 flex-1 truncate">{hint || statusText || "Preview."}</span>
          <span className="font-mono text-[10px] text-[#404040]">
            {profile.label} {profile.widthMm}×{profile.heightMm}mm
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
