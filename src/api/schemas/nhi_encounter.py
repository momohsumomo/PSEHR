from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from src.core.nhi_encounter_validators import NhiEncounterIntake

__all__ = ["NhiEncounterIntake", "NhiEncounterRegisterResponse"]


class NhiEncounterRegisterResponse(BaseModel):
    created: bool
    encounterId: str
    patientId: str
    queueNumber: int
    queueStatus: str
    validation: dict[str, Any]
    resource: dict[str, Any]
    queueMeta: dict[str, Any] | None = None
