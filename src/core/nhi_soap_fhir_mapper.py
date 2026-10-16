"""健保門診 SOAP → FHIR Composition + Encounter 主訴同步。"""

from __future__ import annotations

import html
from datetime import datetime, timezone
from typing import Any

from src.core.nhi_soap_validators import NhiSoapIntake

NHI_SOAP_EXTENSION_URL = "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/outpatient-soap"
LOINC_CONSULT_NOTE = "11488-4"


def _text_div(content: str) -> dict[str, Any]:
    safe = html.escape(content).replace("\n", "<br/>")
    return {"status": "generated", "div": f"<div xmlns='http://www.w3.org/1999/xhtml'>{safe}</div>"}


def _section(title: str, loinc: str, display: str, body: str) -> dict[str, Any]:
    return {
        "title": title,
        "code": {
            "coding": [{"system": "http://loinc.org", "code": loinc, "display": display}],
            "text": title,
        },
        "text": _text_div(body),
    }


def nhi_soap_to_fhir_composition(
    intake: NhiSoapIntake,
    *,
    patient_id: str,
    encounter_id: str,
) -> dict[str, Any]:
    """產生 FHIR Composition（SOAP 門診紀錄）。"""
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    subjective_body = intake.chiefComplaint
    if intake.subjective:
        subjective_body = f"{intake.chiefComplaint}\n\n{intake.subjective}"

    sections: list[dict[str, Any]] = [
        _section("Chief Complaint", "10154-3", "Chief complaint", intake.chiefComplaint),
        _section("Subjective", "61150-9", "Subjective", subjective_body),
    ]
    if intake.objective:
        sections.append(_section("Objective", "61149-1", "Objective", intake.objective))
    sections.append(_section("Assessment", "51848-0", "Assessment", intake.assessment))
    sections.append(_section("Plan", "18776-5", "Plan", intake.plan))

    payload: dict[str, Any] = {
        "resourceType": "Composition",
        "status": "final",
        "type": {
            "coding": [
                {
                    "system": "http://loinc.org",
                    "code": LOINC_CONSULT_NOTE,
                    "display": "Consult note",
                }
            ],
            "text": "門診 SOAP",
        },
        "subject": {"reference": f"Patient/{patient_id}"},
        "encounter": {"reference": f"Encounter/{encounter_id}"},
        "date": now,
        "title": "Outpatient SOAP Note",
        "section": sections,
        "extension": [
            {
                "url": NHI_SOAP_EXTENSION_URL,
                "extension": [
                    {"url": "encounterId", "valueString": encounter_id},
                    {"url": "chiefComplaint", "valueString": intake.chiefComplaint},
                    {"url": "subjective", "valueString": intake.subjective or ""},
                    {"url": "objective", "valueString": intake.objective or ""},
                    {"url": "assessment", "valueString": intake.assessment},
                    {"url": "plan", "valueString": intake.plan},
                ],
            }
        ],
    }
    if intake.authorIdNo:
        payload["author"] = [
            {
                "identifier": {
                    "system": "http://www.moi.gov.tw/id",
                    "value": intake.authorIdNo,
                }
            }
        ]
    return payload


def encounter_reason_patch(chief_complaint: str) -> dict[str, Any]:
    """同步 Encounter.reasonCode（主訴摘要）。"""
    return {"reasonCode": [{"text": chief_complaint}]}


def extract_soap_stickers_from_composition(comp: dict[str, Any]) -> dict[str, str | None]:
    result: dict[str, str | None] = {
        "encounterId": None,
        "chiefComplaint": None,
        "subjective": None,
        "objective": None,
        "assessment": None,
        "plan": None,
    }
    enc = comp.get("encounter") or {}
    if isinstance(enc, dict) and enc.get("reference"):
        result["encounterId"] = str(enc["reference"]).split("/")[-1]
    for ext in comp.get("extension") or []:
        if ext.get("url") != NHI_SOAP_EXTENSION_URL:
            continue
        for sub in ext.get("extension") or []:
            url = sub.get("url")
            if url in result:
                val = sub.get("valueString")
                result[url] = val if val else None
    return result


def preview_text(value: str | None, limit: int = 120) -> str | None:
    if not value:
        return None
    text = value.strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"
