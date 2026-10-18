"""健保署 Web API 患者基本資料欄位校驗（對齊官方 idNo / birthday / sex 格式）。"""

from __future__ import annotations

import re
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator

# 署方 sex 僅允許 M / F（大寫）
NhiSex = Literal["M", "F"]

# 身分證字號首碼對照（含新式/舊式對照表）
_ID_LETTER_VALUES: dict[str, int] = {
    "A": 10,
    "B": 11,
    "C": 12,
    "D": 13,
    "E": 14,
    "F": 15,
    "G": 16,
    "H": 17,
    "I": 34,
    "J": 18,
    "K": 19,
    "L": 20,
    "M": 21,
    "N": 22,
    "O": 35,
    "P": 23,
    "Q": 24,
    "R": 25,
    "S": 26,
    "T": 27,
    "U": 28,
    "V": 29,
    "W": 32,
    "X": 30,
    "Y": 31,
    "Z": 33,
}

_ID_PATTERN = re.compile(r"^[A-Z][0-9]{9}$")
_ROC7_PATTERN = re.compile(r"^[0-9]{7}$")


class NhiValidationError(ValueError):
    """健保欄位校驗失敗（拒絕落庫）。"""


def normalize_id_no(value: str) -> str:
    return value.strip().upper()


def validate_taiwan_id_no_format(id_no: str) -> str:
    """Format only: 1 letter + 9 digits. For optional cross-check on clinical writes."""
    normalized = normalize_id_no(id_no)
    if not _ID_PATTERN.match(normalized):
        raise NhiValidationError(
            "idNo \u9808\u70ba 1 \u78bc\u82f1\u6587\u5927\u5beb + 9 \u78bc\u6578\u5b57\uff08\u4f8b\uff1aA123456789\uff09"
        )
    if normalized[0] not in _ID_LETTER_VALUES:
        raise NhiValidationError(f"idNo \u9996\u78bc\u4e0d\u5408\u6cd5\uff1a{normalized[0]}")
    return normalized


_ARC_SECOND = {"A": 10, "B": 11, "C": 12, "D": 13}
_ARC_WEIGHTS = (1, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 1)


def _old_arc_ok(text: str) -> bool:
    """Old resident certificate: two letters + eight digits."""
    first = _ID_LETTER_VALUES[text[0]]
    second = _ARC_SECOND[text[1]]
    nums = [first // 10, first % 10, second // 10, second % 10]
    nums.extend(int(ch) for ch in text[2:])
    return sum(w * n for w, n in zip(_ARC_WEIGHTS, nums, strict=True)) % 10 == 0


def screen_desk_id(raw: str | None) -> str:
    """Desk new-chart id. Blank is allowed. ID-shaped values must pass the check digit.

    Residence permits and other document numbers stay enterable.
    A string that looks like a national id or an old resident certificate
    is rejected when the check digit is wrong.
    """
    text = (raw or "").strip().upper().replace(" ", "")
    if not text:
        return ""
    if re.fullmatch(r"[A-Z][0-9]{9}", text):
        return validate_taiwan_id_no(text)
    if re.fullmatch(r"[A-Z0-9]{4,20}", text):
        return text
    raise NhiValidationError(
        "\u8b49\u865f\u53ea\u80fd\u586b\u82f1\u6578\u3002\u6c92\u6709\u8b49\u865f\u7684\u81ea\u8cbb\u53ef\u4ee5\u7559\u7a7a\u3002"
    )


def validate_taiwan_id_no(id_no: str) -> str:
    """
    Taiwan national ID (10 chars): format + checksum.
    Strict — use for NHI card / official patient register only.
    """
    normalized = validate_taiwan_id_no_format(id_no)
    letter_value = _ID_LETTER_VALUES[normalized[0]]
    n1 = letter_value // 10
    n2 = letter_value % 10
    digits = [int(c) for c in normalized[1:]]
    # 首碼拆成兩位數後，權重是 1、9，後面九碼是 8 7 6 5 4 3 2 1 1。
    weights = (1, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1)
    payload = [n1, n2, *digits]
    total = sum(w * d for w, d in zip(weights, payload, strict=True))
    if total % 10 != 0:
        raise NhiValidationError(
            "idNo \u6aa2\u67e5\u78bc\u4e0d\u7b26\uff08\u975e\u6709\u6548\u8eab\u5206\u8b49\u5b57\u865f\uff09"
        )
    return normalized


def validate_roc_birthday7(birthday: str) -> str:
    """民國 7 碼生日 YYYMMDD（例：0740315 = 民國 74 年 3 月 15 日）。"""
    raw = birthday.strip()
    if not _ROC7_PATTERN.match(raw):
        raise NhiValidationError("birthday 須為民國 7 碼數字 YYYMMDD")

    roc_year = int(raw[0:3])
    month = int(raw[3:5])
    day = int(raw[5:7])
    if roc_year < 1 or roc_year > 200:
        raise NhiValidationError("birthday 民國年不合理")
    if month < 1 or month > 12:
        raise NhiValidationError("birthday 月份須 01–12")
    if day < 1 or day > 31:
        raise NhiValidationError("birthday 日期須 01–31")

    ad_year = roc_year + 1911
    try:
        date(ad_year, month, day)
    except ValueError as exc:
        raise NhiValidationError("birthday 非有效曆日") from exc
    return raw


def roc7_to_iso_date(birthday_roc: str) -> str:
    """轉 FHIR birthDate（ISO YYYY-MM-DD）。"""
    raw = validate_roc_birthday7(birthday_roc)
    roc_year = int(raw[0:3])
    month = int(raw[3:5])
    day = int(raw[5:7])
    ad_year = roc_year + 1911
    return f"{ad_year:04d}-{month:02d}-{day:02d}"


def validate_nhi_sex(sex: str) -> NhiSex:
    s = sex.strip().upper()
    if s not in ("M", "F"):
        raise NhiValidationError("sex 僅允許 M 或 F")
    return s  # type: ignore[return-value]


def nhi_sex_to_fhir_gender(sex: NhiSex) -> str:
    return "male" if sex == "M" else "female"


class NhiPatientIntake(BaseModel):
    """
    健保署患者進場（對齊官方 Web API 第 5 頁核心 + 第 9 頁姓名擴充）。

    前端 UI 不得繞過此 Schema 直接寫入 Patient。
    """

    idNo: str = Field(..., description="台灣身分證字號（10 碼）", examples=["A123456789"])
    birthday: str = Field(..., description="民國 7 碼生日 YYYMMDD", examples=["0740315"])
    sex: str = Field(..., description="M 或 F", examples=["M"])
    patientName: str | None = Field(
        None,
        description="第 9 頁：姓名（可選；讀卡機回傳時帶入）",
        examples=["王小明"],
    )

    @field_validator("idNo")
    @classmethod
    def _v_id(cls, v: str) -> str:
        return validate_taiwan_id_no(v)

    @field_validator("birthday")
    @classmethod
    def _v_birth(cls, v: str) -> str:
        return validate_roc_birthday7(v)

    @field_validator("sex")
    @classmethod
    def _v_sex(cls, v: str) -> str:
        return validate_nhi_sex(v)

    @field_validator("patientName")
    @classmethod
    def _v_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        name = v.strip()
        if not name:
            return None
        if len(name) > 60:
            raise NhiValidationError("patientName 長度不可超過 60")
        return name
