import { useEffect, useState } from "react";
import {
  FALLBACK_UI_CONFIG,
  type DefaultUiConfig,
  type DoctorPreferences,
  type ShortcutBarItem,
} from "@/types/uiConfig";

const DEFAULT_SHORTCUT_BAR: ShortcutBarItem[] = [
  { key: "F2", label: "掛號", action: "register", enabled: true },
  { key: "F3", label: "診療", action: "clinicMain", enabled: true },
  { key: "F4", label: "歷史病歷", action: "historyChart", enabled: true },
  { key: "F5", label: "過敏/檢查", action: "clinicalAlerts", enabled: true },
  { key: "F6", label: "放射科檢查", action: "radiology", enabled: true },
  { key: "F7", label: "Ditto處方", action: "dittoRx", enabled: true },
  { key: "F8", label: "IC卡內容", action: "icCard", enabled: true },
  { key: "F9", label: "存檔", action: "saveChart", enabled: true },
];

export function useDefaultUiConfig() {
  const [config, setConfig] = useState<DefaultUiConfig>(FALLBACK_UI_CONFIG);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/default_ui_config.json");
        if (!res.ok) return;
        const data = (await res.json()) as DefaultUiConfig;
        if (!cancelled) {
          setConfig({
            ...FALLBACK_UI_CONFIG,
            ...data,
            sections: { ...FALLBACK_UI_CONFIG.sections, ...data.sections },
            doctorPreferences: {
              ...FALLBACK_UI_CONFIG.doctorPreferences,
              ...data.doctorPreferences,
            },
          });
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const prefs: DoctorPreferences = {
    ...FALLBACK_UI_CONFIG.doctorPreferences,
    ...config.doctorPreferences,
  };

  return {
    config,
    loaded,
    prefs,
    ccChips: (() => {
      try {
        const raw = localStorage.getItem("wundadi-cc-templates");
        if (raw) {
          const rows = JSON.parse(raw) as Array<{ text?: string }>;
          const texts = rows.map((r) => (r.text || "").trim()).filter(Boolean);
          if (texts.length) return texts;
        }
      } catch {
        /* ignore */
      }
      return config.ccChips ?? FALLBACK_UI_CONFIG.ccChips!;
    })(),
    ccTemplates: config.ccTemplates ?? [],
    sections: config.sections ?? FALLBACK_UI_CONFIG.sections!,
    queueColumns: config.queueColumns ?? FALLBACK_UI_CONFIG.queueColumns!,
    queueColumnKeys: config.queueColumnKeys ?? FALLBACK_UI_CONFIG.queueColumnKeys!,
    currentRxColumns: config.currentRxColumns ?? FALLBACK_UI_CONFIG.currentRxColumns!,
    defaultUsages: config.defaultUsages ?? [
      "QD",
      "BID",
      "TID",
      "QID",
      "QID/AC",
      "TID/AC",
      "HS",
      "PRN",
      "STAT",
      "QOD",
      "QW",
      "BIW",
      "TIW",
      "QAM",
      "QPM",
      "AC",
      "PC",
    ],
    shortcutBar: config.shortcutBar ?? DEFAULT_SHORTCUT_BAR,
    layoutGrid: config.layoutGrid ?? FALLBACK_UI_CONFIG.layoutGrid!,
  };
}
