"""Condition status as stored in FHIR and as the index column clinical_status.

A diagnosis dropped from a visit is verificationStatus entered-in-error with
no clinicalStatus (FHIR R4 invariant con-5). The index keeps one column:
'entered-in-error' for those, otherwise the clinicalStatus code.
"""

from __future__ import annotations

from typing import Any

CLINICAL = "http://terminology.hl7.org/CodeSystem/condition-clinical"
VERIFICATION = "http://terminology.hl7.org/CodeSystem/condition-ver-status"
ENTERED_IN_ERROR = "entered-in-error"


def _first_code(concept: Any) -> str | None:
    if not isinstance(concept, dict):
        return None
    for coding in concept.get("coding") or []:
        if isinstance(coding, dict) and coding.get("code"):
            return str(coding["code"])
    return None


def index_status(payload: dict[str, Any]) -> str:
    if _first_code(payload.get("verificationStatus")) == ENTERED_IN_ERROR:
        return ENTERED_IN_ERROR
    return _first_code(payload.get("clinicalStatus")) or "active"


def mark_entered_in_error(payload: dict[str, Any]) -> None:
    payload.pop("clinicalStatus", None)
    payload["verificationStatus"] = {"coding": [{"system": VERIFICATION, "code": ENTERED_IN_ERROR}]}


def normalize(payload: dict[str, Any]) -> bool:
    """Old writers put entered-in-error in clinicalStatus. Returns True if changed."""
    if _first_code(payload.get("clinicalStatus")) == ENTERED_IN_ERROR:
        mark_entered_in_error(payload)
        return True
    return False


def put_index_status(payload: dict[str, Any], status: str | None) -> None:
    """Make index_status(payload) return status (None means active)."""
    status = status or "active"
    if status == ENTERED_IN_ERROR:
        mark_entered_in_error(payload)
        return
    if _first_code(payload.get("verificationStatus")) == ENTERED_IN_ERROR:
        payload.pop("verificationStatus", None)
    payload["clinicalStatus"] = {"coding": [{"system": CLINICAL, "code": status}]}
