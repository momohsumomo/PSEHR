import { useEffect, useRef, useState } from "react";
import type { PatientHit } from "@/lib/patientSearch";
import { HIS, HIS_FONT } from "@/lib/hisTheme";

type Props = {
  open: boolean;
  onClose: () => void;
  onIcRegister: () => void;
  /** Enter with no hit / after find — cardless register */
  onNoCardRegister: (query?: string) => void;
  /** 有輸入條件按 Enter：另開找人視窗（蓋在畫面上） */
  onSearchPatients?: (query: string) => void;
  /** User picked a patient from inline search */
  onPatientPicked?: (hit: PatientHit) => void;
  onEditSelected?: () => void;
  onIcRelated?: (action: string) => void;
  onOtherQuery?: (action: string) => void;
  /** 這一頁不要出現的按鈕文字 */
  omit?: string[];
  /** Footer: currently selected queue row */
  selectedLabel?: string;
  pharmacist?: string;
  initialQuery?: string;
};

const EXAMPLES: Array<[string, string]> = [
  ["生日輸入法", "50.12.31"],
  ["身分證輸入", "A120056789"],
  ["電話輸入法", "5541871"],
  ["姓名輸入法", "曾健康"],
  ["病歷號輸入", "123456"],
  ["自定號輸入", "+1234"],
  ["虛擬讀卡", "直接掃描 QR CODE"],
];

const IC_ACTIONS = [
  "讀卡認證",
  "IC 資訊",
  "IC 退押",
  "IC 寫入",
  "每日上傳",
  "調閱退押",
  "醫事登入",
  "過敏藥物",
];

const OTHER_ACTIONS = [
  "收支",
  "成健",
  "轉診",
  "雲端",
  "管藥",
  "疫苗",
  "IC更新",
  "戒菸",
  "兒童",
];

/**
 * F2 register hub — one full dialog; focus lands on「任意條件查詢」immediately.
 * No second-step「手動查詢」button.
 */
