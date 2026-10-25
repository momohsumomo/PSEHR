# -*- coding: utf-8 -*-
"""Deposit refund: makeup-card sequence, cash back, upload with the refund day.

The bureau call is a makeup read (afterCheck 2). The monthly visit date stays
the original encounter day. This module does not invent a second treatment id,
and does not convert an overdue deposit to self-pay.
"""

from __future__ import annotations

import json
from datetime import date
from typing import Any

from src.core.encounter_extensions import attach_reg_extension, extract_reg_meta

_NOT_DEPOSIT = "\u9019\u7b46\u4e0d\u662f\u9084\u6c92\u9000\u7684\u62bc\u55ae\u3002"
_HAS_SEQ = "\u9019\u7b46\u5df2\u7d93\u6709\u5c31\u91ab\u5e8f\u865f\uff0c\u4e0d\u7528\u518d\u9000\u62bc\u3002"
_NO_AMOUNT = "\u9019\u7b46\u6c92\u6709\u62bc\u91d1\u91d1\u984d\u3002"
_FUTURE = "\u770b\u8a3a\u65e5\u9084\u5728\u4eca\u5929\u4e4b\u5f8c\uff0c\u4e0d\u80fd\u9000\u62bc\u3002"
_NO_SEQ = "\u6c92\u6709\u53d6\u5230\u5c31\u91ab\u5e8f\u865f\uff0c\u6c92\u6709\u9000\u62bc\u3002"
_CARD_MISMATCH = "\u63d2\u5361\u8eab\u5206\u8b49\u8207\u9019\u7b46\u62bc\u55ae\u4e0d\u7b26\uff0c\u672a\u53d6\u865f\u3001\u672a\u9000\u62bc\u3002"
_DONE = "\u5df2\u9000\u62bc\u3002\u73fe\u91d1\u9000\u56de\uff0c\u9019\u7b46\u8ddf\u4eca\u5929\u7684\u6bcf\u65e5\u4e0a\u50b3\u4e00\u8d77\u9001\u3002"


def refundable_visit(visit_iso: str, today: date) -> bool:
    """Open until that month's claim file goes out. No 7-day cap."""
    raw = (visit_iso or "")[:10]
    try:
        visit = date.fromisoformat(raw)
    except ValueError:
        return False
    return visit <= today


