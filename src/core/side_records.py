"""Desk tables kept as FHIR resources; the tables are derived from them.

Each row is one resource: the standard skeleton (subject, encounter, date,
status) plus one extension holding every table column as stored. FHIR has no
empty values, so NULL and '' are both left out; the table puts '' back in TEXT
columns and NULL in the others (no desk TEXT column holds NULL). A row that
the desk removes stays in FHIR with sub-extension "retired" and drops out of
the table. Columns listed in EXCLUDED never enter FHIR (staff PIN).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any, Callable

from src.core.fhir_urls import ID_TW_NATIONAL, POLARIS_BASE

_SD = POLARIS_BASE + "/StructureDefinition"


@dataclass(frozen=True)
class Spec:
    table: str
    rtype: str
    key: str
    url: str
    skeleton: Callable[[dict[str, Any], "Links"], dict[str, Any]]


@dataclass
class Links:
    """Patient / visit ids resolved by the store for the skeleton."""

    patient_id: str | None = None
    encounter_id: str | None = None


def _ref(kind: str, rid: str | None) -> dict[str, str] | None:
    return {"reference": f"{kind}/{rid}"} if rid else None


def _put(out: dict[str, Any], key: str, value: Any) -> None:
    if value not in (None, "", {}, []):
        out[key] = value


def _date(*values: Any) -> str | None:
    for v in values:
        text = str(v or "").strip()
        if len(text) >= 10 and text[4] == "-" and text[7] == "-":
            return text[:10]
    return None


def _certificate(row: dict[str, Any], links: Links) -> dict[str, Any]:
    out: dict[str, Any] = {
        "status": "current",
        "type": {"text": "visit certificate"},
    }
    _put(out, "subject", _ref("Patient", links.patient_id))
    _put(out, "date", _date(row.get("print_date"), row.get("visit_date")))
    if links.encounter_id:
        out["context"] = {"encounter": [_ref("Encounter", links.encounter_id)]}
    return out


def _referral(row: dict[str, Any], links: Links) -> dict[str, Any]:
    out: dict[str, Any] = {
        "status": "active",
        "intent": "order" if row.get("kind") == "out" else "reflex-order",
        "code": {"text": "referral"},
    }
    _put(out, "subject", _ref("Patient", links.patient_id) or {"display": "unknown"})
    _put(out, "encounter", _ref("Encounter", links.encounter_id))
    _put(out, "authoredOn", _date(row.get("opened_on")))
    return out


def _lab(row: dict[str, Any], links: Links) -> dict[str, Any]:
    out: dict[str, Any] = {"status": "final", "code": {"text": str(row.get("order_name") or "lab report")}}
    _put(out, "subject", _ref("Patient", links.patient_id))
    _put(out, "encounter", _ref("Encounter", links.encounter_id))
    _put(out, "effectiveDateTime", _date(row.get("report_on")))
    return out


def _look(row: dict[str, Any], links: Links) -> dict[str, Any]:
    out: dict[str, Any] = {
        "status": "completed",
        "content": {"url": "look/" + str(row.get("rel") or ""), "title": str(row.get("file_name") or "")},
    }
    _put(out, "subject", _ref("Patient", links.patient_id))
    _put(out, "createdDateTime", _date(row.get("modified")))
    return out


def _staff(row: dict[str, Any], links: Links) -> dict[str, Any]:
    out: dict[str, Any] = {"active": str(row.get("status") or "") != "\u96e2\u8077"}
    _put(out, "name", [{"text": str(row.get("name") or "")}] if row.get("name") else None)
    if row.get("nhi_id"):
        out["identifier"] = [{"system": ID_TW_NATIONAL, "value": str(row["nhi_id"])}]
    return out


SPECS: dict[str, Spec] = {
    s.table: s
    for s in (
        Spec("visit_certificate", "DocumentReference", "id", _SD + "/visit-certificate", _certificate),
        Spec("referral_slip", "ServiceRequest", "id", _SD + "/referral-slip", _referral),
        Spec("quality_lab_report", "DiagnosticReport", "id", _SD + "/quality-lab-report", _lab),
        Spec("look_file", "Media", "rel", _SD + "/look-file", _look),
        Spec("clinic_staff", "Practitioner", "id", _SD + "/clinic-staff", _staff),
    )
}
_BY_URL = {s.url: s for s in SPECS.values()}
EXCLUDED = {"clinic_staff": {"pin"}}
RETIRED = "retired"


def resource_id(table: str, key: Any) -> str:
    return f"{SPECS[table].rtype.lower()[:4]}-" + hashlib.sha1(f"{table}|{key}".encode("utf-8")).hexdigest()[:24]


def to_resource(table: str, row: dict[str, Any], links: Links | None = None, *, retired: bool = False) -> dict[str, Any]:
    spec = SPECS[table]
    links = links or Links()
    subs: list[dict[str, Any]] = []
    for col, value in row.items():
        if col in EXCLUDED.get(table, ()) or value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            subs.append({"url": col, "valueString": str(value)})
        elif isinstance(value, int):
            subs.append({"url": col, "valueInteger": value})
        else:
            subs.append({"url": col, "valueDecimal": value})
    if retired:
        subs.append({"url": RETIRED, "valueBoolean": True})
    payload: dict[str, Any] = {"resourceType": spec.rtype, "id": resource_id(table, row[spec.key])}
    payload.update(spec.skeleton(row, links))
    if retired:
        if spec.rtype == "Practitioner":
            payload["active"] = False
        else:
            payload["status"] = "entered-in-error"
    payload["extension"] = [{"url": spec.url, "extension": subs}]
    return payload


def from_resource(payload: dict[str, Any] | None) -> tuple[Spec, dict[str, Any], bool] | None:
    """(spec, row, retired) or None when the resource is not a desk row."""
    if not isinstance(payload, dict):
        return None
    for ext in payload.get("extension") or []:
        spec = _BY_URL.get(ext.get("url")) if isinstance(ext, dict) else None
        if spec is None or spec.rtype != payload.get("resourceType"):
            continue
        row: dict[str, Any] = {}
        retired = False
        for sub in ext.get("extension") or []:
            if not isinstance(sub, dict) or not sub.get("url"):
                continue
            if sub["url"] == RETIRED:
                retired = bool(sub.get("valueBoolean"))
                continue
            for k in ("valueString", "valueInteger", "valueDecimal"):
                if k in sub:
                    row[str(sub["url"])] = sub[k]
                    break
        return spec, row, retired
    return None
