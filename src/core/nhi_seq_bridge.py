"""6.0 就醫序號：主控台不支援 Next／Rollback，必須打 VPN 業務端。

正式：https://medvpndc.nhi.gov.tw/api
測試：https://medvpndct.nhi.gov.tw/api
簽章：主控台 POST /api/hc/v1/Signature/Hc，serviceType=03（取號相關）。
禁止編造就醫序號；失敗就回失敗原因。
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any
from urllib.error import URLError

from src.core.nhi_cshis6_client import (
    DEFAULT_CONSOLE_BASE,
    request_json,
    status_hint,
)

DEFAULT_BUSINESS_BASE = os.environ.get(
    "NHI_BUSINESS_BASE",
    "https://medvpndc.nhi.gov.tw/api",
)


def _business_base() -> str:
    return os.environ.get("NHI_BUSINESS_BASE", DEFAULT_BUSINESS_BASE).rstrip("/")


@dataclass
class SeqResult:
    ok: bool
    skipped: bool = False
    reason: str = ""
    sequenceNumber: str | None = None
    treatmentNumber: str | None = None
    treatmentDateTime: str | None = None
    signature: str | None = None
    samId: str | None = None
    isSameDay: bool | None = None
    hvExpire: bool | None = None
    hvExpireDate: str | None = None
    treatmentLimit: int | None = None
    statusCode: int | None = None
    hcId: str | None = None
    hcIdNo: str | None = None
    raw: dict[str, Any] | None = None


def posted_sign(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Signature made by the desk PC's own 6.0. The server must not sign or fill SAM."""
    signed = dict(raw or {})
    needed = ("signature", "clientRandom", "samId", "hospitalId")
    if any(not str(signed.get(key) or "").strip() for key in needed):
        raise RuntimeError("NEED_DESK_SIGN")
    return signed


def _sign_hc(*, console_base: str, service_type: str = "03") -> dict[str, Any]:
    """Desk 6.0 signs. This server does not open a reader."""
    del console_base, service_type
    raise RuntimeError("NEED_DESK_SIGN")


def _call_business(path: str, body: dict[str, Any], *, timeout_sec: float = 25.0) -> tuple[int, Any]:
    url = f"{_business_base()}{path}"
    try:
        return request_json(url, method="POST", body=body, timeout_sec=timeout_sec)
    except URLError as exc:
        raise RuntimeError(
            f"無法連線健保業務端（{_business_base()}）。"
            "請確認已執行「醫療網連線程式」（VPN 路由到 10.x）。未假裝取號／退掛成功。"
            f" 原因：{exc.reason if getattr(exc, 'reason', None) else exc}"
        ) from exc
    except TimeoutError as exc:
        raise RuntimeError("健保業務端逾時，未取得就醫序號／退掛結果。未假裝成功。") from exc


def _sign_sam(*, console_base: str, service_type: str = "03") -> dict[str, Any]:
    """Desk 6.0 signs. This server does not open a reader."""
    del console_base, service_type
    raise RuntimeError("NEED_DESK_SIGN")


NOCARD_EXCEPTIONS = frozenset({"noCard", "childNoCard", "pregnantNoCard", "badCard", "paper"})


def request_visit_number(
    *,
    ic_exception: str = "ic",
    treatment_item: str = "01",
    after_check: str = "1",
    baby_treatment: str = "",
    patient_id_no: str | None = None,
    console_base: str = DEFAULT_CONSOLE_BASE,
    desk_sign: dict[str, Any] | None = None,
) -> SeqResult:
    """正常 IC＝Next；無卡／卡片不良／紙卡＝NoCard；自費才略過。都要連健保局（自費除外）。"""
    mode = (ic_exception or "ic").strip()
    if mode == "selfPay":
        return SeqResult(ok=True, skipped=True, reason="自費案件：不向健保局取就醫序號。")
    if mode == "deposit":
        return SeqResult(ok=True, skipped=True, reason="押單：不向健保局取號，待病患補卡。")
    if mode in NOCARD_EXCEPTIONS:
        return request_no_card(patient_id_no=patient_id_no or "", console_base=console_base, desk_sign=desk_sign)
    check = "2" if mode == "afterCheck" else (after_check or "1")
    return request_seq_next(
        treatment_item=treatment_item,
        after_check=check,
        baby_treatment=baby_treatment,
        console_base=console_base,
        desk_sign=desk_sign,
    )


