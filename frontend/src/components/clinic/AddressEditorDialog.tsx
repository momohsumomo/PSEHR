import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  addAddressFavorite,
  addAddressRoad,
  fetchAddressRoads,
  fetchAddressTree,
  refreshAddressBook,
  removeAddressFavorite,
  type AddressCity,
  type AddressFavorite,
} from "@/api/clinicApi";
import { useEscLayer } from "@/hooks/useEscLayer";
import { readLocalClinicBundle } from "@/lib/clinicProfile";
import { HIS_FONT } from "@/lib/hisTheme";

type Props = {
  open: boolean;
  address: string;
  postalCode: string;
  onClose: () => void;
  onSave: (address: string, postalCode: string) => void;
};

type Parts = {
  city: string;
  district: string;
  road: string;
  lane: string;
  alley: string;
  no: string;
  floor: string;
  zhi: string;
  note: string;
};

const DEFAULT_CITY = "\u53f0\u5357\u5e02";

function parseAddress(full: string): Parts {
  const empty: Parts = {
    city: "",
    district: "",
    road: "",
    lane: "",
    alley: "",
    no: "",
    floor: "",
    zhi: "",
    note: "",
  };
  const text = (full || "").replace(/\s+/g, "");
  const admin = text.match(/^(.+?[\u7e23\u5e02])(.+?(?:\u5340|\u9109|\u93ae|\u5e02))(.*)$/);
  if (!admin) {
    empty.road = text;
    return empty;
  }
  empty.city = admin[1].replace(/\u81fa/g, "\u53f0");
  empty.district = admin[2];
  const rest = admin[3] || "";
  const cut = rest.search(/\d+\u5df7|\d+\u5f04|\d+\u865f|\u4e4b\d+|\d+\u6a13/);
  const road = cut < 0 ? rest : rest.slice(0, cut);
  let tail = cut < 0 ? "" : rest.slice(cut);
  const take = (re: RegExp) => {
    const hit = tail.match(re);
    if (!hit) return "";
    tail = tail.slice(hit[0].length);
    return hit[1] || "";
  };
  empty.road = road;
  empty.lane = take(/^(\d+)\u5df7/);
  empty.alley = take(/^(\d+)\u5f04/);
  empty.no = take(/^(\d+)\u865f/);
  empty.zhi = take(/^\u4e4b(\d+)/);
  empty.floor = take(/^(\d+)\u6a13/);
  empty.note = tail;
  return empty;
}

function compose(p: Parts): string {
  return [
    p.city,
    p.district,
    p.road,
    p.lane ? `${p.lane}\u5df7` : "",
    p.alley ? `${p.alley}\u5f04` : "",
    p.no ? `${p.no}\u865f` : "",
    p.zhi ? `\u4e4b${p.zhi}` : "",
    p.floor ? `${p.floor}\u6a13` : "",
    p.note,
  ].join("");
}

function roadKind(name: string, kind: "all" | "road" | "street" | "lane"): boolean {
  if (kind === "road") return name.includes("\u8def");
  if (kind === "street") return name.includes("\u8857");
  if (kind === "lane") return name.includes("\u5df7") && !name.includes("\u8def") && !name.includes("\u8857");
  return true;
}

function ListBox({
  items,
  selected,
  onPick,
  render,
  jump,
  jumpTick,
}: {
  items: string[];
  selected: string;
  onPick: (item: string) => void;
  render?: (item: string) => string;
  jump?: string;
  jumpTick?: number;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!jump) return;
    const row = scroller.current?.querySelector(`[data-jump="${CSS.escape(jump)}"]`);
    row?.scrollIntoView({ block: "start" });
  }, [jump, jumpTick, items]);
  return (
    <div ref={scroller} className="h-64 overflow-auto border border-[#808080] bg-white">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          data-jump={item.slice(0, 1)}
          className="block w-full truncate px-1 text-left text-[13px]"
          style={{ background: item === selected ? "#1d4ed8" : "#fff", color: item === selected ? "#fff" : "#000" }}
          onClick={() => onPick(item)}
        >
          {render ? render(item) : item}
        </button>
      ))}
    </div>
  );
}

