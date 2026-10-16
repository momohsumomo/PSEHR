"""門診閉環 API 自動驗收（工作台 + 預診 + 前次處方）。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from src.api.main import app
from src.app.bootstrap import get_shadow_store


def main() -> int:
    print("=" * 50)
    print("Outpatient closed-loop test")
    print("=" * 50)

    store = get_shadow_store()
    store.initialize()
    client = TestClient(app)
    failed = 0

    encs = store.list_cached_resources("Encounter", limit=5)
    if not encs:
        print("[FAIL] no encounters in shadow db")
        return 1
    enc = encs[0]
    eid = str(enc["id"])
    pid = (enc.get("subject") or {}).get("reference", "").split("/")[-1]
    print(f"[INFO] encounter={eid} patient={pid}")

    er = client.get("/fhir/Encounter", params={"date": "today"})
    today_entries = er.json().get("entry") if er.status_code == 200 else []

    ws0 = client.get(f"/nhi/v1/outpatient/workspace/{eid}")
    if ws0.status_code == 200 and ws0.json().get("preVisitCompleted"):
        print("[PASS] previsit already completed")
    else:
        pr = client.post(
            "/nhi/v1/previsit/submit",
            json={
                "encounterId": eid,
                "chiefComplaint": "面部紅疹搔癢三天",
                "symptomTags": ["itching", "rash"],
                "hasDrugAllergyHistory": True,
            },
        )
        if pr.status_code != 201:
            print("[FAIL] previsit", pr.status_code, pr.text)
            failed += 1
        else:
            print("[PASS] previsit submit")

    ws = client.get(f"/nhi/v1/outpatient/workspace/{eid}")
    if ws.status_code != 200:
        print("[FAIL] workspace", ws.text)
        failed += 1
    else:
        data = ws.json()
        if not data.get("preVisitCompleted"):
            print("[FAIL] preVisitCompleted false")
            failed += 1
        else:
            print("[PASS] workspace preVisitCompleted")
        cc = data.get("chiefComplaint") or ""
        if "紅疹" not in cc and "搔癢" not in cc:
            print("[FAIL] chiefComplaint", cc)
            failed += 1
        else:
            print("[PASS] workspace CC synced")

    # Register a new encounter for patient pid
    new_enc_res = client.post(
        "/nhi/v1/encounter/register",
        json={
            "patientId": pid,
            "queueStatus": "waiting",
            "reasonText": "今日複診",
            "icException": "selfPay",
        }
    )
    if new_enc_res.status_code != 201:
        print("[FAIL] register new encounter", new_enc_res.status_code, new_enc_res.text)
        failed += 1
        new_eid = None
    else:
        new_eid = new_enc_res.json()["encounterId"]

    # Patch original encounter eid (belonging to pid) to finished
    patch = client.patch(
        f"/fhir/Encounter/{eid}/queue-status",
        json={"queue_status": "finished"},
    )
    if patch.status_code != 200:
        print("[FAIL] patch encounter status to finished", patch.status_code, patch.text)
        failed += 1

    if new_eid and patch.status_code == 200:
        med_body = {
            "subject": {"reference": f"Patient/{pid}"},
            "encounter": {"reference": f"Encounter/{eid}"},
            "drugText": "Prednisolone 5mg",
            "nhiCode": "AC12345678",
            "rxnormCode": "8640",
            "status": "active",
        }
        mr = client.post("/fhir/MedicationRequest", json=med_body)
        if mr.status_code != 201:
            print("[WARN] seed prev med", mr.status_code, mr.text)
            failed += 1

        prev = client.get(
            "/fhir/MedicationRequest/previous",
            params={"patient": pid, "excludeEncounter": new_eid},
        )
        if prev.status_code == 200 and prev.json().get("total", 0) >= 1:
            print("[PASS] previous medications", prev.json().get("previousEncounterId"))
        else:
            print("[FAIL] previous medications", prev.text)
            failed += 1

    print("=" * 50)
    if failed:
        print(f"RESULT: FAILED ({failed})")
        return 1
    print("RESULT: ALL PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
