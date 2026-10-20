import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { printToNamedPrinter } from "@/api/clinicApi";
import { HIS_FONT } from "@/lib/hisTheme";
import { bindPrintPreview, previewSheetMarkup, type PrintSendResult } from "@/lib/printJob";
import { feedLabel } from "@/lib/printSettings";

type Req = {
  title: string;
  html: string;
  printerName: string;
  widthMm: number;
  heightMm: number;
  feed?: "portrait" | "landscape";
  resolve: (result: PrintSendResult) => void;
  reject: (err: Error) => void;
};

function downloadHtml(title: string, html: string) {
  const name = (title || "preview").replace(/[\\/:*?"<>|]/g, "_");
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name + ".html";
  a.click();
  URL.revokeObjectURL(url);
}

function PreviewSheet({ req }: { req: Req }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, (req.html.match(/class="slip-page"/g) || []).length);
  const pageCountRef = useRef(pageCount);
  pageCountRef.current = pageCount;
  const pxW = (req.widthMm / 25.4) * 96;
  const pxH = (req.heightMm / 25.4) * 96;
  const frameH = pxH * pageCount;
  const pageSafe = Math.min(page, pageCount - 1);

  useEffect(() => {
    setPage(0);
  }, [req.html]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const w = Math.max(40, el.clientWidth - 24);
      const h = Math.max(40, el.clientHeight - (pageCount > 1 ? 36 : 12));
      setScale(Math.min(w / pxW, h / pxH));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pxW, pxH, pageCount]);

  useEffect(() => {
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
  }, [req.html]);

  return (
    <div
      ref={stageRef}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      style={{ background: "#5E5E5E" }}
    >
      {pageCount > 1 ? (
        <div className="shrink-0 px-3 pt-2 text-center font-mono text-[12px] font-bold text-white">
          {"\u9801\u6b21: "}
          {pageSafe + 1} / {pageCount}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div style={{ width: pxW * scale, height: pxH * scale, overflow: "hidden" }}>
          <div
            className="his-paper"
            style={{
              width: pxW,
              height: frameH,
              background: "#ffffff",
              color: "#000000",
              transform: `scale(${scale}) translateY(-${pageSafe * pxH}px)`,
              transformOrigin: "top left",
              boxShadow: "0 8px 24px rgba(0,0,0,.45)",
              overflow: "hidden",
            }}
            dangerouslySetInnerHTML={{ __html: previewSheetMarkup(req.html) }}
          />
        </div>
      </div>
    </div>
  );
}

function PreviewWindow({ req, onClose }: { req: Req; onClose: () => void }) {
  const [hint, setHint] = useState("\u5148\u770b\u9810\u89bd\u3002\u78ba\u5b9a\u5f8c\u518d\u6309\u9019\u88e1\u7684\u300c\u5217\u5370\u300d\u624d\u6703\u9001\u51fa\u53bb\u3002");
  const settled = useRef(false);
  const openedAt = useRef(Date.now());
  const sentName = useRef("");
  const aliveRef = useRef(true);
  const printer = req.printerName || "\u9019\u4e00\u5217\u9084\u6c92\u9078\u5370\u8868\u6a5f";

  const finish = (result: PrintSendResult) => {
    if (settled.current) return;
    settled.current = true;
    req.resolve(result);
  };

  const close = () => {
    finish({ printed: !!sentName.current, printer: sentName.current });
    onClose();
  };

  const save = () => {
    downloadHtml(req.title, req.html);
    setHint("\u5df2\u5b58\u6a94\u3002\u6a94\u6848\u5728\u4e0b\u8f09\u8cc7\u6599\u593e\u3002");
  };

  const print = () => {
    if (!req.printerName) {
      setHint("\u9019\u4e00\u5217\u9084\u6c92\u9078\u5370\u8868\u6a5f\uff0c\u6c92\u6709\u9001\u51fa\u53bb\u3002");
      return;
    }
    const name = req.printerName;
    sentName.current = name;
    setHint("\u5df2\u9001\u51fa\uff0c\u53ef\u6309 Esc \u96e2\u958b\u3002");
    void printToNamedPrinter({
      printerName: name,
      html: req.html,
      widthMm: req.widthMm,
      heightMm: req.heightMm,
      feed: req.feed || "portrait",
    })
      .then((sent) => {
        const shown = sent.printer || name;
        sentName.current = shown;
        if (!aliveRef.current) return;
        setHint("\u5df2\u9001\u5230 " + shown);
      })
      .catch((err: unknown) => {
        if (!aliveRef.current) return;
        const msg = err instanceof Error ? err.message : "\u9001\u5230\u5370\u8868\u6a5f\u5931\u6557";
        setHint(msg);
      });
  };

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        close();
        return;
      }
      if (ev.key !== "p" && ev.key !== "P") return;
      if (ev.repeat) return;
      if (Date.now() - openedAt.current < 700) return;
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      ev.preventDefault();
      ev.stopPropagation();
      print();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return createPortal(
    <div data-print-preview="" className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-2">
      <div
        className="flex h-[min(96vh,900px)] w-[min(98vw,1100px)] flex-col overflow-hidden border border-[#404040]"
        style={{ background: "#D4D0C8", fontFamily: HIS_FONT, boxShadow: "0 8px 32px rgba(0,0,0,.45)" }}
      >
        <header
          className="flex shrink-0 items-center justify-between border-b border-[#808080] px-2 py-1 text-[13px] font-bold text-black"
          style={{ background: "linear-gradient(180deg,#fff,#D4D0C8)" }}
        >
          <span>{"\u5217\u5370\u9810\u89bd\u3000"}{req.title}</span>
          <button type="button" className="px-2" onClick={close}>
            {"\u2715"}
          </button>
        </header>
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[#808080] px-2 py-1">
          <button type="button" className="border border-[#808080] bg-[#E8E8E8] px-3 py-0.5 text-[12px] font-bold" onClick={save}>
            {"\u5b58\u6a94"}
          </button>
          <button
            type="button"
            className="border border-[#404040] bg-[#ffe14a] px-3 py-0.5 text-[12px] font-bold"
            onClick={print}
          >
            <span className="font-mono text-[10px]">P</span> {"\u5217\u5370"}
          </button>
          <button type="button" className="border border-[#808080] bg-[#E8E8E8] px-3 py-0.5 text-[12px] font-bold" onClick={close}>
            Esc {"\u96e2\u958b"}
          </button>
          <span className="ml-2 max-w-[36rem] truncate text-[12px] font-bold text-[#000080]">
            {"\u5370\u8868\u6a5f\uff1a"}{printer}
          </span>
          <span className="font-mono text-[11px] text-black">
            {req.widthMm}{"\u00d7"}{req.heightMm} mm {feedLabel(req.feed)}
          </span>
        </div>
        <PreviewSheet req={req} />
        <footer className="shrink-0 border-t border-[#808080] px-2 py-1 text-[12px] font-bold text-black">{hint}</footer>
      </div>
    </div>,
    document.body,
  );
}

export function PrintPreviewHost() {
  const [req, setReq] = useState<Req | null>(null);
  useEffect(() => bindPrintPreview(setReq), []);
  if (!req) return null;
  return <PreviewWindow req={req} onClose={() => setReq(null)} />;
}
