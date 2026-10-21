import { useEffect, useRef, useState } from "react";
import {
  fetchDeskStatus,
  fetchLocalPrintHealth,
  fixCardConsole,
  startLocalCard6,
  type LocalPrintHealth,
} from "@/api/clinicApi";
import { readLocalCardLive, verifyLocalHpc, verifyLocalSam, type LocalCardLive } from "@/lib/localCard";
import { loadPrintSettings } from "@/lib/printSettings";

const SUMATRA_PAGE = "https://www.sumatrapdfreader.org/download-free-pdf-viewer";
const SUMATRA_HINT =
  "\u9019\u53f0\u7684\u5de5\u4f5c\u7ad9\u8cc7\u6599\u593e\u88e1\u61c9\u8a72\u6709\u514d\u5b89\u88dd\u7684 SumatraPDF.exe\uff0c\u8ddf\u300c\u958b\u555f\u9580\u8a3a\u300d\u653e\u5728\u4e00\u8d77\u3002\u6a94\u6848\u4e0d\u5728\u5c31\u653e\u56de\u53bb\uff0c\u4e0d\u7528\u53e6\u5916\u5b89\u88dd\u3002" +
  SUMATRA_PAGE;
const LOCAL_BLOCKED =
  "\u9019\u53f0\u9084\u6c92\u6709\u56de\u5831\u3002\u8acb\u628a\u5ba2\u6236\u7aef\u8cc7\u6599\u593e\u653e\u5230\u9019\u53f0\uff0c\u96d9\u64ca\u88e1\u9762\u7684\u300c\u958b\u555f\u9580\u8a3a\u300d\u3002\u684c\u9762\u6703\u51fa\u73fe\u6377\u5f91\uff0c\u4e4b\u5f8c\u7528\u6377\u5f91\u6216\u7db2\u5740\u90fd\u53ef\u4ee5\u3002";

type Tone = "ok" | "bad" | "wait";

type Props = {
  sync: Tone;
  syncHint: string;
};

type PrintLamp = {
  tone: Tone;
  label: string;
  hint: string;
};

function chosenPrinter(): string {
  const setups = loadPrintSettings().setups;
  const simple = setups.find((row) => row.id === "simple")?.printerName.trim() || "";
  if (simple) return simple;
  return setups.map((row) => row.printerName.trim()).find(Boolean) || "";
}

function pdfLamp(health: LocalPrintHealth | null, loaded: boolean): PrintLamp {
  if (!loaded) {
    return { tone: "wait", label: "PDF", hint: "\u6b63\u5728\u78ba\u8a8d\u5217\u5370\u8edf\u9ad4" };
  }
  if (!health) {
    return {
      tone: "bad",
      label: "PDF\u672a\u8d77",
      hint: LOCAL_BLOCKED,
    };
  }
  if (!health.sumatra) {
    return {
      tone: "bad",
      label: "PDF\u672a\u88dd",
      hint: SUMATRA_HINT,
    };
  }
  if (!health.edge) {
    return {
      tone: "bad",
      label: "PDF\u7f3a Edge",
      hint: "\u9019\u53f0\u96fb\u8166\u6c92\u6709 Microsoft Edge\uff0c\u7d44\u4e0d\u51fa\u5217\u5370\u6a94",
    };
  }
  return { tone: "ok", label: "PDF", hint: "SumatraPDF \u8207 Edge \u90fd\u5728\uff0c\u53ef\u4ee5\u7d44\u5217\u5370\u6a94" };
}

