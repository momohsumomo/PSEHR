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
    tradeName: str | None = Field(None, description="商品名稱，病患收據用")
    payMark: str | None = Field(None, description="計費標記，例如 自")
    memo: str | None = Field(None, description="註記，例如 [")
    daysSupply: int | None = Field(None, description="給藥日份")
    quantity: float | None = Field(None, description="次量")

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
        extensions: list[dict[str, Any]] = []
        if self.bodySite is not None:
            extensions.append(
                {
                    "url": "https://clinic.org/fhir/StructureDefinition/billing/bodySite",
                    "valueString": self.bodySite.strip(),
                }
            )
        if self.tradeName is not None:
            extensions.append(
                {
                    "url": "https://clinic.org/fhir/StructureDefinition/billing/tradeName",
                    "valueString": self.tradeName.strip(),
                }
            )
        if self.payMark is not None:
            extensions.append(
                {
                    "url": "https://clinic.org/fhir/StructureDefinition/billing/payMark",
                    "valueString": self.payMark.strip(),
                }
            )
        if self.memo is not None:
            extensions.append(
                {
                    "url": "https://clinic.org/fhir/StructureDefinition/billing/memoMark",
                    "valueString": self.memo.strip(),
                }
            )
        if self.daysSupply is not None:
            extensions.append(
                {
                    "url": "https://wundadi.local/fhir/StructureDefinition/medication-billing/daysSupply",
                    "valueInteger": int(self.daysSupply),
                }
            )
        if self.quantity is not None:
            extensions.append(
                {
                    "url": "https://wundadi.local/fhir/StructureDefinition/medication-billing/quantity",
                    "valueDecimal": float(self.quantity),
                }
            )
        if extensions:
            data["extension"] = extensions
        return data
