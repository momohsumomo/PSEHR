"""Shape every stored resource so it passes FHIR R4 and TW Core 1.0.0 (format final-2).

The store runs normalize() on each save after its carry-over rules, and
scripts/fhir_convert.py (step twcore) runs it on what is already on disk, so a
live save and a converted record come out the same.

What it changes, never the meaning:
- '' / null / [] / {} are left out (R4 forbids empty values). An extension left
  with only its url goes too. Readers already treat a missing value as blank;
  desk tables refill blank columns from their defaults.
- Encounter.class is a Coding (v3-ActCode AMB). No display, so the visit list
  still falls back to its own label.
- Condition gets category encounter-diagnosis and, unless entered-in-error,
  clinicalStatus active when it had none; status codings get their system.
  TW ICD-10-CM codes carry the dot (L72.0); the index reads them back without it.
- AllergyIntolerance, like Condition, gets clinicalStatus active unless entered-in-error.
- Composition without an author gets the one converted notes carry.
- Order line codes sit under the system their shape belongs to (fhir_urls.item_system);
  a line with no code at all says so with data-absent-reason. On TW Core systems the
  clinic's display moves to text (kept if text was already there).
- Chart-number identifiers drop use other than official; exact duplicates go.
- DocumentReference.date is an instant and content carries an attachment.
"""

from __future__ import annotations

import json
from typing import Any

from src.core import fhir_urls

ACT_CODE = "http://terminology.hl7.org/CodeSystem/v3-ActCode"
CONDITION_CATEGORY = "http://terminology.hl7.org/CodeSystem/condition-category"
DATA_ABSENT = "http://hl7.org/fhir/StructureDefinition/data-absent-reason"
_STATUS_SYSTEMS = {
    ("Condition", "clinicalStatus"): "http://terminology.hl7.org/CodeSystem/condition-clinical",
    ("Condition", "verificationStatus"): "http://terminology.hl7.org/CodeSystem/condition-ver-status",
    ("AllergyIntolerance", "clinicalStatus"): "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
    ("AllergyIntolerance", "verificationStatus"): "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
}
_ITEM_FAMILY = {*fhir_urls.ITEM_SYSTEMS, *fhir_urls.LEGACY_ALIASES.get(fhir_urls.CODE_NHI_MEDICATION, ())}
_GONE = object()


def _prune(node: Any, in_extension: bool = False) -> Any:
    if isinstance(node, dict):
        out: dict[str, Any] = {}
        for key, value in node.items():
            kept = _prune(value, key in ("extension", "modifierExtension"))
            if kept is not _GONE:
                out[key] = kept
        if in_extension and set(out) <= {"url", "id"}:
            return _GONE
        return out if out else _GONE
    if isinstance(node, list):
        items = [x for x in (_prune(v, in_extension) for v in node) if x is not _GONE]
        return items if items else _GONE
    if node is None or node == "":
        return _GONE
    return node


def _encounter(payload: dict[str, Any]) -> None:
    cls = payload.get("class")
    if isinstance(cls, dict) and cls.get("code") and set(cls) <= {"system", "code"}:
        if cls.get("system") != ACT_CODE and cls.get("code") == "AMB":
            cls["system"] = ACT_CODE
        return
    payload["class"] = {"system": ACT_CODE, "code": "AMB"}


def _statuses(rtype: str, payload: dict[str, Any]) -> None:
    for (kind, key), system in _STATUS_SYSTEMS.items():
        if kind != rtype:
            continue
        concept = payload.get(key)
        if not isinstance(concept, dict):
            continue
        for coding in concept.get("coding") or []:
            if isinstance(coding, dict) and coding.get("code") and not coding.get("system"):
                coding["system"] = system


