"""
AllergyIntolerance 寫入模型（對齊模組四 Terminology Binding 最小集）。

verificationStatus: confirmed | unconfirmed | refuted
code: 過敏原大類（SNOMED-CT）
reaction.substance: RxNorm
reaction.manifestation: SNOMED-CT
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from src.api.schemas.common import CodeableConcept, Reference

VerificationStatus = Literal["confirmed", "unconfirmed", "refuted"]
AllergyType = Literal["allergy", "intolerance"]
AllergyCategory = Literal["food", "medication", "environment", "biologic"]
Criticality = Literal["low", "high", "unable-to-assess"]
ReactionSeverity = Literal["mild", "moderate", "severe"]


class AllergyReactionBody(BaseModel):
    substance: CodeableConcept | None = None
    manifestation: list[CodeableConcept] = Field(default_factory=list)
    severity: ReactionSeverity | None = None
    description: str | None = None

    def to_fhir(self) -> dict[str, Any]:
        data = self.model_dump(exclude_none=True)
        if self.substance:
            data["substance"] = self.substance.to_fhir()
        if self.manifestation:
            data["manifestation"] = [m.to_fhir() for m in self.manifestation]
        return data


class AllergyIntoleranceBody(BaseModel):
    id: str | None = None
    patient: Reference
    clinicalStatus: CodeableConcept | None = None
    verificationStatus: CodeableConcept
    type: AllergyType | None = None
    category: list[AllergyCategory] = Field(default_factory=list)
    criticality: Criticality | None = None
    code: CodeableConcept
    reaction: list[AllergyReactionBody] = Field(default_factory=list)
    recordedDate: str | None = None
    note: list[dict[str, Any]] = Field(default_factory=list)

    @field_validator("verificationStatus", mode="before")
    @classmethod
    def normalize_verification_status(cls, value: Any) -> Any:
        """允許傳入字串 'confirmed' 或完整 CodeableConcept。"""
        if isinstance(value, str):
            if value not in ("confirmed", "unconfirmed", "refuted"):
                raise ValueError("verificationStatus 僅允許 confirmed | unconfirmed | refuted")
            return CodeableConcept(
                coding=[
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                        "code": value,
                    }
                ],
                text=value,
            )
        return value

    def to_fhir_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "resourceType": "AllergyIntolerance",
            "patient": self.patient.to_fhir(),
            "verificationStatus": self.verificationStatus.to_fhir(),
            "code": self.code.to_fhir(),
        }
        if self.id:
            data["id"] = self.id
        if self.clinicalStatus:
            data["clinicalStatus"] = self.clinicalStatus.to_fhir()
        if self.type:
            data["type"] = self.type
        if self.category:
            data["category"] = self.category
        if self.criticality:
            data["criticality"] = self.criticality
        if self.reaction:
            data["reaction"] = [r.to_fhir() for r in self.reaction]
        if self.recordedDate:
            data["recordedDate"] = self.recordedDate
        if self.note:
            data["note"] = self.note
        return data