export function AddressEditorDialog({ open, address, postalCode, onClose, onSave }: Props) {
  const [cities, setCities] = useState<AddressCity[]>([]);
  const [favorites, setFavorites] = useState<AddressFavorite[]>([]);
  const [updated, setUpdated] = useState("");
  const [city, setCity] = useState(DEFAULT_CITY);
  const [district, setDistrict] = useState("");
  const [roads, setRoads] = useState<string[]>([]);
  const [kind, setKind] = useState<"all" | "road" | "street" | "lane">("all");
  const [initial, setInitial] = useState("");
  const [jumpTick, setJumpTick] = useState(0);
  const [road, setRoad] = useState("");
  const [lane, setLane] = useState("");
  const [alley, setAlley] = useState("");
  const [no, setNo] = useState("");
  const [floor, setFloor] = useState("");
  const [zhi, setZhi] = useState("");
  const [note, setNote] = useState("");
  const [zip, setZip] = useState("");
  const [favKey, setFavKey] = useState("");
  const [busy, setBusy] = useState("");
  const laneRef = useRef<HTMLInputElement>(null);
  const alleyRef = useRef<HTMLInputElement>(null);
  const noRef = useRef<HTMLInputElement>(null);
  const floorRef = useRef<HTMLInputElement>(null);
  const zhiRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const triedRefresh = useRef(false);

  useEscLayer([{ open, close: onClose }]);

  useEffect(() => {
    if (!open) return;
    const parsed = parseAddress(address);
    const clinicCity = parseAddress(readLocalClinicBundle().profile.address || "").city;
    setCity(parsed.city || clinicCity || DEFAULT_CITY);
    setDistrict(parsed.district);
    setRoad(parsed.road);
    setLane(parsed.lane);
    setAlley(parsed.alley);
    setNo(parsed.no);
    setFloor(parsed.floor);
    setZhi(parsed.zhi);
    setNote(parsed.note);
    setZip(postalCode);
    setInitial(parsed.road.slice(0, 1));
    setBusy("");
    void fetchAddressTree()
      .then((tree) => {
        setCities(tree.cities || []);
        setFavorites(tree.favorites || []);
        setUpdated(tree.updated || "");
      })
      .catch((err) => setBusy(err instanceof Error ? err.message : "\u8def\u540d\u8cc7\u6599\u8b80\u4e0d\u5230"));
    if (!triedRefresh.current) {
      triedRefresh.current = true;
      void refreshAddressBook(false)
        .then((res) => {
          if (res.skipped) return;
          setUpdated(res.updated || "");
          return fetchAddressTree().then((tree) => {
            setCities(tree.cities || []);
            setFavorites(tree.favorites || []);
            setUpdated(tree.updated || res.updated || "");
          });
        })
        .catch(() => undefined);
    }
  }, [open, address, postalCode]);

  useEffect(() => {
    if (!open || !cities.length) return;
    const hit = cities.find((item) => item.name === city);
    if (!hit) {
      const fallback = cities.find((item) => item.name === DEFAULT_CITY) || cities[0];
      if (fallback && fallback.name !== city) setCity(fallback.name);
      return;
    }
    if (district && hit.districts.some((item) => item.name === district)) return;
    setDistrict(hit.districts[0]?.name || "");
  }, [open, cities, city, district]);

  useEffect(() => {
    if (!open || !city || !district) return;
    void fetchAddressRoads(city, district)
      .then((res) => {
        setRoads(res.roads || []);
        if (res.zip) setZip(res.zip);
      })
      .catch(() => setRoads([]));
  }, [open, city, district]);

  const cityHit = cities.find((item) => item.name === city);
  const districts = cityHit?.districts || [];
  const filtered = useMemo(() => roads.filter((name) => roadKind(name, kind)), [roads, kind]);
  const initials = useMemo(() => {
    const chars = new Set<string>();
    roads.filter((name) => roadKind(name, kind)).forEach((name) => {
      if (name) chars.add(name.slice(0, 1));
    });
    return Array.from(chars);
  }, [roads, kind]);

  if (!open) return null;

  const parts = (): Parts => ({ city, district, road: road.trim(), lane, alley, no, floor, zhi, note: note.trim() });

  const go = (ev: React.KeyboardEvent, el: HTMLElement | null) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    el?.focus();
  };

  const pickRoad = (name: string) => {
    setRoad(name);
    laneRef.current?.focus();
  };

  const save = async () => {
    const current = parts();
    if (current.road && !roads.includes(current.road)) {
      const yes = window.confirm(
        "\u9019\u500b\u8def\u540d\u5728\u9019\u500b\u5340\u76ee\u524d\u6c92\u8cc7\u6599\uff0c\u662f\u5426\u8981\u5efa\u6a94?",
      );
      if (yes) {
        try {
          await addAddressRoad(current.city, current.district, current.road);
          setRoads((prev) => (prev.includes(current.road) ? prev : [...prev, current.road].sort()));
        } catch (err) {
          setBusy(err instanceof Error ? err.message : "\u8def\u540d\u5efa\u6a94\u5931\u6557");
          return;
        }
      }
    }
    onSave(compose(current), zip.trim());
    onClose();
  };

  const box = "h-7 border border-[#808080] bg-white px-1 text-[14px]";

  return createPortal(
    <div className="fixed inset-0 z-[98] flex items-center justify-center bg-slate-900/45 p-2" style={{ fontFamily: HIS_FONT }}>
      <div className="flex max-h-[96vh] w-[min(72rem,98vw)] flex-col border-2 border-[#808080] bg-[#f3f3f3] shadow-xl">
        <header className="flex items-center justify-between bg-[#e4e4e4] px-2 py-1 text-[14px] font-bold">
          <span>{"\u4e2d\u83ef\u6c11\u570b\u5730\u5740\u4e00\u89bd\u8868"}</span>
          <span className="text-[12px] font-normal">
            {updated ? `\u8def\u540d\u8cc7\u6599 ${updated}` : ""}
            <button
              type="button"
              className="ml-2 border border-[#808080] bg-white px-2"
              onClick={() => {
                setBusy("\u66f4\u65b0\u4e2d");
                void refreshAddressBook(true)
                  .then(async (res) => {
                    setUpdated(res.updated || "");
                    const tree = await fetchAddressTree();
                    setCities(tree.cities || []);
                    setFavorites(tree.favorites || []);
                    setBusy("");
                  })
                  .catch((err) => setBusy(err instanceof Error ? err.message : "\u66f4\u65b0\u5931\u6557"));
              }}
            >
              {"\u66f4\u65b0\u8def\u540d"}
            </button>
          </span>
        </header>
        <div className="grid min-h-0 gap-2 p-2" style={{ gridTemplateColumns: "16rem 8.5rem 3.2rem 12rem 1fr" }}>
          <div>
            <div className="mb-1 text-center text-[12px]">{"\u7e23\uff0f\u5e02\uff0f\u9109\uff0f"}</div>
            <div className="grid h-52 grid-cols-2 content-start gap-x-2 overflow-auto border border-[#808080] bg-white px-1 py-1">
              {cities.map((item) => (
                <label key={item.name} className="flex items-center gap-1 text-[13px]">
                  <input
                    type="radio"
                    name="addr-city"
                    checked={item.name === city}
                    onChange={() => {
                      setCity(item.name);
                      setDistrict("");
                      setInitial("");
                    }}
                  />
                  {item.name}
                </label>
              ))}
            </div>
            <label className="mt-1 flex items-center gap-1 text-[13px]">
              {"\u90f5\u905e\u5340\u865f"}
              <input className={`${box} w-16 font-mono`} value={zip} onChange={(e) => setZip(e.target.value)} />
            </label>
          </div>
          <div>
            <ListBox
              items={districts.map((item) => item.name)}
              selected={district}
              onPick={(name) => {
                setDistrict(name);
                setInitial("");
              }}
            />
          </div>
          <div>
            <ListBox
              items={initials}
              selected={initial}
              onPick={(ch) => {
                setInitial(ch);
                setJumpTick((n) => n + 1);
              }}
            />
          </div>
          <div>
            <div className="mb-1 flex justify-center gap-2 text-[12px]">
              {(
                [
                  ["all", "\u5168"],
                  ["road", "\u8def"],
                  ["street", "\u8857"],
                  ["lane", "\u5df7"],
                ] as const
              ).map(([id, label]) => (
                <label key={id} className="flex items-center gap-0.5">
                  <input type="radio" name="addr-kind" checked={kind === id} onChange={() => setKind(id)} />
                  {label}
                </label>
              ))}
            </div>
            <ListBox items={filtered} selected={road} onPick={pickRoad} jump={initial} jumpTick={jumpTick} />
          </div>
          <div>
            <div className="mb-1 flex gap-1">
              <button
                type="button"
                className="border border-[#808080] bg-white px-2 text-[12px]"
                onClick={() => {
                  if (!road.trim()) return;
                  void addAddressFavorite(city, district, road.trim()).then((res) => setFavorites(res.favorites || []));
                }}
              >
                {"A\u52a0\u5165\u5e38\u7528\u9078\u9805"}
              </button>
              <button
                type="button"
                className="border border-[#808080] bg-white px-2 text-[12px]"
                onClick={() => {
                  const hit = favorites.find((item) => `${item.city}|${item.district}|${item.road}` === favKey);
                  if (!hit) return;
                  void removeAddressFavorite(hit.city, hit.district, hit.road).then((res) => {
                    setFavorites(res.favorites || []);
                    setFavKey("");
                  });
                }}
              >
                {"D\u522a\u9664\u5e38\u7528\u9078\u9805"}
              </button>
            </div>
            <div className="h-64 overflow-auto border border-[#808080] bg-white">
              {favorites.map((item) => {
                const key = `${item.city}|${item.district}|${item.road}`;
                const on = key === favKey;
                return (
                  <button
                    key={key}
                    type="button"
                    className="block w-full truncate px-1 text-left text-[13px]"
                    style={{ background: on ? "#1d4ed8" : "#fff", color: on ? "#fff" : "#1d4ed8" }}
                    onClick={() => {
                      setFavKey(key);
                      setCity(item.city);
                      setDistrict(item.district);
                      setRoad(item.road);
                      setInitial(item.road.slice(0, 1));
                      laneRef.current?.focus();
                    }}
                  >
                    {`${item.city} ${item.district} ${item.road}`}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-1 px-2 pb-1 text-[13px]">
          <label>
            {"\u7e23\uff0f\u5e02"}
            <input className={`${box} w-24`} value={city} onChange={(e) => setCity(e.target.value.replace(/\u81fa/g, "\u53f0"))} />
          </label>
          <label>
            {"\u9109\uff0f\u93ae\uff0f\u5e02"}
            <input className={`${box} w-24`} value={district} onChange={(e) => setDistrict(e.target.value)} />
          </label>
          <label>
            {"\u8def\uff0f\u8857"}
            <input className={`${box} w-40`} value={road} onChange={(e) => setRoad(e.target.value)} onKeyDown={(e) => go(e, laneRef.current)} />
          </label>
          <label>
            {"\u5df7"}
            <input ref={laneRef} className={`${box} w-14`} value={lane} onChange={(e) => setLane(e.target.value)} onKeyDown={(e) => go(e, alleyRef.current)} />
          </label>
          <label>
            {"\u5f04"}
            <input ref={alleyRef} className={`${box} w-14`} value={alley} onChange={(e) => setAlley(e.target.value)} onKeyDown={(e) => go(e, noRef.current)} />
          </label>
          <label>
            {"\u865f"}
            <input ref={noRef} className={`${box} w-14`} value={no} onChange={(e) => setNo(e.target.value)} onKeyDown={(e) => go(e, floorRef.current)} />
          </label>
          <label>
            {"\u6a13"}
            <input ref={floorRef} className={`${box} w-14`} value={floor} onChange={(e) => setFloor(e.target.value)} onKeyDown={(e) => go(e, zhiRef.current)} />
          </label>
          <label>
            {"\u4e4b"}
            <input ref={zhiRef} className={`${box} w-14`} value={zhi} onChange={(e) => setZhi(e.target.value)} onKeyDown={(e) => go(e, noteRef.current)} />
          </label>
          <label>
            {"\u5099\u8a3b"}
            <input ref={noteRef} className={`${box} w-28`} value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => go(e, saveRef.current)} />
          </label>
          <button ref={saveRef} type="button" className="h-7 border border-[#808080] bg-white px-3 font-bold" onClick={() => void save()} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }}>
            {"S\u5b58\u6a94"}
          </button>
          <button type="button" className="h-7 border border-[#808080] bg-white px-3" onClick={onClose}>
            {"\u96e2\u958b"}
          </button>
          <button
            type="button"
            className="h-7 border border-[#808080] bg-white px-3"
            onClick={() => {
              setRoad("");
              setLane("");
              setAlley("");
              setNo("");
              setFloor("");
              setZhi("");
              setNote("");
            }}
          >
            {"\u522a\u9664"}
          </button>
        </div>
        <div className="border-t border-[#c0c0c0] px-2 py-1 text-[14px]">
          {"\u4f4f\u5740\u3000"}
          {compose(parts())}
        </div>
        {busy ? <p className="bg-amber-50 px-2 py-1 text-[12px] text-amber-950">{busy}</p> : null}
      </div>
    </div>,
    document.body,
  );
}
