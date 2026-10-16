"""掛號取消（本機 cancelled，禁止 DELETE）與取號路徑。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from src.api.main import app
from src.app.bootstrap import get_shadow_store


def main() -> int:
    print("=" * 50)
    print("Register cancel + paper seq-next")
    print("=" * 50)
    get_shadow_store().initialize()
    client = TestClient(app)
    failed = 0

    paper = client.post(
        "/nhi/v1/card/seq-next",
        json={"icException": "paper", "treatmentItem": "01", "patientIdNo": "A189012341"},
    )
    if paper.status_code != 422:
        print("[FAIL] paper without 無卡原因 should 422", paper.status_code, paper.text)
        failed += 1
    else:
        print("[PASS] paper/no-card requires 無卡原因")

    selfpay = client.post(
        "/nhi/v1/card/seq-next",
        json={"icException": "selfPay", "treatmentItem": "01"},
    )
    if selfpay.status_code != 200 or selfpay.json().get("skipped") is not True:
        print("[FAIL] selfPay skip", selfpay.status_code, selfpay.text)
        failed += 1
    else:
        print("[PASS] 自費略過取號")

    card = client.post(
        "/nhi/v1/patient/register",
        json={
            "idNo": "A189012341",
            "birthday": "0740315",
            "sex": "M",
            "patientName": "刪掛號測試",
        },
    )
    if card.status_code != 201:
        print("[FAIL] patient", card.status_code, card.text)
        return 1
    pid = card.json()["patientId"]

    blocked = client.post(
        "/nhi/v1/encounter/register",
        json={
            "patientId": pid,
            "queueStatus": "waiting",
            "reasonText": "不該只讀卡就掛號",
        },
    )
    if blocked.status_code != 422:
        print("[FAIL] ic register without seq should 422", blocked.status_code, blocked.text)
        failed += 1
    else:
        print("[PASS] 健保掛號無序號被拒")

    enc = client.post(
        "/nhi/v1/encounter/register",
        json={
            "patientId": pid,
            "queueStatus": "waiting",
            "reasonText": "測試刪掛號",
            "caseNo": "9X",
            "icException": "selfPay",
        },
    )
    if enc.status_code != 201:
        print("[FAIL] register", enc.status_code, enc.text)
        return 1
    eid = enc.json()["encounterId"]
    print("[PASS] encounter", eid)

    listed = client.get("/fhir/Encounter?date=today")
    ids = [e["resource"]["id"] for e in listed.json().get("entry") or []]
    if eid not in ids:
        print("[FAIL] new encounter missing from list")
        failed += 1
    else:
        print("[PASS] listed before cancel")

    bad_ic = client.post(
        "/nhi/v1/encounter/cancel",
        json={"encounterId": eid, "mode": "ic"},
    )
    if bad_ic.status_code != 422:
        print("[FAIL] paper rollback should 422", bad_ic.status_code, bad_ic.text)
        failed += 1
    else:
        print("[PASS] 退IC without seq is refused")

    cancel = client.post(
        "/nhi/v1/encounter/cancel",
        json={"encounterId": eid, "mode": "local"},
    )
    if cancel.status_code != 200 or cancel.json().get("localCancelled") is not True:
        print("[FAIL] local cancel", cancel.status_code, cancel.text)
        failed += 1
    else:
        print("[PASS] local cancel")

    listed2 = client.get("/fhir/Encounter?date=today")
    ids2 = [e["resource"]["id"] for e in listed2.json().get("entry") or []]
    if eid in ids2:
        print("[FAIL] cancelled encounter still listed")
        failed += 1
    else:
        print("[PASS] cancelled hidden from today list")

    still = client.get(f"/fhir/Encounter/{eid}")
    if still.status_code != 200:
        print("[FAIL] encounter deleted instead of cancelled", still.status_code)
        failed += 1
    else:
        status = (still.json().get("resource") or still.json()).get("status")
        if status != "cancelled" and still.json().get("queueMeta", {}).get("fhirStatus") != "cancelled":
            # get_encounter returns resource+queueMeta or raw resource
            body = still.json()
            fhir = (body.get("resource") or body).get("status")
            q = (body.get("queueMeta") or {}).get("queueStatus")
            if fhir != "cancelled" and q != "cancelled":
                print("[FAIL] status not cancelled", body)
                failed += 1
            else:
                print("[PASS] encounter kept as cancelled")
        else:
            print("[PASS] encounter kept as cancelled")

    print("=" * 50)
    if failed:
        print(f"RESULT: FAILED ({failed})")
        return 1
    print("RESULT: ALL PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
