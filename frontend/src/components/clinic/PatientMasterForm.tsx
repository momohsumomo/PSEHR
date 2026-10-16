import { useState, type CSSProperties } from "react";
import { useEscLayer } from "@/hooks/useEscLayer";
import { HIS, HIS_FONT } from "@/lib/hisTheme";
import type { PatientRecord } from "@/lib/patientMaster";
import { IdCategoryTableDialog } from "@/components/clinic/IdCategoryTableDialog";
import type { IdCategorySetting } from "@/api/clinicApi";

export type IdCategoryOption = {
  code: string;
  deposit?: number;
  reg_fee?: number;
  copay?: number;
};

const DEFAULT_KIND_OPTIONS = [
  "D10 一般案",
  "D11 職傷案",
  "D12 一般門診",
  "D13 重大傷病",
  "D14 慢性病",
  "D16 結核病",
  "D17 安寧",
  "D21 洗腎",
  "自費",
];

/** 病歷上該身份幾乎都是同一個優待方式才代選。混用的不在這裡。 */
function copayDiscForIdentity(code: string): "1" | "2" | null {
  const key = code.trim();
  if (key === "A") return "2";
  if (
    key === "D" ||
    key === "S" ||
    key === "B" ||
    key === "C" ||
    key === "老人優" ||
    key === "老優" ||
    key === "自費" ||
    key === "自" ||
    key === "身輕度" ||
    key === "身中度" ||
    key === "身重度"
  ) {
    return "1";
  }
  return null;
}

const BLOOD_OPTIONS = ["", "A", "B", "O", "AB"];
const MARRY_OPTIONS = ["", "已婚", "未婚", "其他"];

type Props = {
  value: PatientRecord;
  onChange: (next: PatientRecord) => void;
  readOnly?: boolean;
  showSpeak?: boolean;
  className?: string;
  idCategoryOptions?: IdCategoryOption[];
  kindOptions?: string[];
};

const lab: CSSProperties = {
  fontSize: 11,
  fontFamily: HIS_FONT,
  color: "#000",
  fontWeight: 700,
  whiteSpace: "nowrap",
  background: "#d0d0d0",
  border: "1px solid #a0a0a0",
  padding: "1px 3px",
};

const inpBase = (ro?: boolean): CSSProperties => ({
  height: 18,
  fontSize: 11,
  fontFamily: HIS_FONT,
  color: HIS.inputBlue,
  border: "1px inset #808080",
  padding: "0 2px",
  background: ro ? "#E8F0E8" : "#fff",
  fontWeight: 700,
  outline: "none",
});

function Row({ children }: { children: React.ReactNode }) {
  return <div className="mb-0.5 flex flex-wrap items-center gap-1">{children}</div>;
}

/**
 * 醫聖病患主檔表單（對齊 lookalike pat-idblock + pat-3col）。
 * 大廳 /patients 與診療／掛號 F5 共用。
 */
