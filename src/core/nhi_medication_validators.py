"""門診處方 MedicationRequest 嚴格進場。"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field, field_validator

from src.core.nhi_validators import NhiValidationError, validate_taiwan_id_no_format

# Clinic shortcuts are often shorter than an NHI code (PP, HQH). Self-pay items still need a code or the line is dropped.
_NHI_MED_PATTERN = re.compile(r"^[A-Z0-9]{1,16}$", re.I)
_RXNORM_PATTERN = re.compile(r"^\d{1,10}$")


class NhiMedicationIntake(BaseModel):
    encounterId: str = Field(..., min_length=1)
    patientIdNo: str | None = None
    drugText: str = Field(..., min_length=1, max_length=200)
    nhiCode: str = Field(..., description="健保藥品碼")
    rxnormCode: str | None = None
    sig: str | None = Field(None, max_length=120, description="用法，例：BID 外用")
    bodySite: str | None = Field(None, max_length=200, description="列印用部位，可多處以空白分隔")
    tradeName: str | None = Field(None, max_length=80, description="商品名稱，病患收據用")
    payMark: str | None = Field(None, max_length=4, description="計費標記，例如 自")
    memo: str | None = Field(None, max_length=8, description="註記，例如 [")
    daysSupply: int | None = Field(None, ge=1, description="給藥日份")
    quantity: float | None = Field(None, gt=0, le=9999, description="次量／總量（計價用）")
    unitPrice: float | None = Field(
        None,
        ge=0,
        description="可選；未傳則依就醫日 Pack 查價寫入快照",
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

    @field_validator("drugText")
    @classmethod
    def _v_drug(cls, v: str) -> str:
        t = v.strip()
        if not t:
            raise NhiValidationError("drugText 不可為空")
        return t

    @field_validator("nhiCode")
    @classmethod
    def _v_nhi(cls, v: str) -> str:
        code = v.strip().upper()
        if not _NHI_MED_PATTERN.match(code):
            raise NhiValidationError("nhiCode 格式無效")
        return code

    @field_validator("rxnormCode")
    @classmethod
    def _v_rx(cls, v: str | None) -> str | None:
        if v is None:
            return None
        code = v.strip()
        if not _RXNORM_PATTERN.match(code):
            raise NhiValidationError("rxnormCode 須為數字")
        return code
