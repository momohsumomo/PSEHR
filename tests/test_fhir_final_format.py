import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from src.core.condition_status import index_status, put_index_status
from src.core.medication_billing import put_billing
from src.infrastructure.sqlite_shadow_store import (
    FHIR_FORMAT_KEY,
    NotConvertedError,
    SqliteShadowStore,
    _medication_request_index_fields,
)


def _close(store):
    conn = getattr(store._local, "conn", None)
    if conn is not None:
        conn.close()
        store._local.conn = None


class FhirFinalFormatTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.path = Path(self.tmp.name) / "t.db"

    def tearDown(self):
        self.tmp.cleanup()

    def test_old_db_without_mark_refuses_to_start(self):
        store = SqliteShadowStore(self.path)
        store.initialize()
        store.cache_resource("Patient", "p1", {"resourceType": "Patient", "id": "p1"})
        _close(store)
        with closing(sqlite3.connect(self.path)) as conn:
            conn.execute("DELETE FROM clinic_runtime_settings WHERE key = ?", (FHIR_FORMAT_KEY,))
            conn.commit()
        again = SqliteShadowStore(self.path)
        try:
            with self.assertRaises(NotConvertedError):
                again.initialize()
        finally:
            _close(again)

    def test_dropped_rows_change_json_first(self):
        store = SqliteShadowStore(self.path)
        store.initialize()
        try:
            store.cache_resource("Condition", "c1", {
                "resourceType": "Condition", "id": "c1", "subject": {"reference": "Patient/p1"},
                "encounter": {"reference": "Encounter/e1"},
                "clinicalStatus": {"coding": [{"code": "active"}]},
            })
            med = {"resourceType": "MedicationRequest", "id": "m1", "status": "active",
                   "subject": {"reference": "Patient/p1"}, "encounter": {"reference": "Encounter/e1"}}
            put_billing(med, {"unit_price": 2.5, "total_qty": 6.0})
            store.cache_resource("MedicationRequest", "m1", med)
            store.retain_encounter_chart("e1", medication_ids=[], condition_ids=[])
            cond = store.get_cached_resource("Condition", "c1")
            self.assertNotIn("clinicalStatus", cond)
            self.assertEqual(index_status(cond), "entered-in-error")
            stored = store.get_cached_resource("MedicationRequest", "m1")
            self.assertEqual(stored["status"], "cancelled")
            fields = _medication_request_index_fields(stored)
            self.assertEqual((fields["unit_price"], fields["total_qty"]), (2.5, 6.0))
            with store._connect() as conn:
                self.assertEqual(
                    conn.execute("SELECT clinical_status FROM condition_index WHERE resource_id='c1'").fetchone()[0],
                    "entered-in-error",
                )
                self.assertEqual(
                    tuple(conn.execute(
                        "SELECT status, unit_price, total_qty FROM medication_request_index WHERE resource_id='m1'"
                    ).fetchone()),
                    ("cancelled", 2.5, 6.0),
                )
        finally:
            _close(store)

    def test_old_clinical_status_entered_in_error_is_normalized(self):
        store = SqliteShadowStore(self.path)
        store.initialize()
        try:
            store.cache_resource("Condition", "c2", {
                "resourceType": "Condition", "id": "c2", "subject": {"reference": "Patient/p1"},
                "clinicalStatus": {"coding": [{"code": "entered-in-error"}]},
            })
            cond = store.get_cached_resource("Condition", "c2")
            self.assertNotIn("clinicalStatus", cond)
            self.assertEqual(cond["verificationStatus"]["coding"][0]["code"], "entered-in-error")
            put_index_status(cond, "active")
            self.assertEqual(index_status(cond), "active")
            self.assertNotIn("verificationStatus", cond)
        finally:
            _close(store)


if __name__ == "__main__":
    unittest.main()
