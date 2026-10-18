import { useEffect, useState } from "react";
import {
  fetchLocalPrintHealth,
  fetchVpnReach,
  fixCardConsole,
  installLocalSumatra,
  openLocalFix,
  type LocalPrintHealth,
} from "@/api/clinicApi";
import { loadPrintSettings } from "@/lib/printSettings";

type Tone = "ok" | "bad" | "wait";

type Props = {
  card: Tone;
  cardHint: string;
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
      hint: "\u9019\u53f0\u96fb\u8166\u7684\u5217\u5370\u6c92\u6709\u8ddf\u8457\u9580\u8a3a\u8d77\u4f86",
    };
  }
  if (!health.sumatra) {
    return {
      tone: "bad",
      label: "PDF\u672a\u88dd",
      hint: "\u9084\u6c92\u6709 SumatraPDF\uff0c\u5b58\u6a94\u5f8c\u9001\u4e0d\u9032\u5370\u8868\u6a5f",
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
      hint: "\u5217\u5370\u670d\u52d9\u6c92\u8d77\u4f86\uff0c\u770b\u4e0d\u5230\u9019\u53f0\u96fb\u8166\u7684\u5370\u8868\u6a5f",
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

export function DeskStatusLamps({ card, cardHint, sync, syncHint }: Props) {
  const [printHealth, setPrintHealth] = useState<LocalPrintHealth | null>(null);
  const [printLoaded, setPrintLoaded] = useState(false);
  const [vpn, setVpn] = useState<boolean | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    let gone = false;
    const loadPrint = async () => {
      const health = await fetchLocalPrintHealth();
      if (gone) return;
      setPrintHealth(health);
      setPrintLoaded(true);
    };
    void loadPrint();
    const timer = window.setInterval(() => void loadPrint(), 15000);
    return () => {
      gone = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let gone = false;
    const loadVpn = async () => {
      const reach = await fetchVpnReach();
      if (!gone) setVpn(reach);
    };
    void loadVpn();
    const timer = window.setInterval(() => void loadVpn(), 30000);
    return () => {
      gone = true;
      window.clearInterval(timer);
    };
  }, []);

  const pdf = pdfLamp(printHealth, printLoaded);
  const printer = printerLamp(printHealth, printLoaded);
  const vpnTone: Tone = vpn == null ? "wait" : vpn ? "ok" : "bad";
  const vpnLabel = vpn === false ? "VPN\u672a\u901a" : "VPN";
  const vpnHint =
    vpn === true
      ? "\u9019\u53f0\u96fb\u8166\u9023\u5f97\u5230\u5065\u4fdd VPN \u4e3b\u6a5f"
      : vpn === false
        ? "\u9023\u4e0d\u5230\u5065\u4fdd VPN\u3002\u8acb\u78ba\u8a8d\u5df2\u767b\u5165\uff0c\u7cfb\u7d71\u4e0d\u6703\u81ea\u5df1\u767b"
        : "\u6b63\u5728\u78ba\u8a8d VPN";

  const fixCard = () => {
    setNote("\u6b63\u5728\u8655\u7406\u8b80\u5361\u8edf\u9ad4\u2026");
    void fixCardConsole()
      .then((result) => setNote(result.message))
      .catch((err: unknown) => setNote(err instanceof Error ? err.message : "\u8b80\u5361\u8edf\u9ad4\u6c92\u958b\u8d77\u4f86"));
  };
  const fixPdf = () => {
    if (!printHealth) {
      setNote("\u6b63\u5728\u958b\u9019\u53f0\u96fb\u8166\u7684\u5217\u5370\u7a0b\u5f0f\u2026");
      openLocalFix("print");
      return;
    }
    if (!printHealth.sumatra) {
      setNote("\u6b63\u5728\u4e0b\u8f09\u5217\u5370\u7a0b\u5f0f\u2026");
      void installLocalSumatra()
        .then((msg) => setNote(msg))
        .catch(() => {
          openLocalFix("sumatra");
          setNote("\u6539\u7531\u9019\u53f0\u96fb\u8166\u81ea\u5df1\u4e0b\u8f09\u5217\u5370\u7a0b\u5f0f\u3002");
        });
      return;
    }
    setNote(pdf.hint);
  };

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Lamp
        tone={card}
        label={card === "ok" ? "\u8b80\u5361\u6a5f" : card === "bad" ? "\u8b80\u5361\u6a5f\u96e2\u7dda" : "\u8b80\u5361\u6a5f"}
        hint={cardHint}
        onFix={fixCard}
      />
      <Lamp tone={pdf.tone} label={pdf.label} hint={pdf.hint} onFix={fixPdf} />
      <Lamp tone={printer.tone} label={printer.label} hint={printer.hint} onFix={() => setNote(printer.hint)} />
      <Lamp tone={vpnTone} label={vpnLabel} hint={vpnHint} onFix={() => setNote(vpnHint)} />
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
