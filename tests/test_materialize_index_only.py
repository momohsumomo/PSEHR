import contextlib
import importlib.util
import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from src.infrastructure.sqlite_shadow_store import SqliteShadowStore

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("materialize_index_only", ROOT / "scripts" / "materialize_index_only.py")
mi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mi)


class MaterializeIndexOnlyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db = Path(self.tmp.name) / "s.db"
        SqliteShadowStore(self.db).initialize()
        with contextlib.closing(sqlite3.connect(self.db)) as conn, conn:
            conn.execute(
                "INSERT INTO condition_index (resource_id, patient_id, encounter_id, icd10_code, "
                "nhi_icd10_code, summary_text, clinical_status, updated_at) "
                "VALUES ('c1', 'p1', 'e1', 'J00', 'J00', 'cold', 'entered-in-error', '2026-01-02 03:04:05')"
            )
            conn.execute(
                "INSERT INTO medication_request_index (resource_id, patient_id, encounter_id, nhi_code, "
                "drug_text, status, days_supply, quantity, unit_price, pack_version, useage, pay_mark, "
                "memo_mark, total_qty, use_type, body_site, line_sort, updated_at) VALUES "
                "('m1', 'p1', 'e1', 'A001', 'drug', 'cancelled', 3, 1.5, 2.0, 'v1', 'TID', 'S', NULL, "
                "13.5, 'T', 'L', 2, '2026-01-02 03:04:05')"
            )
            conn.execute(
                "INSERT INTO medication_request_index (resource_id, patient_id, encounter_id, nhi_code, "
                "drug_text, status) VALUES ('m2', 'p1', 'e1', 'B001', 'kept', 'active')"
            )
            conn.execute(
                "INSERT INTO resource_cache (resource_type, resource_id, payload_json) "
                "VALUES ('MedicationRequest', 'm2', '{\"keep\": true}')"
            )

    def tearDown(self):
        self.tmp.cleanup()

    def _run(self, apply):
        with contextlib.redirect_stdout(io.StringIO()):
            return mi.run(self.db, apply)

    def _cache(self):
        with contextlib.closing(sqlite3.connect(self.db)) as conn:
            return {
                (t, i): (json.loads(p), u)
                for t, i, p, u in conn.execute(
                    "SELECT resource_type, resource_id, payload_json, updated_at FROM resource_cache "
                    "WHERE resource_type IN ('Condition', 'MedicationRequest')"
                )
            }

    def test_check_only_writes_nothing(self):
        self.assertEqual(self._run(False), 0)
        self.assertEqual(set(self._cache()), {("MedicationRequest", "m2")})

    def test_apply_inserts_missing_only_and_keeps_index(self):
        with contextlib.closing(sqlite3.connect(self.db)) as conn:
            before = mi.index_digest(conn)
        self.assertEqual(self._run(True), 0)
        cache = self._cache()
        self.assertEqual(cache[("MedicationRequest", "m2")][0], {"keep": True})
        cond, stamp = cache[("Condition", "c1")]
        self.assertEqual(stamp, "2026-01-02 03:04:05")
        self.assertEqual(cond["clinicalStatus"]["coding"][0]["code"], "entered-in-error")
        med = cache[("MedicationRequest", "m1")][0]
        self.assertEqual(med["status"], "cancelled")
        self.assertEqual(med["dosageInstruction"], [{"text": "TID"}])
        self.assertEqual(mi.json_only_back(med), {"total_qty": 13.5, "use_type": "T", "line_sort": 2})
        with contextlib.closing(sqlite3.connect(self.db)) as conn:
            self.assertEqual(mi.index_digest(conn), before)
        self.assertEqual(self._run(True), 0)
        self.assertEqual(len(self._cache()), 3)


if __name__ == "__main__":
    unittest.main()
