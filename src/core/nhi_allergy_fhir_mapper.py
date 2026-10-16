"""過敏進場 → FHIR AllergyIntolerance。"""

from __future__ import annotations

from typing import Any

from src.core.nhi_allergy_validators import NhiAllergyIntake
from src.core.terminology import (
    SYSTEM_SNOMED,
    build_allergy_codeable,
    build_rxnorm_codeable,
    extract_allergy_stickers,
)

VERIFICATION_SYSTEM = (
    "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification"
)
CLINICAL_STATUS_SYSTEM = (
    "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical"
)
NHI_ALLERGY_EXTENSION_URL = (
    "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/outpatient-allergy"
)


def nhi_allergy_to_fhir(intake: NhiAllergyIntake) -> dict[str, Any]:
    intake.require_reaction_codes()

    code = build_allergy_codeable(
        snomed_code=intake.allergenSnomedCode,
        summary_text=intake.allergenDisplayText or intake.allergenSnomedCode,
    )

    reaction: dict[str, Any] = {}
    if intake.substanceRxnormCode:
        reaction["substance"] = build_rxnorm_codeable(
            rxnorm_code=intake.substanceRxnormCode,
            display=intake.substanceDisplayText,
        )
    if intake.manifestationSnomedCode:
        reaction["manifestation"] = [
            {
                "coding": [
                    {
                        "system": SYSTEM_SNOMED,
                        "code": intake.manifestationSnomedCode,
                        **(
                            {"display": intake.manifestationDisplayText}
                            if intake.manifestationDisplayText
                            else {}
                        ),
                    }
                ],
                "text": intake.manifestationDisplayText or intake.manifestationSnomedCode,
            }
        ]
    if intake.reactionSeverity:
        reaction["severity"] = intake.reactionSeverity

    payload: dict[str, Any] = {
        "resourceType": "AllergyIntolerance",
        "clinicalStatus": {
            "coding": [{"system": CLINICAL_STATUS_SYSTEM, "code": "active"}],
        },
        "verificationStatus": {
            "coding": [
                {
                    "system": VERIFICATION_SYSTEM,
                    "code": intake.verificationStatus,
                }
            ],
            "text": intake.verificationStatus,
        },
        "category": [intake.category],
        "code": code,
        "patient": {"reference": f"Patient/{intake.patientId}"},
        "extension": [
            {
                "url": NHI_ALLERGY_EXTENSION_URL,
                "extension": [
                    {"url": "allergenSnomed", "valueCode": intake.allergenSnomedCode},
                    *(
                        [{"url": "substanceRxnorm", "valueCode": intake.substanceRxnormCode}]
                        if intake.substanceRxnormCode
                        else []
                    ),
                ],
            }
        ],
    }
    if intake.criticality:
        payload["criticality"] = intake.criticality
    if reaction:
        payload["reaction"] = [reaction]
    if intake.recordedDate:
        payload["recordedDate"] = intake.recordedDate
    return payload


__all__ = ["nhi_allergy_to_fhir", "extract_allergy_stickers", "NHI_ALLERGY_EXTENSION_URL"]
