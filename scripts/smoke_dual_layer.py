"""沙盒 2 雙層儲存煙測（不依賴 uvicorn）。"""

from __future__ import annotations

import tempfile
from pathlib import Path

from src.infrastructure.local_fhir_repository import LocalFirstFhirRepository
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "smoke.db"
        store = SqliteShadowStore(db)
        store.initialize()
        repo = LocalFirstFhirRepository(store)

        patient = repo.create_resource(
            "Patient",
            {"resourceType": "Patient", "name": [{"family": "測", "given": ["試"]}], "gender": "unknown"},
        )
        encounter = repo.create_resource(
            "Encounter",
            {
                "resourceType": "Encounter",
                "status": "arrived",
                "class": {"code": "AMB"},
                "subject": {"reference": f"Patient/{patient['id']}"},
                "period": {"start": "2026-06-02"},
            },
        )

        condition = repo.create_resource(
            "Condition",
            {
                "resourceType": "Condition",
                "code": {
                    "coding": [
                        {"system": "http://hl7.org/fhir/sid/icd-10", "code": "L50.9"},
                        {"system": "http://snomed.info/sct", "code": "126485001"},
                        {"system": "https://nhidcc.nhi.gov.tw/icd10cm", "code": "L50.9"},
                    ],
                    "text": "蕁麻疹",
                },
                "subject": {"reference": f"Patient/{patient['id']}"},
                "encounter": {"reference": f"Encounter/{encounter['id']}"},
            },
        )
        dual_c = store.get_dual_layer("Condition", condition["id"])
        idx = dual_c["indexLayer"]
        assert idx["icd10Code"] == "L50.9", idx
        assert idx["snomedCode"] == "126485001", idx
        assert idx["nhiIcd10Code"] == "L50.9", idx
        assert idx["summaryText"] == "蕁麻疹", idx

        med = repo.create_resource(
            "MedicationRequest",
            {
                "resourceType": "MedicationRequest",
                "status": "active",
                "intent": "order",
                "medicationCodeableConcept": {
                    "text": "Betamethasone",
                    "coding": [
                        {"system": "https://nhidcc.nhi.gov.tw/medication", "code": "AC44121"},
                        {"system": "http://www.nlm.nih.gov/research/umls/rxnorm", "code": "1292"},
                    ],
                },
                "subject": {"reference": f"Patient/{patient['id']}"},
            },
        )
        dual_m = store.get_dual_layer("MedicationRequest", med["id"])
        midx = dual_m["indexLayer"]
        assert midx["nhiCode"] == "AC44121", midx
        assert midx["rxnormCode"] == "1292", midx

    print("smoke_dual_layer: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
