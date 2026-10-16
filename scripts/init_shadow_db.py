#!/usr/bin/env python3
"""建立 SQLite 影子庫 schema 並寫入種子 Patient（Phase 0 一鍵初始化）。"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from datetime import datetime

from src.app.bootstrap import get_fhir_repository, get_shadow_store  # noqa: E402

QUEUE_EXTENSION_URL = "https://wundadi.tw/fhir/StructureDefinition/encounter-queue"


def seed_patients(repo) -> list[str]:
    samples = [
        {
            "resourceType": "Patient",
            "name": [{"family": "王", "given": ["小明"]}],
            "gender": "male",
            "birthDate": "1985-03-15",
            "identifier": [{"system": "http://www.moi.gov.tw", "value": "A123456789"}],
        },
        {
            "resourceType": "Patient",
            "name": [{"family": "陳", "given": ["美玲"]}],
            "gender": "female",
            "birthDate": "1992-08-20",
            "identifier": [{"system": "http://www.moi.gov.tw", "value": "B223456789"}],
        },
    ]
    ids: list[str] = []
    for patient in samples:
        created = repo.create_resource("Patient", patient)
        ids.append(created["id"])
        print(f"  + Patient/{created['id']} {patient['name'][0]['family']}{patient['name'][0]['given'][0]}")
    return ids


def seed_allergies(repo, patient_ids: list[str]) -> None:
    if len(patient_ids) < 2:
        return
    samples = [
        {
            "resourceType": "AllergyIntolerance",
            "patient": {"reference": f"Patient/{patient_ids[0]}"},
            "verificationStatus": {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                        "code": "confirmed",
                    }
                ]
            },
            "criticality": "high",
            "category": ["medication"],
            "code": {
                "coding": [
                    {
                        "system": "http://snomed.info/sct",
                        "code": "292044008",
                        "display": "Adverse reaction to NSAID",
                    }
                ],
                "text": "NSAIDs 類過敏",
            },
            "reaction": [
                {
                    "substance": {
                        "coding": [
                            {"system": "http://www.nlm.nih.gov/research/umls/rxnorm", "code": "5640", "display": "Ibuprofen"}
                        ]
                    },
                    "manifestation": [
                        {
                            "coding": [
                                {"system": "http://snomed.info/sct", "code": "247472004", "display": "Weal"}
                            ],
                            "text": "蕁麻疹",
                        }
                    ],
                    "severity": "moderate",
                }
            ],
        },
        {
            "resourceType": "AllergyIntolerance",
            "patient": {"reference": f"Patient/{patient_ids[1]}"},
            "verificationStatus": {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                        "code": "unconfirmed",
                    }
                ]
            },
            "criticality": "low",
            "category": ["medication"],
            "code": {
                "coding": [
                    {
                        "system": "http://snomed.info/sct",
                        "code": "418038007",
                        "display": "Propensity to adverse reaction to substance",
                    }
                ],
                "text": "自訴盤尼西林過敏（待確認）",
            },
        },
    ]
    for allergy in samples:
        created = repo.create_resource("AllergyIntolerance", allergy)
        label = allergy["code"].get("text", "")
        print(f"  + AllergyIntolerance/{created['id']} → {allergy['patient']['reference']} {label}")


def _encounter(
    patient_id: str,
    queue_number: int,
    queue_status: str,
    fhir_status: str,
    reason: str,
) -> dict:
    return {
        "resourceType": "Encounter",
        "status": fhir_status,
        "class": {
            "coding": [
                {
                    "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                    "code": "AMB",
                    "display": "ambulatory",
                }
            ],
            "text": "門診",
        },
        "subject": {"reference": f"Patient/{patient_id}"},
        "period": {"start": datetime.now().isoformat(timespec="seconds")},
        "reasonCode": [{"text": reason}],
        "extension": [
            {
                "url": QUEUE_EXTENSION_URL,
                "extension": [
                    {"url": "queueNumber", "valueInteger": queue_number},
                    {"url": "queueStatus", "valueCode": queue_status},
                ],
            }
        ],
    }


def seed_encounters(repo, patient_ids: list[str]) -> list[str]:
    if len(patient_ids) < 2:
        return
    samples = [
        _encounter(patient_ids[0], 1, "in_progress", "in-progress", "全身搔癢加劇"),
        _encounter(patient_ids[1], 2, "waiting", "arrived", "臉部皮疹追蹤"),
    ]
    if len(patient_ids) > 2:
        samples.append(_encounter(patient_ids[2], 3, "no_show", "onleave", "過號未到"))
    else:
        samples.append(
            _encounter(patient_ids[1], 3, "finished", "finished", "上週回診已完成")
        )
    enc_ids: list[str] = []
    for enc in samples:
        created = repo.create_resource("Encounter", enc)
        enc_ids.append(created["id"])
        qs = next(
            x["valueCode"]
            for ext in enc["extension"]
            for x in ext["extension"]
            if x.get("url") == "queueStatus"
        )
        print(f"  + Encounter/{created['id']} #{enc['extension'][0]['extension'][0]['valueInteger']} [{qs}]")
    return enc_ids


def seed_conditions(repo, patient_ids: list[str], encounter_ids: list[str]) -> None:
    if not patient_ids or not encounter_ids:
        return
    samples = [
        {
            "resourceType": "Condition",
            "clinicalStatus": {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/condition-clinical",
                        "code": "active",
                    }
                ]
            },
            "code": {
                "coding": [
                    {
                        "system": "http://hl7.org/fhir/sid/icd-10",
                        "code": "L50.9",
                        "display": "Urticaria, unspecified",
                    },
                    {
                        "system": "http://snomed.info/sct",
                        "code": "126485001",
                        "display": "Urticaria",
                    },
                    {
                        "system": "https://nhidcc.nhi.gov.tw/icd10cm",
                        "code": "L50.9",
                    },
                ],
                "text": "蕁麻疹",
            },
            "subject": {"reference": f"Patient/{patient_ids[0]}"},
            "encounter": {"reference": f"Encounter/{encounter_ids[0]}"},
        },
    ]
    for cond in samples:
        created = repo.create_resource("Condition", cond)
        print(f"  + Condition/{created['id']} {cond['code']['text']}")


def seed_medications(repo, patient_ids: list[str], encounter_ids: list[str]) -> None:
    if not patient_ids or not encounter_ids:
        return
    samples = [
        {
            "resourceType": "MedicationRequest",
            "status": "active",
            "intent": "order",
            "medicationCodeableConcept": {
                "text": "Betamethasone 膏",
                "coding": [
                    {
                        "system": "https://nhidcc.nhi.gov.tw/medication",
                        "code": "AC44121",
                    },
                    {
                        "system": "http://www.nlm.nih.gov/research/umls/rxnorm",
                        "code": "1292",
                    },
                ],
            },
            "subject": {"reference": f"Patient/{patient_ids[0]}"},
            "encounter": {"reference": f"Encounter/{encounter_ids[0]}"},
            "dosageInstruction": [{"text": "BID 外用"}],
        },
        {
            "resourceType": "MedicationRequest",
            "status": "active",
            "intent": "order",
            "medicationCodeableConcept": {
                "text": "Cetirizine 錠",
                "coding": [
                    {
                        "system": "https://nhidcc.nhi.gov.tw/medication",
                        "code": "BC25210",
                    }
                ],
            },
            "subject": {"reference": f"Patient/{patient_ids[0]}"},
            "encounter": {"reference": f"Encounter/{encounter_ids[0]}"},
            "dosageInstruction": [{"text": "QD"}],
        },
    ]
    for rx in samples:
        created = repo.create_resource("MedicationRequest", rx)
        print(f"  + MedicationRequest/{created['id']} {rx['medicationCodeableConcept']['text']}")


def main() -> int:
    store = get_shadow_store()
    store.initialize()
    print(f"SQLite 影子庫已初始化：{store.db_path}")

    repo = get_fhir_repository()
    existing_patients = store.list_cached_resources("Patient")
    if existing_patients:
        print(f"已有 {len(existing_patients)} 筆 Patient，略過病人種子。")
        patient_ids = [p["id"] for p in existing_patients]
    else:
        print("寫入種子 Patient…")
        patient_ids = seed_patients(repo)

    existing_allergies = store.list_cached_resources("AllergyIntolerance")
    if existing_allergies:
        print(f"已有 {len(existing_allergies)} 筆 AllergyIntolerance，略過過敏種子。")
    elif patient_ids:
        print("寫入種子 AllergyIntolerance…")
        seed_allergies(repo, patient_ids)

    encounter_ids: list[str] = [e["id"] for e in store.list_cached_resources("Encounter")]
    existing_encounters = store.list_cached_resources("Encounter")
    if existing_encounters:
        print(f"已有 {len(existing_encounters)} 筆 Encounter，略過掛號種子。")
    elif patient_ids:
        print("寫入種子 Encounter（今日掛號）…")
        encounter_ids = seed_encounters(repo, patient_ids)

    existing_conditions = store.list_cached_resources("Condition")
    if existing_conditions:
        print(f"已有 {len(existing_conditions)} 筆 Condition，略過診斷種子。")
    elif patient_ids and encounter_ids:
        print("寫入種子 Condition…")
        seed_conditions(repo, patient_ids, encounter_ids)

    existing_rx = store.list_cached_resources("MedicationRequest")
    if existing_rx:
        print(f"已有 {len(existing_rx)} 筆 MedicationRequest，略過處方種子。")
    elif patient_ids and encounter_ids:
        print("寫入種子 MedicationRequest…")
        seed_medications(repo, patient_ids, encounter_ids)

    pending = store.dequeue_sync_batch(limit=100)
    print(f"待同步佇列：{len(pending)} 筆（權威層上線後處理）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