function printerLamp(health: LocalPrintHealth | null, loaded: boolean): PrintLamp {
  const wanted = chosenPrinter();
  if (!loaded) {
    return { tone: "wait", label: "\u5370\u8868\u6a5f", hint: "\u6b63\u5728\u78ba\u8a8d\u5370\u8868\u6a5f" };
  }
  if (!health) {
    return {
      tone: "bad",
      label: "\u5370\u8868\u6a5f\u672a\u8d77",
      hint: LOCAL_BLOCKED,
    };
  }
  if (!wanted) {
    const devices = (health.printers || []).filter((row) => row.device !== false && row.name);
    const ready = devices.find((row) => row.default && row.online === true) || devices.find((row) => row.online === true);
    if (ready) {
      return {
        tone: "ok",
        label: "\u5370\u8868\u6a5f",
        hint: "\u9019\u53f0\u96fb\u8166\u770b\u5f97\u5230\u5728\u7dda\u7684\u5370\u8868\u6a5f\u3002\u7c21\u5f0f\u8655\u65b9\u7b8b\u82e5\u8981\u6307\u5b9a\u67d0\u4e00\u53f0\uff0c\u5230\u5217\u5370\u8a2d\u5b9a\u9078",
      };
    }
    return {
      tone: "bad",
      label: "\u5370\u8868\u6a5f\u96e2\u7dda",
      hint: "\u770b\u4e0d\u5230\u5728\u7dda\u7684\u5370\u8868\u6a5f",
    };
  }
  const hit = (health.printers || []).find((row) => (row.name || "").trim() === wanted);
  if (!hit) {
    return {
      tone: "bad",
      label: "\u5370\u8868\u6a5f\u770b\u4e0d\u5230",
      hint: "\u5df2\u9078\u7684\u5370\u8868\u6a5f\u9019\u53f0\u96fb\u8166\u5217\u4e0d\u51fa\u4f86",
    };
  }
  if (hit.online === false) {
    return { tone: "bad", label: "\u5370\u8868\u6a5f\u96e2\u7dda", hint: "\u5df2\u9078\u7684\u5370\u8868\u6a5f\u76ee\u524d\u96e2\u7dda" };
  }
  if (hit.online == null) {
    return { tone: "wait", label: "\u5370\u8868\u6a5f", hint: "\u770b\u5f97\u5230\u5370\u8868\u6a5f\uff0c\u4f46\u9084\u4e0d\u78ba\u5b9a\u662f\u5426\u5728\u7dda" };
  }
  return { tone: "ok", label: "\u5370\u8868\u6a5f", hint: "\u5df2\u9078\u7684\u5370\u8868\u6a5f\u5728\u7dda" };
}

function CardButton({
  tone,
  label,
  hint,
  disabled,
  onClick,
}: {
  tone: Tone;
  label: string;
  hint: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const color = tone === "ok" ? "#3DDC6A" : tone === "bad" ? "#E25B5B" : "#E0B84A";
  return (
    <button
      type="button"
      title={hint}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[12px] text-[#E7EEF8] disabled:opacity-60"
      onClick={onClick}
    >
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ background: color, boxShadow: tone === "ok" ? "0 0 8px #3DDC6A" : undefined }}
      />
      {label}
    </button>
  );
}

function Lamp({
  tone,
  label,
  hint,
  onFix,
}: {
  tone: Tone;
  label: string;
  hint: string;
  onFix?: () => void;
}) {
  const color = tone === "ok" ? "#3DDC6A" : tone === "bad" ? "#E25B5B" : "#E0B84A";
  const className = "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[12px] text-[#E7EEF8]";
  if (tone === "bad" && onFix) {
    return (
      <button type="button" title={hint + "\u3002\u9ede\u4e00\u4e0b\u8b93\u7cfb\u7d71\u8655\u7406\u3002"} className={className} onClick={onFix}>
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        {label}
      </button>
    );
  }
  return (
    <span
      title={hint}
      className={className}
    >
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ background: color, boxShadow: tone === "ok" ? "0 0 8px #3DDC6A" : undefined }}
      />
      {label}
    </span>
  );
}

