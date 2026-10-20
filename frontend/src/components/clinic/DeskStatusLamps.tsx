import { useEffect, useRef, useState } from "react";
import {
  fetchCardConsoleStatus,
  fetchDeskStatus,
  fetchLocalPrintHealth,
  fetchVpnReach,
  fixCardConsole,
  startLocalCard6,
  type LocalPrintHealth,
} from "@/api/clinicApi";
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
  const [hostCard, setHostCard] = useState<boolean | null>(null);
  const [hostVpn, setHostVpn] = useState<boolean | null>(null);
  const [note, setNote] = useState("");

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
    void loadPrint();
    const timer = window.setInterval(() => {
      if (gone) return;
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

  const hostDesk = printLoaded && !!printHealth && printHealth.card6 == null;
  const vpnKnown = typeof printHealth?.vpn === "boolean";
  const askHostVpn = printLoaded && !!printHealth && !vpnKnown;

  useEffect(() => {
    if (!hostDesk && !askHostVpn) return;
    let gone = false;
    const loadHost = async () => {
      if (hostDesk) {
        try {
          const status = await fetchCardConsoleStatus();
          if (!gone) setHostCard(status.reachable === true);
        } catch {
          if (!gone) setHostCard(false);
        }
      }
      if (askHostVpn) {
        const reach = await fetchVpnReach();
        if (!gone) setHostVpn(reach === true);
      }
    };
    void loadHost();
    const timer = window.setInterval(() => void loadHost(), 15000);
    return () => {
      gone = true;
      window.clearInterval(timer);
    };
  }, [hostDesk, askHostVpn]);

  const pdf = pdfLamp(printHealth, printLoaded);
  const printer = printerLamp(printHealth, printLoaded);
  const localVpn = printHealth?.vpn;
  const vpnOn = vpnKnown ? localVpn === true : hostVpn === true;
  const vpnTone: Tone = !printLoaded ? "wait" : !printHealth ? "bad" : vpnKnown ? (vpnOn ? "ok" : "bad") : hostVpn == null ? "wait" : vpnOn ? "ok" : "bad";
  const vpnLabel = vpnTone === "bad" ? "VPN\u672a\u901a" : "VPN";
  const vpnHint = !printHealth
    ? LOCAL_BLOCKED
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
  const cardTone: Tone = !printLoaded
    ? "wait"
    : !printHealth
      ? "bad"
      : card6
        ? card6.installed && card6.running
          ? "ok"
          : "bad"
        : hostCard == null
          ? "wait"
          : hostCard
            ? "ok"
            : "bad";
  const cardLabel = cardTone === "bad"
    ? !printHealth
      ? "\u8b80\u5361\u6a5f\u672a\u67e5"
      : card6?.installed
        ? "\u8b80\u5361\u6a5f\u6c92\u958b"
        : card6
          ? "\u8b80\u5361\u6a5f\u6c92\u67096.0"
          : "\u8b80\u5361\u6a5f\u96e2\u7dda"
    : "\u8b80\u5361\u6a5f";
  const cardHint = !printLoaded
    ? "\u6b63\u5728\u78ba\u8a8d\u9019\u53f0\u96fb\u8166"
    : !printHealth
      ? LOCAL_BLOCKED
      : !card6
        ? hostCard
          ? "\u9019\u53f0\u7684\u8b80\u5361\u8edf\u9ad4 6.0 \u6709\u5728\u807d"
          : "\u9019\u53f0\u7684\u8b80\u5361\u6a5f\u6c92\u9023\u4e0a"
        : card6.installed && card6.running
          ? "\u9019\u53f0\u7684\u8b80\u5361\u8edf\u9ad4 6.0 \u6709\u5728\u807d"
          : card6.legacy5
            ? "\u9019\u53f0\u53ea\u6709 5.XX\uff0c\u6c92\u6709 6.0\u3002\u4e0d\u7b97\u5df2\u88dd\u597d"
            : card6.installed
              ? "\u9019\u53f0\u6709 6.0\uff0c\u4f46\u9084\u6c92\u958b"
              : "\u9019\u53f0\u6c92\u6709\u8b80\u5361\u8edf\u9ad4 6.0";

  const fixCard = () => {
    if (!printHealth) {
      wakeLocal();
      return;
    }
    if (!card6) {
      setNote("\u6b63\u5728\u8655\u7406\u9019\u53f0\u7684\u8b80\u5361\u8edf\u9ad4\u2026");
      void fixCardConsole()
        .then((result) => setNote(result.message))
        .catch((err: unknown) => setNote(err instanceof Error ? err.message : "\u8b80\u5361\u8edf\u9ad4\u6c92\u958b\u8d77\u4f86"));
      return;
    }
    if (!card6.installed) {
      setNote(cardHint + "\u30026.0 \u8981\u5f9e\u5065\u4fdd\u5c08\u7db2\u5b89\u88dd\uff0c\u9019\u88e1\u4e0d\u6703\u81ea\u5df1\u4e0b\u8f09\u3002");
      return;
    }
    setNote("\u6b63\u5728\u958b\u9019\u53f0\u7684\u8b80\u5361\u8edf\u9ad4 6.0\u2026");
    void startLocalCard6()
      .then((msg) => {
        setNote(msg);
        return reloadLocal();
      })
      .catch(() => wakeLocal());
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

  const unseen = printLoaded && !printHealth;
  const unseenHint =
    "\u9019\u53f0\u9084\u6c92\u6709\u56de\u5831\u3002\u8acb\u628a\u5ba2\u6236\u7aef\u8cc7\u6599\u593e\u653e\u5230\u9019\u53f0\u96fb\u8166\u7684\u4e00\u500b\u56fa\u5b9a\u4f4d\u7f6e\uff0c\u96d9\u64ca\u88e1\u9762\u7684\u300c\u958b\u555f\u9580\u8a3a\u300d\u3002\u684c\u9762\u6703\u51fa\u73fe\u6377\u5f91\uff0c\u767b\u5165\u5f8c\u4e5f\u6703\u81ea\u5df1\u8dd1\u3002\u76f4\u63a5\u958b\u7db2\u5740\u4e5f\u770b\u5f97\u5230\u9019\u53f0\u7684\u5370\u8868\u6a5f\u3001\u8b80\u5361\u548c VPN\u3002\u8cc7\u6599\u71c8\u554f\u7684\u662f\u8a3a\u6240\u4e3b\u6a5f\u3002";

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {unseen ? (
        <Lamp tone="wait" label={"\u672c\u6a5f\u672a\u770b"} hint={unseenHint} />
      ) : (
        <>
      <Lamp tone={cardTone} label={cardLabel} hint={cardHint} onFix={fixCard} />
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
    </span>
  );
}
