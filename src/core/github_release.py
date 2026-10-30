"""Pick one GitHub Release out of a mixed list.

Drug packs use the drug-pack- prefix. Program updates use program-.
releases/latest is not safe once both kinds exist.
"""

from __future__ import annotations

from typing import Any


def _published(item: dict[str, Any]) -> str:
    return str(item.get("published_at") or item.get("created_at") or "")


def pick_release(items: list[dict[str, Any]], prefix: str) -> dict[str, Any] | None:
    hits = [item for item in items if str(item.get("tag_name") or "").startswith(prefix)]
    if not hits:
        return None
    # GitHub lists tags by name, so program-2026.10.21.9 comes before .10.
    # The clinic wants the one published last.
    return max(hits, key=_published)


def recent_releases(items: list[dict[str, Any]], prefix: str, keep: int = 5) -> list[dict[str, Any]]:
    hits = [item for item in items if str(item.get("tag_name") or "").startswith(prefix)]
    hits.sort(key=_published, reverse=True)
    return hits[:keep]
