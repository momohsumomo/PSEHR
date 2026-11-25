"""Write StructureDefinitions for every Polaris extension found in a chart DB copy.

  python scripts/build_extension_sds.py --db COPY.db [--out fhir-ig]

Reads resource_cache only (read-only), records for each extension URL where it
sits, which value[x] types it carries and its sub-extensions, and writes one
StructureDefinition per URL plus package.json. The output holds URLs and types,
no chart data, so it can be committed. Validate with
  java -jar validator_cli.jar FILES -version 4.0.1 -ig tw.gov.mohw.twcore#1.0.0 -ig fhir-ig
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.core.fhir_urls import POLARIS_BASE  # noqa: E402

PRIMITIVES = {
    "base64Binary", "boolean", "canonical", "code", "date", "dateTime", "decimal", "id", "instant",
    "integer", "markdown", "oid", "positiveInt", "string", "time", "unsignedInt", "uri", "url", "uuid",
}
EXT_BASE = "http://hl7.org/fhir/StructureDefinition/Extension"


class Shape:
    def __init__(self) -> None:
        self.contexts: set[str] = set()
        self.types: set[str] = set()
        self.subs: dict[str, Shape] = defaultdict(Shape)
        self.repeats: set[str] = set()


def _type_of(key: str) -> str:
    name = key[len("value"):]
    lower = name[0].lower() + name[1:]
    return lower if lower in PRIMITIVES else name


def _record(shape: Shape, ext: dict) -> None:
    for key in ext:
        if key.startswith("value") and len(key) > 5:
            shape.types.add(_type_of(key))
    seen: dict[str, int] = defaultdict(int)
    for sub in ext.get("extension") or []:
        if isinstance(sub, dict) and sub.get("url"):
            url = str(sub["url"])
            seen[url] += 1
            _record(shape.subs[url], sub)
    shape.repeats.update(url for url, n in seen.items() if n > 1)


def _walk(node, path: str, found: dict[str, Shape], list_counts: dict[tuple[str, str], int]) -> None:
    if isinstance(node, dict):
        exts = node.get("extension") or []
        per_url: dict[str, int] = defaultdict(int)
        for ext in exts if isinstance(exts, list) else []:
            if isinstance(ext, dict) and str(ext.get("url") or "").startswith(POLARIS_BASE):
                url = str(ext["url"])
                found[url].contexts.add(path)
                per_url[url] += 1
                _record(found[url], ext)
        for url, n in per_url.items():
            if n > 1:
                list_counts[(url, path)] = max(list_counts.get((url, path), 0), n)
        for key, value in node.items():
            if key in ("extension", "modifierExtension", "contained"):
                continue
            _walk(value, f"{path}.{key}", found, list_counts)
    elif isinstance(node, list):
        for item in node:
            _walk(item, path, found, list_counts)


def _name(url: str) -> str:
    tail = url.rstrip("/").split("/")[-1]
    parts = re.split(r"[^A-Za-z0-9]+", tail)
    return "".join(p[:1].upper() + p[1:] for p in parts if p) or "Extension"


def _elements(prefix: str, path: str, shape: Shape, url: str, many: bool) -> list[dict]:
    out: list[dict] = [{"id": prefix, "path": path, **({"max": "*"} if many else {})}]
    if shape.subs:
        out.append({
            "id": f"{prefix}.extension",
            "path": f"{path}.extension",
            "slicing": {"discriminator": [{"type": "value", "path": "url"}], "rules": "open"},
        })
        for sub_url in sorted(shape.subs):
            sub = shape.subs[sub_url]
            slice_id = f"{prefix}.extension:{_slice(sub_url)}"
            head = {
                "id": slice_id,
                "path": f"{path}.extension",
                "sliceName": _slice(sub_url),
                "min": 0,
                "max": "*" if sub_url in shape.repeats else "1",
            }
            inner = _elements(slice_id, f"{path}.extension", sub, sub_url, False)[1:]
            out.append(head)
            out.extend(inner)
    out.append({"id": f"{prefix}.url", "path": f"{path}.url", "fixedUri": url})
    if shape.types:
        out.append({
            "id": f"{prefix}.value[x]",
            "path": f"{path}.value[x]",
            "type": [{"code": t} for t in sorted(shape.types)],
        })
    else:
        out.append({"id": f"{prefix}.value[x]", "path": f"{path}.value[x]", "max": "0"})
    return out


def _slice(url: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", url.rstrip("/").split("/")[-1]).strip("-") or "sub"


def build(url: str, shape: Shape) -> dict:
    name = _name(url)
    return {
        "resourceType": "StructureDefinition",
        "id": re.sub(r"[^A-Za-z0-9\-.]", "-", url.rstrip("/").split("/")[-1])[:64],
        "url": url,
        "version": "1.0.0",
        "name": name,
        "title": name,
        "status": "active",
        "description": "Polaris SEHR extension; shape taken from the stored chart data.",
        "fhirVersion": "4.0.1",
        "kind": "complex-type",
        "abstract": False,
        "context": [{"type": "element", "expression": c} for c in sorted(shape.contexts)],
        "type": "Extension",
        "baseDefinition": EXT_BASE,
        "derivation": "constraint",
        "differential": {"element": _elements("Extension", "Extension", shape, url, False)},
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", required=True, type=Path)
    ap.add_argument("--out", type=Path, default=ROOT / "fhir-ig")
    args = ap.parse_args()
    conn = sqlite3.connect(f"file:{args.db.as_posix()}?mode=ro", uri=True)
    found: dict[str, Shape] = defaultdict(Shape)
    counts: dict[tuple[str, str], int] = {}
    n = 0
    for rtype, text in conn.execute("SELECT resource_type, payload_json FROM resource_cache"):
        _walk(json.loads(text), rtype, found, counts)
        n += 1
        if n % 500_000 == 0:
            print(f"  {n} resources", flush=True)
    args.out.mkdir(parents=True, exist_ok=True)
    for old in args.out.glob("StructureDefinition-*.json"):
        old.unlink()
    ids: set[str] = set()
    for url in sorted(found):
        sd = build(url, found[url])
        base_id, i = sd["id"], 2
        while sd["id"] in ids:
            sd["id"] = f"{base_id}-{i}"
            i += 1
        ids.add(sd["id"])
        (args.out / f"StructureDefinition-{sd['id']}.json").write_text(
            json.dumps(sd, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    (args.out / "package.json").write_text(json.dumps({
        "name": "polarissehr.extensions",
        "version": "1.0.0",
        "fhirVersions": ["4.0.1"],
        "type": "fhir.ig",
        "canonical": POLARIS_BASE.rstrip("/"),
        "dependencies": {"hl7.fhir.r4.core": "4.0.1"},
    }, indent=2) + "\n", encoding="utf-8")
    print(f"{n} resources, {len(found)} extensions -> {args.out}")


if __name__ == "__main__":
    main()
