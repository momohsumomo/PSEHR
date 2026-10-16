"""Encounter（掛號／就醫）Pydantic 模型。"""

from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field

from src.api.schemas.common import CodeableConcept, Reference

FhirEncounterStatus = Literal[
    "planned",
    "arrived",
    "triaged",
    "in-progress",
    "onleave",
    "finished",
    "cancelled",
]

QueueStatus = Literal["waiting", "in_progress", "no_show", "finished"]

QUEUE_STATUS_LABELS: dict[str, str] = {
    "waiting": "候診中",
    "in_progress": "看診中",
    "no_show": "已過號",
    "finished": "已看診",
    "cancelled": "已刪除掛號",
}


class EncounterPeriod(BaseModel):
    start: str | None = None
    end: str | None = None

    def to_fhir(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True)


class EncounterBody(BaseModel):
    id: str | None = None
    status: FhirEncounterStatus | None = None
    class_: CodeableConcept = Field(
        default_factory=lambda: CodeableConcept(
            coding=[
                {
                    "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                    "code": "AMB",
                    "display": "ambulatory",
                }
            ],
            text="門診",
        ),
        alias="class",
    )
    subject: Reference
    period: EncounterPeriod | None = None
    reasonCode: list[CodeableConcept] = Field(default_factory=list)
    queueNumber: int | None = Field(None, description="掛號序")
    queueStatus: QueueStatus | None = Field(None, description="診間候診狀態")
    encounterDate: date | None = Field(None, description="就醫日 YYYY-MM-DD，預設今日")

    model_config = {"populate_by_name": True}

    def to_fhir_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "resourceType": "Encounter",
            "status": self.status or "planned",
            "class": self.class_.to_fhir(),
            "subject": self.subject.to_fhir(),
        }
        if self.id:
            data["id"] = self.id
        if self.period:
            data["period"] = self.period.to_fhir()
        if self.reasonCode:
            data["reasonCode"] = [r.to_fhir() for r in self.reasonCode]
        return data


class QueueStatusTransition(BaseModel):
    """診間掛號狀態變更（Swagger 一鍵操作）。"""

    queue_status: QueueStatus = Field(..., description="waiting|in_progress|no_show|finished")
