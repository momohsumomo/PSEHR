"""病患端預診（自助）嚴格進場。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from src.core.nhi_validators import NhiValidationError, validate_taiwan_id_no_format

SymptomTag = Literal[
    "itching",
    "scaling",
    "rash",
    "pigment",
    "pain",
    "other",
]


class NhiPreVisitIntake(BaseModel):
    """病患預診 — 供診間醫師看見 CC 與掛號列預診完成標記。"""

    encounterId: str = Field(..., min_length=1)
    patientIdNo: str | None = Field(None, description="選填；與 Encounter 病人交叉驗證")
    chiefComplaint: str = Field(..., min_length=1, max_length=500)
    symptomTags: list[SymptomTag] = Field(default_factory=list, max_length=10)
    hasDrugAllergyHistory: bool | None = Field(
        None,
        description="病患自填是否有藥物過敏史（提醒醫師，非正式 Allergy 資源）",
    )

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

    @field_validator("chiefComplaint")
    @classmethod
    def _v_cc(cls, v: str) -> str:
        text = v.strip()
        if not text:
            raise NhiValidationError("chiefComplaint 不可為空")
        return text

    def submitted_iso(self) -> str:
        return datetime.now().astimezone().isoformat(timespec="seconds")
