"""門診一日閉環端到端驗收（讀卡→掛號→預診→SOAP→徵象→診斷→處方→Media→工作台）。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from src.api.main import app
from src.app.bootstrap import get_shadow_store

TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def main() -> int:
    print("=" * 50)
    print("NHI full clinic day flow test")
    print("=" * 50)

    store = get_shadow_store()
    store.initialize()
    client = TestClient(app)
    failed = 0

    card = client.post("/nhi/v1/card/read-and-register?mock=true")
    if card.status_code != 201:
        print("[FAIL] card", card.status_code, card.text)
        return 1
    pid = card.json()["patientId"]
    print("[PASS] card patient", pid)

    enc = client.post(
        "/nhi/v1/encounter/register",
        json={"patientId": pid, "queueStatus": "waiting", "reasonText": "皮膚搔癢", "icException": "selfPay"},
    )
    if enc.status_code != 201:
        print("[FAIL] encounter", enc.status_code, enc.text)
        return 1
    eid = enc.json()["encounterId"]
    print("[PASS] encounter", eid)

    steps: list[tuple[str, str, dict]] = [
        (
            "allergy",
            "/nhi/v1/allergy/register",
            {
                "patientId": pid,
                "verificationStatus": "confirmed",
                "category": "medication",
                "allergenSnomedCode": "292044008",
                "substanceRxnormCode": "5640",
                "manifestationSnomedCode": "247472004",
            },
        ),
        (
            "previsit",
            "/nhi/v1/previsit/submit",
            {
                "encounterId": eid,
                "chiefComplaint": "面部紅疹搔癢三天",
                "symptomTags": ["itching", "rash"],
            },
        ),
        (
            "soap",
            "/nhi/v1/soap/register",
            {
                "encounterId": eid,
                "chiefComplaint": "面部紅疹搔癢三天",
                "subjective": "三天前起疹",
                "objective": "面部紅斑",
                "assessment": "蕁麻疹",
                "plan": "外用藥膏",
            },
        ),
        (
            "observation",
            "/nhi/v1/observation/register",
            {
                "encounterId": eid,
                "vitalType": "body_temperature",
                "value": 36.8,
            },
        ),
        (
            "condition",
            "/nhi/v1/condition/register",
            {
                "encounterId": eid,
                "summaryText": "蕁麻疹",
                "icd10Code": "L50.9",
                "nhiIcd10Code": "L509",
            },
        ),
        (
            "medication",
            "/nhi/v1/medication/register",
            {
                "encounterId": eid,
                "drugText": "Betamethasone cream",
                "nhiCode": "AC44121",
                "rxnormCode": "1292",
                "sig": "BID 外用",
            },
        ),
        (
            "media",
            "/nhi/v1/media/register",
            {
                "encounterId": eid,
                "siteLabel": "左臉頰",
                "contentType": "image/png",
                "imageBase64": TINY_PNG_B64,
            },
        ),
    ]

    for name, path, body in steps:
        r = client.post(path, json=body)
        if r.status_code not in (200, 201):
            print(f"[FAIL] {name}", r.status_code, r.text)
            failed += 1
        else:
            print(f"[PASS] {name}")

    ws = client.get(f"/nhi/v1/outpatient/workspace/{eid}")
    if ws.status_code != 200:
        print("[FAIL] workspace", ws.text)
        failed += 1
    else:
        data = ws.json()
        checks = [
            ("preVisitCompleted", data.get("preVisitCompleted")),
            ("chiefComplaint", "紅疹" in (data.get("chiefComplaint") or "")),
            ("allergies", len(data.get("allergies") or []) >= 1),
            ("soap", data.get("soap") is not None),
            ("vitals", len(data.get("vitals") or []) >= 1),
            ("diagnoses", len(data.get("diagnoses") or []) >= 1),
            ("currentMedications", len(data.get("currentMedications") or []) >= 1),
            ("lesionMedia", len(data.get("lesionMedia") or []) >= 1),
        ]
        for label, ok in checks:
            if not ok:
                print(f"[FAIL] workspace.{label}", data.get(label))
                failed += 1
            else:
                print(f"[PASS] workspace.{label}")

    patch = client.patch(
        f"/fhir/Encounter/{eid}/queue-status",
        json={"queue_status": "finished"},
    )
    if patch.status_code != 200:
        print("[FAIL] finish encounter", patch.text)
        failed += 1
    else:
        print("[PASS] encounter finished")

    print("=" * 50)
    if failed:
        print(f"RESULT: FAILED ({failed})")
        return 1
    print("RESULT: ALL PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
