"""Build a zip that unzips onto a fresh program folder.

Includes the database, the clinic drug catalog, and an image index.
Does not include image bytes.
"""
from __future__ import annotations

import sqlite3
import sys
import zipfile
from datetime import datetime
from pathlib import Path


def zh(text: str) -> str:
    return text.encode("ascii").decode("unicode_escape")


ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "shadow.db"
CATALOG = ROOT / "frontend" / "public" / "yisheng_clinic_catalog.json"
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff"}


def readme() -> str:
    return "\n".join(
        [
            zh("\\u89e3\\u58d3\\u5230\\u4e0b\\u8f09\\u4e0b\\u4f86\\u7684\\u7a0b\\u5f0f\\u8cc7\\u6599\\u593e\\uff0c\\u8ddf\\u7a0b\\u5f0f\\u653e\\u540c\\u4e00\\u5c64\\u3002"),
            zh("\\u4e0d\\u8981\\u591a\\u5305\\u4e00\\u5c64\\u8cc7\\u6599\\u593e\\u3002\\u89e3\\u5b8c\\u8981\\u770b\\u5230 data/shadow.db \\u5728\\u7a0b\\u5f0f\\u8cc7\\u6599\\u593e\\u88e1\\u3002"),
            zh("\\u89e3\\u58d3\\u524d\\u5148\\u95dc\\u6389\\u9580\\u8a3a\\u3002\\u9019\\u5305\\u6703\\u84cb\\u6389\\u540c\\u540d\\u7684\\u8cc7\\u6599\\u5eab\\u3002"),
            zh("\\u88e1\\u9762\\u6709\\uff1a\\u75c5\\u4eba\\u3001\\u5c31\\u8a3a\\u3001\\u8a3a\\u65b7\\u3001\\u8655\\u65b9\\u3001\\u4e3b\\u8ff0\\u3001\\u4eba\\u4e8b\\u3001\\u9662\\u6240\\u8a2d\\u5b9a\\u3001\\u85e5\\u54c1\\u8207\\u85e5\\u7d44\\u6e05\\u55ae\\u3002"),
            zh("\\u6c92\\u6709\\u5716\\u6a94\\u672c\\u9ad4\\u3002\\u5716\\u6a94\\u6e05\\u55ae\\u5728 data/look-index.jsonl\\u3002\\u5716\\u6a94\\u672c\\u9ad4\\u8acb\\u53e6\\u5916\\u7528\\u8907\\u88fd\\u5716\\u6a94\\u628a\\u6574\\u500b IMG \\u62f7\\u5230\\u65b0\\u4e3b\\u6a5f\\u7684 data/look\\u3002"),
            "",
        ]
    )


def write_look_index(path: Path) -> int:
    sys.path.insert(0, str(ROOT))
    from src.core.look_images import look_root

    root = look_root()
    count = 0
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write('{"kind":"header","root":"' + str(root).replace("\\", "\\\\") + '"}\n')
        if not root.is_dir():
            handle.write('{"kind":"missing"}\n')
            return 0
        for folder, _dirs, names in _walk(root):
            for name in names:
                if Path(name).suffix.lower() not in IMAGE_EXT:
                    continue
                full = folder / name
                try:
                    st = full.stat()
                    rel = full.relative_to(root).as_posix()
                except OSError:
                    continue
                handle.write(
                    '{"rel":"'
                    + rel.replace("\\", "\\\\").replace('"', '\\"')
                    + '","bytes":'
                    + str(st.st_size)
                    + ',"mtime":'
                    + str(int(st.st_mtime))
                    + "}\n"
                )
                count += 1
                if count % 20000 == 0:
                    print(zh("\\u5716\\u6a94\\u6e05\\u55ae") + f" {count}", flush=True)
    return count


def _walk(root: Path):
    stack = [root]
    while stack:
        current = stack.pop()
        try:
            children = list(current.iterdir())
        except OSError:
            continue
        dirs = []
        names = []
        for child in children:
            try:
                if child.is_dir(follow_symlinks=False):
                    dirs.append(child)
                elif child.is_file(follow_symlinks=False):
                    names.append(child.name)
            except OSError:
                continue
        yield current, dirs, names
        stack.extend(dirs)


def main() -> int:
    dest_text = sys.argv[1].strip() if len(sys.argv) > 1 else ""
    if not dest_text:
        print(zh("\\u8cc7\\u6599\\u5305\\u8981\\u5b58\\u54ea\\u88e1\\uff1f\\u76f4\\u63a5 Enter \\u5c31\\u653e\\u5230 data\\\\backups"))
        dest_text = input("> ").strip()
    dest = Path(dest_text) if dest_text else ROOT / "data" / "backups"
    if not DB.is_file():
        print(zh("\\u627e\\u4e0d\\u5230\\u8cc7\\u6599\\u5eab"))
        return 1
    dest.mkdir(parents=True, exist_ok=True)
    need = DB.stat().st_size
    import shutil

    free = shutil.disk_usage(dest).free
    if free < need * 1.15:
        print(zh("\\u7a7a\\u9593\\u4e0d\\u5920\\u3002\\u8cc7\\u6599\\u5eab\\u7d04") + f" {need / 1e9:.1f} GB")
        return 1
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    tmp_db = dest / f"shadow-pack-{stamp}.partial"
    index_path = dest / f"look-index-{stamp}.jsonl"
    out = dest / f"clinic-pack-{stamp}.zip"
    print(zh("\\u6b63\\u5728\\u8907\\u88fd\\u8cc7\\u6599\\u5eab\\uff0c\\u770b\\u8a3a\\u53ef\\u4ee5\\u7e7c\\u7e8c\\u3002"), flush=True)
    src = sqlite3.connect(str(DB), timeout=60)
    try:
        dst = sqlite3.connect(str(tmp_db))
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    print(zh("\\u6b63\\u5728\\u5217\\u5716\\u6a94\\u6e05\\u55ae\\uff0c\\u4e0d\\u6703\\u6284\\u5716\\u6a94\\u672c\\u9ad4\\u3002"), flush=True)
    images = write_look_index(index_path)
    print(zh("\\u6b63\\u5728\\u58d3\\u6210\\u4e00\\u5305\\u3002"), flush=True)
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as pack:
        pack.write(tmp_db, "data/shadow.db")
        pack.write(index_path, "data/look-index.jsonl")
        if CATALOG.is_file():
            pack.write(CATALOG, "frontend/public/yisheng_clinic_catalog.json")
        pack.writestr(zh("\\u9084\\u539f\\u8aaa\\u660e.txt"), readme())
    tmp_db.unlink(missing_ok=True)
    index_path.unlink(missing_ok=True)
    print(zh("\\u5b8c\\u6210") + f" {out}")
    print(zh("\\u5927\\u5c0f") + f" {out.stat().st_size / 1e9:.2f} GB")
    print(zh("\\u5716\\u6a94\\u6e05\\u55ae\\u7b46\\u6578") + f" {images}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
