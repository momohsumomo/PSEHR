"""診斷 / 處方 NHI 嚴格進場 API 自動驗收。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from src.api.main import app
from src.app.bootstrap import get_shadow_store


def main() -> int:
    print("=" * 50)
    print("NHI condition + medication intake test")
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
    print(f"[INFO] encounter={eid}")

    cr = client.post(
        "/nhi/v1/condition/register",
        json={
            "encounterId": eid,
            "summaryText": "蕁麻疹",
            "icd10Code": "L50.9",
            "nhiIcd10Code": "L509",
        },
    )
    if cr.status_code != 201:
        print("[FAIL] condition", cr.status_code, cr.text)
        failed += 1
    else:
        cid = cr.json()["conditionId"]
        idx = cr.json().get("indexLayer") or {}
        if idx.get("icd10Code") != "L50.9":
            print("[FAIL] condition index", idx)
            failed += 1
        else:
            print("[PASS] condition", cid)
        dual = client.get(f"/sandbox/dual-layer/Condition/{cid}")
        if dual.status_code != 200 or not dual.json().get("indexPresent"):
            print("[FAIL] condition dual-layer", dual.text)
            failed += 1
        else:
            print("[PASS] condition dual-layer")

    mr = client.post(
        "/nhi/v1/medication/register",
        json={
            "encounterId": eid,
            "drugText": "Betamethasone cream",
            "nhiCode": "AC44121",
            "rxnormCode": "1292",
            "sig": "BID 外用",
        },
    )
    if mr.status_code != 201:
        print("[FAIL] medication", mr.status_code, mr.text)
        failed += 1
    else:
        mid = mr.json()["medicationRequestId"]
        idx = mr.json().get("indexLayer") or {}
        if idx.get("nhiCode") != "AC44121":
            print("[FAIL] medication index", idx)
            failed += 1
        else:
            print("[PASS] medication", mid)

    ws = client.get(f"/nhi/v1/outpatient/workspace/{eid}")
    if ws.status_code != 200:
        print("[FAIL] workspace", ws.text)
        failed += 1
    else:
        data = ws.json()
        if not data.get("diagnoses"):
            print("[FAIL] workspace diagnoses empty")
            failed += 1
        elif not data.get("currentMedications"):
            print("[FAIL] workspace meds empty")
            failed += 1
        else:
            print("[PASS] workspace diagnoses + currentMedications")

    print("=" * 50)
    if failed:
        print(f"RESULT: FAILED ({failed})")
        return 1
    print("RESULT: ALL PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
