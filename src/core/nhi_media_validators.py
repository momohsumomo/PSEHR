"""病灶 Media 嚴格進場（Base64 影像 + 部位標籤）。"""

from __future__ import annotations

import base64
import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from src.core.nhi_validators import NhiValidationError

_SITE_PATTERN = re.compile(r"^[\u4e00-\u9fffA-Za-z0-9\s\-]{1,32}$")
_ALLOWED_TYPES = frozenset(
    {"image/png", "image/jpeg", "image/jpg", "image/webp"}
)
_MAX_B64_LEN = 4_000_000


class NhiMediaIntake(BaseModel):
    encounterId: str = Field(..., min_length=1)
    patientIdNo: str | None = None
    siteLabel: str = Field(..., description="部位，例：臉部、左前臂")
    bodySiteCode: str | None = Field(None, description="SNOMED 部位碼（選填）")
    contentType: Literal["image/png", "image/jpeg", "image/jpg", "image/webp"] = "image/jpeg"
    imageBase64: str = Field(..., description="不含 data: 前綴的 Base64")
    capturedDateTime: str | None = None
    note: str | None = Field(None, max_length=200)

    @field_validator("encounterId")
    @classmethod
    def _v_enc(cls, v: str) -> str:
        eid = v.strip()
        if not eid:
            raise NhiValidationError("encounterId 不可為空")
        return eid

    @field_validator("siteLabel")
    @classmethod
    def _v_site(cls, v: str) -> str:
        s = v.strip()
        if not s or not _SITE_PATTERN.match(s):
            raise NhiValidationError("siteLabel 1–32 字（中文/英數）")
        return s

    @field_validator("imageBase64")
    @classmethod
    def _v_b64(cls, v: str) -> str:
        raw = v.strip()
        if raw.startswith("data:") and "," in raw:
            raw = raw.split(",", 1)[1]
        raw = re.sub(r"\s+", "", raw)
        if len(raw) > _MAX_B64_LEN:
            raise NhiValidationError("影像過大")
        try:
            base64.b64decode(raw, validate=True)
        except Exception as exc:
            raise NhiValidationError("imageBase64 無效") from exc
        return raw

    def captured_iso(self) -> str:
        if self.capturedDateTime and str(self.capturedDateTime).strip():
            return str(self.capturedDateTime).strip()
        return datetime.now().astimezone().isoformat(timespec="seconds")
