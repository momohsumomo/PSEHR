from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from src.core.nhi_allergy_validators import NhiAllergyIntake

__all__ = ["NhiAllergyIntake", "NhiAllergyRegisterResponse"]


class NhiAllergyRegisterResponse(BaseModel):
    created: bool
    allergyId: str
    patientId: str
    validation: dict[str, Any]
    allergyStickers: dict[str, Any]
    resource: dict[str, Any]
    indexLayer: dict[str, Any] | None = None
