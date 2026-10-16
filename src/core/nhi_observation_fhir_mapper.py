"""Observation 進場 → FHIR Observation。"""

from __future__ import annotations

from typing import Any

from src.core.nhi_observation_validators import NhiObservationIntake

NHI_OBSERVATION_EXTENSION_URL = (
    "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/outpatient-observation"
)


def nhi_observation_to_fhir(
    intake: NhiObservationIntake,
    *,
    patient_id: str,
    encounter_id: str,
) -> dict[str, Any]:
    loinc, display, unit = intake.resolved_coding()
    intake.validate_value_range(loinc)

    payload: dict[str, Any] = {
        "resourceType": "Observation",
        "status": intake.status,
        "category": [
            {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                        "code": intake.category,
                    }
                ]
            }
        ],
        "code": {
            "coding": [{"system": "http://loinc.org", "code": loinc, "display": display}],
            "text": display,
        },
        "subject": {"reference": f"Patient/{patient_id}"},
        "encounter": {"reference": f"Encounter/{encounter_id}"},
        "effectiveDateTime": intake.effective_iso(),
        "valueQuantity": {
            "value": intake.value,
            "unit": unit,
            "system": "http://unitsofmeasure.org",
            "code": unit,
        },
        "extension": [
            {
                "url": NHI_OBSERVATION_EXTENSION_URL,
                "extension": [
                    {"url": "vitalType", "valueCode": intake.vitalType},
                    {"url": "loincCode", "valueString": loinc},
                ],
            }
        ],
    }
    return payload


def extract_observation_stickers(obs: dict[str, Any]) -> dict[str, str | float | None]:
    result: dict[str, str | float | None] = {
        "loincCode": None,
        "displayText": None,
        "value": None,
        "unit": None,
        "category": None,
        "vitalType": None,
        "encounterId": None,
        "effectiveDateTime": obs.get("effectiveDateTime"),
    }
    enc = obs.get("encounter") or {}
    if isinstance(enc, dict) and enc.get("reference"):
        result["encounterId"] = str(enc["reference"]).split("/")[-1]
    code = obs.get("code") or {}
    result["displayText"] = code.get("text")
    for c in code.get("coding") or []:
        if c.get("system") == "http://loinc.org" and c.get("code"):
            result["loincCode"] = str(c["code"])
            break
    vq = obs.get("valueQuantity") or {}
    if isinstance(vq, dict):
        result["value"] = vq.get("value")
        result["unit"] = vq.get("unit")
    cats = obs.get("category") or []
    if cats and isinstance(cats[0], dict):
        for c in cats[0].get("coding") or []:
            if c.get("code"):
                result["category"] = str(c["code"])
                break
    for ext in obs.get("extension") or []:
        if ext.get("url") != NHI_OBSERVATION_EXTENSION_URL:
            continue
        for sub in ext.get("extension") or []:
            if sub.get("url") == "vitalType":
                result["vitalType"] = sub.get("valueCode")
    return result
