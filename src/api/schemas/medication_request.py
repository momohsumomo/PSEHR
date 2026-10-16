from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from src.api.schemas.common import CodeableConcept, Reference
from src.core.terminology import build_medication_codeable

MedStatus = Literal[
    "active",
    "on-hold",
    "cancelled",
    "completed",
    "entered-in-error",
    "stopped",
    "draft",
    "unknown",
]


class DosageInstruction(BaseModel):
    text: str | None = None
    timing: dict[str, Any] | None = None

    def to_fhir(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True)


class MedicationRequestBody(BaseModel):
    id: str | None = None
    status: MedStatus = "active"
    intent: str = "order"
    medicationCodeableConcept: CodeableConcept | None = None
    subject: Reference
    encounter: Reference | None = None
    dosageInstruction: list[DosageInstruction] = Field(default_factory=list)
    drugText: str | None = Field(None, description="藥品顯示名")
    nhiCode: str | None = Field(None, description="台灣健保藥品碼，例：AC44121")
    rxnormCode: str | None = Field(None, description="國際 RxNorm，例：1292")
    bodySite: str | None = Field(None, description="列印用部位")

    def to_fhir_dict(self) -> dict[str, Any]:
        existing = self.medicationCodeableConcept.to_fhir() if self.medicationCodeableConcept else None
        if not (self.drugText or self.nhiCode or self.rxnormCode or existing):
            raise ValueError("請提供 medicationCodeableConcept 或 drugText/nhiCode/rxnormCode")

        med = build_medication_codeable(
            summary_text=self.drugText,
            nhi_code=self.nhiCode,
            rxnorm_code=self.rxnormCode,
            existing=existing,
        )

        data: dict[str, Any] = {
            "resourceType": "MedicationRequest",
            "status": self.status,
            "intent": self.intent,
            "medicationCodeableConcept": med,
            "subject": self.subject.to_fhir(),
        }
        if self.id:
            data["id"] = self.id
        if self.encounter:
            data["encounter"] = self.encounter.to_fhir()
        if self.dosageInstruction:
            data["dosageInstruction"] = [d.to_fhir() for d in self.dosageInstruction]
        if self.bodySite is not None:
            data["extension"] = [
                {
                    "url": "https://clinic.org/fhir/StructureDefinition/billing/bodySite",
                    "valueString": self.bodySite.strip(),
                }
            ]
        return data
