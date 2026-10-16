from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from src.api.schemas.common import CodeableConcept, Reference
from src.core.terminology import build_condition_codeable


class ConditionBody(BaseModel):
    id: str | None = None
    clinicalStatus: CodeableConcept | None = None
    verificationStatus: CodeableConcept | None = None
    category: list[CodeableConcept] = Field(default_factory=list)
    code: CodeableConcept | None = None
    subject: Reference
    encounter: Reference | None = None
    recordedDate: str | None = None
    # 雙層術語貼紙（Swagger 可直接填，會併入 code.coding）
    summaryText: str | None = Field(None, description="臨床文字，例：蕁麻疹")
    icd10Code: str | None = Field(None, description="國際 ICD-10，例：L50.9")
    snomedCode: str | None = Field(None, description="SNOMED-CT，例：126485001")
    nhiIcd10Code: str | None = Field(None, description="台灣健保 ICD-10-CM 貼紙（可與 ICD-10 同碼）")

    def to_fhir_dict(self) -> dict[str, Any]:
        existing_code = self.code.to_fhir() if self.code else None
        if not (self.summaryText or self.icd10Code or self.snomedCode or self.nhiIcd10Code or existing_code):
            raise ValueError("請提供 code 或 summaryText/icd10Code/snomedCode/nhiIcd10Code 至少一項")

        code_block = build_condition_codeable(
            summary_text=self.summaryText,
            icd10_code=self.icd10Code,
            snomed_code=self.snomedCode,
            nhi_icd10_code=self.nhiIcd10Code,
            existing=existing_code,
        )

        data: dict[str, Any] = {
            "resourceType": "Condition",
            "code": code_block,
            "subject": self.subject.to_fhir(),
        }
        if self.id:
            data["id"] = self.id
        if self.clinicalStatus:
            data["clinicalStatus"] = self.clinicalStatus.to_fhir()
        if self.verificationStatus:
            data["verificationStatus"] = self.verificationStatus.to_fhir()
        if self.category:
            data["category"] = [c.to_fhir() for c in self.category]
        if self.encounter:
            data["encounter"] = self.encounter.to_fhir()
        if self.recordedDate:
            data["recordedDate"] = self.recordedDate
        return data
