# -*- coding: utf-8 -*-
"""Build the bundled road catalog from the Chunghwa 3+3 CSV snapshot."""
import gzip
import json
from pathlib import Path

from src.core.tw_address import parse_zip_csv

src = Path(r"C:\Users\Michael\AppData\Local\Temp\tw_zip_2606.csv")
text = src.read_text(encoding="utf-8-sig")
book = parse_zip_csv(text, updated="2026-06-29")
out = Path("src/core/tw_roads.json.gz")
out.parent.mkdir(parents=True, exist_ok=True)
raw = json.dumps(book, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
out.write_bytes(gzip.compress(raw, 9))
roads = sum(len(d["roads"]) for c in book["cities"] for d in c["districts"])
print("cities", len(book["cities"]), "roads", roads, "gz", out.stat().st_size, "json", len(raw))
