import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { printToNamedPrinter } from "@/api/clinicApi";
import { HIS_FONT } from "@/lib/hisTheme";
import { bindPrintPreview, type PrintSendResult } from "@/lib/printJob";

type Req = {
  title: string;
  html: string;
  printerName: string;
  widthMm: number;
  heightMm: number;
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
  const pages = Math.max(1, (req.html.match(/class="slip-page"/g) || []).length);
  const pxW = (req.widthMm / 25.4) * 96;
  const pxH = (req.heightMm / 25.4) * 96;
  const frameH = pxH * pages;

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const w = Math.max(40, el.clientWidth - 48);
      setScale(Math.min(w / pxW, 1.15));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pxW]);

  return (
    <div ref={stageRef} className="min-h-0 flex-1 overflow-auto" style={{ background: "#5E5E5E" }}>
      <div style={{ width: pxW * scale, height: frameH * scale, margin: "24px auto" }}>
        <iframe
          title={req.title}
          srcDoc={req.html}
          style={{
            width: pxW,
            height: frameH,
            border: 0,
            background: "#fff",
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            boxShadow: "0 8px 24px rgba(0,0,0,.45)",
          }}
        />
      </div>
    </div>
  );
}

function PreviewWindow({ req, onClose }: { req: Req; onClose: () => void }) {
  const [hint, setHint] = useState("\u5148\u770b\u9810\u89bd\u3002\u78ba\u5b9a\u5f8c\u518d\u6309\u9019\u88e1\u7684\u300c\u5217\u5370\u300d\u624d\u6703\u9001\u51fa\u53bb\u3002");
  const [sending, setSending] = useState(false);
  const settled = useRef(false);
  const printingRef = useRef(false);
  const openedAt = useRef(Date.now());
  const printer = req.printerName || "\u9019\u4e00\u5217\u9084\u6c92\u9078\u5370\u8868\u6a5f";

  const finish = (result: PrintSendResult) => {
    if (settled.current) return;
    settled.current = true;
    req.resolve(result);
  };

  const close = () => {
    finish({ printed: false, printer: "" });
    onClose();
  };

  const save = () => {
    downloadHtml(req.title, req.html);
    setHint("\u5df2\u5b58\u6a94\u3002\u6a94\u6848\u5728\u4e0b\u8f09\u8cc7\u6599\u593e\u3002");
  };

  const print = () => {
    if (printingRef.current || sending) return;
    if (!req.printerName) {
      setHint("\u9019\u4e00\u5217\u9084\u6c92\u9078\u5370\u8868\u6a5f\uff0c\u6c92\u6709\u9001\u51fa\u53bb\u3002");
      return;
    }
    printingRef.current = true;
    setSending(true);
    setHint("\u6b63\u5728\u9001\u5230 " + req.printerName);
    void printToNamedPrinter({
      printerName: req.printerName,
      html: req.html,
      widthMm: req.widthMm,
      heightMm: req.heightMm,
    })
      .then((sent) => {
        const name = sent.printer || req.printerName;
        setHint("\u5df2\u9001\u5230 " + name);
        finish({ printed: true, printer: name });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "\u9001\u5230\u5370\u8868\u6a5f\u5931\u6557";
        setHint(msg);
        if (!settled.current) {
          settled.current = true;
          req.reject(err instanceof Error ? err : new Error(msg));
        }
      })
      .finally(() => {
        printingRef.current = false;
        setSending(false);
      });
  };

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
            disabled={sending}
          >
            <span className="font-mono text-[10px]">P</span> {sending ? "\u9001\u51fa\u4e2d\u2026" : "\u5217\u5370"}
          </button>
          <button type="button" className="border border-[#808080] bg-[#E8E8E8] px-3 py-0.5 text-[12px] font-bold" onClick={close}>
            Esc {"\u96e2\u958b"}
          </button>
          <span className="ml-2 max-w-[36rem] truncate text-[12px] font-bold text-[#000080]">
            {"\u5370\u8868\u6a5f\uff1a"}{printer}
          </span>
          <span className="font-mono text-[11px] text-black">
            {req.widthMm}{"\u00d7"}{req.heightMm} mm
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
