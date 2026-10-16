from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from src.core.nhi_media_validators import NhiMediaIntake

__all__ = ["NhiMediaIntake", "NhiMediaRegisterResponse"]


class NhiMediaRegisterResponse(BaseModel):
    created: bool
    mediaId: str
    encounterId: str
    patientId: str
    siteLabel: str
    mediaStickers: dict[str, Any]
    resource: dict[str, Any]
    indexLayer: dict[str, Any] | None = None
