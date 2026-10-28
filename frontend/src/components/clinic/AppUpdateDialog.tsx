import { useEffect, useState } from "react";
import { request } from "@/api/clinicApi";

type SoftwareStatus = {
  localCommit?: string;
  localVersion?: string;
  remoteCommit?: string;
  remoteVersion?: string;
  updateAvailable?: boolean;
  devTree?: boolean;
  canApply?: boolean;
  detail?: string;
};

type DrugStatus = {
  running?: boolean;
  version?: string | null;
  lastSuccessOn?: string;
  notice?: string;
  detail?: string;
};

function short(sha: string | undefined): string {
  const text = (sha || "").trim();
  if (!text) return "\u2014";
  return text.slice(0, 7);
}

export function AppUpdateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [software, setSoftware] = useState<SoftwareStatus | null>(null);
  const [drug, setDrug] = useState<DrugStatus | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer = 0;
    setNote("");
    const pullDrug = () => {
      void request<DrugStatus>("/maintenance/drug-pack")
        .then((body) => {
          if (cancelled) return;
          setDrug(body);
          if (body.running) timer = window.setTimeout(pullDrug, 3000);
          else setBusy("");
        })
        .catch((err: unknown) => {
          if (!cancelled) setNote(err instanceof Error ? err.message : "\u8b80\u53d6\u5931\u6557");
        });
    };
    void request<SoftwareStatus>("/maintenance/app-update")
      .then((app) => {
        if (!cancelled) setSoftware(app);
      })
      .catch((err: unknown) => {
        if (!cancelled) setNote(err instanceof Error ? err.message : "\u8b80\u53d6\u5931\u6557");
      });
    pullDrug();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open]);

  if (!open) return null;

  const applySoftware = () => {
    setBusy("software");
    setNote("");
    void request<{ detail?: string; already?: boolean }>("/maintenance/app-update", { method: "POST" })
      .then((body) => {
        setNote(
          body.already
            ? "\u8edf\u9ad4\u5df2\u662f\u9019\u4e00\u7248\u3002"
            : body.detail || "\u670d\u52d9\u6703\u505c\u4e00\u4e0b\u518d\u8d77\u4f86\u3002\u9019\u500b\u756b\u9762\u6703\u65b7\u7dda\uff0c\u7b49\u7d04\u4e00\u5206\u9418\u518d\u91cd\u65b0\u6574\u7406\u3002",
        );
      })
      .catch((err: unknown) => {
        setNote(err instanceof Error ? err.message : "\u8edf\u9ad4\u66f4\u65b0\u5931\u6557");
      })
      .finally(() => setBusy(""));
  };

  const applyDrug = () => {
    setBusy("drug");
    setNote("");
    const watch = () => {
      window.setTimeout(() => {
        void request<DrugStatus>("/maintenance/drug-pack")
          .then((body) => {
            setDrug(body);
            setNote(body.detail || "");
            if (body.running) watch();
            else setBusy("");
          })
          .catch((err: unknown) => {
            setNote(err instanceof Error ? err.message : "\u85e5\u50f9\u66f4\u65b0\u5931\u6557");
            setBusy("");
          });
      }, 3000);
    };
    void request<DrugStatus>("/maintenance/drug-pack", { method: "POST" })
      .then((body) => {
        setDrug(body);
        setNote(body.detail || "");
        if (body.running) watch();
        else setBusy("");
      })
      .catch((err: unknown) => {
        setNote(err instanceof Error ? err.message : "\u85e5\u50f9\u66f4\u65b0\u5931\u6557");
        setBusy("");
      });
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[min(32rem,92vw)] rounded-lg border border-white/15 bg-[#151c2c] p-4 text-[#E7EEF8] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[16px] font-semibold">{"\u66f4\u65b0"}</h3>
          <button type="button" className="px-2 text-[13px] text-[#8EA0BA]" onClick={onClose}>
            {"\u95dc\u9589"}
          </button>
        </div>
        <section className="mb-3 rounded border border-white/10 p-3">
          <div className="text-[13px] font-medium">{"\u8edf\u9ad4"}</div>
          <p className="mt-1 text-[12px] leading-relaxed text-[#A9B8CE]">
            {"\u9019\u53f0 "}
            {software?.localVersion || short(software?.localCommit)}
            {" \u00b7 \u66f4\u65b0\u6a94 "}
            {software?.remoteVersion || "\u9084\u6c92\u6709"}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-[#A9B8CE]">
            {software?.detail || "\u8b80\u53d6\u4e2d\u2026"}
          </p>
          <button
            type="button"
            disabled={!software?.canApply || busy !== ""}
            className="mt-2 rounded border border-[#E7D7A8]/60 px-3 py-1 text-[13px] disabled:opacity-40"
            onClick={applySoftware}
          >
            {busy === "software" ? "\u4e0b\u8f09\u4e2d\u2026" : "\u66f4\u65b0\u8edf\u9ad4"}
          </button>
        </section>
        <section className="rounded border border-white/10 p-3">
          <div className="text-[13px] font-medium">{"\u85e5\u50f9"}</div>
          <p className="mt-1 text-[12px] leading-relaxed text-[#A9B8CE]">
            {"\u76ee\u524d "}
            {drug?.version || "\u9084\u6c92\u6709"}
            {drug?.lastSuccessOn ? `\u00b7 \u4e0a\u6b21 ${drug.lastSuccessOn}` : ""}
            {"\u3002\u9019\u53f0\u4e3b\u6a5f\u81ea\u5df1\u5411\u5065\u4fdd\u7f72\u3001\u98df\u85e5\u7f72\u6293\u6574\u4efd\u3002\u6a94\u6848\u4e0d\u5c0d\u5c31\u4e0d\u88dd\uff0c\u820a\u75c5\u6b77\u4ecd\u7528\u5c31\u91ab\u7576\u5929\u7684\u50f9\u683c\u3002"}
          </p>
          {drug?.notice ? <p className="mt-1 text-[12px] leading-relaxed text-[#E7D7A8]">{drug.notice}</p> : null}
          <button
            type="button"
            disabled={busy !== "" || Boolean(drug?.running)}
            className="mt-2 rounded border border-[#E7D7A8]/60 px-3 py-1 text-[13px] disabled:opacity-40"
            onClick={applyDrug}
          >
            {busy === "drug" || drug?.running ? "\u6293\u53d6\u4e2d\u2026" : "\u66f4\u65b0\u85e5\u50f9"}
          </button>
        </section>
        {note ? <p className="mt-3 text-[12px] leading-relaxed text-[#E7D7A8]">{note}</p> : null}
      </div>
    </div>
  );
}
