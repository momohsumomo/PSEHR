import { useEffect, useMemo, useState } from "react";
import { HisXpDialog } from "@/components/clinic/HisPageFrame";
import { fetchDrugPicks, saveDrugPicks, type DrugPick } from "@/api/clinicApi";
import { useClinicCatalog } from "@/hooks/useClinicCatalog";
import type { CatalogDrug } from "@/types/clinicCatalog";

type Tab = "all" | "oral" | "external" | "injection" | "treatment" | "other";

const T = {
  title: "\u5217\u51fa\u85e5\u54c1\u6e05\u55ae\u4f5c\u696d\u7cfb\u7d71",
  hint: "\u5de6\u908a\u6709\u85e5\u6642\uff0c\u85e5\u54c1\u7d71\u8a08\u53ea\u7b97\u5de6\u908a\u9019\u4e9b\uff1b\u5de6\u908a\u7a7a\u767d\u5c31\u7b97\u5168\u90e8\u7684\u85e5\u3002",
  name: "\u85e5\u54c1\u5546\u54c1\u540d\u7a31",
  shown: "\u85e5\u54c1\u5546\u54c1\u540d",
  code: "\u5065\u4fdd\u78bc",
  add: "\u52a0\u5165",
  insert: "\u63d2\u5165",
  remove: "\u79fb\u9664",
  clear: "\u5168\u90e8\u79fb\u9664",
  save: "\u5b58\u6a94",
  leave: "\u96e2\u958b",
  search: "\u627e\u85e5\u540d\u6216\u5065\u4fdd\u78bc",
  loading: "\u8b80\u53d6\u4e2d\u2026",
  saved: "\u5df2\u5b58\u6a94",
  picked: "\u5df2\u9078",
  items: "\u9805",
};

const TABS: Array<[Tab, string]> = [
  ["all", "\u5168\u90e8"],
  ["oral", "\u5167\u670d"],
  ["external", "\u5916\u7528"],
  ["injection", "\u6ce8\u5c04"],
  ["treatment", "\u6cbb\u7642"],
  ["other", "\u5176\u4ed6"],
];

const INJECTION = new Set(["im", "iv", "ivd", "ivp", "sc", "inj"]);

function tabOf(drug: CatalogDrug): Tab {
  const use = String(drug.useType || "").trim().toLowerCase();
  if (INJECTION.has(use)) return "injection";
  const type = String(drug.typeName || "").trim();
  if (type === "\u5167\u670d") return "oral";
  if (type === "\u5916\u7528") return "external";
  if (type === "\u6cbb\u7642") return "treatment";
  return "other";
}

function shownName(drug: CatalogDrug): string {
  return String(drug.customName || drug.name || drug.shortName || "").trim();
}

function toPick(drug: CatalogDrug): DrugPick {
  const name = String(drug.name || drug.customName || drug.shortName || "").trim();
  const alt = [drug.customName, drug.shortName, drug.alias]
    .map((x) => String(x || "").trim())
    .filter((x, i, all) => x && x !== name && all.indexOf(x) === i);
  return { code: String(drug.nhiCode || "").trim().toUpperCase(), name, alt };
}

function samePick(a: DrugPick, b: DrugPick): boolean {
  if (a.code || b.code) return a.code === b.code;
  return a.name.toUpperCase() === b.name.toUpperCase();
}

function pickLabel(pick: DrugPick): string {
  return pick.alt?.[0] || pick.name;
}

