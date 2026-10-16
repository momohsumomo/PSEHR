"""門診 Observation（生命徵象）嚴格進場校驗。"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from src.core.nhi_validators import NhiValidationError, validate_taiwan_id_no_format

ObservationCategory = Literal["vital-signs", "exam", "laboratory"]
VitalType = Literal[
    "body_temperature",
    "heart_rate",
    "systolic_bp",
    "diastolic_bp",
    "body_weight",
    "body_height",
    "custom",
]

VITAL_LOINC: dict[VitalType, tuple[str, str, str]] = {
    "body_temperature": ("8310-5", "Body temperature", "Cel"),
    "heart_rate": ("8867-4", "Heart rate", "/min"),
    "systolic_bp": ("8480-6", "Systolic blood pressure", "mmHg"),
    "diastolic_bp": ("8462-4", "Diastolic blood pressure", "mmHg"),
    "body_weight": ("29463-7", "Body weight", "kg"),
    "body_height": ("8302-2", "Body height", "cm"),
}

_LOINC_PATTERN = re.compile(r"^\d{1,5}-\d$")
_ISO_DT = re.compile(
    r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$"
)


class NhiObservationIntake(BaseModel):
    """嚴格 Observation 進場（沙盒 2 門診生命徵象最小集）。"""

    encounterId: str = Field(..., min_length=1)
    patientIdNo: str | None = Field(None, description="選填；與 Encounter 病人交叉驗證")
    category: ObservationCategory = "vital-signs"
    vitalType: VitalType = Field(..., description="預設 LOINC 對照；custom 時必填 loincCode")
    loincCode: str | None = Field(None, description="vitalType=custom 時必填")
    displayText: str | None = Field(None, max_length=200)
    value: float = Field(..., description="數值結果")
    unit: str | None = Field(None, max_length=32, description="未填則用 vitalType 預設單位")
    effectiveDateTime: str | None = Field(None, description="ISO8601；預設現在")
    status: Literal["final", "preliminary"] = "final"

    @field_validator("encounterId")
    @classmethod
    def _v_enc(cls, v: str) -> str:
        eid = v.strip()
        if not eid:
            raise NhiValidationError("encounterId 不可為空")
        return eid

    @field_validator("patientIdNo")
    @classmethod
    def _v_id_no(cls, v: str | None) -> str | None:
        if v is None or not str(v).strip():
            return None
        return validate_taiwan_id_no_format(v)

    @field_validator("loincCode")
    @classmethod
    def _v_loinc(cls, v: str | None) -> str | None:
        if v is None:
            return None
        code = v.strip()
        if not _LOINC_PATTERN.match(code):
            raise NhiValidationError("loincCode 格式須如 8867-4")
        return code

    @field_validator("effectiveDateTime")
    @classmethod
    def _v_dt(cls, v: str | None) -> str | None:
        if v is None or not str(v).strip():
            return None
        raw = v.strip()
        if not _ISO_DT.match(raw):
            raise NhiValidationError("effectiveDateTime 須為 ISO8601 格式")
        return raw

    @field_validator("unit")
    @classmethod
    def _v_unit(cls, v: str | None) -> str | None:
        if v is None:
            return None
        u = v.strip()
        if not u or len(u) > 32:
            raise NhiValidationError("unit 無效")
        return u

    def resolved_coding(self) -> tuple[str, str, str]:
        """回傳 (loincCode, display, unit)。"""
        if self.vitalType == "custom":
            if not self.loincCode:
                raise NhiValidationError("vitalType=custom 時 loincCode 必填")
            display = self.displayText or self.loincCode
            unit = self.unit or "1"
            return self.loincCode, display, unit
        code, display, default_unit = VITAL_LOINC[self.vitalType]
        return code, self.displayText or display, self.unit or default_unit

    def validate_value_range(self, loinc_code: str) -> None:
        v = self.value
        if self.vitalType == "body_temperature" and not (34.0 <= v <= 42.0):
            raise NhiValidationError("體溫合理範圍 34–42")
        if self.vitalType == "heart_rate" and not (30 <= v <= 220):
            raise NhiValidationError("心率合理範圍 30–220")
        if self.vitalType in ("systolic_bp", "diastolic_bp") and not (40 <= v <= 260):
            raise NhiValidationError("血壓合理範圍 40–260")
        if self.vitalType == "body_weight" and not (1 <= v <= 300):
            raise NhiValidationError("體重合理範圍 1–300 kg")
        if self.vitalType == "body_height" and not (50 <= v <= 250):
            raise NhiValidationError("身高合理範圍 50–250 cm")
        _ = loinc_code

    def effective_iso(self) -> str:
        if self.effectiveDateTime:
            return self.effectiveDateTime
        return datetime.now().astimezone().isoformat(timespec="seconds")