def _condition(payload: dict[str, Any]) -> None:
    from src.core.condition_status import CLINICAL, ENTERED_IN_ERROR, index_status

    if not payload.get("category"):
        payload["category"] = [{"coding": [{"system": CONDITION_CATEGORY, "code": "encounter-diagnosis"}]}]
    for coding in (payload.get("code") or {}).get("coding") or []:
        if isinstance(coding, dict) and coding.get("system") == fhir_urls.CODE_TW_ICD10CM and coding.get("code"):
            coding["code"] = fhir_urls.icd10cm_code(coding["code"])
    # The index already reads a missing status as active (con-5 keeps it off entered-in-error).
    if not payload.get("clinicalStatus") and index_status(payload) != ENTERED_IN_ERROR:
        payload["clinicalStatus"] = {"coding": [{"system": CLINICAL, "code": "active"}]}


def _allergy(payload: dict[str, Any]) -> None:
    verification = [c.get("code") for c in (payload.get("verificationStatus") or {}).get("coding") or []
                    if isinstance(c, dict)]
    if not payload.get("clinicalStatus") and "entered-in-error" not in verification:
        payload["clinicalStatus"] = {"coding": [{
            "system": _STATUS_SYSTEMS[("AllergyIntolerance", "clinicalStatus")], "code": "active"}]}


def _composition(payload: dict[str, Any]) -> None:
    if not payload.get("author"):
        payload["author"] = [{"display": "Polaris SEHR"}]


def _medication(payload: dict[str, Any]) -> None:
    concept = payload.get("medicationCodeableConcept")
    if not concept and not payload.get("medicationReference"):
        payload["medicationCodeableConcept"] = {"extension": [{"url": DATA_ABSENT, "valueCode": "unknown"}]}
        return
    if not isinstance(concept, dict):
        return
    seen: set[tuple[str, str]] = set()
    kept: list[Any] = []
    for coding in concept.get("coding") or []:
        if isinstance(coding, dict) and coding.get("system") in _ITEM_FAMILY and coding.get("code"):
            coding["system"] = fhir_urls.item_system(coding["code"])
            # TW Core code systems own their display; the clinic's own name lives in text.
            if coding["system"].startswith(fhir_urls.TWCORE_CODESYSTEM) and coding.get("display"):
                if not concept.get("text"):
                    concept["text"] = coding["display"]
                coding.pop("display")
        if isinstance(coding, dict):
            key = (str(coding.get("system") or ""), str(coding.get("code") or ""))
            if key in seen:
                continue
            seen.add(key)
        kept.append(coding)
    concept["coding"] = kept


def _patient(payload: dict[str, Any]) -> None:
    seen: set[tuple[str, str]] = set()
    kept: list[Any] = []
    for ident in payload.get("identifier") or []:
        if not isinstance(ident, dict):
            kept.append(ident)
            continue
        if not str(ident.get("value") or "").strip():
            continue
        if fhir_urls.is_chart_number_system(ident.get("system")) and ident.get("use") not in (None, "official"):
            ident.pop("use")
        key = (str(ident.get("system") or ""), str(ident.get("value") or ""))
        if key in seen:
            continue
        seen.add(key)
        kept.append(ident)
    if "identifier" in payload:
        payload["identifier"] = kept


def _document(payload: dict[str, Any]) -> None:
    date = str(payload.get("date") or "")
    if len(date) == 10:
        payload["date"] = date + "T00:00:00+08:00"
    if not payload.get("content"):
        title = str((payload.get("type") or {}).get("text") or "document")
        payload["content"] = [{"attachment": {"title": title}}]


_BY_TYPE = {
    "Encounter": _encounter,
    "Condition": _condition,
    "AllergyIntolerance": _allergy,
    "Composition": _composition,
    "MedicationRequest": _medication,
    "Patient": _patient,
    "DocumentReference": _document,
}


def normalize(rtype: str, payload: dict[str, Any]) -> bool:
    """Reshape payload in place; True when anything changed."""
    before = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    pruned = _prune(payload)
    payload.clear()
    if pruned is not _GONE:
        payload.update(pruned)
    _statuses(rtype, payload)
    step = _BY_TYPE.get(rtype)
    if step:
        step(payload)
    pruned = _prune(payload)
    payload.clear()
    if pruned is not _GONE:
        payload.update(pruned)
    return json.dumps(payload, sort_keys=True, ensure_ascii=False) != before
