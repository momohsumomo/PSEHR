"""健保署門診 SOAP 紀錄欄位校驗（S/O/A/P + 主訴 CC）。"""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

from src.core.nhi_validators import NhiValidationError, validate_taiwan_id_no_format

# 對齊署方/診所申報常見欄位長度上限（固定寬度思維）
CHIEF_COMPLAINT_MAX = 500
SOAP_SECTION_MAX = 8000

_FORBIDDEN_TEXT = re.compile(r"[<>\x00]")


class NhiSoapIntake(BaseModel):
    """
    門診 SOAP 進場（嚴格 Schema，前端 UI 不得繞過）。

    - chiefComplaint：主訴 CC（必填）
    - subjective：S 主觀/病史（可空）
    - objective：O 理學（可空）
    - assessment：A 評估（必填）
    - plan：P 計畫（必填）
    """

    encounterId: str = Field(..., min_length=1, description="當次 Encounter ID")
    patientIdNo: str | None = Field(
        None,
        description="選填；若提供則與 Encounter 病人身分證交叉驗證",
    )
    chiefComplaint: str = Field(..., description="主訴 CC")
    subjective: str | None = Field(None, description="S 主觀描述")
    objective: str | None = Field(None, description="O 理學檢查")
    assessment: str = Field(..., description="A 臨床評估")
    plan: str = Field(..., description="P 處置計畫")
    authorIdNo: str | None = Field(None, description="撰寫醫師身分證（選填）")

    @field_validator("encounterId")
    @classmethod
    def _v_encounter_id(cls, v: str) -> str:
        eid = v.strip()
        if not eid:
            raise NhiValidationError("encounterId 不可為空")
        return eid

    @field_validator("patientIdNo", "authorIdNo")
    @classmethod
    def _v_optional_id(cls, v: str | None) -> str | None:
        if v is None or not str(v).strip():
            return None
        return validate_taiwan_id_no_format(v)

    @staticmethod
    def _clean_section(value: str | None, *, max_len: int, required: bool, label: str) -> str | None:
        if value is None:
            if required:
                raise NhiValidationError(f"{label} 為必填")
            return None
        text = value.strip()
        if not text:
            if required:
                raise NhiValidationError(f"{label} 不可為空白")
            return None
        if _FORBIDDEN_TEXT.search(text):
            raise NhiValidationError(f"{label} 不可含 < > 或空字元")
        if len(text) > max_len:
            raise NhiValidationError(f"{label} 超過 {max_len} 字")
        return text

    @field_validator("chiefComplaint")
    @classmethod
    def _v_cc(cls, v: str) -> str:
        out = cls._clean_section(v, max_len=CHIEF_COMPLAINT_MAX, required=True, label="chiefComplaint")
        assert out is not None
        return out

    @field_validator("subjective", "objective")
    @classmethod
    def _v_optional_sections(cls, v: str | None) -> str | None:
        return cls._clean_section(v, max_len=SOAP_SECTION_MAX, required=False, label="section")

    @field_validator("assessment", "plan")
    @classmethod
    def _v_required_sections(cls, v: str) -> str:
        out = cls._clean_section(v, max_len=SOAP_SECTION_MAX, required=True, label="section")
        assert out is not None
        return out

    @model_validator(mode="after")
    def _at_least_clinical_content(self) -> NhiSoapIntake:
        if len(self.chiefComplaint) < 2:
            raise NhiValidationError("chiefComplaint 至少 2 字")
        return self

    def normalized_dict(self) -> dict[str, Any]:
        return {
            "encounterId": self.encounterId,
            "patientIdNo": self.patientIdNo,
            "chiefComplaint": self.chiefComplaint,
            "subjective": self.subjective,
            "objective": self.objective,
            "assessment": self.assessment,
            "plan": self.plan,
            "authorIdNo": self.authorIdNo,
        }
