"""All custom FHIR extension and identifier/code system URLs used by the app.

These strings are stored inside resource_cache JSON. Changing a value here
changes what new writes look like but not what is already on disk; readers
must keep accepting every value listed in LEGACY_ALIASES until the stored data
has been rewritten. See docs/FHIR化-讀寫清單.md.
"""

# Encounter
ENCOUNTER_QUEUE = "https://wundadi.tw/fhir/StructureDefinition/encounter-queue"
ENCOUNTER_REG = "https://wundadi.tw/fhir/StructureDefinition/encounter-reg"
ENCOUNTER_PREVISIT = "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/patient-previsit"

# Patient
PATIENT_NHI_CARD = "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/nhi-card-basic"
PATIENT_CLINIC = "https://clinic.org/fhir/StructureDefinition/patient-clinic-ext"
PATIENT_FIDO2_KEY = "https://wundadi.tw/fhir/StructureDefinition/patient-fido2-key"

# MedicationRequest billing sub-extensions are f"{base}/{key}"; readers match on
# the trailing "/key", so both bases below are in use on disk.
MEDICATION_BILLING = "https://wundadi.local/fhir/StructureDefinition/medication-billing"
MEDICATION_BILLING_SCHEMA = "https://clinic.org/fhir/StructureDefinition/billing"

# Clinical resources
COMPOSITION_SOAP = "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/outpatient-soap"
OBSERVATION_OUTPATIENT = "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/outpatient-observation"
ALLERGY_OUTPATIENT = "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/outpatient-allergy"
MEDIA_LESION = "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/lesion-media"

# Identifier systems
ID_TW_NATIONAL = "http://www.moi.gov.tw/id"
ID_NHI_CARD = "https://nhidcc.nhi.gov.tw/id"
ID_CHART_NUMBER = "https://clinic.org/chart-number"

# Code systems
CODE_NHI_MEDICATION = "https://nhidcc.nhi.gov.tw/medication"
CODE_TW_ICD10CM = "https://nhidcc.nhi.gov.tw/icd10cm"

# Older URLs still present in stored JSON, keyed by the current URL.
LEGACY_ALIASES: dict[str, tuple[str, ...]] = {
    ENCOUNTER_QUEUE: ("https://clinic.org/fhir/StructureDefinition/queue",),
    ENCOUNTER_REG: ("https://clinic.org/fhir/StructureDefinition/reg",),
    MEDICATION_BILLING: (MEDICATION_BILLING_SCHEMA,),
}
