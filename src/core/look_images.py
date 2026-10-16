"""LOOK photos. Folder is the chart number in pairs: 103170 -> 10/31/70/.

Preferred root is data/look under this project. While that folder is empty,
reads stay on Z:\\SC\\IMG so current clinic photos still open. Set
WUNDADI_LOOK_DIR to force a root. Copy the image tree into data/look when
the clinic folder should stop depending on Z:.
"""

from __future__ import annotations

import os
import re
import time
from datetime import date as date_cls
from datetime import datetime
from pathlib import Path

_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
_BASE36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_NAME = re.compile(r"^(\d{6})([0-9A-Za-z]{2})(\.[A-Za-z0-9]+)$")


def _project_look_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "data" / "look"


def look_root() -> Path:
    raw = os.environ.get("WUNDADI_LOOK_DIR", "").strip()
    if raw:
        return Path(raw)
    local = _project_look_dir()
    try:
        if local.is_dir() and any(local.iterdir()):
            return local
    except OSError:
        pass
    legacy = Path(r"Z:\SC\IMG")
    if legacy.is_dir():
        return legacy
    local.mkdir(parents=True, exist_ok=True)
    return local


def _chart_key(medical_no: str) -> str:
    digits = re.sub(r"\D", "", medical_no or "")
    if not digits:
        return ""
    if len(digits) >= 6:
        return digits[:6]
    return digits.zfill(6)


def chart_folder(medical_no: str) -> Path | None:
    """101190 -> IMG/10/11/90. Six digits: first pair, middle pair, last pair."""
    key = _chart_key(medical_no)
    if len(key) != 6:
        return None
    return look_root() / key[0:2] / key[2:4] / key[4:6]


def _serial_value(token: str) -> int | None:
    text = (token or "").upper()
    if len(text) != 2 or any(ch not in _BASE36 for ch in text):
        return None
    return _BASE36.index(text[0]) * 36 + _BASE36.index(text[1])


