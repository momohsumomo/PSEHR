import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchSciniSettings,
  saveSciniValues,
  saveClinicDevice,
  type SciniRow,
} from "@/api/clinicApi";
import { loadLocalDeviceMeta, type DeviceRole } from "@/lib/clinicDevice";
import { loadClinicBundle, persistClinicBundle, type ClinicFees } from "@/lib/clinicProfile";

/** These names are copied into clinic fees and used at registration. The other rows are stored only. */
const LIVE_FEE: Record<string, keyof ClinicFees> = {
  "\u81ea\u8cbb\u6848\u4ef6\u639b\u865f\u8cbb\u7528": "regFeeSelfPay",
  "\u5e7e\u6b72\u4ee5\u4e0a\u512a\u5f85\u7684\u91d1\u984d": "seniorDiscount",
  "A3 \u6210\u5065\u7684\u639b\u865f\u8cbb": "regFeeAdultCheckup",
  "A3 \u5152\u7ae5\u9810\u9632\u4fdd\u5065\u7684\u639b\u865f\u8cbb": "regFeeChildCare",
  "A3 \u53e3\u8154\u7be9\u6aa2\u639b\u865f\u8cbb": "regFeeCancerScreen",
};

type ScopeMode = "clinic" | "device";

const SECTION_ORDER = [
  "Register",
  "Doctor",
  "Printer",
  "Price",
  "Medical",
  "User",
  "DRUGCONTROL",
  "OTHER",
  "Rx",
  "SF",
  "EMR",
  "MsgSet",
  "Set",
];

/** ASCII-safe labels (Windows tooling must not corrupt these files). */
const L = {
  title: "\u5176\u4ed6\u53c3\u6578",
  subtitle: "\uff08Scini\uff0fSc.ini \u00b7 \u9662\u6240\u5c64\u70ba\u4e3b\uff09",
  writeLayer: "\u5beb\u5165\u5c64",
  clinicAll: "\u9662\u6240\uff08\u5168\u9ad4\uff09",
  deviceOverride: "\u672c\u6a5f\u8986\u5beb",
  saveChanges: "\u5b58\u6a94\u8b8a\u66f4",
  search: "\u641c\u5c0b",
  searchPh: "\u95dc\u9375\u5b57\uff0f\u7de8\u865f",
  loading: "\u8f09\u5165\u4e2d\u2026",
  colNo: "\u7de8\u865f",
  colItem: "\u8a2d\u5b9a\u9805\u76ee",
  colValue: "\u8a2d\u5b9a\u503c",
  colScope: "\u5efa\u8b70\u5c64",
  colEffect: "\u4f5c\u7528",
  live: "\u6709\u4f5c\u7528",
  archive: "\u53ea\u7559\u5b58",
  onlyLive: "\u53ea\u770b\u6709\u4f5c\u7528",
  showAll: "\u770b\u5168\u90e8",
  banner:
    "\u9019\u5f35\u8868\u6709\u4e00\u5343\u591a\u9805\u820a\u53c3\u6578\u3002\u6a19\u300c\u6709\u4f5c\u7528\u300d\u7684\u6703\u5beb\u9032\u9580\u8a3a\u8cbb\u7528\uff0c\u639b\u865f\u6642\u6703\u7528\u3002\u5176\u9918\u6539\u4e86\u53ea\u7559\u5728\u9019\u88e1\uff0c\u770b\u8a3a\u3001\u5217\u5370\u3001\u7533\u5831\u90fd\u4e0d\u8b80\u3002\u5b58\u6a94\u5f8c\u8981\u4e0d\u8981\u8df3\u5217\u5370\uff0c\u5728\u300c\u672c\u6a5f\u5de5\u4f5c\u7ad9\u300d\u3002\u672a\u6eff 3 \u6b72\u514d\u90e8\u5206\u8ca0\u64d4\u3001\u5b78\u751f\u6e1b\u639b\u865f\u8cbb\uff0c\u5728\u300c\u9580\u8a3a\u8cbb\u7528\u300d\u3002",
  scopeClinic: "\u9662\u6240",
  scopeRole: "\u89d2\u8272",
  scopeDevice: "\u672c\u6a5f",
  noChange: "\u6c92\u6709\u8b8a\u66f4\u3002",
  saveFail: "\u5b58\u6a94\u5931\u6557",
  loadFail:
    "\u7121\u6cd5\u8f09\u5165\u5176\u4ed6\u53c3\u6578\uff08\u8acb\u5148\u532f\u5165 Scini\uff09",
};

type Props = {
  onNotice?: (msg: string) => void;
};

