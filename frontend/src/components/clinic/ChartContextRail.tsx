/**
 * 醫聖右欄目錄：依左欄焦點顯示主訴／病名／藥品清單（雙擊帶入）。
 * 皮：zone-hint + pick-list（對 lookalike）
 */
import { useMemo, useState } from "react";
import type { CatalogDiagnosis, CatalogDrug, CatalogPackage } from "@/types/clinicCatalog";
import type { DiagnosisRow, RxLine } from "@/mocks/clinicMocks";
import {
  browseDiagnoses,
  browseDrugs,
  DRUG_RAIL_SECTION_LABEL,
  drugRailSection,
  type DrugRailSection,
} from "@/utils/catalogSearch";
import { catalogDrugToRxLine, resolvePackageLines } from "@/utils/catalogRx";
import { HIS, HIS_FONT } from "@/lib/hisTheme";

export type ChartEditFocus = "cc" | "dx" | "rx" | "history";
export type ChartRailMode = "common" | "full" | "oral";

/** 病名淺粉紅、治療淺綠、檢驗淺藍、藥名淺黃、行政費用更淺的綠。材料另用淺杏。 */
const RAIL_ROW_BG: Record<DrugRailSection, string> = {
  檢查: "#D2EAFF",
  處置: "#C8EFC4",
  用藥: "#FFF4C2",
  材料: "#F6E4D2",
  行政: "#D2ECD0",
};
const RAIL_HEAD_BG: Record<DrugRailSection, string> = {
  檢查: "#A9D4F7",
  處置: "#9ED99A",
  用藥: "#F0DC8A",
  材料: "#E4CDB4",
  行政: "#B5DFAE",
};
const DX_ROW_BG = "#FFD4E5";

type Props = {
  focus: ChartEditFocus;
  railMode?: ChartRailMode;
  diagnoses: CatalogDiagnosis[];
  drugs: CatalogDrug[];
  packages: CatalogPackage[];
  ccChips?: string[];
  dxQuery: string;
  setDxQuery: (q: string) => void;
  rxQuery: string;
  setRxQuery: (q: string) => void;
  onAddDx: (row: DiagnosisRow) => void;
  onReject?: (message: string) => void;
  onAddRx: (lines: RxLine[]) => void;
  onAddCc?: (text: string) => void;
  fontSizePx?: number;
};

