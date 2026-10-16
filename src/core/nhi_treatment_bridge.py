# -*- coding: utf-8 -*-
"""NHI 6.0 business-end Treatment / Prescription cloud read-write.

Paths (base = NHI_BUSINESS_BASE, default https://medvpndc.nhi.gov.tw/api):
  POST /v1/Treatment/WriteCodeFee
  POST /v1/Prescription/Write
  POST /v1/Treatment/NoNeedHPC
Signature serviceType: write=02, read=01 (same pattern as SequelNumber uses 03).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from src.core.nhi_cshis6_client import DEFAULT_CONSOLE_BASE, status_hint
from src.core.nhi_seq_bridge import _call_business, _sign_hc


@dataclass
class CloudWriteResult:
    ok: bool
    skipped: bool = False
    reason: str = ""
    statusCode: int | None = None
    wroteCodes: bool = False
    wrotePrescriptions: bool = False
    prescriptionCount: int = 0
    raw: dict[str, Any] | None = None


@dataclass
class CloudTreatHit:
    treatDateTime: str = ""
    hospitalId: str = ""
    hospitalVisit: str = ""
    treatmentItem: str = ""
    afterCheck: str = ""
    outpatientFee: int | None = None


@dataclass
class CloudTreatQueryResult:
    ok: bool
    reason: str = ""
    treatments: list[CloudTreatHit] = field(default_factory=list)
    statusCode: int | None = None
    raw: dict[str, Any] | None = None


def _icd(raw: str) -> str:
    return str(raw or "").strip().replace(".", "").upper()[:7]


def _fee_int(raw: Any) -> int:
    if raw is None:
        return 0
    text = str(raw).replace(",", "").strip()
    if not text or text == "\u2014" or text == "-":
        return 0
    try:
        return int(round(float(text)))
    except Exception:
        return 0


def _roc_datetime13(raw: str | None) -> str:
    """Accept ISO, ROC13, or empty -> now ROC YYYMMDDhhmmss."""
    text = (raw or "").strip()
    digits = "".join(ch for ch in text if ch.isdigit())
    if len(digits) >= 13:
        return digits[:13]
    if len(digits) == 7:
        now = datetime.now()
        return f"{digits}{now.hour:02d}{now.minute:02d}{now.second:02d}"
    # ISO YYYY-MM-DD[THH:MM:SS]
    try:
        if "T" in text:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00").split("+")[0])
        else:
            dt = datetime.strptime(text[:10], "%Y-%m-%d")
            now = datetime.now()
            dt = dt.replace(hour=now.hour, minute=now.minute, second=now.second)
        return f"{dt.year - 1911:03d}{dt.month:02d}{dt.day:02d}{dt.hour:02d}{dt.minute:02d}{dt.second:02d}"
    except Exception:
        now = datetime.now()
        return f"{now.year - 1911:03d}{now.month:02d}{now.day:02d}{now.hour:02d}{now.minute:02d}{now.second:02d}"


def write_visit_to_cloud(
    *,
    console_base: str = DEFAULT_CONSOLE_BASE,
    hc_id: str,
    hc_id_no: str,
    treatment_date_time: str | None,
    after_check: str = "1",
    diagnosis_codes: list[str],
    outpatient_fee: int = 0,
    cost_fee: int = 0,
    write_dx: bool = True,
    write_orders: bool = True,
    prescriptions: list[dict[str, Any]] | None = None,
    skip_reason: str | None = None,
) -> CloudWriteResult:
    """Write diagnosis+fee (+ optional Rx) to NHI cloud. Never pretends success."""
    if skip_reason:
        return CloudWriteResult(ok=True, skipped=True, reason=skip_reason)

    if not (hc_id or "").strip() or not (hc_id_no or "").strip():
        return CloudWriteResult(
            ok=False,
            reason=(
                "\u7f3a\u5c11\u5065\u4fdd\u5361\u865f\uff08hcId\uff09\u6216\u8eab\u5206\u8b49\uff08hcIdNo\uff09\uff0c"
                "\u7121\u6cd5\u7c3d\u7ae0\u5beb\u5165\u96f2\u7aef\u3002\u7121\u5361\uff0f\u81ea\u8cbb\u8acb\u53d6\u6d88\u52fe\u9078\u6216\u6539\u8d70\u7576\u5730\u5b58\u6a94\u3002"
            ),
        )

    codes = [_icd(c) for c in diagnosis_codes if _icd(c)]
    if write_dx and not codes:
        return CloudWriteResult(
            ok=False,
            reason="\u5beb\u8a3a\u65b7\u9700\u81f3\u5c11\u4e00\u500b ICD\uff1b\u8acb\u5148\u5728\u8a3a\u7642\u9078\u75c5\u540d\u3002",
        )

    try:
        signed = _sign_hc(console_base=console_base, service_type="02")
    except RuntimeError as exc:
        return CloudWriteResult(ok=False, reason=str(exc))

    dt13 = _roc_datetime13(treatment_date_time)
    main = codes[0] if codes else ""
    subs = (codes[1:] + ["", "", "", "", ""])[:5]

    wrote_codes = False
    wrote_rx = False
    rx_count = 0
    last_raw: dict[str, Any] | None = None

    if write_dx:
        body: dict[str, Any] = {
            "clientRandom": signed.get("clientRandom"),
            "hospitalId": signed.get("hospitalId"),
            "samId": signed.get("samId"),
            "signature": signed.get("signature"),
            "hcId": (hc_id or signed.get("hcId") or "")[:12],
            "hcIdNo": (hc_id_no or signed.get("hcIdNo") or "")[:10],
            "treatmentDateTime": dt13,
            "afterCheck": (after_check or "1")[:1],
            "format": "2",
            "mainCode": main,
            "subCode1": subs[0],
            "subCode2": subs[1],
            "subCode3": subs[2],
            "subCode4": subs[3],
            "subCode5": subs[4],
            "outpatientFee": int(outpatient_fee or 0),
            "inpatientFee": 0,
            "inpatient30Fee": 0,
            "inpatient180Fee": 0,
            "costFee": int(cost_fee or 0),
        }
        try:
            http_status, data = _call_business("/v1/Treatment/WriteCodeFee", body, timeout_sec=35.0)
        except RuntimeError as exc:
            return CloudWriteResult(ok=False, reason=str(exc))
        if not isinstance(data, dict):
            return CloudWriteResult(
                ok=False,
                reason=f"\u696d\u52d9\u7aef WriteCodeFee \u56de\u50b3\u4e0d\u662f JSON\uff08HTTP {http_status}\uff09\u3002",
            )
        last_raw = data
        code = data.get("statusCode")
        if code not in (None, 0):
            return CloudWriteResult(
                ok=False,
                statusCode=int(code) if code is not None else None,
                reason=f"WriteCodeFee \u5931\u6557\uff1a{status_hint(int(code))}",
                raw=data,
            )
        wrote_codes = True

    if write_orders and prescriptions:
        # re-sign for second call
        try:
            signed2 = _sign_hc(console_base=console_base, service_type="02")
        except RuntimeError as exc:
            return CloudWriteResult(
                ok=False,
                wroteCodes=wrote_codes,
                reason=f"\u8a3a\u65b7\u5df2\u5beb\u5165\uff0c\u8655\u65b9\u7c3d\u7ae0\u5931\u6557\uff1a{exc}",
                raw=last_raw,
            )
        rx_body: dict[str, Any] = {
            "clientRandom": signed2.get("clientRandom"),
            "hospitalId": signed2.get("hospitalId"),
            "samId": signed2.get("samId"),
            "signature": signed2.get("signature"),
            "hcId": (hc_id or signed2.get("hcId") or "")[:12],
            "hcIdNo": (hc_id_no or signed2.get("hcIdNo") or "")[:10],
            "treatmentDateTime": dt13,
            "prescriptions": prescriptions[:60],
        }
        try:
            http_status, data = _call_business("/v1/Prescription/Write", rx_body, timeout_sec=35.0)
        except RuntimeError as exc:
            return CloudWriteResult(
                ok=False,
                wroteCodes=wrote_codes,
                reason=f"\u8a3a\u65b7\u5df2\u5beb\u5165\uff0c\u8655\u65b9\u5beb\u5165\u5931\u6557\uff1a{exc}",
                raw=last_raw,
            )
        if not isinstance(data, dict):
            return CloudWriteResult(
                ok=False,
                wroteCodes=wrote_codes,
                reason=f"\u696d\u52d9\u7aef Prescription/Write \u56de\u50b3\u4e0d\u662f JSON\uff08HTTP {http_status}\uff09\u3002",
                raw=last_raw,
            )
        last_raw = data
        code = data.get("statusCode")
        if code not in (None, 0):
            return CloudWriteResult(
                ok=False,
                wroteCodes=wrote_codes,
                statusCode=int(code) if code is not None else None,
                reason=f"Prescription/Write \u5931\u6557\uff1a{status_hint(int(code))}",
                raw=data,
            )
        wrote_rx = True
        rx_count = len(prescriptions[:60])

    if not write_dx and not (write_orders and prescriptions):
        return CloudWriteResult(
            ok=True,
            skipped=True,
            reason="\u672a\u52fe\u9078\u5beb\u8a3a\u65b7\uff0f\u91ab\u4ee4\uff0c\u7565\u904e\u96f2\u7aef\u5beb\u5165\u3002",
        )

    parts = []
    if wrote_codes:
        parts.append("WriteCodeFee")
    if wrote_rx:
        parts.append(f"Prescription/Write x{rx_count}")
    return CloudWriteResult(
        ok=True,
        wroteCodes=wrote_codes,
        wrotePrescriptions=wrote_rx,
        prescriptionCount=rx_count,
        reason="\u96f2\u7aef\u5beb\u5165\u6210\u529f\uff1a" + "+".join(parts),
        raw=last_raw,
    )


def query_recent_treatments(
    *,
    console_base: str = DEFAULT_CONSOLE_BASE,
) -> CloudTreatQueryResult:
    """Read recent visits from cloud (Treatment/NoNeedHPC). Needs patient HC + SAM."""
    try:
        signed = _sign_hc(console_base=console_base, service_type="01")
    except RuntimeError as exc:
        return CloudTreatQueryResult(ok=False, reason=str(exc))

    body = {
        "clientRandom": signed.get("clientRandom"),
        "hospitalId": signed.get("hospitalId"),
        "samId": signed.get("samId"),
        "signature": signed.get("signature"),
        "hcId": str(signed.get("hcId") or "")[:12],
        "hcIdNo": str(signed.get("hcIdNo") or "")[:10],
    }
    try:
        http_status, data = _call_business("/v1/Treatment/NoNeedHPC", body, timeout_sec=28.0)
    except RuntimeError as exc:
        return CloudTreatQueryResult(ok=False, reason=str(exc))
    if not isinstance(data, dict):
        return CloudTreatQueryResult(
            ok=False,
            reason=f"\u696d\u52d9\u7aef NoNeedHPC \u56de\u50b3\u4e0d\u662f JSON\uff08HTTP {http_status}\uff09\u3002",
        )
    code = data.get("statusCode")
    if code not in (None, 0):
        return CloudTreatQueryResult(
            ok=False,
            statusCode=int(code) if code is not None else None,
            reason=f"NoNeedHPC \u5931\u6557\uff1a{status_hint(int(code))}",
            raw=data,
        )
    hits: list[CloudTreatHit] = []
    for row in data.get("treatments") or []:
        if not isinstance(row, dict):
            continue
        hits.append(
            CloudTreatHit(
                treatDateTime=str(row.get("treatDateTime") or ""),
                hospitalId=str(row.get("hospitalId") or ""),
                hospitalVisit=str(row.get("hospitalVisit") or "").strip(),
                treatmentItem=str(row.get("treatmentItem") or ""),
                afterCheck=str(row.get("afterCheck") or ""),
                outpatientFee=row.get("outpatientFee") if row.get("outpatientFee") is not None else None,
            )
        )
    return CloudTreatQueryResult(ok=True, treatments=hits, statusCode=0, raw=data)


def build_prescription_items(
    meds: list[dict[str, Any]],
    *,
    treatment_date_time: str,
) -> list[dict[str, Any]]:
    """Build Prescription/Write prescriptions[] from clinic Rx-like dicts."""
    dt13 = _roc_datetime13(treatment_date_time)
    out: list[dict[str, Any]] = []
    for m in meds:
        code = str(m.get("nhiCode") or m.get("treatmentItemCode") or "").strip()
        if not code:
            continue
        days = str(int(m.get("days") or m.get("daysSupply") or 1))
        qty = m.get("quantity")
        if qty is None:
            qty = m.get("qty")
        try:
            qf = float(qty if qty is not None else 1)
            qty_s = f"{qf:.2f}".rstrip("0").rstrip(".") if abs(qf - round(qf)) > 1e-9 else str(int(round(qf)))
        except Exception:
            qty_s = "1"
        usage = str(m.get("usage") or m.get("sig") or "QD")[:18]
        out.append(
            {
                "days": days[:2],
                "deliveryNotes": str(m.get("deliveryNotes") or "")[:2],
                "totalQuantity": qty_s[:7],
                "treatmentDateTime": dt13,
                "treatmentItem": str(m.get("treatmentItem") or "1")[:1],
                "treatmentItemCode": code[:12],
                "treatmentPosition": str(m.get("treatmentPosition") or "A")[:6],
                "usage": usage,
            }
        )
    return out
