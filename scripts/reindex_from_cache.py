"""依 resource_cache 重新寫入 index 貼紙（schema 升級後使用）。"""

from __future__ import annotations

from src.app.bootstrap import get_shadow_store
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore


def main() -> int:
    store = get_shadow_store()
    assert isinstance(store, SqliteShadowStore)
    store.initialize()
    for rt in ("Patient", "Encounter", "Condition", "MedicationRequest", "AllergyIntolerance"):
        resources = store.list_cached_resources(rt, limit=10_000)
        for res in resources:
            rid = res.get("id")
            if rid:
                store.cache_resource(rt, str(rid), res)
        print(f"  reindex {rt}: {len(resources)}")
    print(f"完成：{store.db_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