def _serial_token(value: int) -> str:
    if value < 0 or value >= 36 * 36:
        raise ValueError("photo serial is full")
    return _BASE36[value // 36] + _BASE36[value % 36]


def look_name(medical_no: str, serial: int, ext: str) -> str:
    key = _chart_key(medical_no)
    suffix = ext if ext.startswith(".") else f".{ext}"
    suffix = suffix.upper() if suffix.lower() == ".jpg" else suffix.lower()
    if suffix.lower() == ".jpeg":
        suffix = ".JPG"
    if suffix.lower() == ".jpg":
        suffix = ".JPG"
    return f"{key}{_serial_token(serial)}{suffix}"


def list_look_files(medical_no: str) -> list[dict[str, str]]:
    key = _chart_key(medical_no)
    folder = chart_folder(medical_no)
    if folder is None or not folder.is_dir():
        return []
    root = look_root()
    out: list[dict[str, str]] = []
    for name in sorted(os.listdir(folder)):
        match = _NAME.match(name)
        if not match or match.group(1) != key:
            continue
        if match.group(3).lower() not in _IMAGE_EXT:
            continue
        path = folder / name
        if not path.is_file():
            continue
        rel = path.resolve().relative_to(root.resolve()).as_posix()
        modified = datetime.fromtimestamp(path.stat().st_mtime).date().isoformat()
        out.append({"rel": rel, "name": name, "medicalNo": key, "modified": modified})
    out.sort(key=lambda item: (item["modified"], item["name"]), reverse=True)
    return out


# Leaf folder path + its own mtime. Parent listings already carry that mtime,
# so a date query can skip chart folders that have not been written since the start day.
_leaf_cache: tuple[float, str, list[tuple[str, float]]] | None = None
_LEAF_TTL_SEC = 90.0


def _leaf_folders(base: Path) -> list[tuple[str, float]]:
    """IMG/aa/bb/cc folders. cc is the chart folder; its mtime moves when a photo is added."""
    global _leaf_cache
    key = str(base)
    now = time.monotonic()
    if _leaf_cache is not None and _leaf_cache[1] == key and now - _leaf_cache[0] < _LEAF_TTL_SEC:
        return _leaf_cache[2]
    leaves: list[tuple[str, float]] = []
    stack: list[tuple[str, int]] = [(key, 0)]
    while stack:
        current, depth = stack.pop()
        try:
            iterator = os.scandir(current)
        except OSError:
            continue
        with iterator:
            for entry in iterator:
                try:
                    if not entry.is_dir(follow_symlinks=False):
                        continue
                    if depth < 2:
                        stack.append((entry.path, depth + 1))
                        continue
                    leaves.append((entry.path, entry.stat(follow_symlinks=False).st_mtime))
                except OSError:
                    continue
    _leaf_cache = (now, key, leaves)
    return leaves


def charts_with_images(date_from: str, date_to: str, root: Path | None = None) -> set[str]:
    """Chart numbers that have a photo file saved inside the inclusive date range.

    The date is the file's local modified time, which is when the photo was written.
    Only chart folders touched on or after the start day are opened.
    """
    base = root if root is not None else look_root()
    if not base.is_dir():
        return set()
    start = date_cls.fromisoformat(date_from[:10])
    end = date_cls.fromisoformat(date_to[:10])
    start_ts = datetime(start.year, start.month, start.day).timestamp()
    found: set[str] = set()
    for folder, folder_mtime in _leaf_folders(base):
        if folder_mtime < start_ts:
            continue
        try:
            iterator = os.scandir(folder)
        except OSError:
            continue
        with iterator:
            for entry in iterator:
                try:
                    if entry.is_dir(follow_symlinks=False):
                        continue
                    match = _NAME.match(entry.name)
                    if not match or match.group(3).lower() not in _IMAGE_EXT:
                        continue
                    day = date_cls.fromtimestamp(entry.stat(follow_symlinks=False).st_mtime)
                except OSError:
                    continue
                if start <= day <= end:
                    found.add(match.group(1))
    return found


def next_look_serial(medical_no: str) -> int:
    """Next free 2-char base36 code. 00..ZZ is 1296 names. Does not reuse a gap."""
    used = -1
    for item in list_look_files(medical_no):
        match = _NAME.match(item["name"])
        if not match:
            continue
        value = _serial_value(match.group(2))
        if value is not None and value > used:
            used = value
    nxt = used + 1
    if nxt >= 36 * 36:
        raise ValueError("photo serial is full")
    return nxt


def write_look_image(medical_no: str, data: bytes, ext: str = ".JPG") -> dict[str, str]:
    """Write one new photo. Never overwrites and never deletes."""
    folder = chart_folder(medical_no)
    if folder is None:
        raise ValueError("chart number needs 6 digits")
    if not data:
        raise ValueError("empty photo")
    suffix = ext if str(ext).startswith(".") else f".{ext}"
    if suffix.lower() not in _IMAGE_EXT:
        raise ValueError("unsupported photo type")
    folder.mkdir(parents=True, exist_ok=True)
    serial = next_look_serial(medical_no)
    name = look_name(medical_no, serial, suffix)
    path = folder / name
    if path.exists():
        raise FileExistsError(name)
    path.write_bytes(data)
    global _leaf_cache
    _leaf_cache = None
    root = look_root().resolve()
    rel = path.resolve().relative_to(root).as_posix()
    return {"rel": rel, "name": name, "medicalNo": _chart_key(medical_no)}


def resolve_look_file(rel: str) -> Path:
    root = look_root().resolve()
    target = (root / rel).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise FileNotFoundError(rel)
    if target.suffix.lower() not in _IMAGE_EXT:
        raise FileNotFoundError(rel)
    return target


def _drop_leaf_cache() -> None:
    global _leaf_cache
    _leaf_cache = None


def removed_root() -> Path:
    """Photos taken out of an album. Not shown in LOOK. Can be put back by hand."""
    return Path(__file__).resolve().parents[2] / "data" / "look-removed"


def retire_look_file(rel: str) -> None:
    """Take one photo out of the album. The bytes move under data/look-removed."""
    import shutil

    path = resolve_look_file(rel)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest_dir = removed_root() / stamp
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / path.name
    n = 1
    while dest.exists():
        dest = dest_dir / f"{path.stem}-{n}{path.suffix}"
        n += 1
    shutil.move(str(path), str(dest))
    _drop_leaf_cache()


def replace_look_file(rel: str, data: bytes) -> dict[str, str]:
    """Overwrite this photo. A jpeg written over a non-jpeg becomes a new .JPG and the old file is retired."""
    path = resolve_look_file(rel)
    if not data:
        raise ValueError("empty photo")
    jpeg = data[:3] == b"\xff\xd8\xff"
    if jpeg and path.suffix.lower() not in {".jpg", ".jpeg"}:
        key = path.name[:6]
        saved = write_look_image(key, data, ".JPG")
        retire_look_file(rel)
        return saved
    path.write_bytes(data)
    _drop_leaf_cache()
    root = look_root().resolve()
    return {"rel": path.resolve().relative_to(root).as_posix(), "name": path.name}