export function ChartContextRail({
  focus,
  railMode = "common",
  diagnoses,
  drugs,
  packages,
  ccChips = [],
  dxQuery,
  setDxQuery,
  rxQuery,
  setRxQuery,
  onAddDx,
  onReject,
  onAddRx,
  onAddCc,
  fontSizePx = 13,
}: Props) {
  const [rxTab, setRxTab] = useState<"drug" | "pkg">("drug");
  const [ccQuery, setCcQuery] = useState("");

  const dxPool = useMemo(() => {
    if (railMode === "full") return diagnoses;
    const withShort = diagnoses.filter((d) => d.short);
    return withShort.length >= 20 ? withShort : diagnoses;
  }, [diagnoses, railMode]);

  const drugPool = useMemo(() => {
    let list = drugs;
    if (railMode === "oral") {
      list = drugs.filter((d) => {
        const route = String((d as { route?: string }).route || "").toLowerCase();
        // 內服頁只列 MEDICAL 標成 oral 的；勿把檢查／外用算進來
        return route === "oral" || route === "po";
      });
    }
    return list;
  }, [drugs, railMode]);

  const pickDx = (d: CatalogDiagnosis) => {
    if (!(d.icd10 || "").trim()) {
      onReject?.("\u9019\u500b\u75c5\u540d\u53ea\u6709\u5feb\u78bc\u3001\u6c92\u6709 ICD-10\uff0c\u4e0d\u80fd\u5beb\u9032\u9019\u6b21\u770b\u8a3a\u3002");
      return;
    }
    onAddDx({ icd10: d.icd10, nhiIcd10: d.icd10, text: d.text });
    setDxQuery("");
  };
  const listFocus: ChartEditFocus = focus === "history" ? "dx" : focus;
  const ccHits = useMemo(() => {
    const q = ccQuery.trim().toLowerCase();
    const list = ccChips.map((text) => text.trim()).filter(Boolean);
    if (!q) return list;
    return list.filter((text) => text.toLowerCase().includes(q));
  }, [ccChips, ccQuery]);
  const dxHits = useMemo(
    () => browseDiagnoses(dxPool, dxQuery, Math.max(dxPool.length, 1)),
    [dxPool, dxQuery],
  );
  const drugHits = useMemo(
    () => browseDrugs(drugPool, rxQuery, Math.max(drugPool.length, 1), railMode !== "full"),
    [drugPool, rxQuery, railMode],
  );
  const pkgHits = useMemo(() => {
    const q = rxQuery.trim().toLowerCase();
    if (!q) return packages;
    return packages.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.id || "").toLowerCase().includes(q) ||
        (p.code || "").toLowerCase().includes(q),
    );
  }, [packages, rxQuery]);

  const zoneHint =
    listFocus === "cc"
      ? "目前對應：主訴（雙擊帶入）"
      : listFocus === "dx"
        ? "目前對應：病名（雙擊帶入）"
        : "目前對應：處置（雙擊帶入。先分檢驗、處置、藥品；常用排在該類最上面）";

  const filterQuery = listFocus === "rx" ? rxQuery : listFocus === "cc" ? ccQuery : dxQuery;
  const setFilterQuery = listFocus === "rx" ? setRxQuery : listFocus === "cc" ? setCcQuery : setDxQuery;

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: "#F0F0F0", fontFamily: HIS_FONT }}>
      <div
        className="shrink-0 border-b px-1 py-0.5 text-[10px] font-bold text-[#003C74]"
        style={{ borderColor: HIS.chromeBorder, background: "#E0DCD0" }}
      >
        {zoneHint}
      </div>
      <div
        className="flex shrink-0 items-center gap-1 border-b px-1 py-0.5"
        style={{ borderColor: HIS.chromeBorder, background: HIS.chrome }}
      >
        <input
          className="min-w-0 flex-1 border bg-white px-0.5 font-mono outline-none"
          style={{
            borderColor: HIS.chromeBorder,
            height: 18,
            fontSize: 11,
            color: HIS.inputBlue,
          }}
          placeholder={
            listFocus === "rx" ? "藥名／健保碼／藥組" : listFocus === "cc" ? "主訴" : "病名／ICD"
          }
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (listFocus === "cc" && ccHits[0]) {
              onAddCc?.(ccHits[0]);
              setCcQuery("");
            } else if (listFocus === "dx" && dxHits[0]) {
              pickDx(dxHits[0]);
            } else if (listFocus === "rx" && rxTab === "drug" && drugHits[0]) {
              onAddRx([catalogDrugToRxLine(drugHits[0])]);
              setRxQuery("");
            } else if (listFocus === "rx" && rxTab === "pkg" && pkgHits[0]) {
              onAddRx(resolvePackageLines(pkgHits[0], drugs));
              setRxQuery("");
            }
          }}
        />
        {listFocus === "rx" && (
          <>
            <button
              type="button"
              className="border px-1 text-[10px] font-bold"
              style={{
                borderColor: HIS.chromeBorder,
                background: rxTab === "drug" ? HIS.tabActive : "#D4D0C8",
                color: rxTab === "drug" ? HIS.tabActiveText : "#000",
              }}
              onClick={() => setRxTab("drug")}
            >
              藥品
            </button>
            <button
              type="button"
              className="border px-1 text-[10px] font-bold"
              style={{
                borderColor: HIS.chromeBorder,
                background: rxTab === "pkg" ? HIS.tabActive : "#D4D0C8",
                color: rxTab === "pkg" ? HIS.tabActiveText : "#000",
              }}
              onClick={() => setRxTab("pkg")}
            >
              藥組
            </button>
          </>
        )}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto bg-white" style={{ fontSize: fontSizePx }}>
        {listFocus === "cc" &&
          ccHits.map((text) => (
            <li key={text} className="border-b" style={{ borderColor: "#E8D0E8" }}>
              <button
                type="button"
                className="w-full px-1 py-0.5 text-left font-bold hover:bg-[#FFFF80]"
                title="雙擊帶入"
                onDoubleClick={() => onAddCc?.(text)}
              >
                {text}
              </button>
            </li>
          ))}
        {listFocus === "dx" &&
          dxHits.map((d, i) => (
            <li key={`${d.icd10}-${d.text}-${i}`} className="border-b" style={{ borderColor: "#F0C0D0", background: DX_ROW_BG }}>
              <button
                type="button"
                className="flex w-full gap-1 px-1 py-0.5 text-left hover:shadow-[inset_0_0_0_2px_#404040]"
                style={{ background: DX_ROW_BG }}
                title="雙擊帶入"
                onDoubleClick={() => pickDx(d)}
              >
                <span className="w-16 shrink-0 font-mono text-[11px]">{d.short || d.icd10 || "\u2014"}</span>
                <span className="min-w-0 flex-1 font-bold">{d.text}</span>
              </button>
            </li>
          ))}
        {listFocus === "rx" &&
          rxTab === "drug" &&
          drugHits.map((d, i) => {
            const section = drugRailSection(d);
            const showSection = railMode !== "oral" && (i === 0 || drugRailSection(drugHits[i - 1]) !== section);
            const rowBg = RAIL_ROW_BG[section];
            return (
              <li key={`${section}-${d.nhiCode}-${d.drugNo}-${i}`} className="border-b" style={{ borderColor: "#E0E8F0", background: rowBg }}>
                {showSection ? (
                  <div
                    className="sticky top-0 px-1 py-1 text-[15px] font-bold text-[#003C74]"
                    style={{ background: RAIL_HEAD_BG[section] }}
                  >
                    {DRUG_RAIL_SECTION_LABEL[section]}
                  </div>
                ) : null}
                <button
                  type="button"
                  className="flex w-full gap-1 px-1 py-0.5 text-left hover:shadow-[inset_0_0_0_2px_#404040]"
                  style={{ background: rowBg }}
                  title="雙擊帶入"
                  onDoubleClick={() => {
                    onAddRx([catalogDrugToRxLine(d)]);
                    setRxQuery("");
                  }}
                >
                  <span className="w-16 shrink-0 font-mono text-[10px]">{d.alias || d.shortName || d.nhiCode || "\u2014"}</span>
                  <span className="min-w-0 flex-1 font-bold">{d.customName || d.name}</span>
                </button>
              </li>
            );
          })}
        {listFocus === "rx" &&
          rxTab === "pkg" &&
          pkgHits.map((p) => (
            <li key={p.id || p.code || p.name} className="border-b" style={{ borderColor: "#E0E8F0" }}>
              <button
                type="button"
                className="w-full px-1 py-0.5 text-left font-bold hover:bg-[#FFFF80]"
                title="雙擊帶入"
                onDoubleClick={() => {
                  onAddRx(resolvePackageLines(p, drugs));
                  setRxQuery("");
                }}
              >
                {p.name}
              </button>
            </li>
          ))}
        {((listFocus === "cc" && !ccHits.length) ||
          (listFocus === "dx" && !dxHits.length) ||
          (listFocus === "rx" && rxTab === "drug" && !drugHits.length) ||
          (listFocus === "rx" && rxTab === "pkg" && !pkgHits.length)) && (
          <li className="px-2 py-6 text-center text-[11px] text-[#808080]">無符合項目</li>
        )}
      </ul>
    </div>
  );
}
