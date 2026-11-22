"""All custom FHIR extension and identifier/code system URLs used by the app.

Stored JSON uses only the current values. Every save goes through
modernize() in the store, which rewrites the older URLs in RENAMED (and the
chart-number system, which carries the clinic's institution code), so an old
browser tab or tool that still sends an old URL stores the current one.
scripts/fhir_convert.py applies the same rewrite to what is already on disk.
"""

from __future__ import annotations

from typing import Any

POLARIS_BASE = "https://polarissehr.eskincrux.com/fhir"
_SD = POLARIS_BASE + "/StructureDefinition"

# Encounter
ENCOUNTER_BOOK = _SD + "/encounter-book"
ENCOUNTER_QUEUE = _SD + "/encounter-queue"
ENCOUNTER_REG = _SD + "/encounter-reg"
ENCOUNTER_PREVISIT = _SD + "/patient-previsit"

# Basic (records with no closer FHIR type)
BASIC_KIND = POLARIS_BASE + "/CodeSystem/basic-kind"
CASH_RETURN = _SD + "/cash-return"

# Patient
PATIENT_NHI_CARD = _SD + "/nhi-card-basic"
PATIENT_CLINIC = _SD + "/patient-clinic-ext"
PATIENT_FIDO2_KEY = _SD + "/patient-fido2-key"

# MedicationRequest billing sub-extensions are f"{MEDICATION_BILLING}/{key}".
MEDICATION_BILLING = _SD + "/medication-billing"

# Clinical resources
COMPOSITION_SOAP = _SD + "/outpatient-soap"
OBSERVATION_OUTPATIENT = _SD + "/outpatient-observation"
ALLERGY_OUTPATIENT = _SD + "/outpatient-allergy"
MEDIA_LESION = _SD + "/lesion-media"

# Identifier systems (TW Core idCardNumber uses the MOI URL as is)
ID_TW_NATIONAL = "http://www.moi.gov.tw"
ID_NHI_CARD = POLARIS_BASE + "/sid/nhi-card-id"
ID_NHI_ORG = POLARIS_BASE + "/sid/nhi-org-id"
CHART_NUMBER_BASE = POLARIS_BASE + "/sid/medical-record"
# Writers may still send this; the store turns it into chart_number_system().
ID_CHART_NUMBER = "https://clinic.org/chart-number"
ID_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0203"

# Code systems
TWCORE_CODESYSTEM = "https://twcore.mohw.gov.tw/ig/twcore/CodeSystem"
CODE_NHI_MEDICATION = TWCORE_CODESYSTEM + "/medication-nhi-tw"
CODE_TW_ICD10CM = TWCORE_CODESYSTEM + "/icd-10-cm-2023-tw"
CODE_NHI_MEDICATION_OLD = "https://nhidcc.nhi.gov.tw/medication"
CODE_TW_ICD10CM_OLD = "https://nhidcc.nhi.gov.tw/icd10cm"

_OLD_SD_WUNDADI = "https://wundadi.tw/fhir/StructureDefinition"
_OLD_SD_NHIDCC = "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition"

# Exact old value -> current value, for "url" and "system" strings.
RENAMED: dict[str, str] = {
    _OLD_SD_WUNDADI + "/encounter-queue": ENCOUNTER_QUEUE,
    _OLD_SD_WUNDADI + "/encounter-reg": ENCOUNTER_REG,
    _OLD_SD_NHIDCC + "/patient-previsit": ENCOUNTER_PREVISIT,
    _OLD_SD_NHIDCC + "/nhi-card-basic": PATIENT_NHI_CARD,
    "https://clinic.org/fhir/StructureDefinition/patient-clinic-ext": PATIENT_CLINIC,
    _OLD_SD_WUNDADI + "/patient-fido2-key": PATIENT_FIDO2_KEY,
    _OLD_SD_NHIDCC + "/outpatient-soap": COMPOSITION_SOAP,
    _OLD_SD_NHIDCC + "/outpatient-observation": OBSERVATION_OUTPATIENT,
    _OLD_SD_NHIDCC + "/outpatient-allergy": ALLERGY_OUTPATIENT,
    _OLD_SD_NHIDCC + "/lesion-media": MEDIA_LESION,
    "http://www.moi.gov.tw/id": ID_TW_NATIONAL,
    "https://nhidcc.nhi.gov.tw/id": ID_NHI_CARD,
    CODE_NHI_MEDICATION_OLD: CODE_NHI_MEDICATION,
    CODE_TW_ICD10CM_OLD: CODE_TW_ICD10CM,
}

# Old base + "/key" -> MEDICATION_BILLING + "/key".
RENAMED_PREFIX: dict[str, str] = {
    "https://wundadi.local/fhir/StructureDefinition/medication-billing/": MEDICATION_BILLING + "/",
    "https://clinic.org/fhir/StructureDefinition/billing/": MEDICATION_BILLING + "/",
}

# Older values readers still accept, keyed by the current value.
LEGACY_ALIASES: dict[str, tuple[str, ...]] = {}
for _old, _new in RENAMED.items():
    LEGACY_ALIASES[_new] = LEGACY_ALIASES.get(_new, ()) + (_old,)

# Stale copies left by early lean imports. Every such Encounter also has the
# current extension, which was updated later (check-in clears forespeak, edits
# change noteMark), so reading these would bring back outdated values.
# Never read; modernize() drops them.
STALE_DUPLICATES: dict[str, str] = {
    "https://clinic.org/fhir/StructureDefinition/queue": ENCOUNTER_QUEUE,
    "https://clinic.org/fhir/StructureDefinition/reg": ENCOUNTER_REG,
}


def chart_number_system(clinic_code: str) -> str:
    return f"{CHART_NUMBER_BASE}/{clinic_code.strip()}"


def is_chart_number_system(system: str | None) -> bool:
    text = str(system or "")
    return text.startswith(CHART_NUMBER_BASE + "/") or text == ID_CHART_NUMBER


def _new_url(value: str) -> str:
    if value in RENAMED:
        return RENAMED[value]
    for old, new in RENAMED_PREFIX.items():
        if value.startswith(old):
            return new + value[len(old):]
    return value


def modernize(node: Any, chart_system: str | None = None) -> bool:
    """Rewrite old URLs in place. Returns True if anything changed.

    chart_system, when given, replaces the old chart-number system and marks
    that identifier with type MR.
    """
    changed = False
    if isinstance(node, list):
        for item in node:
            changed = modernize(item, chart_system) or changed
        return changed
    if not isinstance(node, dict):
        return False
    exts = node.get("extension")
    if isinstance(exts, list):
        kept = [e for e in exts if not (isinstance(e, dict) and e.get("url") in STALE_DUPLICATES)]
        if len(kept) != len(exts):
            node["extension"] = kept
            changed = True
    for key in ("url", "system"):
        value = node.get(key)
        if isinstance(value, str):
            new = _new_url(value)
            if new != value:
                node[key] = new
                changed = True
    if chart_system and node.get("system") == ID_CHART_NUMBER and "value" in node:
        node["system"] = chart_system
        node.setdefault("type", {"coding": [{"system": ID_TYPE_SYSTEM, "code": "MR"}]})
        changed = True
    for key, value in node.items():
        if isinstance(value, (dict, list)) and key != "valueString":
            changed = modernize(value, chart_system) or changed
    return changed
