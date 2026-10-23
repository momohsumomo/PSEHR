import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useEscLayer } from "@/hooks/useEscLayer";
import { HIS, HIS_FONT } from "@/lib/hisTheme";
import type { PatientRecord } from "@/lib/patientMaster";
import { AddressEditorDialog } from "@/components/clinic/AddressEditorDialog";
import { IdCategoryTableDialog } from "@/components/clinic/IdCategoryTableDialog";
import { RocBirthdayInput } from "@/components/clinic/RocBirthdayInput";
import { fetchHomeAddressByPhone, type IdCategorySetting } from "@/api/clinicApi";

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
  fontSize: 16,
  fontFamily: HIS_FONT,
  color: "#000",
  fontWeight: 700,
  whiteSpace: "nowrap",
  background: "#d0d0d0",
  border: "1px solid #a0a0a0",
  padding: "1px 3px",
};

const inpBase = (ro?: boolean): CSSProperties => ({
  height: 30,
  fontSize: 16,
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
  const [addressOpen, setAddressOpen] = useState(false);
  const mobileRef = useRef<HTMLInputElement>(null);
  const addressBtnRef = useRef<HTMLButtonElement>(null);
  const phoneLenRef = useRef((value.phone || "").length);
  useEffect(() => {
    phoneLenRef.current = (value.phone || "").length;
  }, [value.id]);
  const onHomePhone = (raw: string) => {
    const next = raw.slice(0, 10);
    const finished = phoneLenRef.current < 10 && next.length === 10;
    phoneLenRef.current = next.length;
    set("phone", next);
    if (!finished || ro) return;
    const current = value;
    void (async () => {
      let address = current.address;
      let postalCode = current.postalCode;
      if (!address.trim()) {
        try {
          const hit = await fetchHomeAddressByPhone(next, current.id || "");
          if (hit.address) {
            address = hit.address;
            if (hit.postalCode) postalCode = hit.postalCode;
          }
        } catch {
          /* leave the address blank */
        }
      }
      if (address !== current.address || postalCode !== current.postalCode) {
        onChange({ ...current, phone: next, address, postalCode });
      }
      mobileRef.current?.focus();
    })();
  };
  useEscLayer([{ open: pickOpen, close: () => setPickOpen(false) }]);
  const [localCats, setLocalCats] = useState<IdCategorySetting[] | null>(null);
  const depositFollow = useRef("");
  const valueRef = useRef(value);
  valueRef.current = value;
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
    if (hit && hit.deposit != null) next.deposit = String(hit.deposit ?? 0);
    // 病歷上幾乎固定的才代選。老+榮、福保、榮民兩種都很多，不代選。
    if (hit) next.copayDisc = Number(hit.copay) > 0 ? "2" : "1";
    else {
      const disc = copayDiscForIdentity(code);
      if (disc) next.copayDisc = disc;
    }
    onChange(next);
    depositFollow.current = `${value.id}|${code}|${hit?.deposit ?? ""}`;
  };

  useEffect(() => {
    if (ro) return;
    const current = valueRef.current;
    const code = (current.idCategory || "").trim();
    if (!code) return;
    const hit = categorySource.find((c) => c.code === code);
    if (!hit || hit.deposit == null) return;
    const token = `${current.id}|${code}|${hit.deposit}`;
    if (depositFollow.current === token) return;
    depositFollow.current = token;
    const want = String(hit.deposit ?? 0);
    if (String(current.deposit ?? "").trim() === want) return;
    onChange({ ...current, deposit: want });
  }, [value.id, value.idCategory, categorySource, ro, onChange]);

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
      className={`flex h-full min-h-0 flex-col overflow-y-auto p-1 ${className}`}
      style={{ fontFamily: HIS_FONT, background: HIS.patientFace, fontSize: 16 }}
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

      <div>
      {/* pat-idblock */}
      <div
        className="mb-1 shrink-0 border p-1"
        style={{ borderColor: "#608060", background: HIS.patientFace }}
      >
        <Row>
          <span style={lab}>病歷號&lt;M&gt;</span>
          <input style={{ ...inpBase(true), width: 120 }} value={value.medicalNo} readOnly />
          <button
            type="button"
            className="border border-[#808080] bg-[#e8e4dc] px-1 text-[15px]"
            disabled={ro}
            title="自動編證號"
          >
            自動編證號
          </button>
          <span style={lab}>姓　名&lt;N&gt;</span>
          <input
            style={{ ...inpBase(ro), width: 180 }}
            value={value.name}
            readOnly={ro}
            onChange={(e) => set("name", e.target.value)}
          />
          {showSpeak ? (
            <button
              type="button"
              className="border border-[#80C080] bg-[#C5EBC5] px-1 text-[16px]"
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
          <RocBirthdayInput
            style={{ ...inpBase(ro), width: 140 }}
            className="font-mono"
            value={value.birthday}
            readOnly={ro}
            onChange={(birthday) => set("birthday", birthday)}
          />
          <span style={lab}>身分證&lt;I&gt;</span>
          <input
            style={{ ...inpBase(ro), width: 150 }}
            className="font-mono uppercase"
            value={value.idNo}
            readOnly={ro}
            onChange={(e) => set("idNo", e.target.value.toUpperCase())}
          />
          <span style={lab}>性　別</span>
          <select
            style={{ ...inpBase(ro), width: 72 }}
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
            style={{ ...inpBase(ro), width: 72 }}
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
            style={{ ...inpBase(ro), width: 150 }}
            className="font-mono"
            value={value.phone}
            readOnly={ro}
            maxLength={10}
            onChange={(e) => onHomePhone(e.target.value)}
          />
          <span style={lab}>電話二</span>
          <input
            style={{ ...inpBase(ro), width: 150 }}
            className="font-mono"
            value={value.contactPhone}
            readOnly={ro}
            onChange={(e) => set("contactPhone", e.target.value)}
          />
          <span style={lab}>行動電話</span>
          <input
            style={{ ...inpBase(ro), width: 150 }}
            className="font-mono"
            ref={mobileRef}
            value={value.phone2}
            readOnly={ro}
            onChange={(e) => set("phone2", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !ro) {
                e.preventDefault();
                addressBtnRef.current?.focus();
              }
            }}
          />
        </Row>
        <Row>
          <button ref={addressBtnRef} type="button" style={lab} disabled={ro} onClick={() => setAddressOpen(true)}>
            {"\u5730\u5740\u7de8\u4fee"}
          </button>
          <input
            style={{ ...inpBase(ro), width: 150 }}
            value={addrParts.city}
            readOnly={ro}
            onChange={(e) => setAddressParts(e.target.value, addrParts.detail)}
          />
          <span style={lab}>郵遞區號</span>
          <input
            style={{ ...inpBase(ro), width: 72 }}
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
        className="grid gap-1"
        style={{ gridTemplateColumns: "1.05fr 0.95fr 0.9fr" }}
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
                className="flex-1 border border-[#808080] bg-[#ece9d8] py-0.5 text-[15px] leading-tight"
                title={t}
              >
                {t}
              </button>
            ))}
          </div>
          <fieldset className="mb-1 border border-[#808080] p-1 text-[16px]">
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
              style={{ fontFamily: HIS_FONT, fontSize: 16, minHeight: 56 }}
              readOnly={ro}
              value={value.allergicMemo}
              onChange={(e) => set("allergicMemo", e.target.value)}
            />
          </div>
        </div>

        <div
          className="border p-1 [&_input]:!h-6 [&_select]:!h-6 [&>div]:!mb-0"
          style={{ borderColor: "#608060", background: HIS.patientFace }}
        >
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
              title={"\u8eab\u5206\u985e\u5225\uff1a\u62bc\u91d1\u3001\u639b\u8cbb\u512a\u5f85\u3001\u90e8\u5206\u8ca0\u64d4\u512a\u5f85"}
              onClick={() => setIdTableOpen(true)}
            >
              身份類別
            </button>
            <input
              style={{ ...inpBase(ro), width: 120 }}
              className="font-mono"
              value={value.idCategory}
              readOnly={ro}
              onChange={(e) => applyIdCategory(e.target.value)}
            />
            <button
              type="button"
              className="border border-[#808080] bg-[#E8F8C8] px-1 text-[16px] font-bold"
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
                <span className="font-bold text-[#800000]" style={{ fontSize: 16 }}>
                  {`\u62bc\u91d1 ${hit.deposit ?? 0}\u3000\u639b\u8cbb\u512a\u5f85 ${hit.reg_fee ?? 0}\u3000\u90e8\u5206\u8ca0\u64d4\u512a\u5f85 ${Number(hit.copay) > 0 ? "\u662f" : "\u5426"}`}
                </span>
              );
            })()}
          </Row>
          <Row>
            <span style={lab}>押金金額</span>
            <input
              style={{ ...inpBase(ro), width: 88 }}
              className="font-mono"
              value={value.deposit}
              readOnly={ro}
              onChange={(e) => set("deposit", e.target.value.replace(/[^\d.-]/g, ""))}
            />
            <span style={lab}>欠　款</span>
            <input
              style={{ ...inpBase(ro), width: 88 }}
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
              style={{ ...inpBase(ro), width: 72 }}
              className="font-mono"
              value={value.birthOrder}
              readOnly={ro}
              onChange={(e) => set("birthOrder", e.target.value)}
            />
          </Row>
          <Row>
            <span style={lab}>{"\u5bb6\u8b77\u65e5\u671f"}</span>
            <RocBirthdayInput
              style={{ ...inpBase(ro), width: 140 }}
              className="font-mono"
              placeholder=""
              value={value.familyCareDate}
              readOnly={ro}
              onChange={(familyCareDate) => set("familyCareDate", familyCareDate)}
            />
          </Row>
          <Row>
            <span style={lab}>{"\u500b\u6848\u7a2e\u985e"}</span>
            <select
              style={{ ...inpBase(ro), width: 148 }}
              disabled={ro}
              title={"A \u7f72\u63d0\u4f9b\u540d\u55ae\u4e14\u9662\u6240\u9078\u5b9a\u3000B \u9662\u6240\u81ea\u884c\u6536\u6848\u3000C \u8ad6\u8cea\u65b9\u6848\u540d\u55ae"}
              value={value.familyCareCase || ""}
              onChange={(e) => set("familyCareCase", e.target.value)}
            >
              <option value="">{""}</option>
              <option value="A">{"A \u7f72\u63d0\u4f9b\u540d\u55ae"}</option>
              <option value="B">{"B \u9662\u6240\u81ea\u6536"}</option>
              <option value="C">{"C \u8ad6\u8cea\u540d\u55ae"}</option>
            </select>
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
          className="flex min-h-0 flex-col border p-1"
          style={{ borderColor: "#608060", background: HIS.patientFace }}
        >
          <Row>
            <span style={lab}>安養院代</span>
            <input
              style={{ ...inpBase(ro), width: 150 }}
              value={value.nursingHomeCode}
              readOnly={ro}
              onChange={(e) => set("nursingHomeCode", e.target.value)}
            />
          </Row>
          <fieldset className="mt-1 flex min-h-0 flex-1 flex-col border border-[#808080] p-1">
            <legend className="px-1 font-bold">病史記載</legend>
            <textarea
              className="min-h-[4.5rem] w-full flex-1 border-0 bg-white p-1"
              style={{ fontFamily: HIS_FONT, fontSize: 16, resize: "none" }}
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
          style={{ fontFamily: HIS_FONT, fontSize: 16, resize: "none" }}
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
            <header className="bg-[#D8E8A8] px-2 py-1 text-[16px] font-bold">選擇病患身份</header>
            <div className="min-h-0 flex-1 overflow-auto">
              {categoryCodes.map((code) => {
                const hit = categorySource.find((c) => c.code === code);
                const on = code === value.idCategory;
                return (
                  <button
                    key={code}
                    type="button"
                    className="flex w-full items-center gap-2 border-b px-2 py-1 text-left text-[16px]"
                    style={{ background: on ? "#FFFF80" : "#fff", borderColor: "#C0C080" }}
                    onClick={() => {
                      applyIdCategory(code);
                      setPickOpen(false);
                    }}
                  >
                    <span className="w-16 font-mono font-bold">{code}</span>
                    <span>
                      {`\u62bc\u91d1 ${hit?.deposit ?? 0}\u3000\u639b\u8cbb\u512a\u5f85 ${hit?.reg_fee ?? 0}\u3000\u90e8\u5206\u8ca0\u64d4\u512a\u5f85 ${Number(hit?.copay) > 0 ? "\u662f" : "\u5426"}`}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end p-1">
              <button type="button" className="border border-[#808080] bg-white px-2 py-0.5 text-[16px]" onClick={() => setPickOpen(false)}>
                關閉
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <AddressEditorDialog
        open={addressOpen}
        address={value.address}
        postalCode={value.postalCode}
        onClose={() => setAddressOpen(false)}
        onSave={(nextAddress, nextPostal) => onChange({ ...value, address: nextAddress, postalCode: nextPostal })}
      />
    </div>
  );
}
