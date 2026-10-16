"""組裝並發布 Pack 到 hub_packages（供 Spoke Hydrator 下載）。"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from typing import Any

from hub import config
from src.spoke.pack_models import sha256_canonical_payload


def next_version(day: date | None = None) -> str:
    d = day or date.today()
    base = f"{d.year:04d}.{d.month:02d}"
    # 同月多版：.0 .1 .2 …（略過 *.summary.json）
    n = 0
    for p in config.PUBLISH_DIR.glob(f"{base}.*.json"):
        if p.name.endswith(".summary.json"):
            continue
        # stem 應為 YYYY.MM.N
        parts = p.stem.split(".")
        if len(parts) != 3:
            continue
        try:
            n = max(n, int(parts[2]) + 1)
        except ValueError:
            continue
    return f"{base}.{n}"


def build_pack(
    *,
    rows: dict[str, dict[str, Any]],
    diff_summary: dict[str, Any],
    publish_mode: str,
    intervention_event: str | None,
    version: str | None = None,
    controlled_by_nhi_code: dict[str, str] | None = None,
    extra_source: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ver = version or next_version()
    drugs = list(rows.values())
    # 依 nhiCode + startDate 排序，穩定輸出
    drugs.sort(key=lambda r: (r.get("nhiCode") or "", r.get("startDate") or ""))
    index = dict(controlled_by_nhi_code or {})
    if not index:
        for r in drugs:
            code = str(r.get("nhiCode") or "").strip()
            cls = str(r.get("controlClass") or "").strip()
            if code and cls:
                index[code] = cls
    source: dict[str, Any] = {
        "system": "NHI-open-data+TFDA-open-data",
        "resourceId": config.NHI_RESOURCE_ID,
        "datastoreUrl": config.NHI_DATASTORE_URL,
    }
    if extra_source:
        source.update(extra_source)
    pack: dict[str, Any] = {
        "version": ver,
        "effectiveFrom": date.today().isoformat(),
        "effectiveTo": None,
        "publishedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "publishMode": publish_mode,
        "interventionEvent": intervention_event,
        "source": source,
        "resources": {
            "drugs": drugs,
            "drugCount": len(drugs),
            "controlledByNhiCode": index,
            "controlCount": len(index),
            "diffSummary": diff_summary,
        },
    }
    pack["checksumSha256"] = sha256_canonical_payload(pack)
    return pack


def publish_pack(pack: dict[str, Any]) -> str:
    config.PUBLISH_DIR.mkdir(parents=True, exist_ok=True)
    path = config.PUBLISH_DIR / f"{pack['version']}.json"
    # 大檔：不 indent
    path.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # 旁路摘要（方便人眼看，不含 drugs）
    summary = {
        "version": pack["version"],
        "effectiveFrom": pack["effectiveFrom"],
        "checksumSha256": pack["checksumSha256"],
        "publishMode": pack["publishMode"],
        "drugCount": pack["resources"].get("drugCount"),
        "controlCount": pack["resources"].get("controlCount"),
        "diffSummary": pack["resources"].get("diffSummary"),
        "interventionEvent": pack.get("interventionEvent"),
    }
    (config.PUBLISH_DIR / f"{pack['version']}.summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return str(path)
