"""The clinic as an Organization; every Encounter points at it."""

from __future__ import annotations

from typing import Any

from src.core.fhir_urls import ID_NHI_ORG


def clinic_code(profile: Any) -> str:
    if not isinstance(profile, dict):
        return ""
    inner = profile.get("profile") if isinstance(profile.get("profile"), dict) else {}
    return str(inner.get("clinicCode") or profile.get("clinicCode") or "").strip()


def resource_id(code: str) -> str:
    return "org-" + code


def organization_for(profile: Any) -> dict[str, Any] | None:
    code = clinic_code(profile)
    if not code:
        return None
    inner = profile.get("profile") if isinstance(profile.get("profile"), dict) else {}
    out: dict[str, Any] = {
        "resourceType": "Organization",
        "id": resource_id(code),
        "active": True,
        "identifier": [{"system": ID_NHI_ORG, "value": code}],
    }
    name = str(inner.get("clinicName") or inner.get("name") or "").strip()
    if name:
        out["name"] = name
    phone = str(inner.get("phone") or inner.get("tel") or "").strip()
    if phone:
        out["telecom"] = [{"system": "phone", "value": phone}]
    address = str(inner.get("address") or "").strip()
    if address:
        out["address"] = [{"text": address}]
    return out


def put_service_provider(payload: dict[str, Any], code: str) -> bool:
    """Set Encounter.serviceProvider when the clinic code is known and it is missing."""
    if not code or payload.get("serviceProvider"):
        return False
    payload["serviceProvider"] = {"reference": "Organization/" + resource_id(code)}
    return True
