from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from src.core.nhi_condition_validators import NhiConditionIntake

__all__ = ["NhiConditionIntake", "NhiConditionRegisterResponse"]


class NhiConditionRegisterResponse(BaseModel):
    created: bool
    conditionId: str
    encounterId: str
    patientId: str
    validation: dict[str, Any]
    conditionStickers: dict[str, Any]
    resource: dict[str, Any]
    indexLayer: dict[str, Any] | None = None
