"""過敏嚴格進場 API 自動驗收（沙盒 2）。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from src.api.main import app
from src.app.bootstrap import get_shadow_store


def _first_patient_id(client: TestClient) -> str | None:
    r = client.get("/fhir/Patient")
    if r.status_code != 200:
        return None
    bundle = r.json()
    entries = bundle if isinstance(bundle, list) else bundle.get("entry") or []
    if not entries:
        return None
    first = entries[0]
    resource = first.get("resource") if isinstance(first, dict) else first
    if isinstance(resource, dict) and resource.get("id"):
        return str(resource["id"])
    return None


def main() -> int:
    print("=" * 50)
    print("NHI allergy intake test")
    print("=" * 50)

    store = get_shadow_store()
    store.initialize()
    client = TestClient(app)
    failed = 0

    pid = _first_patient_id(client)
    if not pid:
        print("[FAIL] no seed patient")
        return 1
    print(f"[INFO] patientId={pid}")

    body = {
        "patientId": pid,
        "patientIdNo": "A123456789",
        "verificationStatus": "confirmed",
        "category": "medication",
        "criticality": "high",
        "allergenSnomedCode": "292044008",
        "allergenDisplayText": "Adverse reaction to NSAID",
        "substanceRxnormCode": "5640",
        "substanceDisplayText": "Ibuprofen",
        "manifestationSnomedCode": "247472004",
        "manifestationDisplayText": "Weal",
        "reactionSeverity": "moderate",
    }

    r = client.post("/nhi/v1/allergy/register", json=body)
    if r.status_code != 201:
        print("[FAIL] register", r.status_code, r.text)
        failed += 1
    else:
        data = r.json()
        aid = data["allergyId"]
        print("[PASS] register", aid)
        idx = data.get("indexLayer") or {}
        if idx.get("snomedCode") != "292044008" or idx.get("rxnormSubstance") != "5640":
            print("[FAIL] indexLayer", idx)
            failed += 1
        else:
            print("[PASS] indexLayer snomed/rxnorm")
        stickers = data.get("allergyStickers") or {}
        if stickers.get("snomedManifestation") != "247472004":
            print("[FAIL] stickers", stickers)
            failed += 1
        else:
            print("[PASS] manifestation sticker")

        dual = client.get(f"/sandbox/dual-layer/AllergyIntolerance/{aid}")
        if dual.status_code != 200 or not dual.json().get("indexPresent"):
            print("[FAIL] dual-layer", dual.text)
            failed += 1
        else:
            print("[PASS] dual-layer AllergyIntolerance")

        lst = client.get(f"/nhi/v1/allergy/by-patient/{pid}")
        if lst.status_code != 200 or lst.json().get("total", 0) < 1:
            print("[FAIL] by-patient list", lst.text)
            failed += 1
        else:
            print("[PASS] by-patient list", lst.json()["total"])

    bad = {**body, "allergenSnomedCode": "NOT-SNOMED"}
    br = client.post("/nhi/v1/allergy/register", json=bad)
    if br.status_code != 422:
        print("[FAIL] expect 422 bad snomed", br.status_code)
        failed += 1
    else:
        print("[PASS] rejected invalid snomed")

    no_rx = {**body, "substanceRxnormCode": None}
    br2 = client.post("/nhi/v1/allergy/register", json=no_rx)
    if br2.status_code != 422:
        print("[FAIL] expect 422 missing rxnorm for medication", br2.status_code)
        failed += 1
    else:
        print("[PASS] rejected medication without rxnorm")

    print("=" * 50)
    if failed:
        print(f"RESULT: FAILED ({failed})")
        return 1
    print("RESULT: ALL PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
