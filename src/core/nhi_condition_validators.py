"""門診診斷 Condition 嚴格進場。"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field, field_validator, model_validator

from src.core.nhi_validators import NhiValidationError, validate_taiwan_id_no_format

_ICD_PATTERN = re.compile(r"^[A-Z]\d{2}(\.\d{1,4})?$", re.I)
_SNOMED_PATTERN = re.compile(r"^\d{5,18}$")
_NHI_ICD_PATTERN = re.compile(r"^[A-Z0-9]{3,10}$", re.I)


class NhiConditionIntake(BaseModel):
    encounterId: str = Field(..., min_length=1)
    patientIdNo: str | None = None
    summaryText: str = Field(..., min_length=1, max_length=500)
    icd10Code: str | None = None
    snomedCode: str | None = None
    nhiIcd10Code: str | None = None

    @field_validator("encounterId")
    @classmethod
    def _v_enc(cls, v: str) -> str:
        eid = v.strip()
        if not eid:
            raise NhiValidationError("encounterId 不可為空")
        return eid

    @field_validator("patientIdNo")
    @classmethod
    def _v_id(cls, v: str | None) -> str | None:
        if v is None or not str(v).strip():
            return None
        return validate_taiwan_id_no_format(v)

    @field_validator("summaryText")
    @classmethod
    def _v_text(cls, v: str) -> str:
        t = v.strip()
        if not t:
            raise NhiValidationError("summaryText 不可為空")
        return t

    @field_validator("icd10Code")
    @classmethod
    def _v_icd(cls, v: str | None) -> str | None:
        if v is None:
            return None
        code = v.strip().upper()
        if not _ICD_PATTERN.match(code):
            raise NhiValidationError("icd10Code 格式須如 L50.9")
        return code

    @field_validator("snomedCode")
    @classmethod
    def _v_snomed(cls, v: str | None) -> str | None:
        if v is None:
            return None
        code = v.strip()
        if not _SNOMED_PATTERN.match(code):
            raise NhiValidationError("snomedCode 須為數字")
        return code

    @field_validator("nhiIcd10Code")
    @classmethod
    def _v_nhi(cls, v: str | None) -> str | None:
        if v is None:
            return None
        code = v.strip().upper()
        if not _NHI_ICD_PATTERN.match(code):
            raise NhiValidationError("nhiIcd10Code 格式無效")
        return code

    @model_validator(mode="after")
    def _require_code(self) -> "NhiConditionIntake":
        if not (self.icd10Code or self.snomedCode or self.nhiIcd10Code):
            raise NhiValidationError("icd10Code / snomedCode / nhiIcd10Code 至少填一項")
        return self
