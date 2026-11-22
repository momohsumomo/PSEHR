import contextlib
import io
import sqlite3
import tempfile
import unittest
from pathlib import Path

from scripts.rebuild_from_fhir import run
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore


class RebuildFromFhirTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db = Path(self.tmp.name) / "t.db"
        store = SqliteShadowStore(self.db)
        store.initialize()
        store.cache_resource("Patient", "p1", {"resourceType": "Patient", "id": "p1", "name": [{"family": "F", "given": ["G"]}]})
        store.cache_resource("Encounter", "e1", {
            "resourceType": "Encounter", "id": "e1", "status": "finished",
            "subject": {"reference": "Patient/p1"}, "period": {"start": "2026-10-01T09:00:00"},
        })
        store.cache_resource("Condition", "c1", {"resourceType": "Condition", "id": "c1",
                                                 "subject": {"reference": "Patient/p1"}, "encounter": {"reference": "Encounter/e1"},
                                                 "code": {"text": "x"}})
        store.save_staff({"id": "s1", "name": "N", "role": "R", "pin": "9876"})
        store.insert_cash_return(encounter_date="2026-10-02", amount=100, keywords="e1", treat_seq="0001")
        self.store = store

    def tearDown(self):
        conn = getattr(self.store._local, "conn", None)
        if conn is not None:
            conn.close()
        self.tmp.cleanup()

    def test_rebuild_is_identical_and_leaves_db_alone(self):
        conn = getattr(self.store._local, "conn", None)
        conn.close()
        self.store._local.conn = None
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = run(self.db)
        self.assertEqual(code, 0, out.getvalue())
        self.assertIn("IDENTICAL", out.getvalue())
        check = sqlite3.connect(self.db)
        self.assertEqual(check.execute("SELECT pin FROM clinic_staff WHERE id='s1'").fetchone()[0], "9876")
        self.assertEqual(check.execute("SELECT COUNT(*) FROM condition_index").fetchone()[0], 1)
        check.close()

    def test_index_only_row_is_reported(self):
        conn = getattr(self.store._local, "conn", None)
        conn.execute("INSERT INTO condition_index (resource_id, patient_id, updated_at) VALUES ('orphan', 'p1', '2026-01-01 00:00:00')")
        conn.commit()
        conn.close()
        self.store._local.conn = None
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(run(self.db), 1)
        self.assertIn("DIFFERENT", out.getvalue())


if __name__ == "__main__":
    unittest.main()
