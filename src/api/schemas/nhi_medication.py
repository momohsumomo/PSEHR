from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from src.core.nhi_medication_validators import NhiMedicationIntake

__all__ = ["NhiMedicationIntake", "NhiMedicationRegisterResponse"]


class NhiMedicationRegisterResponse(BaseModel):
    created: bool
    medicationRequestId: str
    encounterId: str
    patientId: str
    validation: dict[str, Any]
    medicationStickers: dict[str, Any]
    resource: dict[str, Any]
    indexLayer: dict[str, Any] | None = None
