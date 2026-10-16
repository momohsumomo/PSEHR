"""
Sandbox2 automated acceptance (no uvicorn required).
Uses FastAPI TestClient + project data/shadow.db.
"""

from __future__ import annotations

import sys
from datetime import date
from typing import Any

from fastapi.testclient import TestClient

from src.api.main import app
from src.app.bootstrap import get_shadow_store


def _ok(name: str) -> None:
    print(f"[PASS] {name}")


def _fail(name: str, detail: str) -> None:
    print(f"[FAIL] {name}")
    print(f"       {detail}")


def _assert(name: str, cond: bool, detail: str = "") -> bool:
    if cond:
        _ok(name)
        return True
    _fail(name, detail or "assertion failed")
    return False


def _first_patient_encounter(client: TestClient) -> tuple[str, str] | None:
    r = client.get("/fhir/Patient")
    if r.status_code != 200:
        return None
    bundle = r.json()
    entries = bundle if isinstance(bundle, list) else bundle.get("entry") or []
    if not entries:
        return None
    first = entries[0]
    resource = first.get("resource") if isinstance(first, dict) else first
    if not isinstance(resource, dict):
        return None
    pid = resource.get("id")
    if not pid:
        return None

    er = client.get("/fhir/Encounter", params={"date": "today"})
    if er.status_code != 200:
        return str(pid), ""
    eb = er.json()
    eentries = eb.get("entry") or []
    eid = ""
    for ent in eentries:
        res = ent.get("resource") or {}
        subj = (res.get("subject") or {}).get("reference", "")
        if subj.endswith(pid) or f"Patient/{pid}" in subj:
            eid = res.get("id") or ""
            break
    if not eid and eentries:
        res = eentries[0].get("resource") or {}
        eid = res.get("id") or ""
    return str(pid), str(eid)


def main() -> int:
    print("=" * 50)
    print("Sandbox2 acceptance test")
    print("=" * 50)

    store = get_shadow_store()
    store.initialize()
    print(f"DB: {store.db_path}")
    print()

    client = TestClient(app)
    failed = 0

    # --- sandbox status ---
    r = client.get("/sandbox/status")
    if not _assert("GET /sandbox/status", r.status_code == 200, r.text):
        failed += 1
    else:
        counts = r.json().get("resourceCounts") or {}
        if not _assert("sandbox has Patient seed", counts.get("Patient", 0) >= 1, str(counts)):
            failed += 1

    pe = _first_patient_encounter(client)
    if not pe or not pe[0]:
        if not _assert("resolve Patient/Encounter", False, "no patient in DB - run init_shadow_db"):
            failed += 1
        print()
        print(f"RESULT: {failed} failed")
        return 1 if failed else 0

    patient_id, encounter_id = pe
    print(f"Using Patient/{patient_id} Encounter/{encounter_id or '(none)'}")
    print()

    # --- POST Condition (dual stickers via API fields) ---
    cond_body: dict[str, Any] = {
        "subject": {"reference": f"Patient/{patient_id}"},
        "summaryText": "蕁麻疹",
        "icd10Code": "L50.9",
        "snomedCode": "126485001",
        "nhiIcd10Code": "L50.9",
    }
    if encounter_id:
        cond_body["encounter"] = {"reference": f"Encounter/{encounter_id}"}

    cr = client.post("/fhir/Condition", json=cond_body)
    if not _assert("POST /fhir/Condition", cr.status_code == 201, cr.text):
        failed += 1
        cond_id = ""
    else:
        created = cr.json()
        res = created.get("resource") or created
        cond_id = str(res.get("id") or "")
        if not _assert("Condition returned id", bool(cond_id), str(created)[:200]):
            failed += 1

    if cond_id:
        dr = client.get(f"/sandbox/dual-layer/Condition/{cond_id}")
        if not _assert("GET dual-layer Condition", dr.status_code == 200, dr.text):
            failed += 1
        else:
            body = dr.json()
            cache = body.get("cacheLayer") or {}
            idx = body.get("indexLayer") or {}
            codings = (cache.get("code") or {}).get("coding") or []
            if not _assert("cacheLayer has 3+ codings", len(codings) >= 3, f"len={len(codings)}"):
                failed += 1
            if not _assert("indexLayer icd10Code L50.9", idx.get("icd10Code") == "L50.9", str(idx)):
                failed += 1
            if not _assert("indexLayer snomedCode", idx.get("snomedCode") == "126485001", str(idx)):
                failed += 1
            if not _assert("indexLayer nhiIcd10Code", idx.get("nhiIcd10Code") == "L50.9", str(idx)):
                failed += 1
            if not _assert("indexLayer summaryText", idx.get("summaryText") == "蕁麻疹", str(idx)):
                failed += 1

    # --- POST MedicationRequest ---
    med_body: dict[str, Any] = {
        "subject": {"reference": f"Patient/{patient_id}"},
        "drugText": "Betamethasone test",
        "nhiCode": "AC44121",
        "rxnormCode": "1292",
        "dosageInstruction": [{"text": "BID"}],
    }
    if encounter_id:
        med_body["encounter"] = {"reference": f"Encounter/{encounter_id}"}

    mr = client.post("/fhir/MedicationRequest", json=med_body)
    if not _assert("POST /fhir/MedicationRequest", mr.status_code == 201, mr.text):
        failed += 1
        med_id = ""
    else:
        mres = mr.json().get("resource") or mr.json()
        med_id = str(mres.get("id") or "")
        if not _assert("MedicationRequest returned id", bool(med_id), str(mr.json())[:200]):
            failed += 1

    if med_id:
        mdr = client.get(f"/sandbox/dual-layer/MedicationRequest/{med_id}")
        if not _assert("GET dual-layer MedicationRequest", mdr.status_code == 200, mdr.text):
            failed += 1
        else:
            midx = mdr.json().get("indexLayer") or {}
            if not _assert("indexLayer nhiCode AC44121", midx.get("nhiCode") == "AC44121", str(midx)):
                failed += 1
            if not _assert("indexLayer rxnormCode 1292", midx.get("rxnormCode") == "1292", str(midx)):
                failed += 1

    # --- list endpoints ---
    er = client.get("/fhir/Encounter", params={"date": "today"})
    if not _assert("GET /fhir/Encounter?date=today", er.status_code == 200, er.text):
        failed += 1
    else:
        total = er.json().get("total", 0)
        _assert("Encounter today total >= 0", total >= 0, f"total={total}")

    lr = client.get("/fhir/MedicationRequest", params={"patient": f"Patient/{patient_id}"})
    if not _assert("GET /fhir/MedicationRequest", lr.status_code == 200, lr.text):
        failed += 1
    else:
        total = lr.json().get("total", 0)
        if not _assert("MedicationRequest list has entries", total >= 1, f"total={total}"):
            failed += 1

    print()
    print("=" * 50)
    if failed:
        print(f"RESULT: FAILED ({failed} checks)")
        print("=" * 50)
        return 1
    print("RESULT: ALL PASSED")
    print("=" * 50)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