export function DeskStatusLamps({ sync, syncHint }: Props) {
  const [printHealth, setPrintHealth] = useState<LocalPrintHealth | null>(null);
  const [printLoaded, setPrintLoaded] = useState(false);
  const [note, setNote] = useState("");
  const [live, setLive] = useState<LocalCardLive | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [cardBusy, setCardBusy] = useState(false);

  const localSeen = useRef(false);

  useEffect(() => {
    let gone = false;
    const apply = (health: LocalPrintHealth | null) => {
      if (gone) return;
      if (health) localSeen.current = true;
      setPrintHealth(health);
      setPrintLoaded(true);
    };
    const loadPrint = async () => {
      const desk = await fetchDeskStatus();
      if (gone) return;
      if (desk) {
        apply(desk);
        return;
      }
      apply(await fetchLocalPrintHealth());
    };
    const refreshLive = () => {
      void readLocalCardLive().then((next) => {
        if (!gone) setLive(next);
      });
    };
    void loadPrint();
    refreshLive();
    const timer = window.setInterval(() => {
      if (gone) return;
      refreshLive();
      void fetchDeskStatus().then((health) => {
        if (gone || !health) return;
        apply(health);
      });
    }, 15000);
    return () => {
      gone = true;
      window.clearInterval(timer);
    };
  }, []);

  const pdf = pdfLamp(printHealth, printLoaded);
  const printer = printerLamp(printHealth, printLoaded);
  const localVpn = printHealth?.vpn;
  const vpnKnown = typeof localVpn === "boolean";
  const vpnOn = vpnKnown && localVpn === true;
  const vpnTone: Tone = !printLoaded ? "wait" : !printHealth || !vpnKnown ? "bad" : vpnOn ? "ok" : "bad";
  const vpnLabel = vpnTone === "bad" ? "VPN\u672a\u901a" : "VPN";
  const vpnHint = !printHealth
    ? LOCAL_BLOCKED
    : !vpnKnown
      ? "\u9019\u53f0\u6c92\u6709\u56de\u5831 VPN\u3002\u4e0d\u6703\u6539\u770b\u4e3b\u6a5f\u3002"
      : vpnOn
        ? "\u9019\u53f0\u96fb\u8166\u9023\u5f97\u5230\u5065\u4fdd VPN \u4e3b\u6a5f"
        : "\u9019\u53f0\u9023\u4e0d\u5230\u5065\u4fdd VPN\u3002\u8acb\u81ea\u5df1\u767b\u5165\uff0c\u7db2\u9801\u4e0d\u6703\u4ee3\u767b\u3002";

  const reloadLocal = async () => {
    const health = await fetchLocalPrintHealth();
    setPrintHealth(health);
    setPrintLoaded(true);
    return health;
  };

  const wakeLocal = () => {
    setNote(LOCAL_BLOCKED);
    let left = 40;
    const timer = window.setInterval(() => {
      left -= 1;
      void fetchLocalPrintHealth().then((health) => {
        if (!health) {
          if (left <= 0) window.clearInterval(timer);
          return;
        }
        window.clearInterval(timer);
        setPrintHealth(health);
        setPrintLoaded(true);
        const names = (health.printers || []).map((row) => row.name).filter(Boolean);
        setNote(names.length ? "\u9019\u53f0\u770b\u5f97\u5230\u5370\u8868\u6a5f\uff1a" + names.slice(0, 3).join("\u3001") : "\u672c\u6a5f\u6aa2\u67e5\u5df2\u958b\uff0c\u9019\u53f0\u76ee\u524d\u6c92\u6709\u5370\u8868\u6a5f");
      });
    }, 1000);
  };

  const card6 = printHealth?.card6;
  const samTone: Tone = !live ? "wait" : !live.reachable ? "bad" : live.sam === 2 ? "ok" : live.sam === 1 ? "wait" : "bad";
  const hpcTone: Tone = !live ? "wait" : !live.reachable ? "bad" : live.hpc === 3 ? "ok" : live.hpc >= 1 ? "wait" : "bad";
  const samHint = !live
    ? "\u6b63\u5728\u8b80\u9019\u53f0\u7684\u8b80\u5361\u8edf\u9ad4"
    : !live.reachable
      ? "\u9019\u53f0\u7684\u8b80\u5361\u8edf\u9ad4\u6c92\u6709\u56de\u61c9\u3002\u9ede\u4e00\u4e0b\u6703\u8a66\u8457\u958b 6.0 \u518d\u9a57\u8b49"
      : live.sam === 2
        ? "SAM \u5df2\u9a57\u8b49" + (live.samExpire ? "\uff0c\u6709\u6548\u5230 " + live.samExpire : "")
        : live.sam === 1
          ? "SAM \u5df2\u8f09\u5165\uff0c\u9084\u6c92\u5411\u5065\u4fdd\u7f72\u9a57\u8b49\u3002\u9ede\u4e00\u4e0b\u9a57\u8b49"
          : "\u9ede\u4e00\u4e0b\u505a SAM \u9a57\u8b49";
  const hpcHint = !live
    ? "\u6b63\u5728\u8b80\u9019\u53f0\u7684\u8b80\u5361\u8edf\u9ad4"
    : !live.reachable
      ? "\u9019\u53f0\u7684\u8b80\u5361\u8edf\u9ad4\u6c92\u6709\u56de\u61c9"
      : live.hpc === 3
        ? "\u91ab\u4e8b\u4eba\u54e1\u5361 PIN \u5df2\u9a57\u8b49" + (live.hpcExpire ? "\uff0c\u6709\u6548\u5230 " + live.hpcExpire : "") + "\u3002\u9ede\u4e00\u4e0b\u53ef\u4ee5\u518d\u9a57"
        : live.hpc === 2
          ? "\u91ab\u4e8b\u4eba\u54e1\u5361\u5df2\u9a57\u8b49\uff0c\u9084\u6c92\u6253 PIN"
          : live.hpc === 1
            ? "\u91ab\u4e8b\u4eba\u54e1\u5361\u5728\u8b80\u5361\u6a5f\u4e0a\uff0c\u9084\u6c92\u9a57 PIN"
            : "\u91ab\u4e8b\u4eba\u54e1\u5361\u6c92\u6709\u63d2\u5728\u73fe\u5728\u9019\u53f0\u8b80\u5361\u6a5f\u3002\u9ede\u4e00\u4e0b\u8f38\u5165 PIN";

  const onSam = () => {
    if (cardBusy) return;
    if (card6 && !card6.installed) {
      setNote("\u9019\u53f0\u6c92\u6709\u8b80\u5361\u8edf\u9ad4 6.0\u30026.0 \u8981\u5f9e\u5065\u4fdd\u5c08\u7db2\u5b89\u88dd\uff0c\u9019\u88e1\u4e0d\u6703\u81ea\u5df1\u4e0b\u8f09\u3002");
      return;
    }
    setCardBusy(true);
    const run = async () => {
      if (!live?.reachable) {
        if (!printHealth) {
          wakeLocal();
          return;
        }
        if (!card6) {
          setNote("\u6b63\u5728\u8655\u7406\u9019\u53f0\u7684\u8b80\u5361\u8edf\u9ad4\u2026");
          const result = await fixCardConsole();
          setNote(result.message);
        } else if (!card6.running) {
          setNote("\u6b63\u5728\u958b\u9019\u53f0\u7684\u8b80\u5361\u8edf\u9ad4 6.0\u2026");
          const msg = await startLocalCard6();
          setNote(msg);
          await reloadLocal();
        }
      }
      setNote("\u6b63\u5728\u9a57\u8b49 SAM\u2026");
      const next = await verifyLocalSam();
      setLive(next);
      setNote(next.sam === 2
        ? "SAM \u5df2\u9a57\u8b49" + (next.samExpire ? "\uff0c\u6709\u6548\u5230 " + next.samExpire : "")
        : "SAM \u9084\u6c92\u9a57\u8b49\u5b8c\u6210");
    };
    void run()
      .catch((err: unknown) => {
        setNote(err instanceof Error ? err.message : "SAM \u9a57\u8b49\u5931\u6557");
        void readLocalCardLive().then(setLive);
      })
      .finally(() => setCardBusy(false));
  };

  const onHpc = () => {
    if (cardBusy) return;
    setPinOpen(true);
    setPin("");
  };

  const submitPin = () => {
    const value = pin;
    setPin("");
    setCardBusy(true);
    setNote("\u6b63\u5728\u9a57\u8b49\u91ab\u4e8b\u4eba\u54e1\u5361\u2026");
    void verifyLocalHpc(value)
      .then((next) => {
        setLive(next);
        setPinOpen(false);
        setNote(next.hpc === 3
          ? "\u91ab\u4e8b\u4eba\u54e1\u5361 PIN \u5df2\u9a57\u8b49" + (next.hpcExpire ? "\uff0c\u6709\u6548\u5230 " + next.hpcExpire : "")
          : "\u91ab\u4e8b\u4eba\u54e1\u5361\u9084\u6c92\u9a57\u5b8c PIN");
      })
      .catch((err: unknown) => {
        setNote(err instanceof Error ? err.message : "\u91ab\u4e8b\u4eba\u54e1\u5361\u9a57\u8b49\u5931\u6557");
        void readLocalCardLive().then(setLive);
      })
      .finally(() => setCardBusy(false));
  };
  const fixPdf = () => {
    if (!printHealth) {
      wakeLocal();
      return;
    }
    if (!printHealth.sumatra) {
      setNote(SUMATRA_HINT);
      window.open(SUMATRA_PAGE, "_blank", "noopener");
      return;
    }
    setNote(pdf.hint);
  };

  const samLabel = live?.sam === 2 && live.samExpire ? "SAM\u9a57\u8b49 " + live.samExpire : "SAM\u9a57\u8b49";
  const hpcLabel = live?.hpc === 3 && live.hpcExpire ? "\u91ab\u4e8b\u4eba\u54e1\u5361 " + live.hpcExpire : "\u91ab\u4e8b\u4eba\u54e1\u5361\u9a57\u8b49";

  const unseen = printLoaded && !printHealth;
  const unseenHint =
    "\u9019\u53f0\u9084\u6c92\u6709\u56de\u5831\u3002\u8acb\u628a\u5ba2\u6236\u7aef\u8cc7\u6599\u593e\u653e\u5230\u9019\u53f0\u96fb\u8166\u7684\u4e00\u500b\u56fa\u5b9a\u4f4d\u7f6e\uff0c\u96d9\u64ca\u88e1\u9762\u7684\u300c\u958b\u555f\u9580\u8a3a\u300d\u3002\u684c\u9762\u6703\u51fa\u73fe\u6377\u5f91\uff0c\u767b\u5165\u5f8c\u4e5f\u6703\u81ea\u5df1\u8dd1\u3002\u76f4\u63a5\u958b\u7db2\u5740\u4e5f\u770b\u5f97\u5230\u9019\u53f0\u7684\u5370\u8868\u6a5f\u3001\u8b80\u5361\u548c VPN\u3002\u8cc7\u6599\u71c8\u554f\u7684\u662f\u8a3a\u6240\u4e3b\u6a5f\u3002";

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <CardButton tone={samTone} label={samLabel} hint={samHint} disabled={cardBusy} onClick={onSam} />
      <CardButton tone={hpcTone} label={hpcLabel} hint={hpcHint} disabled={cardBusy} onClick={onHpc} />
      {pinOpen ? (
        <form
          className="inline-flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            submitPin();
          }}
        >
          <input
            type="password"
            autoFocus
            value={pin}
            autoComplete="off"
            placeholder="PIN"
            className="w-16 rounded border border-white/15 bg-black/30 px-1.5 py-0.5 text-[12px] text-[#E7EEF8]"
            onChange={(event) => setPin(event.target.value)}
          />
          <button type="submit" disabled={cardBusy || !pin.trim()} className="rounded border border-white/15 px-1.5 py-0.5 text-[12px] text-[#E7EEF8] disabled:opacity-60">
            {"\u9a57\u8b49"}
          </button>
        </form>
      ) : null}
      {unseen ? (
        <Lamp tone="wait" label={"\u672c\u6a5f\u672a\u770b"} hint={unseenHint} />
      ) : (
        <>
      <Lamp tone={pdf.tone} label={pdf.label} hint={pdf.hint} onFix={fixPdf} />
      <Lamp
        tone={printer.tone}
        label={printer.label}
        hint={printer.hint}
        onFix={() => {
          if (!printHealth) {
            wakeLocal();
            return;
          }
          void reloadLocal().then(() => setNote(printer.hint));
        }}
      />
      <Lamp tone={vpnTone} label={vpnLabel} hint={vpnHint} onFix={() => setNote(vpnHint)} />
        </>
      )}
      <Lamp
        tone={sync}
        label={sync === "bad" ? "\u8cc7\u6599\u4e2d\u65b7" : "\u8cc7\u6599"}
        hint={syncHint}
        onFix={() => setNote(syncHint)}
      />
      {note ? <span className="text-[12px] text-[#F3D48A]">{note}</span> : null}
    </div>
  );
}
