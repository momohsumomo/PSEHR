"""Pick one GitHub Release out of a mixed list.

Drug packs use the drug-pack- prefix. Program updates use program-.
releases/latest is not safe once both kinds exist.
"""

from __future__ import annotations

from typing import Any


def pick_release(items: list[dict[str, Any]], prefix: str) -> dict[str, Any] | None:
    for item in items:
        tag = str(item.get("tag_name") or "")
        if tag.startswith(prefix):
            return item
    return None
