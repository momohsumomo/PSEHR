"""AllergyIntolerance 嚴格進場校驗（SNOMED 過敏原 / RxNorm 成分 / SNOMED 症狀）。"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from src.core.nhi_validators import NhiValidationError, validate_taiwan_id_no_format

VerificationStatus = Literal["confirmed", "unconfirmed", "refuted"]
AllergyCategory = Literal["food", "medication", "environment", "biologic"]
Criticality = Literal["low", "high", "unable-to-assess"]
ReactionSeverity = Literal["mild", "moderate", "severe"]

_SNOMED_PATTERN = re.compile(r"^\d{5,18}$")
_RXNORM_PATTERN = re.compile(r"^\d{1,10}$")


class NhiAllergyIntake(BaseModel):
    """門診過敏紀錄嚴格進場（沙盒 2 · 模組四 Terminology Binding）。"""

    patientId: str = Field(..., min_length=1, description="FHIR Patient.id")
    patientIdNo: str | None = Field(None, description="選填；與庫內病人交叉驗證")
    verificationStatus: VerificationStatus = "confirmed"
    category: AllergyCategory = "medication"
    criticality: Criticality | None = "high"
    allergenSnomedCode: str = Field(
        ...,
        description="過敏原大類 SNOMED-CT，例 292044008",
    )
    allergenDisplayText: str | None = Field(None, max_length=200)
    substanceRxnormCode: str | None = Field(
        None,
        description="反應物質 RxNorm，例 5640 Ibuprofen",
    )
    substanceDisplayText: str | None = Field(None, max_length=200)
    manifestationSnomedCode: str | None = Field(
        None,
        description="臨床症狀 SNOMED-CT，例 247472004",
    )
    manifestationDisplayText: str | None = Field(None, max_length=200)
    reactionSeverity: ReactionSeverity | None = "moderate"
    recordedDate: str | None = None

    @field_validator("patientId")
    @classmethod
    def _v_pid(cls, v: str) -> str:
        pid = v.strip()
        if not pid:
            raise NhiValidationError("patientId 不可為空")
        return pid

    @field_validator("patientIdNo")
    @classmethod
    def _v_id_no(cls, v: str | None) -> str | None:
        if v is None or not str(v).strip():
            return None
        return validate_taiwan_id_no_format(v)

    @field_validator("allergenSnomedCode", "manifestationSnomedCode")
    @classmethod
    def _v_snomed(cls, v: str | None) -> str | None:
        if v is None:
            return None
        code = v.strip()
        if not _SNOMED_PATTERN.match(code):
            raise NhiValidationError("SNOMED 代碼須為 5–18 位數字")
        return code

    @field_validator("substanceRxnormCode")
    @classmethod
    def _v_rxnorm(cls, v: str | None) -> str | None:
        if v is None:
            return None
        code = v.strip()
        if not _RXNORM_PATTERN.match(code):
            raise NhiValidationError("RxNorm 代碼須為數字")
        return code

    def require_reaction_codes(self) -> None:
        """藥物過敏建議同時帶成分與症狀碼。"""
        if self.category == "medication" and not self.substanceRxnormCode:
            raise NhiValidationError("category=medication 時 substanceRxnormCode 必填")
