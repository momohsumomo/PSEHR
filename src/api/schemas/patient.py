from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class PatientBody(BaseModel):
    """最小 Patient 寫入欄位。"""

    id: str | None = None
    name: list[dict[str, Any]] = Field(default_factory=list)
    gender: str | None = None
    birthDate: str | None = None
    identifier: list[dict[str, Any]] = Field(default_factory=list)
    telecom: list[dict[str, Any]] | None = None
    address: list[dict[str, Any]] | None = None
    extension: list[dict[str, Any]] | None = None

    def to_fhir_dict(self) -> dict[str, Any]:
        data = self.model_dump(exclude_none=True)
        data["resourceType"] = "Patient"
        return data
