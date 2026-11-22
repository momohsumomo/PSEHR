"""Cash refund (return slip) as a FHIR Basic resource.

The cash_return table is derived from these. Fields are kept as booked: an
imported refund keeps its own day and codes, so the cash book of that day
does not move when the patient record is edited later.
"""

from __future__ import annotations

import hashlib
from typing import Any

from src.core.fhir_urls import BASIC_KIND, CASH_RETURN

KIND = "cash-return"

# (cash_return column, sub-extension key)
TEXT_FIELDS = (
    ("keywords", "keywords"),
    ("copay_code", "copayCode"),
    ("chart_no", "chartNo"),
    ("patient_name", "patientName"),
    ("id_no", "idNo"),
    ("seg", "seg"),
    ("treat_seq", "treatSeq"),
    ("case_no", "caseNo"),
)


def resource_id_for(keywords: str) -> str:
    return "cr-" + hashlib.sha1(keywords.encode("utf-8")).hexdigest()[:24]


def is_cash_return(payload: dict[str, Any] | None) -> bool:
    if not isinstance(payload, dict) or payload.get("resourceType") != "Basic":
        return False
    for coding in (payload.get("code") or {}).get("coding") or []:
        if isinstance(coding, dict) and coding.get("system") == BASIC_KIND and coding.get("code") == KIND:
            return True
    return False


def to_basic(
    row: dict[str, Any],
    *,
    patient_id: str | None = None,
    encounter_id: str | None = None,
) -> dict[str, Any]:
    """One refund row (cash_return columns) as a Basic resource."""
    keywords = str(row.get("keywords") or "").strip()
    subs: list[dict[str, Any]] = [
        {"url": "date", "valueDate": str(row.get("encounter_date") or "")[:10]},
        {"url": "amount", "valueInteger": int(row.get("amount") or 0)},
    ]
    for column, key in TEXT_FIELDS:
        value = row.get(column)
        if value is not None:
            subs.append({"url": key, "valueString": str(value)})
    if encounter_id:
        subs.append({"url": "encounter", "valueReference": {"reference": f"Encounter/{encounter_id}"}})
    out: dict[str, Any] = {
        "resourceType": "Basic",
        "id": resource_id_for(keywords),
        "code": {"coding": [{"system": BASIC_KIND, "code": KIND}]},
        "extension": [{"url": CASH_RETURN, "extension": subs}],
    }
    if patient_id:
        out["subject"] = {"reference": f"Patient/{patient_id}"}
    return out


def from_basic(payload: dict[str, Any]) -> dict[str, Any] | None:
    """cash_return columns; a key not stored is None."""
    if not is_cash_return(payload):
        return None
    subs: dict[str, dict[str, Any]] = {}
    for ext in payload.get("extension") or []:
        if isinstance(ext, dict) and ext.get("url") == CASH_RETURN:
            for sub in ext.get("extension") or []:
                if isinstance(sub, dict) and sub.get("url"):
                    subs[str(sub["url"])] = sub
    row: dict[str, Any] = {
        "encounter_date": (subs.get("date") or {}).get("valueDate") or "",
        "amount": int((subs.get("amount") or {}).get("valueInteger") or 0),
    }
    for column, key in TEXT_FIELDS:
        row[column] = (subs.get(key) or {}).get("valueString")
    return row
