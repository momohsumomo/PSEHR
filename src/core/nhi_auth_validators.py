from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel, Field


class RegisterOptionsRequest(BaseModel):
    patientId: str
    attachment: Optional[str] = Field("cross-platform", description="cross-platform or platform")


class RegisterCredentialRequest(BaseModel):
    patientId: str
    registrationResponse: dict[str, Any] = Field(..., description="The navigator.credentials.create() response JSON")


class LoginOptionsRequest(BaseModel):
    patientId: str


class LoginCredentialRequest(BaseModel):
    patientId: str
    assertionResponse: dict[str, Any] = Field(..., description="The navigator.credentials.get() response JSON")


class Fido2KeyExtension(BaseModel):
    keyId: str
    publicKey: str
    counter: int