export function SciniParamsEditor({ onNotice }: Props) {
  const [sections, setSections] = useState<string[]>([]);
  const [section, setSection] = useState("Register");
  const [rows, setRows] = useState<SciniRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scopeMode, setScopeMode] = useState<ScopeMode>("clinic");
  const [dirty, setDirty] = useState(false);
  const [liveOnly, setLiveOnly] = useState(false);
  const device = loadLocalDeviceMeta();

  const load = useCallback(async (sec: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSciniSettings(sec, true);
      const list = res.rows || [];
      setRows(list);
      const d: Record<string, string> = {};
      for (const r of list) d[r.entry] = String(r.value ?? "");
      setDraft(d);
      setDirty(false);
      if (res.sections?.length) {
        const ordered = [
          ...SECTION_ORDER.filter((s) => res.sections!.some((x) => x.toLowerCase() === s.toLowerCase())),
          ...res.sections.filter((s) => !SECTION_ORDER.some((o) => o.toLowerCase() === s.toLowerCase())),
        ];
        setSections(ordered);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : L.loadFail);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(section);
  }, [section, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = liveOnly ? rows.filter((r) => LIVE_FEE[r.entry]) : rows;
    if (!q) return base;
    return base.filter(
      (r) =>
        r.entry.toLowerCase().includes(q) ||
        r.seqNo.toLowerCase().includes(q) ||
        String(r.value ?? "")
          .toLowerCase()
          .includes(q),
    );
  }, [rows, query, liveOnly]);

  const setValue = (entry: string, value: string) => {
    setDraft((prev) => ({ ...prev, [entry]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    const patch: Record<string, string> = {};
    for (const r of rows) {
      const next = draft[r.entry] ?? "";
      if (next !== String(r.value ?? "")) patch[r.entry] = next;
    }
    if (!Object.keys(patch).length) {
      onNotice?.(L.noChange);
      return;
    }
    try {
      if (scopeMode === "clinic") {
        await saveSciniValues({ [section]: patch });
        const liveKeys = Object.keys(patch).filter((k) => LIVE_FEE[k]);
        if (liveKeys.length) {
          const bundle = await loadClinicBundle();
          const fees = { ...bundle.fees };
          for (const key of liveKeys) {
            const n = Number(patch[key]);
            if (Number.isFinite(n)) fees[LIVE_FEE[key]] = n;
          }
          await persistClinicBundle({ profile: bundle.profile, fees, workflow: bundle.workflow });
        }
        onNotice?.(
          liveKeys.length
            ? `\u5df2\u5beb\u5165\u9662\u6240\u5c64\u300c${section}\u300d${Object.keys(patch).length} \u9805\uff0c\u5176\u4e2d ${liveKeys.length} \u9805\u5df2\u5e36\u9032\u9580\u8a3a\u8cbb\u7528\u3002`
            : `\u5df2\u5beb\u5165\u9662\u6240\u5c64\u300c${section}\u300d${Object.keys(patch).length} \u9805\u3002\u9019\u4e9b\u53ea\u7559\u5b58\uff0c\u770b\u8a3a\u4e0d\u6703\u8b80\u3002`,
        );
      } else {
        await saveClinicDevice(device.id, {
          label: device.label,
          role: device.role as DeviceRole,
          sciniOverrides: { [section]: patch },
        });
        onNotice?.(
          `\u5df2\u5beb\u5165\u672c\u6a5f\u8986\u5beb\u300c${section}\u300d${Object.keys(patch).length} \u9805\uff08\u50c5\u6b64\u5de5\u4f5c\u7ad9\uff09\u3002`,
        );
      }
      await load(section);
    } catch (e) {
      onNotice?.(e instanceof Error ? e.message : L.saveFail);
    }
  };

  const scopeLabel = (s?: string) =>
    s === "device" ? L.scopeDevice : s === "role" ? L.scopeRole : L.scopeClinic;

  return (
    <div className="flex flex-col min-h-0 flex-1 border" style={{ borderColor: "#808080", background: "#fff" }}>
      <div
        className="flex flex-wrap items-center gap-1 px-1 py-0.5 border-b text-[11px]"
        style={{ borderColor: "#808080", background: "#ECE9D8" }}
      >
        <span className="font-bold">{L.title}</span>
        <span className="opacity-70">{L.subtitle}</span>
        <button
          type="button"
          className="border px-1 py-0.5"
          style={{ borderColor: "#808080", background: liveOnly ? "#7FFFD4" : "#fff" }}
          onClick={() => setLiveOnly((v) => !v)}
        >
          {liveOnly ? L.showAll : L.onlyLive}
        </button>
        <div className="flex-1" />
        <label className="flex items-center gap-1">
          <span>{L.writeLayer}</span>
          <select
            className="border px-1 py-0.5"
            style={{ borderColor: "#808080" }}
            value={scopeMode}
            onChange={(e) => setScopeMode(e.target.value as ScopeMode)}
          >
            <option value="clinic">{L.clinicAll}</option>
            <option value="device">
              {L.deviceOverride}({device.label || device.id})
            </option>
          </select>
        </label>
        <button
          type="button"
          className="px-2 py-0.5 border font-bold"
          style={{ borderColor: "#808080", background: dirty ? "#7FFFD4" : "#D4D0C8" }}
          onClick={() => void handleSave()}
        >
          {L.saveChanges}
        </button>
      </div>

      <div className="flex flex-wrap gap-0 border-b" style={{ borderColor: "#808080", background: "#D4D0C8" }}>
        {(sections.length ? sections : SECTION_ORDER).map((s) => (
          <button
            key={s}
            type="button"
            className="px-2 py-0.5 text-[11px] font-bold border-r"
            style={{
              borderColor: "#808080",
              background: section.toLowerCase() === s.toLowerCase() ? "#B8E0E0" : "#A0A0A0",
              color: section.toLowerCase() === s.toLowerCase() ? "#000" : "#fff",
            }}
            onClick={() => setSection(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <p className="px-2 py-1 text-[11px] leading-relaxed border-b" style={{ borderColor: "#808080", background: "#FFFFCC" }}>
        {L.banner}
      </p>

      <div className="px-1 py-0.5 border-b flex items-center gap-2" style={{ borderColor: "#808080" }}>
        <span className="text-[11px]">{L.search}</span>
        <input
          className="flex-1 border px-1 py-0.5 text-[12px] font-mono"
          style={{ borderColor: "#808080" }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={L.searchPh}
        />
        <span className="text-[11px] opacity-70">
          {filtered.length}/{rows.length}
        </span>
      </div>

      {error && (
        <p className="px-2 py-1 text-[11px] bg-[#FFFFCC] border-b" style={{ borderColor: "#808080" }}>
          {error}
        </p>
      )}

      <div className="flex-1 overflow-auto min-h-[280px]">
        {loading ? (
          <p className="p-2 text-[11px]">{L.loading}</p>
        ) : (
          <table className="w-full text-[11px] border-collapse">
            <thead className="sticky top-0" style={{ background: "#ECE9D8" }}>
              <tr>
                <th className="border px-1 py-0.5 text-left w-14" style={{ borderColor: "#808080" }}>
                  {L.colNo}
                </th>
                <th className="border px-1 py-0.5 text-left" style={{ borderColor: "#808080" }}>
                  {L.colItem}
                </th>
                <th className="border px-1 py-0.5 text-left w-40" style={{ borderColor: "#808080" }}>
                  {L.colValue}
                </th>
                <th className="border px-1 py-0.5 text-left w-16" style={{ borderColor: "#808080" }}>
                  {L.colEffect}
                </th>
                <th className="border px-1 py-0.5 text-left w-16" style={{ borderColor: "#808080" }}>
                  {L.colScope}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const opts = (r.combox || "")
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean);
                const val = draft[r.entry] ?? "";
                return (
                  <tr
                    key={`${r.seqNo}-${r.entry}`}
                    className="hover:bg-[#FFFFEE]"
                    style={LIVE_FEE[r.entry] ? { background: "#E5FFE5" } : undefined}
                  >
                    <td className="border px-1 py-0.5 font-mono align-top" style={{ borderColor: "#c0c0c0" }}>
                      {r.seqNo}
                    </td>
                    <td className="border px-1 py-0.5 align-top" style={{ borderColor: "#c0c0c0" }}>
                      {r.entry}
                    </td>
                    <td className="border px-1 py-0.5 align-top" style={{ borderColor: "#c0c0c0" }}>
                      {opts.length >= 2 && opts.length <= 12 ? (
                        <select
                          className="w-full border px-0.5 py-0.5 font-mono"
                          style={{ borderColor: "#808080" }}
                          value={val}
                          onChange={(e) => setValue(r.entry, e.target.value)}
                        >
                          {!opts.includes(val) && val !== "" && <option value={val}>{val}</option>}
                          {opts.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="w-full border px-0.5 py-0.5 font-mono"
                          style={{ borderColor: "#808080" }}
                          value={val}
                          onChange={(e) => setValue(r.entry, e.target.value)}
                        />
                      )}
                    </td>
                    <td className="border px-1 py-0.5 align-top text-center" style={{ borderColor: "#c0c0c0" }}>
                      {LIVE_FEE[r.entry] ? L.live : L.archive}
                    </td>
                    <td className="border px-1 py-0.5 align-top text-center" style={{ borderColor: "#c0c0c0" }}>
                      {scopeLabel(r.suggestedScope)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