export function DrugPickDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (count: number) => void;
}) {
  const { catalog, loaded } = useClinicCatalog();
  const [picks, setPicks] = useState<DrugPick[]>([]);
  const [leftAt, setLeftAt] = useState(-1);
  const [rightAt, setRightAt] = useState(-1);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNote("");
    setLeftAt(-1);
    void fetchDrugPicks()
      .then(setPicks)
      .catch((err: unknown) => setNote(err instanceof Error ? err.message : String(err)));
  }, [open]);

  const drugs = useMemo(() => {
    const needle = query.trim().toUpperCase();
    return catalog.drugs
      .filter((d) => String(d.typeName || "").trim() !== "\u8ad6\u8cea\u6aa2\u9a57")
      .filter((d) => shownName(d))
      .filter((d) => tab === "all" || tabOf(d) === tab)
      .filter((d) => {
        if (!needle) return true;
        const hay = [d.customName, d.name, d.shortName, d.alias, d.nhiCode].join(" ").toUpperCase();
        return hay.includes(needle);
      })
      .sort((a, b) => shownName(a).localeCompare(shownName(b), "en", { sensitivity: "base" }));
  }, [catalog.drugs, tab, query]);

  useEffect(() => setRightAt(-1), [tab, query]);

  const place = (at: number) => {
    const drug = drugs[rightAt];
    if (!drug) return;
    const pick = toPick(drug);
    if (!pick.name && !pick.code) return;
    if (picks.some((p) => samePick(p, pick))) return;
    const next = [...picks];
    next.splice(at, 0, pick);
    setPicks(next);
    setLeftAt(at);
  };

  const remove = () => {
    if (leftAt < 0 || leftAt >= picks.length) return;
    setPicks(picks.filter((_, i) => i !== leftAt));
    setLeftAt(Math.min(leftAt, picks.length - 2));
  };

  const save = () => {
    setBusy(true);
    void saveDrugPicks(picks)
      .then((saved) => {
        setPicks(saved);
        setNote(`${T.saved}\u3000${T.picked} ${saved.length} ${T.items}`);
        onSaved?.(saved.length);
      })
      .catch((err: unknown) => setNote(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const arrowBtn = "flex items-center gap-1 border px-3 py-1 font-bold disabled:opacity-40";
  const btnStyle = { borderColor: "#404040", background: "#ece9d8" };

  return (
    <HisXpDialog open={open} title={T.title} onClose={onClose} width={980}>
      <div className="flex flex-col gap-2 text-[13px] text-black">
        <p className="text-[12px]">{T.hint}</p>
        <div className="flex h-[30rem] gap-2">
          <div className="flex min-w-0 flex-1 flex-col border bg-white" style={{ borderColor: "#808080" }}>
            <div className="flex border-b bg-[#dbe7f5] font-bold" style={{ borderColor: "#808080" }}>
              <span className="min-w-0 flex-1 px-1">{T.name}</span>
              <span className="w-28 px-1">{T.code}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {picks.map((pick, i) => (
                <button
                  key={`${pick.code}|${pick.name}`}
                  type="button"
                  className="flex w-full text-left"
                  style={{ background: i === leftAt ? "#000080" : i % 2 ? "#eef4fb" : "#fff", color: i === leftAt ? "#fff" : "#000" }}
                  onClick={() => setLeftAt(i)}
                  onDoubleClick={() => {
                    setLeftAt(i);
                    setPicks(picks.filter((_, k) => k !== i));
                  }}
                >
                  <span className="min-w-0 flex-1 truncate px-1">{pickLabel(pick)}</span>
                  <span className="w-28 px-1 font-mono">{pick.code}</span>
                </button>
              ))}
            </div>
            <div className="border-t px-1 text-[12px]" style={{ borderColor: "#808080" }}>
              {`${T.picked} ${picks.length} ${T.items}`}
            </div>
          </div>

          <div className="flex w-28 shrink-0 flex-col items-stretch justify-center gap-3">
            <button type="button" className={arrowBtn} style={btnStyle} disabled={rightAt < 0} onClick={() => place(picks.length)}>
              {"\u2190"} {T.add}
            </button>
            <button
              type="button"
              className={arrowBtn}
              style={btnStyle}
              disabled={rightAt < 0}
              onClick={() => place(leftAt >= 0 ? leftAt : 0)}
            >
              {"\u2190"} {T.insert}
            </button>
            <button type="button" className={arrowBtn} style={btnStyle} disabled={leftAt < 0} onClick={remove}>
              {T.remove} {"\u2192"}
            </button>
            <button
              type="button"
              className={arrowBtn}
              style={btnStyle}
              disabled={picks.length === 0}
              onClick={() => {
                setPicks([]);
                setLeftAt(-1);
              }}
            >
              {T.clear}
            </button>
          </div>

          <div className="flex min-w-0 flex-1 flex-col border bg-white" style={{ borderColor: "#808080" }}>
            <div className="flex flex-wrap gap-0.5 border-b bg-[#d4e8c8] p-0.5" style={{ borderColor: "#808080" }}>
              {TABS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className="border px-2 font-bold"
                  style={{ borderColor: "#808080", background: tab === key ? "#000080" : "#eef6e6", color: tab === key ? "#fff" : "#000" }}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              className="border-b px-1 py-0.5 outline-none"
              style={{ borderColor: "#808080" }}
              placeholder={T.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="flex border-b bg-[#dbe7f5] font-bold" style={{ borderColor: "#808080" }}>
              <span className="min-w-0 flex-1 px-1">{T.shown}</span>
              <span className="w-28 px-1">{T.code}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {!loaded ? <p className="px-1">{T.loading}</p> : null}
              {drugs.map((drug, i) => (
                <button
                  key={`${drug.drugNo}|${drug.nhiCode}|${shownName(drug)}|${i}`}
                  type="button"
                  className="flex w-full text-left"
                  style={{ background: i === rightAt ? "#000080" : i % 2 ? "#fdf3dc" : "#fff", color: i === rightAt ? "#fff" : "#000" }}
                  onClick={() => setRightAt(i)}
                  onDoubleClick={() => {
                    setRightAt(i);
                    const pick = toPick(drug);
                    if (picks.some((p) => samePick(p, pick))) return;
                    setPicks([...picks, pick]);
                    setLeftAt(picks.length);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate px-1">{shownName(drug)}</span>
                  <span className="w-28 px-1 font-mono">{drug.nhiCode}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-[12px]">{note}</span>
          <button type="button" className="border px-4 py-1 font-bold disabled:opacity-40" style={btnStyle} disabled={busy} onClick={save}>
            {T.save}
          </button>
          <button type="button" className="border px-4 py-1 font-bold" style={btnStyle} onClick={onClose}>
            {T.leave}
          </button>
        </div>
      </div>
    </HisXpDialog>
  );
}