def request_no_card(
    *,
    patient_id_no: str,
    console_base: str = DEFAULT_CONSOLE_BASE,
    desk_sign: dict[str, Any] | None = None,
) -> SeqResult:
    """異常時取得就醫識別碼。SAM 簽章即可，不需要病人卡／醫事人員卡。"""
    id_no = (patient_id_no or "").strip().upper()
    if len(id_no) != 10:
        return SeqResult(ok=False, reason="無卡／卡片不良／紙卡仍要向健保局取就醫識別碼，請填身分證。")
    try:
        signed = posted_sign(desk_sign)
    except RuntimeError as exc:
        return SeqResult(ok=False, reason=str(exc), hcIdNo=id_no)

    body = {
        "clientRandom": signed.get("clientRandom"),
        "hospitalId": signed.get("hospitalId"),
        "samId": signed.get("samId"),
        "signature": signed.get("signature"),
        "patientId": id_no,
    }
    try:
        http_status, data = _call_business("/v1/TreatmentNumber/NoCard", body, timeout_sec=28.0)
    except RuntimeError as exc:
        return SeqResult(ok=False, reason=str(exc), hcIdNo=id_no)

    if not isinstance(data, dict):
        return SeqResult(ok=False, reason=f"業務端無卡取號回傳不是 JSON（HTTP {http_status}）。")
    code = data.get("statusCode")
    treat_no = str(data.get("treatmentNumber") or "").strip()
    if http_status >= 400 or code not in (None, 0) or not treat_no:
        hint = status_hint(int(code)) if isinstance(code, int) else f"HTTP {http_status}"
        detail = data.get("message") or data.get("detail") or data.get("error") or ""
        return SeqResult(
            ok=False,
            reason=f"健保局無卡取就醫識別碼失敗（{hint}{('：' + str(detail)) if detail else ''}）。未假裝成功。",
            statusCode=int(code) if isinstance(code, int) else None,
            raw=data,
            hcIdNo=id_no,
        )
    return SeqResult(
        ok=True,
        reason="健保局已核發無卡就醫識別碼",
        treatmentNumber=treat_no,
        treatmentDateTime=str(data.get("treatmentDateTime") or "") or None,
        samId=str(signed.get("samId") or "") or None,
        statusCode=0,
        hcIdNo=id_no,
        raw=data,
    )


def request_seq_next(
    *,
    treatment_item: str = "01",
    after_check: str = "1",
    baby_treatment: str = "",
    paper_card: bool = False,
    console_base: str = DEFAULT_CONSOLE_BASE,
    desk_sign: dict[str, Any] | None = None,
) -> SeqResult:
    """取得就醫序號。需要病人健保卡＋已驗證 SAM，不需要醫事人員卡。"""
    if paper_card:
        return SeqResult(
            ok=False,
            reason="紙卡請在掛號編輯選「紙卡」例外，走無卡就醫識別碼，不可略過健保局。",
        )

    try:
        signed = posted_sign(desk_sign)
    except RuntimeError as exc:
        return SeqResult(ok=False, reason=str(exc))

    body = {
        "clientRandom": signed.get("clientRandom"),
        "hospitalId": signed.get("hospitalId"),
        "samId": signed.get("samId"),
        "signature": signed.get("signature"),
        "hcId": signed.get("hcId"),
        "hcIdNo": signed.get("hcIdNo"),
        "treatmentItem": (treatment_item or "01")[:2],
        "babyTreatment": baby_treatment or "",
        "afterCheck": (after_check or "1")[:1],
    }
    try:
        http_status, data = _call_business("/v1/SequelNumber/Next", body, timeout_sec=28.0)
    except RuntimeError as exc:
        return SeqResult(ok=False, reason=str(exc), hcId=str(signed.get("hcId") or ""), hcIdNo=str(signed.get("hcIdNo") or ""))

    if not isinstance(data, dict):
        return SeqResult(ok=False, reason=f"業務端取號回傳不是 JSON（HTTP {http_status}）。")

    code = data.get("statusCode")
    seq = str(data.get("sequenceNumber") or "").strip()
    if http_status >= 400 or code not in (None, 0) or not seq:
        hint = status_hint(int(code)) if isinstance(code, int) else f"HTTP {http_status}"
        detail = data.get("message") or data.get("detail") or data.get("error") or ""
        return SeqResult(
            ok=False,
            reason=f"健保局取號失敗（{hint}{('：' + str(detail)) if detail else ''}）。未編造序號。",
            statusCode=int(code) if isinstance(code, int) else None,
            raw=data,
            hcId=str(signed.get("hcId") or ""),
            hcIdNo=str(signed.get("hcIdNo") or ""),
        )

    limit = data.get("treatmentLimit")
    return SeqResult(
        ok=True,
        sequenceNumber=seq,
        treatmentNumber=str(data.get("treatmentNumber") or "") or None,
        treatmentDateTime=str(data.get("treatmentDateTime") or "") or None,
        signature=str(data.get("signature") or "") or None,
        samId=str(signed.get("samId") or "") or None,
        isSameDay=data.get("isSameDay") if isinstance(data.get("isSameDay"), bool) else None,
        hvExpire=data.get("hvExpire") if isinstance(data.get("hvExpire"), bool) else None,
        hvExpireDate=str(data.get("hvExpireDate") or "") or None,
        treatmentLimit=int(limit) if isinstance(limit, int) else None,
        statusCode=0,
        hcId=str(signed.get("hcId") or ""),
        hcIdNo=str(signed.get("hcIdNo") or ""),
        raw=data,
    )


