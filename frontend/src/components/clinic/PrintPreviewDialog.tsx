import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { printToNamedPrinter } from "@/api/clinicApi";
import { HIS_FONT } from "@/lib/hisTheme";
import {
  bindPrintPreview,
  previewSheetMarkup,
  type PreparedPrint,
  type PrintSendResult,
} from "@/lib/printJob";
import { feedLabel } from "@/lib/printSettings";

type Req = {
  sheets: PreparedPrint[];
  resolve: (result: PrintSendResult) => void;
  reject: (err: Error) => void;
};

type View = { sheet: number; page: number };

function slipCount(html: string): number {
  return Math.max(1, (html.match(/class="slip-page"/g) || []).length);
}

function flatten(sheets: PreparedPrint[]): View[] {
  const views: View[] = [];
  sheets.forEach((sheet, index) => {
    const count = slipCount(sheet.html);
    for (let page = 0; page < count; page += 1) views.push({ sheet: index, page });
  });
  return views.length ? views : [{ sheet: 0, page: 0 }];
}

function htmlForSlip(html: string, page: number): string {
  const count = slipCount(html);
  if (count <= 1) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const pages = [...doc.querySelectorAll(".slip-page")];
  if (pages.length <= 1) return html;
  pages.forEach((node, index) => {
    if (index !== page) node.remove();
  });
  return "<!doctype html>" + doc.documentElement.outerHTML;
}

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

function PreviewSheet({
  sheet,
  page,
  pageLabel,
  stageRef,
}: {
  sheet: PreparedPrint;
  page: number;
  pageLabel: string;
  stageRef: { current: HTMLDivElement | null };
}) {
  const [scale, setScale] = useState(1);
  const pageCount = slipCount(sheet.html);
  const pageSafe = Math.min(page, pageCount - 1);
  const pxW = (sheet.widthMm / 25.4) * 96;
  const pxH = (sheet.heightMm / 25.4) * 96;
  const frameH = pxH * pageCount;

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const w = Math.max(40, el.clientWidth - 24);
      const h = Math.max(40, el.clientHeight - 36);
      setScale(Math.min(w / pxW, h / pxH));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pxW, pxH, stageRef]);

  return (
    <div
      ref={stageRef}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      style={{ background: "#5E5E5E" }}
    >
      <div className="shrink-0 px-3 pt-2 text-center font-mono text-[12px] font-bold text-white">
        {pageLabel}
        {sheet.title ? "　" + sheet.title : ""}
      </div>
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
            dangerouslySetInnerHTML={{ __html: previewSheetMarkup(sheet.html) }}
          />
        </div>
      </div>
    </div>
  );
}

