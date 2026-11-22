import re
import unittest
from pathlib import Path

from src.core import fhir_urls

ROOT = Path(__file__).resolve().parents[1]
CUSTOM_URL = re.compile(
    r"https?://(wundadi\.tw|wundadi\.local|clinic\.org|nhidcc\.nhi\.gov\.tw|www\.moi\.gov\.tw)"
)

# Stored JSON on clinic hosts uses exactly these strings.
FROZEN = {
    "ENCOUNTER_QUEUE": "https://wundadi.tw/fhir/StructureDefinition/encounter-queue",
    "ENCOUNTER_REG": "https://wundadi.tw/fhir/StructureDefinition/encounter-reg",
    "ENCOUNTER_PREVISIT": "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/patient-previsit",
    "PATIENT_NHI_CARD": "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/nhi-card-basic",
    "PATIENT_CLINIC": "https://clinic.org/fhir/StructureDefinition/patient-clinic-ext",
    "PATIENT_FIDO2_KEY": "https://wundadi.tw/fhir/StructureDefinition/patient-fido2-key",
    "MEDICATION_BILLING": "https://wundadi.local/fhir/StructureDefinition/medication-billing",
    "MEDICATION_BILLING_SCHEMA": "https://clinic.org/fhir/StructureDefinition/billing",
    "COMPOSITION_SOAP": "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/outpatient-soap",
    "OBSERVATION_OUTPATIENT": "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/outpatient-observation",
    "ALLERGY_OUTPATIENT": "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/outpatient-allergy",
    "MEDIA_LESION": "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/lesion-media",
    "ID_TW_NATIONAL": "http://www.moi.gov.tw/id",
    "ID_NHI_CARD": "https://nhidcc.nhi.gov.tw/id",
    "ID_CHART_NUMBER": "https://clinic.org/chart-number",
    "CODE_NHI_MEDICATION": "https://nhidcc.nhi.gov.tw/medication",
    "CODE_TW_ICD10CM": "https://nhidcc.nhi.gov.tw/icd10cm",
}


class FhirUrlsTest(unittest.TestCase):
    def test_values_unchanged(self):
        for name, value in FROZEN.items():
            self.assertEqual(getattr(fhir_urls, name), value, name)

    def test_src_has_no_literal_custom_urls(self):
        own = ROOT / "src" / "core" / "fhir_urls.py"
        hits = []
        for path in (ROOT / "src").rglob("*.py"):
            if path == own:
                continue
            for no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if CUSTOM_URL.search(line):
                    hits.append(f"{path.relative_to(ROOT)}:{no}")
        self.assertEqual(hits, [])


if __name__ == "__main__":
    unittest.main()
