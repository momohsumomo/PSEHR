"""今日掛號 Encounter 嚴格進場。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from src.core.nhi_validators import NhiValidationError

QueueStatus = Literal["waiting", "in_progress"]


class NhiEncounterIntake(BaseModel):
    patientId: str = Field(..., min_length=1)
    patientIdNo: str | None = None
    queueStatus: QueueStatus = "waiting"
    reasonText: str | None = Field(None, max_length=500)
    encounterDate: str | None = Field(None, description="就醫日 YYYY-MM-DD")
    caseNo: str | None = Field(None, max_length=8, description="案件分類，預設 01")
    copayCode: str | None = Field(None, max_length=8)
    dispense: str | None = Field(None, max_length=20)
    room: str | None = Field(None, max_length=20)
    shift: str | None = Field(None, max_length=8)
    treatmentItem: str | None = Field(None, max_length=2, description="就醫類別 01=西醫門診")
    afterCheck: str | None = Field(None, max_length=1, description="1 正常／2 補卡")
    paperCard: bool = False
    treatSeq: str | None = Field(None, max_length=8, description="健保就醫序號，禁止編造")
    treatmentNumber: str | None = Field(None, max_length=32)
    treatDateTime: str | None = Field(None, max_length=13, description="民國 13 碼就診時間，退掛用")
    securitySign: str | None = Field(None, max_length=512, description="取號時的安全簽章，上傳 M14 用")
    samId: str | None = Field(None, max_length=12)
    icUploadDate: str | None = Field(None, max_length=10, description="每日上傳歸屬日 YYYY-MM-DD")
    hcId: str | None = Field(None, max_length=12)
    hcIdNo: str | None = Field(None, max_length=20)
    icException: str | None = Field(None, max_length=20, description="ic/afterCheck/noCard/badCard/paper/selfPay")
    noCardReason: str | None = Field(None, max_length=80)
    pharmacist: str | None = Field(None, max_length=40)
    doctorId: str | None = Field(None, max_length=40)
    doctorName: str | None = Field(None, max_length=40)
    payType: str | None = Field(None, max_length=8)
    regFee: str | None = Field(None, max_length=12)
    copayAmt: str | None = Field(None, max_length=12)
    deposit: str | None = Field(None, max_length=12)
    consultFee: str | None = Field(None, max_length=12)
    drugFee: str | None = Field(None, max_length=12)
    materialFee: str | None = Field(None, max_length=12)
    burdenFee: str | None = Field(None, max_length=12)
    drugCopay: str | None = Field(None, max_length=12)
    cardIdentity: str | None = Field(None, max_length=1)
    totalFee: str | None = Field(None, max_length=12)
    selfPay: str | None = Field(None, max_length=12)
    referralSeq: str | None = Field(None, max_length=20)
    referralHospId: str | None = Field(None, max_length=20)
    referralHospName: str | None = Field(None, max_length=80)
    referralDate: str | None = Field(None, max_length=12)
    acceptReferral: str | None = Field(None, max_length=1)
    prebook: bool = False
    confirmDuplicate: bool = False
    queueNumber: int | None = Field(None, description="當次看診序號，可手改")
    visitClock: str | None = Field(None, max_length=8, description="就診時間 HH:MM")
    # None＝這次不改。False 會清掉「已寫入」圈，只有寫入成功才送 True。
    cardWritten: bool | None = None

    @field_validator("patientId")
    @classmethod
    def _v_pid(cls, v: str) -> str:
        pid = v.strip()
        if not pid:
            raise NhiValidationError("patientId 不可為空")
        return pid

    @field_validator("patientIdNo")
    @classmethod
    def _v_id(cls, v: str | None) -> str | None:
        # 證號在病患資料存檔時檢查。掛號沿用病歷上的值，空白自費不擋。
        if v is None or not str(v).strip():
            return None
        text = str(v).strip().upper()
        if len(text) > 20:
            raise NhiValidationError("\u8b49\u865f\u904e\u9577")
        return text