function PreviewWindow({ req, onClose }: { req: Req; onClose: () => void }) {
  const sheets = req.sheets.length ? req.sheets : [];
  const views = flatten(sheets);
  const [cursor, setCursor] = useState(0);
  const [ask, setAsk] = useState(false);
  const [printed, setPrinted] = useState(false);
  const printedRef = useRef(false);
  const [hint, setHint] = useState(
    views.length > 1
      ? "\u6efe\u8f2a\u63db\u9801\u3002\u6309\u5217\u5370\u6703\u554f\u8981\u6574\u4efd\u9084\u662f\u53ea\u5370\u9019\u4e00\u5f35\u3002"
      : "\u5148\u770b\u9810\u89bd\u3002\u78ba\u5b9a\u5f8c\u518d\u6309\u9019\u88e1\u7684\u300c\u5217\u5370\u300d\u624d\u6703\u9001\u51fa\u53bb\u3002",
  );
  const settled = useRef(false);
  const openedAt = useRef(Date.now());
  const sentName = useRef("");
  const aliveRef = useRef(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewsRef = useRef(views);
  viewsRef.current = views;
  const safeCursor = Math.min(cursor, Math.max(0, views.length - 1));
  const view = views[safeCursor] || { sheet: 0, page: 0 };
  const sheet = sheets[view.sheet] || sheets[0];
  const printer = sheet?.printerName || "\u9019\u4e00\u5217\u9084\u6c92\u9078\u5370\u8868\u6a5f";

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
    if (!sheet) return;
    downloadHtml(sheet.title, sheet.html);
    setHint("\u5df2\u5b58\u6a94\u3002\u6a94\u6848\u5728\u4e0b\u8f09\u8cc7\u6599\u593e\u3002");
  };

  const sendSheets = (jobs: { html: string; sheet: PreparedPrint }[], again = false) => {
    if (printedRef.current && !again) return;
    const ready = jobs.filter((job) => job.sheet.printerName);
    if (!ready.length) {
      setHint("\u9019\u4e00\u5217\u9084\u6c92\u9078\u5370\u8868\u6a5f\uff0c\u6c92\u6709\u9001\u51fa\u53bb\u3002");
      return;
    }
    printedRef.current = true;
    setPrinted(true);
    sentName.current = ready.map((job) => job.sheet.printerName).filter((name, index, all) => all.indexOf(name) === index).join("\u3001");
    setHint("\u5df2\u4ea4\u7d66\u5370\u8868\u6a5f\uff0c\u96e2\u958b\u9019\u500b\u756b\u9762\u4e5f\u6703\u5370\u5b8c\u3002");
    void (async () => {
      const names: string[] = [];
      for (const job of ready) {
        try {
          const sent = await printToNamedPrinter({
            printerName: job.sheet.printerName,
            html: job.html,
            widthMm: job.sheet.widthMm,
            heightMm: job.sheet.heightMm,
            feed: job.sheet.feed || "portrait",
          });
          names.push(sent.printer || job.sheet.printerName);
        } catch (err: unknown) {
          if (!aliveRef.current) return;
          const msg = err instanceof Error ? err.message : "\u9001\u5230\u5370\u8868\u6a5f\u5931\u6557";
          setHint(msg);
          return;
        }
      }
      if (!aliveRef.current) return;
      const shown = names.filter((name, index, all) => all.indexOf(name) === index).join("\u3001");
      sentName.current = shown;
      setHint("\u5df2\u4ea4\u7d66 " + shown + "\uff0c\u5171 " + String(ready.length) + " \u5f35\u3002\u96e2\u958b\u4e5f\u6703\u5370\u5b8c\u3002");
    })();
  };

  const printChoice = (mode: "all" | "one", again = false) => {
    setAsk(false);
    if (!sheet) return;
    if (mode === "one") {
      sendSheets([{ sheet, html: htmlForSlip(sheet.html, view.page) }], again);
      return;
    }
    const seen = new Set<number>();
    const jobs: { html: string; sheet: PreparedPrint }[] = [];
    for (const item of views) {
      if (seen.has(item.sheet)) continue;
      seen.add(item.sheet);
      const one = sheets[item.sheet];
      if (one) jobs.push({ sheet: one, html: one.html });
    }
    sendSheets(jobs, again);
  };

  const print = (again = false) => {
    if (printedRef.current && !again) return;
    if (views.length > 1) {
      setAsk(true);
      return;
    }
    printChoice("all", again);
  };

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let acc = 0;
    let lockedUntil = 0;
    const onWheel = (ev: WheelEvent) => {
      if (viewsRef.current.length <= 1) return;
      ev.preventDefault();
      const now = Date.now();
      if (now < lockedUntil) return;
      acc += ev.deltaY;
      if (Math.abs(acc) < 30) return;
      const dir = acc > 0 ? 1 : -1;
      acc = 0;
      lockedUntil = now + 140;
      setCursor((p) => Math.min(viewsRef.current.length - 1, Math.max(0, p + dir)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [req]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        if (ask) {
          setAsk(false);
          return;
        }
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
      if (ask) return;
      print(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (!sheet) return null;
  const pageLabel = "\u9801\u6b21: " + String(safeCursor + 1) + " / " + String(views.length);

  return createPortal(
    <div data-print-preview="" className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-2">
      <div
        className="relative flex h-[min(96vh,900px)] w-[min(98vw,1100px)] flex-col overflow-hidden border border-[#404040]"
        style={{ background: "#D4D0C8", fontFamily: HIS_FONT, boxShadow: "0 8px 32px rgba(0,0,0,.45)" }}
      >
        <header
          className="flex shrink-0 items-center justify-between border-b border-[#808080] px-2 py-1 text-[13px] font-bold text-black"
          style={{ background: "linear-gradient(180deg,#fff,#D4D0C8)" }}
        >
          <span>{"\u5217\u5370\u9810\u89bd\u3000"}{sheet.title}</span>
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
            disabled={printed}
            className="border border-[#404040] bg-[#ffe14a] px-3 py-0.5 text-[12px] font-bold disabled:border-[#808080] disabled:bg-[#C0C0C0] disabled:text-[#666]"
            onClick={() => print(false)}
          >
            <span className="font-mono text-[10px]">P</span> {"\u5217\u5370"}
          </button>
          {printed ? (
            <button
              type="button"
              className="border border-[#404040] bg-[#ffe14a] px-3 py-0.5 text-[12px] font-bold"
              onClick={() => print(true)}
            >
              {"\u518d\u6b21\u5217\u5370"}
            </button>
          ) : null}
          <button type="button" className="border border-[#808080] bg-[#E8E8E8] px-3 py-0.5 text-[12px] font-bold" onClick={close}>
            Esc {"\u96e2\u958b"}
          </button>
          <span className="ml-2 max-w-[36rem] truncate text-[12px] font-bold text-[#000080]">
            {"\u5370\u8868\u6a5f\uff1a"}{printer}
          </span>
          <span className="font-mono text-[11px] text-black">
            {sheet.widthMm}{"\u00d7"}{sheet.heightMm} mm {feedLabel(sheet.feed)}
          </span>
        </div>
        <PreviewSheet sheet={sheet} page={view.page} pageLabel={pageLabel} stageRef={stageRef} />
        <footer className="shrink-0 border-t border-[#808080] px-2 py-1 text-[12px] font-bold text-black">{hint}</footer>
        {ask ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/35">
            <div className="w-[min(26rem,92vw)] border border-black bg-[#F4F1EA] p-3 text-[14px] shadow-lg">
              <div className="mb-2 text-[16px] font-bold">{"\u8981\u5217\u5370\u54ea\u4e00\u5f35\uff1f"}</div>
              <p className="mb-3 leading-snug">
                {"\u73fe\u5728\u662f\u7b2c "}
                {safeCursor + 1}
                {" \u5f35\uff0c\u4e00\u5171 "}
                {views.length}
                {" \u5f35\u3002\u6efe\u8f2a\u53ea\u662f\u7ffb\u9801\u3002"}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="border border-[#808080] bg-white px-3 py-1 font-bold"
                  onClick={() => setAsk(false)}
                >
                  {"\u53d6\u6d88"}
                </button>
                <button
                  type="button"
                  className="border border-[#808080] bg-white px-3 py-1 font-bold"
                  onClick={() => printChoice("one", printedRef.current)}
                >
                  {"\u53ea\u5370\u9019\u4e00\u5f35"}
                </button>
                <button
                  type="button"
                  className="border border-[#004d00] bg-[#C8F0C8] px-3 py-1 font-bold"
                  onClick={() => printChoice("all", printedRef.current)}
                >
                  {"\u5b8c\u6574\u5217\u5370"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
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
