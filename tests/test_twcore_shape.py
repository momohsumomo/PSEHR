import contextlib
import io
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from scripts import fhir_convert
from src.core import fhir_urls
from src.core.twcore_shape import normalize
from src.infrastructure.sqlite_shadow_store import (
    FHIR_FORMAT,
    FHIR_FORMAT_KEY,
    FHIR_FORMAT_PREVIOUS,
    NotConvertedError,
    SqliteShadowStore,
)


def _close(store):
    conn = getattr(store._local, "conn", None)
    if conn is not None:
        conn.close()
        store._local.conn = None


class ItemSystemTest(unittest.TestCase):
    def test_code_shape_picks_system(self):
        self.assertEqual(fhir_urls.item_system("AC12345100"), fhir_urls.CODE_NHI_MEDICATION)
        self.assertEqual(fhir_urls.item_system("48011c"), fhir_urls.CODE_NHI_SERVICE)
        self.assertEqual(fhir_urls.item_system("FBP01234567A"), fhir_urls.CODE_NHI_MATERIAL)
        self.assertEqual(fhir_urls.item_system("DEP"), fhir_urls.CODE_CLINIC_ITEM)


class NormalizeTest(unittest.TestCase):
    def test_empty_values_and_bare_extensions_go(self):
        p = {
            "resourceType": "Patient",
            "id": "p1",
            "address": [{"text": ""}],
            "telecom": [],
            "name": [{"text": "x", "given": [""]}],
            "extension": [{"url": "u", "extension": [{"url": "a", "valueString": ""}]}],
        }
        self.assertTrue(normalize("Patient", p))
        self.assertEqual(p, {"resourceType": "Patient", "id": "p1", "name": [{"text": "x"}]})

    def test_already_shaped_is_unchanged(self):
        p = {"resourceType": "Encounter", "id": "e1", "status": "finished",
             "class": {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "AMB"}}
        self.assertFalse(normalize("Encounter", p))

    def test_encounter_class_becomes_coding(self):
        p = {"resourceType": "Encounter", "class": {"code": "AMB", "display": "???E"}}
        normalize("Encounter", p)
        self.assertEqual(p["class"], {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "AMB"})

    def test_condition_gets_category_status_and_systems(self):
        p = {"resourceType": "Condition", "code": {"coding": []},
             "verificationStatus": {"coding": [{"code": "confirmed"}]}}
        normalize("Condition", p)
        self.assertEqual(p["category"][0]["coding"][0]["code"], "encounter-diagnosis")
        self.assertEqual(p["clinicalStatus"]["coding"][0]["code"], "active")
        self.assertTrue(p["verificationStatus"]["coding"][0]["system"].endswith("condition-ver-status"))
        self.assertNotIn("code", p)

    def test_entered_in_error_gets_no_clinical_status(self):
        p = {"resourceType": "Condition", "verificationStatus": {"coding": [{"code": "entered-in-error"}]}}
        normalize("Condition", p)
        self.assertNotIn("clinicalStatus", p)

    def test_order_codes_sit_under_their_system(self):
        p = {"resourceType": "MedicationRequest", "medicationCodeableConcept": {"coding": [
            {"system": fhir_urls.CODE_NHI_MEDICATION, "code": "48011C"},
            {"system": fhir_urls.CODE_NHI_MEDICATION, "code": "48011C"},
            {"system": fhir_urls.CODE_NHI_MEDICATION, "code": "AC12345100"},
        ]}}
        normalize("MedicationRequest", p)
        self.assertEqual(
            [(c["system"], c["code"]) for c in p["medicationCodeableConcept"]["coding"]],
            [(fhir_urls.CODE_NHI_SERVICE, "48011C"), (fhir_urls.CODE_NHI_MEDICATION, "AC12345100")],
        )

    def test_order_without_code_says_unknown(self):
        p = {"resourceType": "MedicationRequest", "medicationCodeableConcept": {"coding": [], "text": ""}}
        normalize("MedicationRequest", p)
        self.assertEqual(p["medicationCodeableConcept"]["extension"][0]["valueCode"], "unknown")

    def test_icd10cm_carries_dot_and_index_reads_it_bare(self):
        from src.core.terminology import build_condition_codeable, extract_terminology_stickers

        p = {"resourceType": "Condition", "code": {"coding": [
            {"system": fhir_urls.CODE_TW_ICD10CM, "code": "L720"},
            {"system": "http://hl7.org/fhir/sid/icd-10", "code": "L720"},
        ]}}
        normalize("Condition", p)
        self.assertEqual([c["code"] for c in p["code"]["coding"]], ["L72.0", "L720"])
        self.assertEqual(extract_terminology_stickers(p["code"])["nhiIcd10Code"], "L720")
        built = build_condition_codeable(nhi_icd10_code="S90561A")
        self.assertEqual(built["coding"][0]["code"], "S90.561A")
        self.assertEqual(fhir_urls.icd10cm_code("L30"), "L30")

    def test_twcore_display_moves_to_text(self):
        p = {"resourceType": "MedicationRequest", "medicationCodeableConcept": {"coding": [
            {"system": fhir_urls.CODE_NHI_MEDICATION, "code": "51005C", "display": "own name"}]}}
        normalize("MedicationRequest", p)
        concept = p["medicationCodeableConcept"]
        self.assertEqual(concept["text"], "own name")
        self.assertNotIn("display", concept["coding"][0])
        q = {"resourceType": "MedicationRequest", "medicationCodeableConcept": {"text": "kept", "coding": [
            {"system": fhir_urls.CODE_CLINIC_ITEM, "code": "DEP", "display": "own"}]}}
        normalize("MedicationRequest", q)
        self.assertEqual(q["medicationCodeableConcept"]["coding"][0]["display"], "own")

    def test_allergy_gets_clinical_status(self):
        p = {"resourceType": "AllergyIntolerance", "verificationStatus": {"coding": [{"code": "confirmed"}]}}
        normalize("AllergyIntolerance", p)
        self.assertEqual(p["clinicalStatus"]["coding"][0]["code"], "active")

    def test_chart_number_use_and_duplicates(self):
        sys_chart = fhir_urls.ID_CHART_NUMBER
        p = {"resourceType": "Patient", "identifier": [
            {"system": sys_chart, "value": "1", "use": "official"},
            {"system": sys_chart, "value": "2", "use": "secondary"},
            {"system": sys_chart, "value": "2"},
            {"system": sys_chart, "value": ""},
        ]}
        normalize("Patient", p)
        self.assertEqual(p["identifier"], [
            {"system": sys_chart, "value": "1", "use": "official"},
            {"system": sys_chart, "value": "2"},
        ])

    def test_document_date_and_content(self):
        p = {"resourceType": "DocumentReference", "date": "2026-11-24", "type": {"text": "??E??"}}
        normalize("DocumentReference", p)
        self.assertEqual(p["date"], "2026-11-24T00:00:00+08:00")
        self.assertEqual(p["content"], [{"attachment": {"title": "??E??"}}])

    def test_composition_gets_author(self):
        p = {"resourceType": "Composition"}
        normalize("Composition", p)
        self.assertEqual(p["author"], [{"display": "Polaris SEHR"}])


class FinalTwoTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.path = Path(self.tmp.name) / "t.db"

    def tearDown(self):
        self.tmp.cleanup()

    def _set_format(self, value):
        with closing(sqlite3.connect(self.path)) as conn:
            conn.execute("UPDATE clinic_runtime_settings SET value = ? WHERE key = ?", (value, FHIR_FORMAT_KEY))
            conn.commit()

    def test_final_one_refuses_then_twcore_converts_it(self):
        store = SqliteShadowStore(self.path)
        store.initialize()
        store.cache_resource("Patient", "p1", {"resourceType": "Patient", "id": "p1"})
        store.cache_resource("Condition", "c1", {
            "resourceType": "Condition", "id": "c1", "subject": {"reference": "Patient/p1"},
            "code": {"coding": [{"code": "L82.1"}]},
        })
        _close(store)
        old = {"resourceType": "Condition", "id": "c1", "subject": {"reference": "Patient/p1"},
               "code": {"coding": [{"code": "L82.1"}]}, "note": [],
               "clinicalStatus": {"coding": [{"code": "active"}]}, "meta": {"lastUpdated": "2026-11-01T00:00:00+08:00"}}
        with closing(sqlite3.connect(self.path)) as conn:
            conn.execute("UPDATE resource_cache SET payload_json = ? WHERE resource_type = 'Condition' AND resource_id = 'c1'",
                         (json.dumps(old),))
            before = conn.execute("SELECT * FROM condition_index WHERE resource_id = 'c1'").fetchone()
            conn.commit()
        self._set_format(FHIR_FORMAT_PREVIOUS)

        again = SqliteShadowStore(self.path)
        try:
            with self.assertRaises(NotConvertedError):
                again.initialize()
        finally:
            _close(again)

        with contextlib.redirect_stdout(io.StringIO()):
            fhir_convert.run(self.path, ["twcore"], apply=True)
        with closing(sqlite3.connect(self.path)) as conn:
            mark = conn.execute("SELECT value FROM clinic_runtime_settings WHERE key = ?", (FHIR_FORMAT_KEY,)).fetchone()
            text = conn.execute("SELECT payload_json FROM resource_cache WHERE resource_id = 'c1'").fetchone()[0]
            after = conn.execute("SELECT * FROM condition_index WHERE resource_id = 'c1'").fetchone()
        self.assertEqual(mark[0], FHIR_FORMAT)
        payload = json.loads(text)
        self.assertNotIn("note", payload)
        self.assertEqual(payload["meta"]["lastUpdated"], "2026-11-01T00:00:00+08:00")
        self.assertIn("category", payload)
        self.assertEqual(before, after)

        ok = SqliteShadowStore(self.path)
        try:
            ok.initialize()
        finally:
            _close(ok)

    def test_rewriting_staff_keeps_pin(self):
        from src.core import side_records

        store = SqliteShadowStore(self.path)
        store.initialize()
        try:
            store.save_staff({"id": "s1", "name": "N", "role": "R", "certNo": "", "pin": "98765"})
            payload = store.get_cached_resource("Practitioner", side_records.resource_id("clinic_staff", "s1"))
            with store._connect() as conn:
                store._upsert_side_row(conn, payload)
                pin = conn.execute("SELECT pin FROM clinic_staff WHERE id = 's1'").fetchone()[0]
        finally:
            _close(store)
        self.assertEqual(pin, "98765")

    def test_side_row_keeps_blank_text(self):
        from src.core import side_records

        store = SqliteShadowStore(self.path)
        store.initialize()
        try:
            store.put_side_row(
                "look_file",
                {"rel": "a/b.jpg", "chart_no": "", "file_name": "b.jpg", "modified": None, "size_bytes": 1, "noted_at": "t"},
            )
            with store._connect() as conn:
                row = conn.execute("SELECT chart_no, modified FROM look_file WHERE rel = 'a/b.jpg'").fetchone()
            payload = store.get_cached_resource(
                side_records.SPECS["look_file"].rtype, side_records.resource_id("look_file", "a/b.jpg")
            )
        finally:
            _close(store)
        self.assertEqual(tuple(row), ("", ""))
        self.assertNotIn('""', json.dumps(payload))


if __name__ == "__main__":
    unittest.main()
