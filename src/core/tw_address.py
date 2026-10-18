# -*- coding: utf-8 -*-
"""Taiwan city / district / road catalog.

Official rows come from the Chunghwa Post 3+3 list. Clinic-added roads and
favorites live in clinic settings and stay when the official list is refreshed.
"""

from __future__ import annotations

import gzip
import json
import urllib.request
from datetime import date, datetime
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parents[2]
_BUNDLED = Path(__file__).resolve().parent / "tw_roads.json.gz"
_CACHE = _ROOT / "data" / "address" / "roads.json"
_LOCAL_KEY = "address_book_local_v1"
_GITHUB_DATA = "https://api.github.com/repos/chiakich/tw-address-tools/contents/data"
_STALE_DAYS = 30

_CITY_ORDER = [
    "\u57fa\u9686\u5e02",
    "\u53f0\u5317\u5e02",
    "\u65b0\u5317\u5e02",
    "\u5b9c\u862d\u7e23",
    "\u65b0\u7af9\u5e02",
    "\u65b0\u7af9\u7e23",
    "\u6843\u5712\u5e02",
    "\u82d7\u6817\u7e23",
    "\u53f0\u4e2d\u5e02",
    "\u5f70\u5316\u7e23",
    "\u5357\u6295\u7e23",
    "\u5609\u7fa9\u5e02",
    "\u5609\u7fa9\u7e23",
    "\u96f2\u6797\u7e23",
    "\u53f0\u5357\u5e02",
    "\u9ad8\u96c4\u5e02",
    "\u5c4f\u6771\u7e23",
    "\u53f0\u6771\u7e23",
    "\u82b1\u84ee\u7e23",
    "\u6f8e\u6e56\u7e23",
    "\u91d1\u9580\u7e23",
    "\u9023\u6c5f\u7e23",
]


def _norm_city(name: str) -> str:
    return (name or "").strip().replace("\u81fa", "\u53f0")


def parse_zip_csv(text: str, updated: str) -> dict[str, Any]:
    """CSV columns: ZIPCODE,CITY,AREA,ROAD,SCOOP. One road can span many zip rows."""
    grouped: dict[str, dict[str, dict[str, Any]]] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("ZIPCODE"):
            continue
        parts = line.split(",")
        if len(parts) < 4:
            continue
        zipcode, city, area, road = parts[0].strip(), _norm_city(parts[1]), parts[2].strip(), parts[3].strip()
        if not city or not area or not road:
            continue
        districts = grouped.setdefault(city, {})
        slot = districts.setdefault(area, {"zip": zipcode[:3], "roads": set()})
        if not slot["zip"] and zipcode:
            slot["zip"] = zipcode[:3]
        slot["roads"].add(road)
    names = [name for name in _CITY_ORDER if name in grouped]
    names.extend(sorted(set(grouped) - set(names)))
    cities = []
    for name in names:
        districts = []
        for area in sorted(grouped[name]):
            slot = grouped[name][area]
            districts.append(
                {
                    "name": area,
                    "zip": slot["zip"],
                    "roads": sorted(slot["roads"]),
                }
            )
        cities.append({"name": name, "districts": districts})
    return {
        "updated": updated,
        "source": "Chunghwa Post 3+3",
        "cities": cities,
    }


def _load_book() -> dict[str, Any]:
    if _CACHE.exists():
        return json.loads(_CACHE.read_text(encoding="utf-8"))
    if _BUNDLED.exists():
        with gzip.open(_BUNDLED, "rt", encoding="utf-8") as handle:
            return json.load(handle)
    return {"updated": "", "source": "", "cities": []}


