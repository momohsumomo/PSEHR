"""與上一 snapshot 比對。"""

from __future__ import annotations

from typing import Any


def diff_snapshots(
    previous: dict[str, dict[str, Any]],
    current: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    prev_keys = set(previous)
    curr_keys = set(current)
    added_keys = sorted(curr_keys - prev_keys)
    removed_keys = sorted(prev_keys - curr_keys)
    common = curr_keys & prev_keys

    price_changes: list[dict[str, Any]] = []
    field_changes: list[dict[str, Any]] = []
    max_rel_pct = 0.0
    control_filled = 0
    control_cleared = 0
    control_reclassified = 0
    control_reclass_samples: list[dict[str, Any]] = []

    for k in sorted(common):
        a, b = previous[k], current[k]
        pa, pb = a.get("price"), b.get("price")
        if pa != pb:
            rel = 0.0
            if pa not in (None, 0) and pb is not None:
                rel = abs(float(pb) - float(pa)) / abs(float(pa)) * 100.0
            elif pa in (None, 0) and pb not in (None, 0):
                rel = 100.0
            max_rel_pct = max(max_rel_pct, rel)
            price_changes.append(
                {
                    "key": k,
                    "nhiCode": b.get("nhiCode"),
                    "nameZh": b.get("nameZh"),
                    "oldPrice": pa,
                    "newPrice": pb,
                    "relPct": round(rel, 2),
                }
            )
        # 其他欄位粗比
        for field in ("endDate", "startDate", "nameZh", "atc", "isUpdate", "controlClass"):
            if a.get(field) != b.get(field):
                field_changes.append(
                    {
                        "key": k,
                        "field": field,
                        "old": a.get(field),
                        "new": b.get(field),
                        "nhiCode": b.get("nhiCode"),
                    }
                )
        old_c = (a.get("controlClass") or "").strip()
        new_c = (b.get("controlClass") or "").strip()
        if old_c != new_c:
            if not old_c and new_c:
                control_filled += 1
            elif old_c and not new_c:
                control_cleared += 1
            else:
                control_reclassified += 1
                control_reclass_samples.append(
                    {
                        "key": k,
                        "nhiCode": b.get("nhiCode"),
                        "nameZh": b.get("nameZh"),
                        "old": old_c,
                        "new": new_c,
                    }
                )

    material = bool(
        added_keys or removed_keys or price_changes or control_filled or control_cleared or control_reclassified
    )
    summary = {
        "previousCount": len(previous),
        "currentCount": len(current),
        "added": len(added_keys),
        "removed": len(removed_keys),
        "priceChanged": len(price_changes),
        "otherFieldChanged": len(field_changes),
        "controlFilled": control_filled,
        "controlCleared": control_cleared,
        "controlReclassified": control_reclassified,
        "maxPriceRelPct": round(max_rel_pct, 2),
        "material": material,
        "priceMaterial": bool(added_keys or removed_keys or price_changes),
    }
    # 樣本（給 LLM／通知，避免塞爆）
    samples = {
        "addedSample": [current[k] for k in added_keys[:20]],
        "removedSample": [previous[k] for k in removed_keys[:20]],
        "priceChangeSample": price_changes[:30],
        "fieldChangeSample": field_changes[:30],
        "controlReclassSample": control_reclass_samples[:30],
    }
    return {"summary": summary, "samples": samples, "priceChanges": price_changes}