def request_hc_content_update(*, desk_sign: dict[str, Any] | None = None) -> SeqResult:
    """Ask the bureau to refresh this card. Signature service type is 04.

    Does not invent a visit sequence. A failed update leaves the card unchanged.
    """
    try:
        signed = posted_sign(desk_sign)
    except RuntimeError as exc:
        return SeqResult(ok=False, reason=str(exc))
    body = {
        "clientRandom": signed.get("clientRandom"),
        "hospitalId": signed.get("hospitalId"),
        "samId": signed.get("samId"),
        "signature": signed.get("signature"),
        "hcId": signed.get("hcId"),
        "hcIdNo": signed.get("hcIdNo"),
    }
    try:
        http_status, data = _call_business("/v1/HcContent/Update", body, timeout_sec=40.0)
    except RuntimeError as exc:
        return SeqResult(
            ok=False,
            reason=str(exc),
            hcId=str(signed.get("hcId") or ""),
            hcIdNo=str(signed.get("hcIdNo") or ""),
        )
    if not isinstance(data, dict):
        return SeqResult(ok=False, reason=f"更新健保卡回傳不是 JSON（HTTP {http_status}）。這張卡沒有改寫。")
    code = data.get("statusCode")
    if http_status >= 400 or code not in (None, 0):
        hint = status_hint(int(code)) if isinstance(code, int) else f"HTTP {http_status}"
        detail = data.get("message") or data.get("detail") or data.get("error") or ""
        return SeqResult(
            ok=False,
            reason=f"更新健保卡失敗（{hint}{('：' + str(detail)) if detail else ''}）。這張卡沒有改寫，也沒有取號。",
            statusCode=int(code) if isinstance(code, int) else None,
            raw=data,
            hcId=str(signed.get("hcId") or ""),
            hcIdNo=str(signed.get("hcIdNo") or ""),
        )
    return SeqResult(
        ok=True,
        reason="健保卡內容已更新",
        statusCode=0,
        hcId=str(signed.get("hcId") or ""),
        hcIdNo=str(signed.get("hcIdNo") or ""),
        raw=data,
    )


def request_seq_rollback(
    *,
    treatment_date_time: str,
    expected_id_no: str | None = None,
    console_base: str = DEFAULT_CONSOLE_BASE,
    desk_sign: dict[str, Any] | None = None,
) -> SeqResult:
    """退掛（回復就醫資料累計值）。"""
    roc = str(treatment_date_time or "").strip()
    if len(roc) != 13 or not roc.isdigit():
        return SeqResult(
            ok=False,
            reason="本筆沒有就診時間（民國 13 碼），無法向健保局退掛。若當初沒取到序號，請只選「刪除」。",
        )

    try:
        signed = posted_sign(desk_sign)
    except RuntimeError as exc:
        return SeqResult(ok=False, reason=str(exc))

    hc_id_no = str(signed.get("hcIdNo") or "")
    if expected_id_no and hc_id_no and hc_id_no.upper() != expected_id_no.strip().upper():
        return SeqResult(
            ok=False,
            reason=f"插卡身分證（{hc_id_no}）與本筆病患不符，未退掛。",
            hcId=str(signed.get("hcId") or ""),
            hcIdNo=hc_id_no,
        )

    body = {
        "clientRandom": signed.get("clientRandom"),
        "hospitalId": signed.get("hospitalId"),
        "samId": signed.get("samId"),
        "signature": signed.get("signature"),
        "hcId": signed.get("hcId"),
        "hcIdNo": signed.get("hcIdNo"),
        "treatmentDateTime": roc,
    }
    try:
        http_status, data = _call_business("/v1/SequelNumber/Rollback", body, timeout_sec=28.0)
    except RuntimeError as exc:
        return SeqResult(ok=False, reason=str(exc), hcId=str(signed.get("hcId") or ""), hcIdNo=hc_id_no)

    if not isinstance(data, dict):
        return SeqResult(ok=False, reason=f"業務端退掛回傳不是 JSON（HTTP {http_status}）。")

    code = data.get("statusCode")
    if http_status >= 400 or code not in (None, 0):
        hint = status_hint(int(code)) if isinstance(code, int) else f"HTTP {http_status}"
        detail = data.get("message") or data.get("detail") or data.get("error") or ""
        return SeqResult(
            ok=False,
            reason=f"執行IC卡退掛失敗（{hint}{('：' + str(detail)) if detail else ''}）。",
            statusCode=int(code) if isinstance(code, int) else None,
            raw=data,
            hcId=str(signed.get("hcId") or ""),
            hcIdNo=hc_id_no,
        )

    return SeqResult(
        ok=True,
        reason="退掛成功",
        statusCode=0,
        hcId=str(signed.get("hcId") or ""),
        hcIdNo=hc_id_no,
        treatmentDateTime=roc,
        raw=data,
    )