def _save_cache(book: dict[str, Any]) -> None:
    _CACHE.parent.mkdir(parents=True, exist_ok=True)
    _CACHE.write_text(json.dumps(book, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def _local(store: Any) -> dict[str, Any]:
    raw = store.get_json_setting(_LOCAL_KEY, None) or {}
    if not isinstance(raw, dict):
        raw = {}
    raw.setdefault("roads", [])
    raw.setdefault("favorites", [])
    raw.setdefault("lastAttempt", "")
    return raw


def _write_local(store: Any, raw: dict[str, Any]) -> None:
    store.set_json_setting(_LOCAL_KEY, raw)


def tree(store: Any) -> dict[str, Any]:
    book = _load_book()
    cities = []
    for city in book.get("cities") or []:
        cities.append(
            {
                "name": city.get("name") or "",
                "districts": [
                    {"name": d.get("name") or "", "zip": d.get("zip") or ""}
                    for d in (city.get("districts") or [])
                ],
            }
        )
    local = _local(store)
    return {
        "updated": book.get("updated") or "",
        "source": book.get("source") or "",
        "cities": cities,
        "favorites": local.get("favorites") or [],
    }


def roads_for(store: Any, city: str, district: str) -> dict[str, Any]:
    city = _norm_city(city)
    district = (district or "").strip()
    book = _load_book()
    official: list[str] = []
    zipcode = ""
    for item in book.get("cities") or []:
        if item.get("name") != city:
            continue
        for area in item.get("districts") or []:
            if area.get("name") == district:
                official = list(area.get("roads") or [])
                zipcode = str(area.get("zip") or "")
                break
    local_names = [
        str(row.get("road") or "")
        for row in _local(store).get("roads") or []
        if _norm_city(str(row.get("city") or "")) == city and str(row.get("district") or "") == district
    ]
    seen = set(official)
    merged = list(official)
    local_flags = []
    for name in local_names:
        if name and name not in seen:
            merged.append(name)
            seen.add(name)
            local_flags.append(name)
    merged.sort()
    return {"zip": zipcode, "roads": merged, "local": local_flags}


def add_road(store: Any, city: str, district: str, road: str) -> None:
    city = _norm_city(city)
    district = (district or "").strip()
    road = (road or "").strip()
    if not city or not district or not road:
        raise ValueError("city, district and road are required")
    current = roads_for(store, city, district)
    if road in current["roads"]:
        return
    raw = _local(store)
    raw["roads"].append({"city": city, "district": district, "road": road})
    _write_local(store, raw)


def add_favorite(store: Any, city: str, district: str, road: str) -> list[dict[str, str]]:
    city = _norm_city(city)
    district = (district or "").strip()
    road = (road or "").strip()
    raw = _local(store)
    row = {"city": city, "district": district, "road": road}
    if row not in raw["favorites"] and city and district and road:
        raw["favorites"].append(row)
        _write_local(store, raw)
    return list(raw["favorites"])


def remove_favorite(store: Any, city: str, district: str, road: str) -> list[dict[str, str]]:
    city = _norm_city(city)
    raw = _local(store)
    raw["favorites"] = [
        row
        for row in raw["favorites"]
        if not (
            _norm_city(str(row.get("city") or "")) == city
            and str(row.get("district") or "") == (district or "").strip()
            and str(row.get("road") or "") == (road or "").strip()
        )
    ]
    _write_local(store, raw)
    return list(raw["favorites"])


def _newest_csv_url() -> tuple[str, str]:
    req = urllib.request.Request(_GITHUB_DATA, headers={"User-Agent": "wundadi-address"})
    payload = json.loads(urllib.request.urlopen(req, timeout=20).read().decode("utf-8"))
    files = [
        item
        for item in payload
        if str(item.get("name") or "").endswith(".csv") and int(item.get("size") or 0) > 500_000
    ]
    if not files:
        raise RuntimeError("no address csv")
    files.sort(key=lambda item: str(item.get("name")))
    picked = files[-1]
    return str(picked["download_url"]), str(picked["name"])


def refresh(store: Any, force: bool = False) -> dict[str, Any]:
    """Pull a newer 3+3 catalog. Clinic-added roads are not in this file."""
    local = _local(store)
    today = date.today().isoformat()
    last = str(local.get("lastAttempt") or "")
    book = _load_book()
    updated = str(book.get("updated") or "")
    if not force and last:
        try:
            age = (date.today() - date.fromisoformat(last[:10])).days
        except ValueError:
            age = _STALE_DAYS + 1
        if age < _STALE_DAYS:
            return {"ok": True, "skipped": True, "updated": updated}
    url, name = _newest_csv_url()
    raw = urllib.request.urlopen(
        urllib.request.Request(url, headers={"User-Agent": "wundadi-address"}),
        timeout=40,
    ).read()
    text = raw.decode("utf-8-sig")
    stamp = name[:4]
    updated_on = updated
    if len(stamp) == 4 and stamp.isdigit():
        updated_on = f"20{stamp[:2]}-{stamp[2:4]}"
        if updated_on.endswith("-"):
            updated_on = datetime.utcnow().date().isoformat()
    # 2606_01 -> 2026-06. Day stays 01 when the filename has it.
    if len(name) >= 7 and name[4] == "_" and name[5:7].isdigit():
        updated_on = f"20{name[:2]}-{name[2:4]}-{name[5:7]}"
    parsed = parse_zip_csv(text, updated=updated_on)
    if len(parsed["cities"]) < 10:
        raise RuntimeError("address catalog too small")
    _save_cache(parsed)
    local["lastAttempt"] = today
    _write_local(store, local)
    return {"ok": True, "skipped": False, "updated": updated_on, "file": name}