export function PatientMasterForm({
  value,
  onChange,
  readOnly,
  showSpeak,
  className = "",
  idCategoryOptions = [],
  kindOptions,
}: Props) {
  const ro = !!readOnly;
  const [idTableOpen, setIdTableOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  useEscLayer([{ open: pickOpen, close: () => setPickOpen(false) }]);
  const [localCats, setLocalCats] = useState<IdCategorySetting[] | null>(null);
  const categorySource: IdCategoryOption[] = localCats ?? idCategoryOptions;
  const set = <K extends keyof PatientRecord>(key: K, v: PatientRecord[K]) =>
    onChange({ ...value, [key]: v });

  const kinds = kindOptions?.length
    ? kindOptions
    : [
        ...DEFAULT_KIND_OPTIONS,
        ...(value.kind && !DEFAULT_KIND_OPTIONS.includes(value.kind) ? [value.kind] : []),
      ];

  const categoryCodes = Array.from(
    new Set([
      ...categorySource.map((c) => c.code).filter(Boolean),
      ...(value.idCategory ? [value.idCategory] : []),
    ]),
  );

  const applyIdCategory = (code: string) => {
    const hit = categorySource.find((c) => c.code === code);
    const next: PatientRecord = { ...value, idCategory: code };
    if (hit && (hit.deposit != null || hit.deposit === 0)) {
      const prevHit = categorySource.find((c) => c.code === value.idCategory);
      const prevDeposit = prevHit != null ? String(prevHit.deposit ?? "") : null;
      const cur = String(value.deposit ?? "").trim();
      if (!cur || (prevDeposit != null && cur === prevDeposit)) {
        next.deposit = String(hit.deposit ?? 0);
      }
    }
    // 病歷上幾乎固定的才代選。老+榮、福保、榮民兩種都很多，不代選。
    const disc = copayDiscForIdentity(code);
    if (disc) next.copayDisc = disc;
    onChange(next);
  };

  const addrParts = (() => {
    const full = value.address || "";
    const m = full.match(/^(.*?[市縣].*?[區鄉鎮市])\s*(.*)$/);
    if (m) return { city: m[1], detail: m[2] || "" };
    return { city: "", detail: full };
  })();

  const setAddressParts = (city: string, detail: string) => {
    set("address", [city.trim(), detail.trim()].filter(Boolean).join(""));
  };

  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden p-1 ${className}`}
      style={{ fontFamily: HIS_FONT, background: HIS.patientFace, fontSize: 11 }}
    >
      <datalist id="patient-master-id-categories">
        {categoryCodes.map((cat) => (
          <option key={cat} value={cat} />
        ))}
      </datalist>
      <datalist id="patient-master-kinds">
        {kinds.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>

      <div className="min-h-0 flex-1 overflow-auto">
      {/* pat-idblock */}
      <div
        className="mb-1 shrink-0 border p-1"
        style={{ borderColor: "#608060", background: HIS.patientFace }}
      >
        <Row>
          <span style={lab}>病歷號&lt;M&gt;</span>
          <input style={{ ...inpBase(true), width: 72 }} value={value.medicalNo} readOnly />
          <button
            type="button"
            className="border border-[#808080] bg-[#e8e4dc] px-1 text-[10px]"
            disabled={ro}
            title="自動編證號"
          >
            自動編證號
          </button>
          <span style={lab}>姓　名&lt;N&gt;</span>
          <input
            style={{ ...inpBase(ro), width: 120 }}
            value={value.name}
            readOnly={ro}
            onChange={(e) => set("name", e.target.value)}
          />
          {showSpeak ? (
            <button
              type="button"
              className="border border-[#80C080] bg-[#C5EBC5] px-1 text-[12px]"
              title="發音叫號"
              onClick={() => {
                if (!value.name) return;
                const utter = new SpeechSynthesisUtterance(`${value.name} 號，請進`);
                utter.lang = "zh-TW";
                window.speechSynthesis.speak(utter);
              }}
            >
              {"\uD83D\uDD0A"}
            </button>
          ) : null}
        </Row>
        <Row>
          <span style={lab}>生　日&lt;B&gt;</span>
          <input
            style={{ ...inpBase(ro), width: 70 }}
            className="font-mono"
            maxLength={7}
            placeholder="0500425"
            value={value.birthday}
            readOnly={ro}
            onChange={(e) => set("birthday", e.target.value.replace(/\D/g, "").slice(0, 7))}
          />
          <span style={lab}>身分證&lt;I&gt;</span>
          <input
            style={{ ...inpBase(ro), width: 100 }}
            className="font-mono uppercase"
            value={value.idNo}
            readOnly={ro}
            onChange={(e) => set("idNo", e.target.value.toUpperCase())}
          />
          <span style={lab}>性　別</span>
          <select
            style={{ ...inpBase(ro), width: 48 }}
            disabled={ro}
            value={value.sex}
            onChange={(e) => set("sex", e.target.value)}
          >
            <option>男</option>
            <option>女</option>
            <option>其他</option>
          </select>
          <span style={lab}>血　型</span>
          <select
            style={{ ...inpBase(ro), width: 48 }}
            disabled={ro}
            value={value.bloodType}
            onChange={(e) => set("bloodType", e.target.value)}
          >
            {BLOOD_OPTIONS.map((b) => (
              <option key={b || "_"} value={b}>
                {b}
              </option>
            ))}
          </select>
        </Row>
        <Row>
          <span style={lab}>電　話&lt;T&gt;</span>
          <input
            style={{ ...inpBase(ro), width: 90 }}
            className="font-mono"
            value={value.phone}
            readOnly={ro}
            onChange={(e) => set("phone", e.target.value)}
          />
          <span style={lab}>電話二</span>
          <input
            style={{ ...inpBase(ro), width: 90 }}
            className="font-mono"
            value={value.contactPhone}
            readOnly={ro}
            onChange={(e) => set("contactPhone", e.target.value)}
          />
          <span style={lab}>行動電話</span>
          <input
            style={{ ...inpBase(ro), width: 100 }}
            className="font-mono"
            value={value.phone2}
            readOnly={ro}
            onChange={(e) => set("phone2", e.target.value)}
          />
        </Row>
        <Row>
          <span style={lab}>地址編修A</span>
          <input
            style={{ ...inpBase(ro), width: 100 }}
            value={addrParts.city}
            readOnly={ro}
            onChange={(e) => setAddressParts(e.target.value, addrParts.detail)}
          />
          <span style={lab}>郵遞區號</span>
          <input
            style={{ ...inpBase(ro), width: 40 }}
            className="font-mono"
            value={value.postalCode}
            readOnly={ro}
            onChange={(e) => set("postalCode", e.target.value)}
          />
          <span style={lab}>婚姻狀況</span>
          <select
            style={{ ...inpBase(ro), width: 70 }}
            disabled={ro}
            value={value.marry}
            onChange={(e) => set("marry", e.target.value)}
          >
            {MARRY_OPTIONS.map((m) => (
              <option key={m || "_"} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Row>
        <Row>
          <input
            style={{ ...inpBase(ro), flex: 1, minWidth: 260 }}
            value={addrParts.detail || (!addrParts.city ? value.address : "")}
            readOnly={ro}
            onChange={(e) => setAddressParts(addrParts.city, e.target.value)}
          />
        </Row>
        <Row>
          <span style={lab}>參考住址</span>
          <input
            style={{ ...inpBase(ro), flex: 1, minWidth: 260 }}
            value={value.address2}
            readOnly={ro}
            onChange={(e) => set("address2", e.target.value)}
          />
        </Row>
      </div>

      {/* pat-3col：照護｜健保/押金｜病史 */}
      <div
        className="grid min-h-0 flex-1 gap-1 overflow-auto"
        style={{ gridTemplateColumns: "1.05fr 0.95fr 0.9fr", minHeight: 220 }}
      >
        <div className="border p-1" style={{ borderColor: "#608060", background: HIS.patientFace }}>
          <Row>
            <span style={lab}>病人整合照護</span>
            <input style={{ ...inpBase(ro), width: 140 }} value={value.customId} readOnly={ro} onChange={(e) => set("customId", e.target.value)} />
          </Row>
          <div className="my-1 flex gap-0.5">
            {[
              ["聯絡人", value.contactName],
              ["試辦追蹤", ""],
              ["初診會談", ""],
              ["圖像", ""],
            ].map(([t]) => (
              <button
                key={t}
                type="button"
                className="flex-1 border border-[#808080] bg-[#ece9d8] py-0.5 text-[10px] leading-tight"
                title={t}
              >
                {t}
              </button>
            ))}
          </div>
          <fieldset className="mb-1 border border-[#808080] p-1 text-[11px]">
            <legend className="px-1 font-bold">部份負擔優待方式</legend>
            {(
              [
                ["1", "不要優待 1"],
                ["2", "全部優待 2"],
                ["3", "分級優待 3"],
              ] as const
            ).map(([code, lab]) => (
              <label key={code} className={code === "3" ? "block" : "mr-2"}>
                <input
                  type="radio"
                  name="disc"
                  disabled={ro}
                  checked={(value.copayDisc || "1") === code}
                  onChange={() => set("copayDisc", code)}
                />{" "}
                {lab}
              </label>
            ))}
          </fieldset>
          <div className="mt-1">
            <div className="mb-0.5 font-bold text-[#800000]">過敏特別記載</div>
            <textarea
              className="w-full rounded border border-[#C08080] bg-[#FFE8E8] px-1 py-0.5 font-bold text-[#4A0080]"
              style={{ fontFamily: HIS_FONT, fontSize: 12, minHeight: 56 }}
              readOnly={ro}
              value={value.allergicMemo}
              onChange={(e) => set("allergicMemo", e.target.value)}
            />
          </div>
        </div>

        <div className="border p-1" style={{ borderColor: "#608060", background: HIS.patientFace }}>
          <Row>
            <span style={lab}>健保身份</span>
            <input
              style={{ ...inpBase(ro), width: 150 }}
              list="patient-master-kinds"
              value={value.kind}
              readOnly={ro}
              onChange={(e) => set("kind", e.target.value)}
            />
          </Row>
          <Row>
            <span style={lab}>健保卡號</span>
            <input
              style={{ ...inpBase(ro), width: 130 }}
              className="font-mono"
              value={value.nhiCardNo}
              readOnly={ro}
              onChange={(e) => set("nhiCardNo", e.target.value)}
            />
          </Row>
          <Row>
            <button
              type="button"
              style={{ ...lab, cursor: "pointer" }}
              title="進入身分類別設定（押金、掛號費、部份負擔）"
              onClick={() => setIdTableOpen(true)}
            >
              身份類別
            </button>
            <input
              style={{ ...inpBase(ro), width: 72 }}
              className="font-mono"
              value={value.idCategory}
              readOnly={ro}
              onChange={(e) => applyIdCategory(e.target.value)}
            />
            <button
              type="button"
              className="border border-[#808080] bg-[#E8F8C8] px-1 text-[11px] font-bold"
              title="選擇這位病患的身份"
              disabled={ro}
              onClick={() => setPickOpen(true)}
            >
              …
            </button>
            {(() => {
              const hit = categorySource.find((c) => c.code === value.idCategory);
              if (!hit) return null;
              return (
                <span className="font-bold text-[#800000]" style={{ fontSize: 11 }}>
                  押金 {hit.deposit ?? 0}　掛號費 {hit.reg_fee ?? 0}　部份負擔 {hit.copay ?? 0}
                </span>
              );
            })()}
          </Row>
          <Row>
            <span style={lab}>押金金額</span>
            <input
              style={{ ...inpBase(ro), width: 56 }}
              className="font-mono"
              value={value.deposit}
              readOnly={ro}
              onChange={(e) => set("deposit", e.target.value.replace(/[^\d.-]/g, ""))}
            />
            <span style={lab}>欠　款</span>
            <input
              style={{ ...inpBase(ro), width: 56 }}
              className="font-mono"
              value={value.arrearage}
              readOnly={ro}
              onChange={(e) => set("arrearage", e.target.value.replace(/[^\d.-]/g, ""))}
            />
          </Row>
          <Row>
            <span style={lab}>父或母 Id</span>
            <input
              style={{ ...inpBase(ro), width: 110 }}
              className="font-mono uppercase"
              value={value.parentId}
              readOnly={ro}
              onChange={(e) => set("parentId", e.target.value.toUpperCase())}
            />
          </Row>
          <Row>
            <span style={lab}>同胎次序</span>
            <input
              style={{ ...inpBase(ro), width: 40 }}
              className="font-mono"
              value={value.birthOrder}
              readOnly={ro}
              onChange={(e) => set("birthOrder", e.target.value)}
            />
          </Row>
          <Row>
            <span style={lab}>入住安養</span>
            <input
              style={{ ...inpBase(ro), width: 70 }}
              className="font-mono"
              value={value.nursingHomeIn}
              readOnly={ro}
              onChange={(e) => set("nursingHomeIn", e.target.value)}
            />
          </Row>
          <Row>
            <span style={lab}>離開安養</span>
            <input
              style={{ ...inpBase(ro), width: 70 }}
              className="font-mono"
              value={value.nursingHomeOut}
              readOnly={ro}
              onChange={(e) => set("nursingHomeOut", e.target.value)}
            />
          </Row>
          <Row>
            <span style={lab}>結案原因</span>
            <input
              style={{ ...inpBase(ro), width: 140 }}
              value={value.closeReason}
              readOnly={ro}
              onChange={(e) => set("closeReason", e.target.value)}
            />
          </Row>
        </div>

        <div
          className="flex min-h-[200px] flex-col border p-1"
          style={{ borderColor: "#608060", background: HIS.patientFace }}
        >
          <Row>
            <span style={lab}>安養院代</span>
            <input
              style={{ ...inpBase(ro), width: 90 }}
              value={value.nursingHomeCode}
              readOnly={ro}
              onChange={(e) => set("nursingHomeCode", e.target.value)}
            />
          </Row>
          <fieldset className="mt-1 flex min-h-0 flex-1 flex-col border border-[#808080] p-1">
            <legend className="px-1 font-bold">病史記載</legend>
            <textarea
              className="min-h-[120px] w-full flex-1 border-0 bg-white p-1"
              style={{ fontFamily: HIS_FONT, fontSize: 12, resize: "none" }}
              readOnly={ro}
              value={value.medicalHistory}
              onChange={(e) => set("medicalHistory", e.target.value)}
            />
          </fieldset>
        </div>
      </div>
      </div>
      <fieldset className="mx-0.5 mb-1 mt-1 shrink-0 border border-[#808080] px-1 py-0.5">
        <legend className="px-1 font-bold">備註記載</legend>
        <textarea
          className="h-12 w-full border-0 bg-white px-1 py-0.5"
          style={{ fontFamily: HIS_FONT, fontSize: 12, resize: "none" }}
          readOnly={ro}
          value={value.memo}
          onChange={(e) => set("memo", e.target.value)}
        />
      </fieldset>
      <IdCategoryTableDialog
        open={idTableOpen}
        onClose={() => setIdTableOpen(false)}
        onSaved={(rows) => setLocalCats(rows)}
      />
      {pickOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPickOpen(false);
          }}
        >
          <div
            className="flex max-h-[70vh] w-[min(22rem,92vw)] flex-col border-2 bg-[#E8F8C8] shadow-xl"
            style={{ borderColor: "#404040", fontFamily: HIS_FONT }}
          >
            <header className="bg-[#D8E8A8] px-2 py-1 text-[12px] font-bold">選擇病患身份</header>
            <div className="min-h-0 flex-1 overflow-auto">
              {categoryCodes.map((code) => {
                const hit = categorySource.find((c) => c.code === code);
                const on = code === value.idCategory;
                return (
                  <button
                    key={code}
                    type="button"
                    className="flex w-full items-center gap-2 border-b px-2 py-1 text-left text-[12px]"
                    style={{ background: on ? "#FFFF80" : "#fff", borderColor: "#C0C080" }}
                    onClick={() => {
                      applyIdCategory(code);
                      setPickOpen(false);
                    }}
                  >
                    <span className="w-16 font-mono font-bold">{code}</span>
                    <span>
                      押金 {hit?.deposit ?? 0}　掛號費 {hit?.reg_fee ?? 0}　部份負擔 {hit?.copay ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end p-1">
              <button type="button" className="border border-[#808080] bg-white px-2 py-0.5 text-[12px]" onClick={() => setPickOpen(false)}>
                關閉
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
