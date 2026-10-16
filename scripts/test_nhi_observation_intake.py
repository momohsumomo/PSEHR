"""NHI Observation 自動驗收。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from src.api.main import app
from src.app.bootstrap import get_shadow_store


def main() -> int:
    print("=" * 50)
    print("NHI Observation intake test")
    print("=" * 50)

    store = get_shadow_store()
    store.initialize()
    client = TestClient(app)
    failed = 0

    encounters = store.list_cached_resources("Encounter", limit=1)
    if not encounters:
        print("[FAIL] no Encounter")
        return 1
    enc_id = str(encounters[0]["id"])
    print(f"Using Encounter/{enc_id}")

    vitals = [
        {"vitalType": "body_temperature", "value": 36.8},
        {"vitalType": "heart_rate", "value": 78},
        {"vitalType": "systolic_bp", "value": 120},
        {"vitalType": "diastolic_bp", "value": 80},
    ]
    obs_ids: list[str] = []

    for v in vitals:
        body = {"encounterId": enc_id, **v}
        r = client.post("/nhi/v1/observation/register", json=body)
        if r.status_code != 201:
            print("[FAIL] register", v, r.status_code, r.text)
            failed += 1
        else:
            data = r.json()
            obs_ids.append(data["observationId"])
            print(f"[PASS] {v['vitalType']} -> {data['observationId']} {data['loincCode']}")

    if obs_ids:
        dual = client.get(f"/sandbox/dual-layer/Observation/{obs_ids[0]}")
        if dual.status_code != 200:
            print("[FAIL] dual-layer", dual.text)
            failed += 1
        else:
            idx = dual.json().get("indexLayer") or {}
            if idx.get("loincCode") != "8310-5":
                print("[FAIL] index loinc", idx)
                failed += 1
            else:
                print("[PASS] dual-layer index")

    lr = client.get("/fhir/Observation", params={"encounter": enc_id})
    if lr.status_code != 200 or lr.json().get("total", 0) < 4:
        print("[FAIL] list", lr.status_code, lr.text)
        failed += 1
    else:
        print(f"[PASS] list total={lr.json()['total']}")

    bad = client.post(
        "/nhi/v1/observation/register",
        json={"encounterId": enc_id, "vitalType": "heart_rate", "value": 999},
    )
    if bad.status_code != 422:
        print("[FAIL] expect 422 out of range", bad.status_code)
        failed += 1
    else:
        print("[PASS] rejected out-of-range heart_rate")

    print("=" * 50)
    if failed:
        print(f"RESULT: FAILED ({failed})")
        return 1
    print("RESULT: ALL PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
