"""病灶 Media API 自動驗收。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from src.api.main import app
from src.app.bootstrap import get_shadow_store

# 1x1 PNG
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def main() -> int:
    print("=" * 50)
    print("NHI media intake test")
    print("=" * 50)

    store = get_shadow_store()
    store.initialize()
    client = TestClient(app)
    failed = 0

    encs = store.list_cached_resources("Encounter", limit=1)
    if not encs:
        print("[FAIL] no encounter")
        return 1
    eid = str(encs[0]["id"])

    body = {
        "encounterId": eid,
        "siteLabel": "左前臂",
        "contentType": "image/png",
        "imageBase64": TINY_PNG_B64,
        "note": "沙盒驗收",
    }
    r = client.post("/nhi/v1/media/register", json=body)
    if r.status_code != 201:
        print("[FAIL] register", r.status_code, r.text)
        failed += 1
    else:
        mid = r.json()["mediaId"]
        print("[PASS] register", mid)
        idx = r.json().get("indexLayer") or {}
        if idx.get("siteLabel") != "左前臂":
            print("[FAIL] indexLayer", idx)
            failed += 1
        else:
            print("[PASS] indexLayer siteLabel")

        dual = client.get(f"/sandbox/dual-layer/Media/{mid}")
        if dual.status_code != 200:
            print("[FAIL] dual-layer", dual.text)
            failed += 1
        else:
            print("[PASS] dual-layer Media")

        lst = client.get(f"/nhi/v1/media/by-encounter/{eid}")
        if lst.status_code != 200 or lst.json().get("total", 0) < 1:
            print("[FAIL] by-encounter", lst.text)
            failed += 1
        else:
            print("[PASS] by-encounter list")

        ws = client.get(f"/nhi/v1/outpatient/workspace/{eid}")
        if ws.status_code == 200 and len(ws.json().get("lesionMedia") or []) >= 1:
            print("[PASS] workspace lesionMedia")
        else:
            print("[FAIL] workspace lesionMedia")
            failed += 1

    bad = client.post(
        "/nhi/v1/media/register",
        json={**body, "imageBase64": "not-valid-base64!!!"},
    )
    if bad.status_code != 422:
        print("[FAIL] expect 422 bad b64")
        failed += 1
    else:
        print("[PASS] rejected invalid base64")

    print("=" * 50)
    if failed:
        print(f"RESULT: FAILED ({failed})")
        return 1
    print("RESULT: ALL PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
