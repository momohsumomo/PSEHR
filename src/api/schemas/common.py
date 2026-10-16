"""FHIR 共用 Pydantic 片段（CodeableConcept、Reference）。"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class CodingItem(BaseModel):
    system: str | None = None
    code: str | None = None
    display: str | None = None


class CodeableConcept(BaseModel):
    coding: list[CodingItem] = Field(default_factory=list)
    text: str | None = None

    def to_fhir(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True)


class Reference(BaseModel):
    reference: str
    display: str | None = None

    def to_fhir(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True)
