from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from src.core.nhi_validators import NhiPatientIntake

# Re-export for OpenAPI
__all__ = ["NhiPatientIntake", "NhiPatientRegisterResponse"]


class NhiValidationReport(BaseModel):
    idNo: str
    birthdayRoc: str
    sex: str
    birthDateIso: str | None = None
    patientName: str | None = None
    cardName: str | None = None
    cardId: str | None = None
    identityStatus: str | None = None


class NhiPatientRegisterResponse(BaseModel):
    created: bool
    patientId: str
    validation: NhiValidationReport
    nhiStickers: dict[str, Any]
    resource: dict[str, Any]
    indexLayer: dict[str, Any] | None = None
    cardSource: str | None = None
    consoleReachable: bool | None = None
    cardBridgeNote: str | None = None