export function RegisterOptionsDialog({
  open,
  onClose,
  onIcRegister,
  onNoCardRegister,
  onSearchPatients,
  onEditSelected,
  onIcRelated,
  onOtherQuery,
  omit = [],
  selectedLabel,
  pharmacist,
  initialQuery = "",
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
    return () => window.clearTimeout(t);
  }, [open, initialQuery]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        return;
      }
      if (ev.key === "F9") {
        ev.preventDefault();
        onClose();
        onIcRegister();
        return;
      }
      if (ev.key === "F3") {
        ev.preventDefault();
        onClose();
        onEditSelected?.();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose, onIcRegister, onEditSelected]);

  if (!open) return null;

  const handleEnterFromSearch = () => {
    const q = query.trim();
    if (!q) {
      onClose();
      onNoCardRegister();
      return;
    }
    onSearchPatients?.(q);
  };

  const titlePharmacist = pharmacist
    ? `（收支人員:${pharmacist}）`
    : "";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-2"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden border-2 shadow-lg"
        style={{
          borderColor: "#404040",
          background: HIS.chrome,
          fontFamily: HIS_FONT,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="flex shrink-0 items-center gap-2 px-2 py-0.5 text-[11px] font-bold text-white"
          style={{
            background: `linear-gradient(180deg,${HIS.titleBarFrom},${HIS.titleBarTo} 45%,${HIS.titleBarFrom})`,
            borderBottom: `1px solid ${HIS.titleBarBorder}`,
          }}
        >
          <span className="min-w-0 flex-1 truncate">
            {titlePharmacist} 目前IC讀卡機的Com Port為 : 1
          </span>
          <button
            type="button"
            className="border border-white/40 bg-white/15 px-1.5 text-[10px]"
            onClick={onClose}
          >
            Esc
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-2 overflow-auto p-2 md:grid-cols-[1.35fr_1fr]">
          {/* Left: search + examples + IC */}
          <div className="flex min-h-0 flex-col gap-2">
            <div
              className="flex flex-wrap items-center gap-2 border bg-white px-2 py-1.5"
              style={{ borderColor: HIS.chromeBorder }}
            >
              <span className="shrink-0 text-[13px] font-bold text-[#003C74]">
                任意條件查詢：
              </span>
              <input
                ref={inputRef}
                type="search"
                className="min-w-[12rem] flex-1 border-0 bg-transparent font-mono text-[15px] font-bold outline-none"
                style={{ color: HIS.inputBlue, height: 26 }}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    handleEnterFromSearch();
                  }
                }}
                placeholder="病歷號／姓名／身分證／電話／生日"
                autoComplete="off"
              />
            </div>

            <fieldset
              className="border bg-white p-2"
              style={{ borderColor: HIS.chromeBorder }}
            >
              <legend className="px-1 text-[11px] font-bold">各項條件輸入範例</legend>
              <p className="mb-1 text-[10px] text-[#606060]">
                下列為範例，請在上方「任意條件查詢」輸入（不是分欄位）
              </p>
              {EXAMPLES.map(([lab, val]) => (
                <div key={lab} className="flex gap-1 text-[11px] leading-snug">
                  <span className="w-[5.5rem] shrink-0 font-bold text-[#003C74]">{lab}</span>
                  <span className="text-[#606060]">:</span>
                  <span className="font-mono font-bold" style={{ color: HIS.inputBlue }}>
                    {val}
                  </span>
                </div>
              ))}
            </fieldset>

            <fieldset
              className="border p-2"
              style={{ borderColor: HIS.chromeBorder, background: "#E8F0FF" }}
            >
              <legend className="px-1 text-[11px] font-bold">IC 卡相關作業</legend>
              <div className="grid grid-cols-4 gap-1">
                {IC_ACTIONS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="border px-0.5 py-1.5 text-[10px] font-bold leading-tight"
                    style={{ borderColor: HIS.chromeBorder, background: "#D4D0C8" }}
                    onClick={() => {
                      onClose();
                      onIcRelated?.(t);
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          {/* Right: register + other */}
          <div className="flex flex-col gap-2">
            <fieldset
              className="border p-2"
              style={{ borderColor: "#206020", background: "#E8FFE8" }}
            >
              <legend className="px-1 text-[11px] font-bold">掛號選項</legend>
              <button
                type="button"
                className="mb-2 w-full border-2 px-3 py-4 text-left text-[17px] font-extrabold"
                style={{
                  borderColor: "#004080",
                  background: "linear-gradient(180deg,#C8E0FF,#80B0E0)",
                  color: "#000080",
                }}
                onClick={() => {
                  onClose();
                  onIcRegister();
                }}
              >
                [F9] IC卡掛號
              </button>
              <button
                type="button"
                className="w-full border-2 px-3 py-4 text-left text-[17px] font-extrabold"
                style={{
                  borderColor: "#804000",
                  background: "linear-gradient(180deg,#FFE8C0,#F0C080)",
                  color: "#603000",
                }}
                onClick={() => {
                  onClose();
                  onNoCardRegister(query.trim() || undefined);
                }}
              >
                [ENTER] 無卡掛號
              </button>
              <div className="mt-2 grid grid-cols-4 gap-1">
                {["移至G", "銷售D", "調閱S", "切換卡機"].map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="border px-0.5 py-1 text-[10px] font-bold"
                    style={{ borderColor: HIS.chromeBorder, background: "#D4D0C8" }}
                    onClick={() => {
                      onClose();
                      onOtherQuery?.(t);
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset
              className="border p-2"
              style={{ borderColor: "#808000", background: "#FFFFE0" }}
            >
              <legend className="px-1 text-[11px] font-bold">其他 作業/查詢</legend>
              <div className="grid grid-cols-3 gap-1">
                {OTHER_ACTIONS.filter((t) => !omit.includes(t)).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="border px-0.5 py-1.5 text-[10px] font-bold"
                    style={{ borderColor: HIS.chromeBorder, background: "#D4D0C8" }}
                    onClick={() => {
                      onClose();
                      onOtherQuery?.(t);
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        </div>

        <div
          className="flex shrink-0 items-center gap-2 border-t px-2 py-1"
          style={{
            borderColor: HIS.chromeBorder,
            background: "linear-gradient(180deg,#f4f2e8,#ece9d8)",
          }}
        >
          <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-[#003C74]">
            {selectedLabel || "—"}
          </span>
          <button
            type="button"
            className="border px-2 py-0.5 text-[11px] font-bold text-white"
            style={{ borderColor: "#003C74", background: "#0A5AD6" }}
            onClick={() => {
              onClose();
              onEditSelected?.();
            }}
          >
            [F3] 修編
          </button>
          <button
            type="button"
            className="border px-2 py-0.5 text-[11px] font-bold text-white"
            style={{ borderColor: "#800000", background: "#CC0000" }}
            onClick={onClose}
          >
            離開
          </button>
        </div>
      </div>
    </div>
  );
}
