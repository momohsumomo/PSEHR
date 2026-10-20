import { useEffect, useMemo, useRef, useState } from "react";
import { fetchSciniSettings, saveSciniValues, type SciniRow } from "@/api/clinicApi";
import {
  applyFieldFallback,
  canonSection,
  fieldGuide,
  flagState,
  flagToStored,
  PRESCRIPTION_FONT_ENTRY,
  depositPatchFromFlags,
  rowKey,
  rowsForFormat,
  simplePatchFromFlags,
} from "@/lib/printFormatOptions";
import { buildSetupPreviewPages, settingMovesPreview, type PreviewClinic } from "@/lib/printSetupPreview";
import { previewSheetMarkup } from "@/lib/printJob";
import { paperSizeEditable, type PrintSetup } from "@/lib/printSettings";
import { HIS_FONT } from "@/lib/hisTheme";

type Props = {
  row: PrintSetup;
  printers: string[];
  onClose: () => void;
  onSaved: (patch: Partial<PrintSetup>) => void;
};

function PaperFrame({
  html,
  widthMm,
  heightMm,
  padTopMm,
  padLeftMm,
  caption,
}: {
  html: string;
  widthMm: number;
  heightMm: number;
  padTopMm: number;
  padLeftMm: number;
  caption: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.7);
  const w = Number.isFinite(widthMm) && widthMm > 0 ? widthMm : 114;
  const h = Number.isFinite(heightMm) && heightMm > 0 ? heightMm : 101.6;
  useEffect(() => {
    const el = host.current?.parentElement;
    if (!el) return;
    const fit = () => {
      const pxW = w * 3.7795;
      const pxH = h * 3.7795;
      const sx = Math.max(120, el.clientWidth - 28) / pxW;
      const sy = Math.max(120, el.clientHeight - 40) / pxH;
      setScale(Math.max(0.28, Math.min(sx, sy, 1.4)));
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, [w, h]);
  const wrapped = `<div style="height:100%;display:flex;flex-direction:column;box-sizing:border-box;padding-top:${padTopMm}mm;padding-left:${padLeftMm}mm"><div style="flex:1;min-height:0;overflow:hidden">${html}</div></div>`;
  const doc = `<!doctype html><html style="color-scheme:only light;background:#fff;color:#000;forced-color-adjust:none"><head><meta charset="utf-8"/><meta name="color-scheme" content="only light"/>
<style>
  html, body { margin:0; height:100%; background:#fff !important; color:#000 !important; color-scheme:only light; forced-color-adjust:none; }
  .slip-page { height:100%; min-height:0; background:#fff; color:#000; }
</style></head><body>${wrapped}</body></html>`;
  return (
    <div ref={host}>
      {caption ? <div className="mb-1 text-center text-[11px] font-bold">{caption}</div> : null}
      <div style={{ width: w * 3.7795 * scale, height: h * 3.7795 * scale, margin: "0 auto" }}>
        <div
          className="his-paper"
          style={{
            width: `${w}mm`,
            height: `${h}mm`,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            background: "#ffffff",
            color: "#000000",
            boxShadow: "0 2px 8px rgba(0,0,0,.35)",
            overflow: "hidden",
          }}
          dangerouslySetInnerHTML={{ __html: previewSheetMarkup(doc) }}
        />
      </div>
    </div>
  );
}

export function PrintFormatDialog({ row, printers, onClose, onSaved }: Props) {
  const [items, setItems] = useState<SciniRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [widthMm, setWidthMm] = useState(row.widthMm);
  const [heightMm, setHeightMm] = useState(row.heightMm);
  const [printerName, setPrinterName] = useState(row.printerName);
  const [footer, setFooter] = useState(row.footer);
  const [drugFont, setDrugFont] = useState(row.drugFontSizePx || row.fontSizePx || 9);
  const [rxFont, setRxFont] = useState(row.fontSizePx || 9);
  const [fontRow, setFontRow] = useState<SciniRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [focusEntry, setFocusEntry] = useState("");

  useEffect(() => {
    let stop = false;
    setLoading(true);
    setError("");
    fetchSciniSettings(undefined, true)
      .then((res) => {
        if (stop) return;
        const picked = rowsForFormat(row.id, res.rows || []).map((item) => ({
          ...item,
          section: canonSection(item.section, res.values || {}),
        }));
        const next: Record<string, string> = {};
        for (const item of picked) next[rowKey(item)] = item.value || "";
        setValues(res.values || {});
        setItems(picked);
        setDraft(next);
        const source = (res.rows || []).find((item) => item.entry === PRESCRIPTION_FONT_ENTRY);
        if (source) {
          const kept = {
            ...source,
            section: canonSection(source.section, res.values || {}),
          };
          setFontRow(kept);
          const size = Math.abs(Number.parseFloat(source.value || ""));
          if ((!row.fontSizePx || row.fontSizePx === 9) && size >= 7 && size <= 16) setRxFont(size);
        }
      })
      .catch(() => {
        if (!stop) setError("\u9662\u6240\u53c3\u6578\u8b80\u4e0d\u5230\uff0c\u5148\u6539\u7d19\u5f35\u8207\u5370\u8868\u6a5f\u3002");
      })
      .finally(() => {
        if (!stop) setLoading(false);
      });
    return () => {
      stop = true;
    };
  }, [row.id]);

  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, SciniRow[]>();
    for (const item of items) {
      const name = (item.group1 || item.group || "").trim() || "\u5176\u4ed6";
      if (!map.has(name)) {
        map.set(name, []);
        order.push(name);
      }
      map.get(name)!.push(item);
    }
    return order.map((name) => ({ name, rows: map.get(name) || [] }));
  }, [items]);

  const clinic = useMemo<PreviewClinic>(() => {
    try {
      const raw = localStorage.getItem("wundadi-clinic-profile-page-v2");
      const profile = raw ? (JSON.parse(raw).profile as Record<string, unknown>) : {};
      return {
        name: String(profile?.clinicName || "\u9662\u6240\u540d\u7a31"),
        address: String(profile?.address || ""),
        phone: String(profile?.phone || ""),
        code: String(profile?.clinicCode || ""),
      };
    } catch {
      return { name: "\u9662\u6240\u540d\u7a31", address: "", phone: "", code: "" };
    }
  }, []);

  const pages = useMemo(
    () =>
      buildSetupPreviewPages({
        id: row.id,
        items,
        draft: applyFieldFallback(items, draft),
        footer,
        focusEntry,
        clinic,
        drugFontSizePx: drugFont,
        fontSizePx: rxFont,
      }),
    [row.id, items, draft, footer, focusEntry, clinic, drugFont, rxFont],
  );

  const save = async () => {
    setSaving(true);
    setError("");
    const bySection: Record<string, Record<string, string>> = {};
    for (const item of items) {
      const key = rowKey(item);
      const next = draft[key] ?? "";
      if (next === (item.value || "")) continue;
      const sec = canonSection(item.section, values);
      bySection[sec] = bySection[sec] || {};
      bySection[sec][item.entry] = next;
    }
    if (row.id === "simple" && fontRow) {
      const sec = canonSection(fontRow.section, values);
      bySection[sec] = bySection[sec] || {};
      bySection[sec][fontRow.entry] = String(rxFont);
    }
    try {
      if (Object.keys(bySection).length) await saveSciniValues(bySection);
    } catch {
      setSaving(false);
      setError("\u9662\u6240\u53c3\u6578\u6c92\u5beb\u5165\uff0c\u8acb\u518d\u5b58\u4e00\u6b21\u3002");
      return;
    }
    const patch: Partial<PrintSetup> = { printerName, footer };
    if (paperSizeEditable(row)) {
      patch.widthMm = widthMm;
      patch.heightMm = heightMm;
    }
    Object.assign(patch, simplePatchFromFlags(row, draft, items));
    Object.assign(patch, depositPatchFromFlags(row, draft, items));
    if (row.id === "simple") {
      patch.fontSizePx = rxFont;
      patch.drugFontSizePx = drugFont;
    }
    onSaved(patch);
    setSaving(false);
    onClose();
  };

  const input = "border border-[#808080] bg-white px-1 py-0 text-[12px]";

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-3">
      <div
        className="flex h-[min(92vh,860px)] w-[min(76rem,98vw)] flex-col border bg-[#F0F0F0] shadow-lg"
        style={{ borderColor: "#404040", fontFamily: HIS_FONT }}
      >
        <div className="flex items-center bg-[#2060A0] px-2 py-1 text-[13px] font-bold text-white">
          <span>
            {row.label}
            {"\u3000\u5de6\u908a\u6539\u3001\u53f3\u908a\u99ac\u4e0a\u770b\u5230"}
          </span>
          <button type="button" className="ml-auto px-2" onClick={onClose}>
            {"\u95dc\u9589"}
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
        <div className="min-h-0 w-[min(30rem,48%)] space-y-2 overflow-auto border-r border-[#808080] p-2 text-[12px]">
          <div className="grid grid-cols-2 gap-2 bg-white p-2">
            <label>
              {"\u5bec mm "}
              <input
                className={`${input} w-24`}
                type="number"
                min={40}
                max={400}
                step={0.1}
                disabled={!paperSizeEditable(row)}
                value={widthMm}
                onChange={(e) => setWidthMm(Number(e.target.value))}
              />
            </label>
            <label>
              {"\u9577 mm "}
              <input
                className={`${input} w-24`}
                type="number"
                min={40}
                max={500}
                step={0.1}
                disabled={!paperSizeEditable(row)}
                value={heightMm}
                onChange={(e) => setHeightMm(Number(e.target.value))}
              />
            </label>
            <label className="col-span-2">
              {"\u5370\u8868\u6a5f "}
              <select
                className={`${input} w-[18rem]`}
                value={printerName}
                onChange={(e) => setPrinterName(e.target.value)}
              >
                <option value="">{printers.length ? "\u8acb\u9078\u9019\u53f0\u7684\u5370\u8868\u6a5f" : "\u9019\u53f0\u9084\u6c92\u6709\u5370\u8868\u6a5f"}</option>
                {printerName && !printers.includes(printerName) ? (
                  <option value={printerName}>{printerName}</option>
                ) : null}
                {printers.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            {row.id === "simple" && (
              <>
                <label>
                  {"\u8655\u65b9\u5b57\u7d1a "}
                  <input
                    className={`${input} w-24`}
                    type="number"
                    min={7}
                    max={16}
                    step={0.5}
                    value={rxFont}
                    onChange={(e) => setRxFont(Number(e.target.value))}
                  />
                </label>
                <label>
                  {"\u85e5\u540d\u5b57\u7d1a "}
                  <input
                    className={`${input} w-24`}
                    type="number"
                    min={7}
                    max={16}
                    step={0.5}
                    value={drugFont}
                    onChange={(e) => setDrugFont(Number(e.target.value))}
                  />
                </label>
                <p className="col-span-2 text-[11px] text-[#606060]">
                  {"\u8655\u65b9\u5b57\u7d1a\u7ba1\u62ac\u982d\u3001\u53f3\u4e0a\u9662\u6240\u540d\u7a31\u548c\u53f3\u5074\u4e0b\u65b9\u8cbb\u7528\u660e\u7d30\u3002\u85e5\u540d\u5b57\u7d1a\u53ea\u7ba1\u85e5\u54c1\u90a3\u4e00\u6bb5\u3002"}
                </p>
              </>
            )}
            {row.layoutFixed ? (
              <p className="col-span-2 text-[11px] text-[#404040]">
                {row.id === "deposit"
                  ? "\u7248\u9762\u7dad\u6301\u5de6\u53f3\u5169\u806f\u3002\u9577\u5bec\u5728\u4e0a\u9762\u6539\uff0c\u4e0b\u9762\u662f\u9019\u4e00\u9805\u81ea\u5df1\u7684\u5217\u5370\u9805\u76ee\u3002"
                  : "\u9019\u4efd\u55ae\u64da\u7684\u7d19\u5f35\u7248\u9762\u4f9d\u898f\u5b9a\u3002\u4e0b\u9762\u662f\u9019\u4e00\u9805\u81ea\u5df1\u7684\u5217\u5370\u9805\u76ee\u3002"}
              </p>
            ) : (
              <label className="col-span-2">
                {"\u8868\u5c3e "}
                <input className={`${input} w-[18rem]`} value={footer} onChange={(e) => setFooter(e.target.value)} />
              </label>
            )}
          </div>
          {loading && <p>{"\u8f09\u5165\u9662\u6240\u53c3\u6578\u2026"}</p>}
          {!loading && items.length === 0 && (
            <p>
              {row.id === "audit"
                ? "\u53f3\u908a\u5c31\u662f\u9019\u5f35\u62bd\u5be9\u55ae\u7684\u7248\u9762\u3002\u7d19\u5f35\u548c\u5370\u8868\u6a5f\u5b58\u9019\u88e1\u3002\u770b\u8a3a\u756b\u9762\u9084\u6c92\u6709\u6309\u9215\u9001\u5370\u9019\u5f35\u3002"
                : row.layoutFixed
                  ? "\u53f3\u908a\u5c31\u662f\u8a3a\u7642\u9001\u5370\u7684\u540c\u4e00\u5f35\u3002\u7d19\u5f35\u4f9d\u898f\u5b9a\uff0c\u9019\u88e1\u9078\u5370\u8868\u6a5f\u3002"
                  : "\u9019\u4efd\u55ae\u76ee\u524d\u53ea\u8a2d\u7d19\u5f35\u548c\u5370\u8868\u6a5f\u3002\u7528\u4e0d\u5230\u7684\u9805\u76ee\u4e0d\u653e\u9032\u4f86\u3002"}
            </p>
          )}
          {groups.map((group) => (
            <section key={group.name} className="border border-[#808080] bg-white">
              <div className="bg-[#ECE9D8] px-2 py-0.5 font-bold">{group.name}</div>
              <div className="space-y-1 p-2">
                {group.rows.map((item) => {
                  const key = rowKey(item);
                  const value = draft[key] ?? "";
                  const guide = fieldGuide(item);
                  const shown = value.trim() ? value : guide.fallback;
                  if (guide.kind === "check") {
                    const on = flagState(shown) === true;
                    return (
                      <label
                        key={key}
                        className="flex items-start gap-1"
                        title={guide.hint}
                        onMouseEnter={() => setFocusEntry(item.entry)}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={on}
                          onChange={(e) => {
                            setFocusEntry(item.entry);
                            setDraft((prev) => ({
                              ...prev,
                              [key]: flagToStored(e.target.checked, item.value || ""),
                            }));
                          }}
                        />
                        <span>
                          {item.entry}
                          <span className="ml-1 font-normal text-[#606060]">{guide.hint}</span>
                        </span>
                      </label>
                    );
                  }
                  if (guide.kind === "select") {
                    const options = guide.options.some((choice) => choice.value === shown)
                      ? guide.options
                      : [{ value: shown, label: shown }, ...guide.options];
                    return (
                      <label
                        key={key}
                        className="flex items-center gap-1"
                        title={guide.hint}
                        onMouseEnter={() => setFocusEntry(item.entry)}
                      >
                        <span className="min-w-0 flex-1">
                          {item.entry}
                          <span className="ml-1 font-normal text-[#606060]">{guide.hint}</span>
                        </span>
                        <select
                          className={`${input} w-40`}
                          value={shown}
                          onChange={(e) => {
                            setFocusEntry(item.entry);
                            setDraft((prev) => ({ ...prev, [key]: e.target.value }));
                          }}
                        >
                          {options.map((choice) => (
                            <option key={choice.value} value={choice.value}>
                              {choice.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  }
                  return (
                    <label
                      key={key}
                      className="flex items-center gap-1"
                      title={guide.hint}
                      onMouseEnter={() => setFocusEntry(item.entry)}
                    >
                      <span className="min-w-0 flex-1">
                        {item.entry}
                        {guide.hint ? (
                          <span className="ml-1 font-normal text-[#606060]">{guide.hint}</span>
                        ) : null}
                      </span>
                      <input
                        className={`${input} w-36`}
                        value={value}
                        placeholder={guide.hint}
                        onChange={(e) => {
                          setFocusEntry(item.entry);
                          setDraft((prev) => ({ ...prev, [key]: e.target.value }));
                        }}
                      />
                    </label>
                  );
                })}
              </div>
            </section>
          ))}
          {error && <p className="font-bold text-[#800000]">{error}</p>}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#D0D0D0]">
          <div className="bg-[#ECE9D8] px-2 py-0.5 text-[12px] font-bold">
            {"\u7bc4\u4f8b\u9810\u89bd\uff08\u4e0d\u662f\u67d0\u4f4d\u75c5\u60a3\uff09"}
            {focusEntry && !settingMovesPreview(focusEntry)
              ? "\u3000\u9019\u4e00\u9805\u591a\u534a\u662f\u5831\u8868\u6216\u5225\u7684\u55ae\u64da\uff0c\u9019\u5f35\u7bc4\u4f8b\u4e0a\u770b\u4e0d\u5230"
              : ""}
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
            {pages.map((page, index) => (
              <PaperFrame
                key={index}
                html={page.html}
                widthMm={widthMm}
                heightMm={heightMm}
                padTopMm={page.padTopMm}
                padLeftMm={page.padLeftMm}
                caption={pages.length > 1 ? `\u7b2c ${index + 1} \u5f35` : ""}
              />
            ))}
          </div>
        </div>
        </div>
        <div className="flex justify-end gap-2 border-t bg-[#ECE9D8] px-2 py-1" style={{ borderColor: "#808080" }}>
          <button
            type="button"
            className="border border-[#808080] bg-[#D4D0C8] px-3 py-0.5 text-[12px] font-bold"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "\u5b58\u6a94\u4e2d\u2026" : "\u5b58\u6a94"}
          </button>
          <button
            type="button"
            className="border border-[#808080] bg-[#D4D0C8] px-3 py-0.5 text-[12px]"
            onClick={onClose}
          >
            {"\u53d6\u6d88"}
          </button>
        </div>
      </div>
    </div>
  );
}
