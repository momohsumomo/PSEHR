import { useEffect, useMemo, useState } from "react";
import { HIS_FONT } from "@/lib/hisTheme";

export type NhiHospital = {
  code: string;
  name: string;
  address: string;
  phone: string;
  grade: "1" | "2" | "3";
};

const FAV_KEY = "wundadi.referralHospFavorites.v1";

const GRADES: Array<{ id: "1" | "2" | "3" | "find"; label: string }> = [
  { id: "1", label: "\u91ab\u5b78\u4e2d\u5fc3" },
  { id: "2", label: "\u5340\u57df\u91ab\u9662" },
  { id: "3", label: "\u5730\u5340\u91ab\u9662" },
  { id: "find", label: "\u81ea\u67e5" },
];

function loadFavs(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FAV_KEY) || "[]") as unknown;
    return Array.isArray(raw) ? raw.map(String) : [];
  } catch {
    return [];
  }
}

type Props = {
  open: boolean;
  onClose: () => void;
  onPick: (row: NhiHospital) => void;
};

export function HospitalLookupDialog({ open, onClose, onPick }: Props) {
  const [rows, setRows] = useState<NhiHospital[]>([]);
  const [grade, setGrade] = useState<"1" | "2" | "3" | "find">("1");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState("");
  const [favs, setFavs] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setFavs(loadFavs());
    setQuery("");
    setGrade("1");
    if (rows.length) return;
    void fetch("/nhi-hospitals.json")
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<{ rows: NhiHospital[] }>;
      })
      .then((data) => setRows(Array.isArray(data.rows) ? data.rows : []))
      .catch(() => setError("\u9662\u6240\u540d\u518a\u8b80\u4e0d\u5230\u3002"));
  }, [open, rows.length]);

  const byCode = useMemo(() => {
    const map = new Map<string, NhiHospital>();
    rows.forEach((row) => map.set(row.code, row));
    return map;
  }, [rows]);

  const shown = useMemo(() => {
    const q = query.trim();
    return rows.filter((row) => {
      if (grade !== "find" && row.grade !== grade) return false;
      if (!q) return true;
      return row.name.includes(q) || row.code.includes(q) || row.address.includes(q);
    });
  }, [rows, grade, query]);

  const remember = (code: string) => {
    const next = [code, ...favs.filter((item) => item !== code)].slice(0, 30);
    setFavs(next);
    localStorage.setItem(FAV_KEY, JSON.stringify(next));
  };

  const choose = (row: NhiHospital) => {
    remember(row.code);
    onPick(row);
  };

  if (!open) return null;

  const selected = byCode.get(picked);

  return (
    <div className="fixed inset-0 z-[97] flex items-center justify-center bg-black/35 p-2">
      <div className="flex max-h-[86vh] w-[min(62rem,98vw)] flex-col border-2 border-[#206020] bg-[#E8FFE8] shadow-lg" style={{ fontFamily: HIS_FONT }}>
        <div className="bg-[#208020] px-2 py-1 text-center text-[14px] font-bold text-white">{"\u5168\u570b\u91ab\u7642\u9662\u6240\u901f\u67e5\u8868"}</div>
        <div className="flex flex-wrap items-center gap-3 px-2 py-1 text-[13px]">
          {GRADES.map((item) => (
            <label key={item.id} className="flex items-center gap-1">
              <input type="radio" checked={grade === item.id} onChange={() => setGrade(item.id)} />
              {item.label}
            </label>
          ))}
          <input
            className="ml-auto w-40 border border-[#808080] bg-white px-1"
            placeholder={"\u540d\u7a31\u3001\u4ee3\u78bc\u3001\u4f4f\u5740"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.6fr)_minmax(14rem,0.8fr)] gap-1 px-1 pb-1">
          <div className="min-h-0 overflow-auto border border-[#808080] bg-[#D8FFFF]">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-[#D0F0A0]">
                <tr>
                  <th className="border px-1 text-left">{"\u6a5f\u69cb\u540d\u7a31"}</th>
                  <th className="border px-1 text-left">{"\u6a5f\u69cb\u4ee3\u78bc"}</th>
                  <th className="border px-1 text-left">{"\u4f4f\u5740"}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr
                    key={row.code}
                    className={picked === row.code ? "bg-[#000080] text-white" : "cursor-pointer"}
                    onClick={() => setPicked(row.code)}
                    onDoubleClick={() => choose(row)}
                  >
                    <td className="border border-[#9bd] px-1">{row.name}</td>
                    <td className="border border-[#9bd] px-1">{row.code}</td>
                    <td className="border border-[#9bd] px-1">{row.address}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex min-h-0 flex-col border border-[#808080]">
            <div className="bg-[#C00000] px-1 py-0.5 text-[13px] font-bold text-white">{"\u5e38\u7528\u9078\u55ae"}</div>
            <div className="min-h-0 flex-1 overflow-auto bg-[#D8FFFF]">
              <table className="w-full border-collapse text-[12px]">
                <thead className="sticky top-0 bg-[#E8E8E8]">
                  <tr>
                    <th className="border px-1 text-left">{"\u6a5f\u69cb\u540d\u7a31"}</th>
                    <th className="border px-1 text-left">{"\u6a5f\u69cb\u4ee3\u78bc"}</th>
                  </tr>
                </thead>
                <tbody>
                  {favs.map((code) => {
                    const row = byCode.get(code);
                    if (!row) return null;
                    return (
                      <tr key={code} className={picked === code ? "bg-[#000080] text-white" : "cursor-pointer"} onClick={() => setPicked(code)} onDoubleClick={() => choose(row)}>
                        <td className="border px-1">{row.name}</td>
                        <td className="border px-1">{row.code}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-2 py-1 text-[13px]">
          <div className="min-w-0 flex-1 truncate font-bold text-[#000080]">{selected ? selected.name : error}</div>
          <button type="button" className="border border-[#808080] bg-[#D4D0C8] px-3 py-1" onClick={onClose}>{"\u96e2\u958b"}</button>
          <button
            type="button"
            className="border border-[#808080] bg-[#D4D0C8] px-3 py-1 font-bold"
            disabled={!selected}
            onClick={() => selected && choose(selected)}
          >
            {"\u78ba\u5b9a"}
          </button>
        </div>
      </div>
    </div>
  );
}
