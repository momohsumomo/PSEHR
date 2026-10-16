"""NHI 門診 SOAP 落庫自動驗收。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from src.api.main import app
from src.app.bootstrap import get_shadow_store


def main() -> int:
    print("=" * 50)
    print("NHI SOAP intake test")
    print("=" * 50)

    store = get_shadow_store()
    store.initialize()
    client = TestClient(app)
    failed = 0

    encounters = store.list_cached_resources("Encounter", limit=5)
    if not encounters:
        print("[FAIL] need at least one Encounter in shadow.db — run init_shadow_db")
        return 1

    enc_id = str(encounters[0]["id"])
    print(f"Using Encounter/{enc_id}")

    soap_body = {
        "encounterId": enc_id,
        "chiefComplaint": "全身搔癢加劇三日",
        "subjective": "既往異位性皮膚炎，否認發燒",
        "objective": "軀幹散在紅斑與風團",
        "assessment": "急性蕁麻疹發作",
        "plan": "抗組織胺口服，類固醇外用，衛教避免刺激",
    }

    r = client.post("/nhi/v1/soap/register", json=soap_body)
    if r.status_code != 201:
        print("[FAIL] register soap", r.status_code, r.text)
        failed += 1
    else:
        data = r.json()
        cid = data["compositionId"]
        print("[PASS] register soap", cid)
        if not data.get("encounterReasonSynced"):
            print("[FAIL] encounterReasonSynced")
            failed += 1
        else:
            print("[PASS] encounter reason synced")

        dual = client.get(f"/sandbox/dual-layer/Composition/{cid}")
        if dual.status_code != 200:
            print("[FAIL] dual-layer", dual.text)
            failed += 1
        else:
            idx = dual.json().get("indexLayer") or {}
            if idx.get("chiefComplaint") != soap_body["chiefComplaint"]:
                print("[FAIL] index chiefComplaint", idx)
                failed += 1
            else:
                print("[PASS] indexLayer chiefComplaint")

        by_enc = client.get(f"/nhi/v1/soap/by-encounter/{enc_id}")
        if by_enc.status_code != 200:
            print("[FAIL] by-encounter", by_enc.text)
            failed += 1
        else:
            print("[PASS] GET soap by encounter")

    r2 = client.post("/nhi/v1/soap/register", json=soap_body)
    if r2.status_code != 201 or r2.json().get("created") is not False:
        print("[FAIL] soap upsert", r2.text)
        failed += 1
    else:
        print("[PASS] same encounter updates soap")

    bad = client.post(
        "/nhi/v1/soap/register",
        json={
            "encounterId": enc_id,
            "chiefComplaint": "x",
            "assessment": "a",
            "plan": "p",
        },
    )
    if bad.status_code != 422:
        print("[FAIL] expect 422 short CC", bad.status_code)
        failed += 1
    else:
        print("[PASS] rejected short chiefComplaint")

    print("=" * 50)
    if failed:
        print(f"RESULT: FAILED ({failed})")
        return 1
    print("RESULT: ALL PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
