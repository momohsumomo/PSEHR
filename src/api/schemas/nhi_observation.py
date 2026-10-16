from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from src.core.nhi_observation_validators import NhiObservationIntake

__all__ = ["NhiObservationIntake", "NhiObservationRegisterResponse"]


class NhiObservationRegisterResponse(BaseModel):
    created: bool
    observationId: str
    encounterId: str
    patientId: str
    loincCode: str
    value: float
    unit: str
    observationStickers: dict[str, Any]
    resource: dict[str, Any]
    indexLayer: dict[str, Any] | None = None
