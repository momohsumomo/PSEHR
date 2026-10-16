/**
 * 醫聖右欄目錄：依左欄焦點顯示主訴／病名／藥品清單（點兩下加入）。
 * 皮：zone-hint + pick-list（對 lookalike）
 */
import { useMemo, useState } from "react";
import type { CatalogDiagnosis, CatalogDrug, CatalogPackage } from "@/types/clinicCatalog";
import type { DiagnosisRow, RxLine } from "@/mocks/clinicMocks";
import { browseDiagnoses, browseDrugs } from "@/utils/catalogSearch";
import { catalogDrugToRxLine, resolvePackageLines } from "@/utils/catalogRx";
import { HIS, HIS_FONT } from "@/lib/hisTheme";

export type ChartEditFocus = "cc" | "dx" | "rx" | "history";
export type ChartRailMode = "common" | "full" | "oral";

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
  ccChips: _ccChips = [],
  dxQuery,
  setDxQuery,
  rxQuery,
  setRxQuery,
  onAddDx,
  onAddRx,
  onAddCc: _onAddCc,
  fontSizePx = 13,
}: Props) {
  void _onAddCc;
  void _ccChips;
  const [rxTab, setRxTab] = useState<"drug" | "pkg">("drug");

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

  const listFocus: ChartEditFocus = focus === "cc" || focus === "history" ? "rx" : focus;
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
    listFocus === "dx"
      ? "目前對應：病名選單（點左側病名區可切換）"
      : "目前對應：處置選單（常用＝診所開放的藥；完全＝設定裡整份藥檔）";

  const filterQuery = listFocus === "rx" ? rxQuery : dxQuery;
  const setFilterQuery = listFocus === "rx" ? setRxQuery : setDxQuery;

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
            listFocus === "rx" ? "藥名／健保碼／藥組" : "病名／ICD"
          }
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (listFocus === "dx" && dxHits[0]) {
              const d = dxHits[0];
              onAddDx({ icd10: d.icd10, nhiIcd10: d.icd10, text: d.text });
              setDxQuery("");
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
        {listFocus === "dx" &&
          dxHits.map((d, i) => (
            <li key={`${d.icd10}-${d.text}-${i}`} className="border-b" style={{ borderColor: "#D0E8D0" }}>
              <button
                type="button"
                className="flex w-full gap-1 px-1 py-0.5 text-left hover:bg-[#FFFF80]"
                onClick={() => {
                  onAddDx({ icd10: d.icd10, nhiIcd10: d.icd10, text: d.text });
                  setDxQuery("");
                }}
                onDoubleClick={() => {
                  onAddDx({ icd10: d.icd10, nhiIcd10: d.icd10, text: d.text });
                  setDxQuery("");
                }}
              >
                <span className="w-14 shrink-0 font-mono text-[11px]">{d.icd10 || "—"}</span>
                <span className="min-w-0 flex-1 font-bold">{d.text}</span>
              </button>
            </li>
          ))}
        {listFocus === "rx" &&
          rxTab === "drug" &&
          drugHits.map((d) => (
            <li key={`${d.nhiCode}-${d.drugNo}`} className="border-b" style={{ borderColor: "#E0E8F0" }}>
              <button
                type="button"
                className="flex w-full gap-1 px-1 py-0.5 text-left hover:bg-[#FFFF80]"
                onClick={() => {
                  onAddRx([catalogDrugToRxLine(d)]);
                  setRxQuery("");
                }}
                onDoubleClick={() => {
                  onAddRx([catalogDrugToRxLine(d)]);
                  setRxQuery("");
                }}
              >
                <span className="w-16 shrink-0 font-mono text-[10px]">{d.alias || d.shortName || d.nhiCode || "\u2014"}</span>
                <span className="min-w-0 flex-1 font-bold">{d.customName || d.name}</span>
              </button>
            </li>
          ))}
        {listFocus === "rx" &&
          rxTab === "pkg" &&
          pkgHits.map((p) => (
            <li key={p.id || p.code || p.name} className="border-b" style={{ borderColor: "#E0E8F0" }}>
              <button
                type="button"
                className="w-full px-1 py-0.5 text-left font-bold hover:bg-[#FFFF80]"
                onClick={() => {
                  onAddRx(resolvePackageLines(p, drugs));
                  setRxQuery("");
                }}
                onDoubleClick={() => {
                  onAddRx(resolvePackageLines(p, drugs));
                  setRxQuery("");
                }}
              >
                {p.name}
              </button>
            </li>
          ))}
        {((listFocus === "dx" && !dxHits.length) ||
          (listFocus === "rx" && rxTab === "drug" && !drugHits.length) ||
          (listFocus === "rx" && rxTab === "pkg" && !pkgHits.length)) && (
          <li className="px-2 py-6 text-center text-[11px] text-[#808080]">無符合項目</li>
        )}
      </ul>
    </div>
  );
}
