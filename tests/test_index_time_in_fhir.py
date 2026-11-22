import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.infrastructure import sqlite_shadow_store as s


class IndexTimeInFhirTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.store = s.SqliteShadowStore(Path(self.tmp.name) / "t.db")
        self.store.initialize()

    def tearDown(self):
        conn = getattr(self.store._local, "conn", None)
        if conn is not None:
            conn.close()
        self.tmp.cleanup()

    def _dx(self, rid, code):
        self.store.cache_resource("Condition", rid, {
            "resourceType": "Condition", "id": rid, "subject": {"reference": "Patient/p1"},
            "encounter": {"reference": "Encounter/e1"}, "code": {"text": code},
        })

    def test_round_trip(self):
        payload = {}
        s.put_last_updated(payload, "2026-11-22 08:15:00")
        self.assertEqual(payload["meta"]["lastUpdated"], "2026-11-22T08:15:00Z")
        self.assertEqual(s.last_updated_index_time(payload), "2026-11-22 08:15:00")

    def test_index_time_comes_from_meta(self):
        times = iter(["2026-11-22 08:00:00", "2026-11-22 08:00:05"])
        with mock.patch.object(s, "_now_index_time", lambda: next(times)):
            self._dx("c1", "first")
            self._dx("c2", "second")
        with self.store._connect() as conn:
            rows = conn.execute("SELECT resource_id, updated_at FROM condition_index ORDER BY updated_at").fetchall()
        self.assertEqual([tuple(r) for r in rows], [("c1", "2026-11-22 08:00:00"), ("c2", "2026-11-22 08:00:05")])
        stored = self.store.get_cached_resource("Condition", "c2")
        self.assertEqual(stored["meta"]["lastUpdated"], "2026-11-22T08:00:05Z")

    def test_rewrite_json_stamps_and_audits(self):
        self._dx("c1", "x")
        with self.store._connect() as conn:
            s._set_runtime_setting(conn, "audit_recording", "1")
        with mock.patch.object(s, "_now_index_time", lambda: "2026-11-23 01:02:03"):
            with self.store._connect() as conn:
                self.store._rewrite_json(conn, "Condition", "c1", lambda p: p.update({"note": [{"text": "n"}]}))
        with self.store._connect() as conn:
            when = conn.execute("SELECT updated_at FROM condition_index WHERE resource_id='c1'").fetchone()[0]
            audits = conn.execute("SELECT COUNT(*) FROM audit_modifications WHERE record_id='Condition/c1'").fetchone()[0]
        self.assertEqual(when, "2026-11-23 01:02:03")
        self.assertGreaterEqual(audits, 1)


if __name__ == "__main__":
    unittest.main()
