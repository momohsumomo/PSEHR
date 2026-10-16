from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from src.core.nhi_soap_validators import NhiSoapIntake

__all__ = ["NhiSoapIntake", "NhiSoapRegisterResponse"]


class NhiSoapValidationReport(BaseModel):
    encounterId: str
    chiefComplaint: str
    hasSubjective: bool
    hasObjective: bool
    assessmentLength: int
    planLength: int


class NhiSoapRegisterResponse(BaseModel):
    created: bool
    compositionId: str
    encounterId: str
    patientId: str
    validation: NhiSoapValidationReport
    soapStickers: dict[str, Any]
    resource: dict[str, Any]
    indexLayer: dict[str, Any] | None = None
    encounterReasonSynced: bool