def list_open_deposits(store: Any, id_no: str, today: date | None = None) -> list[dict[str, Any]]:
    """Unrefunded deposits for this id within the window. No sequence yet."""
    key = (id_no or "").strip().upper()
    if len(key) != 10:
        return []
    day = today or date.today()
    end = day.isoformat()
    with store._connect() as conn:
        rows = conn.execute(
            """
            SELECT ei.resource_id, ei.encounter_date, ei.queue_number, ei.fee_deposit,
                   ei.queue_status, pi.family_name, pi.given_name, pi.medical_no,
                   rc.payload_json
            FROM encounter_index ei
            JOIN patient_index pi ON pi.resource_id = ei.patient_id
            JOIN resource_cache rc
              ON rc.resource_type = 'Encounter' AND rc.resource_id = ei.resource_id
            WHERE upper(pi.id_no) = ?
              AND ei.encounter_date <= ?
              AND ei.queue_status != 'cancelled'
              AND ei.fee_deposit > 0
            ORDER BY ei.encounter_date DESC, ei.queue_number ASC
            """,
            (key, end),
        ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        try:
            payload = json.loads(row[8]) if isinstance(row[8], str) else row[8]
        except json.JSONDecodeError:
            continue
        reg = extract_reg_meta(payload if isinstance(payload, dict) else {})
        if str(reg.get("treatSeq") or "").strip():
            continue
        mode = str(reg.get("icException") or "deposit")
        if mode != "deposit":
            continue
        if not refundable_visit(str(row[1] or ""), day):
            continue
        name = f"{row[5] or ''}{row[6] or ''}".strip()
        out.append(
            {
                "encounterId": str(row[0]),
                "encounterDate": str(row[1] or "")[:10],
                "queueNumber": int(row[2] or 0),
                "amount": int(row[3] or 0),
                "name": name,
                "chartNo": str(row[7] or ""),
            }
        )
    return out


def prepare_refund(store: Any, encounter_id: str, today: date | None = None) -> dict[str, Any]:
    """Check the visit before anyone talks to the card."""
    day = today or date.today()
    found = _load(store, encounter_id)
    if found is None:
        return {"ok": False, "reason": "\u627e\u4e0d\u5230\u9019\u7b46\u639b\u865f\u3002"}
    reg, visit_day, amount, id_no, name, chart = found
    if str(reg.get("treatSeq") or "").strip():
        return {"ok": False, "reason": _HAS_SEQ}
    if str(reg.get("icException") or "deposit") != "deposit":
        return {"ok": False, "reason": _NOT_DEPOSIT}
    if amount <= 0:
        return {"ok": False, "reason": _NO_AMOUNT}
    if not refundable_visit(visit_day, day):
        return {"ok": False, "reason": _FUTURE}
    return {
        "ok": True,
        "encounterId": encounter_id,
        "idNo": id_no,
        "name": name,
        "chartNo": chart,
        "amount": amount,
        "encounterDate": visit_day,
        "caseNo": str(reg.get("caseNo") or ""),
    }


def cash_collected(parts: int, held: int, refunded: int) -> int:
    """Visit total keeps a deposit that was taken.

    The return line, not a smaller total, is what leaves that day's cash.
    A deposit still in the drawer is `held`. After the card refund it is `refunded`.
    """
    held = max(0, int(held))
    refunded = max(0, int(refunded))
    if held > 0:
        return int(parts) + held
    return int(parts) + refunded


def adjusted_visit_total(sent: int, parts: int, held: int, refunded: int) -> int:
    """Refuse a later save that drops a refunded deposit out of the visit total."""
    want = cash_collected(parts, held, refunded)
    if int(refunded) > 0 and int(sent) < want:
        return want
    return int(sent)


def refunded_cash(store: Any, encounter_id: str) -> int:
    key = (encounter_id or "").strip()
    if not key:
        return 0
    with store._connect() as conn:
        row = conn.execute(
            "SELECT amount FROM cash_return WHERE keywords = ?",
            (key,),
        ).fetchone()
    if not row:
        return 0
    try:
        return max(0, int(row[0] or 0))
    except (TypeError, ValueError):
        return 0


def card_matches(expected_id_no: str, card_id_no: str) -> bool:
    exp = (expected_id_no or "").strip().upper()
    got = (card_id_no or "").strip().upper()
    if len(exp) != 10 or len(got) != 10:
        return False
    return exp == got


def apply_refund(
    store: Any,
    repo: Any,
    encounter_id: str,
    *,
    sequence_number: str,
    treatment_number: str,
    treat_date_time: str,
    signature: str,
    sam_id: str,
    hc_id: str,
    hc_id_no: str,
    today: date | None = None,
) -> dict[str, Any]:
    """Write the refund. Caller must already hold a real sequence from the bureau."""
    day = today or date.today()
    seq = (sequence_number or "").strip()
    treat = (treatment_number or "").strip()
    if not seq or not treat:
        return {"ok": False, "reason": _NO_SEQ}
    prepared = prepare_refund(store, encounter_id, day)
    if not prepared.get("ok"):
        return prepared
    if not card_matches(str(prepared.get("idNo") or ""), hc_id_no):
        return {"ok": False, "reason": _CARD_MISMATCH}
    existing = repo.read_resource("Encounter", encounter_id)
    if existing is None:
        return {"ok": False, "reason": "\u627e\u4e0d\u5230\u9019\u7b46\u639b\u865f\u3002"}
    upload_day = day.isoformat()
    previous = extract_reg_meta(dict(existing))
    old_treat = str(previous.get("treatmentNumber") or "").strip()
    old_when = "".join(ch for ch in str(previous.get("treatDateTime") or "") if ch.isdigit())
    card_again = bool(old_treat and old_treat != (treat or "").strip())
    payload = attach_reg_extension(
        dict(existing),
        {
            "icException": "ic",
            "afterCheck": "2",
            "treatSeq": seq,
            "treatmentNumber": treat,
            "treatDateTime": (treat_date_time or "").strip(),
            "icRemark": "2",
            "actualTreatId": old_treat if card_again else None,
            "actualTreatWhen": old_when[:13] if card_again and len(old_when) >= 13 else None,
            "securitySign": (signature or "").strip(),
            "samId": (sam_id or "").strip(),
            "hcId": (hc_id or "").strip(),
            "hcIdNo": (hc_id_no or "").strip().upper(),
            "deposit": "0",
            "depositPaid": str(int(prepared["amount"])),
            "icUploadDate": upload_day,
            "cardWritten": True,
        },
    )
    repo.update_resource("Encounter", encounter_id, payload)
    amount = int(prepared["amount"])
    store.insert_cash_return(
        encounter_date=upload_day,
        amount=amount,
        keywords=encounter_id,
        chart_no=str(prepared.get("chartNo") or ""),
        patient_name=str(prepared.get("name") or ""),
        id_no=str(prepared.get("idNo") or ""),
        treat_seq=seq,
        case_no=str(prepared.get("caseNo") or ""),
    )
    return {
        "ok": True,
        "encounterId": encounter_id,
        "amount": amount,
        "sequenceNumber": seq,
        "uploadDate": upload_day,
        "reason": _DONE,
    }


def _load(
    store: Any, encounter_id: str
) -> tuple[dict[str, Any], str, int, str, str, str] | None:
    with store._connect() as conn:
        row = conn.execute(
            """
            SELECT ei.encounter_date, ei.fee_deposit, rc.payload_json,
                   pi.id_no, pi.family_name, pi.given_name, pi.medical_no
            FROM encounter_index ei
            JOIN resource_cache rc
              ON rc.resource_type = 'Encounter' AND rc.resource_id = ei.resource_id
            LEFT JOIN patient_index pi ON pi.resource_id = ei.patient_id
            WHERE ei.resource_id = ?
            """,
            (encounter_id,),
        ).fetchone()
    if not row:
        return None
    try:
        payload = json.loads(row[2]) if isinstance(row[2], str) else row[2]
    except json.JSONDecodeError:
        payload = {}
    reg = extract_reg_meta(payload if isinstance(payload, dict) else {})
    amount = int(row[1] or 0)
    if amount <= 0:
        try:
            amount = int(float(str(reg.get("deposit") or "0").replace(",", "")))
        except ValueError:
            amount = 0
    name = f"{row[4] or ''}{row[5] or ''}".strip()
    return reg, str(row[0] or "")[:10], amount, str(row[3] or "").upper(), name, str(row[6] or "")
