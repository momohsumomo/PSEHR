# -*- coding: utf-8 -*-
"""Yisheng REGISTER.Dat field decoders.

Date fields (from REGIBRW.Dat BDATA):
- 看診日 = Main->R_Date   ← clinic day / queue day / age as-of
- O_DATE = registration/opd key date (used in encounter id with KEYWORD+TIMESNO)
- SERNO uniqueness holds for (R_DATE + SLOT), NOT for (O_DATE + SLOT)

REGISTER status markers:

1) DBF 0x2A ('*') — skip in read_dbf_records
2) REGIDELE.Dat — deleted archive; do not import as active
3) STATUS='0' + RECEIPTS 0 + no real diagnosis — unbilled delete → cancelled.
   A written diagnosis stays on the cash book, including self-pay code !07Y
   with zero receipts. Any other diagnosis that starts with ! and has no
   money stays a delete.
4) STATUS='A' (+ FORESPEAK 預) — appointment; show on R_DATE as waiting+prebook
5) STATUS='-' / '+' — finished visit on R_DATE
"""

from __future__ import annotations

from typing import Any


def decode_cp950(value: str | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("cp950", errors="ignore").strip()
    return str(value).strip()


def decode_register_time(raw: str | bytes | None) -> str | None:
    """掛號清單「時間」= Left(xSecToTime(cTon75(REGISTER.TIME)), 5).

    TIME 是 3 個字元。cTon75 把它當成 75 進位的秒數（每位 = 字元碼 − '0'），
    xSecToTime 再換成時:分:秒。清單只取前 5 碼，所以顯示到分。
    早上常見 10:00、10:30、11:00、11:30；下午常見 16:00 起、每 30 分一格。
    """
    if raw is None:
        return None
    if isinstance(raw, str):
        tb = raw.encode("latin1", errors="ignore")
    else:
        tb = bytes(raw)
    tb = tb[:3]
    if len(tb) < 3 or any(b < 48 or b > 122 for b in tb):
        return None
    seconds = 0
    for b in tb:
        seconds = seconds * 75 + (b - 48)
    hour, rem = divmod(seconds, 3600)
    minute = rem // 60
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return f"{hour:02d}:{minute:02d}"


def parse_serno(raw: str | bytes | None) -> int:
    text = decode_cp950(raw)
    try:
        n = int(text)
        return n if n > 0 else 1
    except ValueError:
        return 1


def slot_to_shift(slot: str | bytes | None) -> str:
    s = decode_cp950(slot)
    if s == "2":
        return "\u4e0b\u5348"
    if s == "3":
        return "\u665a\u4e0a"
    return "\u4e0a\u5348"


def is_register_void(
    status: str | bytes | None,
    *,
    receipts: str | bytes | None = None,
    icno: str | bytes | None = None,
    diagnose: str | bytes | None = None,
    caseno: str | bytes | None = None,
) -> bool:
    """Unbilled delete leftover in REGISTER."""
    st = decode_cp950(status)
    rec = decode_cp950(receipts)
    ic = decode_cp950(icno)
    diag = decode_cp950(diagnose)
    case = decode_cp950(caseno)
    # Paid rows stay on the cash book.
    # STATUS 0 with a real diagnosis stays too.
    # A diagnosis that starts with "!" and has no money is a delete,
    # except self-pay code "!07Y", which stays even when receipts are 0.
    coded_self = diag.startswith("!07Y")
    real_dx = (bool(diag) and not diag.startswith("!")) or coded_self
    if diag.startswith("!") and rec in {"", "0"} and not coded_self:
        return True
    if st == "0" and rec in {"", "0"} and not ic and not real_dx:
        return True
    if st == "0" and case in {"\u81ea", "\u81ea\u8cbb"} and rec in {"", "0"} and not real_dx:
        return True
    return False


def map_visit_state(
    status: str | bytes | None,
    d_end: str | bytes | None,
    icno: str | bytes | None,
    *,
    receipts: str | bytes | None = None,
    diagnose: str | bytes | None = None,
    caseno: str | bytes | None = None,
    forespeak: str | bytes | None = None,
) -> dict[str, Any]:
    if is_register_void(
        status,
        receipts=receipts,
        icno=icno,
        diagnose=diagnose,
        caseno=caseno,
    ):
        return {
            "queue_status": "cancelled",
            "fhir_status": "cancelled",
            "card_written": False,
            "finished": False,
            "void": True,
            "appointment": False,
        }

    st = decode_cp950(status)
    fs = decode_cp950(forespeak)

    # Appointment: list on R_DATE as waiting; 預 column while still waiting
    if st == "A":
        return {
            "queue_status": "waiting",
            "fhir_status": "arrived",
            "card_written": False,
            "finished": False,
            "void": False,
            "appointment": True,
            "prebook": True,
        }

    if isinstance(d_end, str):
        dend_b = d_end.encode("latin1", errors="ignore")[:1]
    elif isinstance(d_end, bytes):
        dend_b = d_end[:1] if d_end else b" "
    else:
        dend_b = b" "
    finished = dend_b[:1] == b"\x1d" or st in {"-", "0", "+"}
    if not finished and st not in {"-", "0", "+"}:
        return {
            "queue_status": "waiting",
            "fhir_status": "arrived",
            "card_written": False,
            "finished": False,
            "void": False,
            "appointment": False,
            "prebook": fs == "\u9810",
        }
    ic = decode_cp950(icno)
    return {
        "queue_status": "finished",
        "fhir_status": "finished",
        "card_written": bool(ic),
        "finished": True,
        "void": False,
        "appointment": False,
        "prebook": False,
    }


def remark_text(remark: str | bytes | None) -> str:
    return decode_cp950(remark)


def forespeak_text(forespeak: str | bytes | None) -> str:
    return decode_cp950(forespeak)
