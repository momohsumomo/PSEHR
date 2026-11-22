import re
import unittest
from pathlib import Path

from src.core import fhir_urls

ROOT = Path(__file__).resolve().parents[1]
CUSTOM_URL = re.compile(
    r"https?://(wundadi\.tw|wundadi\.local|clinic\.org|nhidcc\.nhi\.gov\.tw|www\.moi\.gov\.tw"
    r"|polarissehr\.eskincrux\.com|twcore\.mohw\.gov\.tw)"
)
P = "https://polarissehr.eskincrux.com/fhir"

# Stored JSON on clinic hosts uses exactly these strings.
FROZEN = {
    "ENCOUNTER_BOOK": P + "/StructureDefinition/encounter-book",
    "ENCOUNTER_QUEUE": P + "/StructureDefinition/encounter-queue",
    "ENCOUNTER_REG": P + "/StructureDefinition/encounter-reg",
    "ENCOUNTER_PREVISIT": P + "/StructureDefinition/patient-previsit",
    "BASIC_KIND": P + "/CodeSystem/basic-kind",
    "CASH_RETURN": P + "/StructureDefinition/cash-return",
    "PATIENT_NHI_CARD": P + "/StructureDefinition/nhi-card-basic",
    "PATIENT_CLINIC": P + "/StructureDefinition/patient-clinic-ext",
    "PATIENT_FIDO2_KEY": P + "/StructureDefinition/patient-fido2-key",
    "MEDICATION_BILLING": P + "/StructureDefinition/medication-billing",
    "COMPOSITION_SOAP": P + "/StructureDefinition/outpatient-soap",
    "OBSERVATION_OUTPATIENT": P + "/StructureDefinition/outpatient-observation",
    "ALLERGY_OUTPATIENT": P + "/StructureDefinition/outpatient-allergy",
    "MEDIA_LESION": P + "/StructureDefinition/lesion-media",
    "ID_TW_NATIONAL": "http://www.moi.gov.tw",
    "ID_NHI_CARD": P + "/sid/nhi-card-id",
    "CHART_NUMBER_BASE": P + "/sid/medical-record",
    "CODE_NHI_MEDICATION": "https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/medication-nhi-tw",
    "CODE_TW_ICD10CM": "https://twcore.mohw.gov.tw/ig/twcore/CodeSystem/icd-10-cm-2023-tw",
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

    def test_modernize_rewrites_old_urls_and_chart_system(self):
        patient = {
            "resourceType": "Patient",
            "identifier": [
                {"use": "official", "system": "http://www.moi.gov.tw/id", "value": "X"},
                {"use": "secondary", "system": "https://clinic.org/chart-number", "value": "7"},
            ],
            "extension": [
                {"url": "https://clinic.org/fhir/StructureDefinition/patient-clinic-ext",
                 "extension": [{"url": "idCategory", "valueString": "https://clinic.org/x"}]},
                {"url": "https://clinic.org/fhir/StructureDefinition/reg", "valueString": "stale"},
            ],
        }
        self.assertTrue(fhir_urls.modernize(patient, fhir_urls.chart_number_system("123")))
        self.assertEqual(patient["identifier"][0]["system"], "http://www.moi.gov.tw")
        self.assertEqual(patient["identifier"][1]["system"], P + "/sid/medical-record/123")
        self.assertEqual(patient["identifier"][1]["type"]["coding"][0]["code"], "MR")
        self.assertEqual([e["url"] for e in patient["extension"]], [fhir_urls.PATIENT_CLINIC])
        self.assertEqual(patient["extension"][0]["extension"][0]["valueString"], "https://clinic.org/x")
        self.assertFalse(fhir_urls.modernize(patient, fhir_urls.chart_number_system("123")))

    def test_modernize_billing_prefix_and_unknown_clinic(self):
        med = {"extension": [{"url": "https://clinic.org/fhir/StructureDefinition/billing/payMark", "valueString": "x"}],
               "medicationCodeableConcept": {"coding": [{"system": "https://nhidcc.nhi.gov.tw/medication", "code": "A"}]}}
        fhir_urls.modernize(med)
        self.assertEqual(med["extension"][0]["url"], fhir_urls.MEDICATION_BILLING + "/payMark")
        self.assertEqual(med["medicationCodeableConcept"]["coding"][0]["system"], fhir_urls.CODE_NHI_MEDICATION)
        chart = {"identifier": [{"system": fhir_urls.ID_CHART_NUMBER, "value": "1"}]}
        fhir_urls.modernize(chart, None)
        self.assertEqual(chart["identifier"][0]["system"], fhir_urls.ID_CHART_NUMBER)


if __name__ == "__main__":
    unittest.main()
