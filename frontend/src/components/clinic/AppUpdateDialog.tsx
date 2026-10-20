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

type PackStatus = {
  latestActiveVersion?: string | null;
  diagnosis?: string | null;
};

type DrugResult = {
  ok?: boolean;
  tag?: string;
  version?: string | null;
  diagnosis?: string;
};

function short(sha: string | undefined): string {
  const text = (sha || "").trim();
  if (!text) return "\u2014";
  return text.slice(0, 7);
}

export function AppUpdateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [software, setSoftware] = useState<SoftwareStatus | null>(null);
  const [packVersion, setPackVersion] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setNote("");
    void (async () => {
      try {
        const [app, pack] = await Promise.all([
          request<SoftwareStatus>("/maintenance/app-update"),
          request<PackStatus>("/sync/packages/status"),
        ]);
        if (cancelled) return;
        setSoftware(app);
        setPackVersion(pack.latestActiveVersion || "");
      } catch (err: unknown) {
        if (!cancelled) setNote(err instanceof Error ? err.message : "\u8b80\u53d6\u5931\u6557");
      }
    })();
    return () => {
      cancelled = true;
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
    void request<DrugResult>("/maintenance/drug-pack", { method: "POST" })
      .then((body) => {
        if (body.version) setPackVersion(body.version);
        setNote(body.diagnosis || (body.ok ? "\u85e5\u50f9\u5df2\u88dd\u9032\u67e5\u50f9\u3002" : "\u85e5\u50f9\u6c92\u6709\u88dd\u9032\u3002"));
      })
      .catch((err: unknown) => {
        setNote(err instanceof Error ? err.message : "\u85e5\u50f9\u66f4\u65b0\u5931\u6557");
      })
      .finally(() => setBusy(""));
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
            {packVersion || "\u9084\u6c92\u6709"}
            {"\u3002\u820a\u75c5\u6b77\u4ecd\u7528\u5c31\u91ab\u7576\u5929\u7684\u50f9\u683c\uff0c\u4e0d\u7528\u91cd\u958b\u3002"}
          </p>
          <button
            type="button"
            disabled={busy !== ""}
            className="mt-2 rounded border border-[#E7D7A8]/60 px-3 py-1 text-[13px] disabled:opacity-40"
            onClick={applyDrug}
          >
            {busy === "drug" ? "\u6293\u53d6\u4e2d\u2026" : "\u66f4\u65b0\u85e5\u50f9"}
          </button>
        </section>
        {note ? <p className="mt-3 text-[12px] leading-relaxed text-[#E7D7A8]">{note}</p> : null}
      </div>
    </div>
  );
}
