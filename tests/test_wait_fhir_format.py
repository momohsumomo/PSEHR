import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from scripts.wait_fhir_format import ready
from src.infrastructure.sqlite_shadow_store import FHIR_FORMAT, FHIR_FORMAT_KEY, SqliteShadowStore


class WaitFhirFormatTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.path = Path(self.tmp.name) / "t.db"

    def tearDown(self):
        self.tmp.cleanup()

    def _store(self):
        store = SqliteShadowStore(self.path)
        store.initialize()
        store.cache_resource("Patient", "p1", {"resourceType": "Patient", "id": "p1"})
        conn = getattr(store._local, "conn", None)
        if conn is not None:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            conn.close()
            store._local.conn = None

    def test_missing_file_is_ready(self):
        self.assertTrue(ready(self.path))

    def test_marked_db_is_ready_and_old_mark_waits(self):
        self._store()
        self.assertTrue(ready(self.path))
        with closing(sqlite3.connect(self.path)) as conn:
            conn.execute("UPDATE clinic_runtime_settings SET value = 'final-1' WHERE key = ?", (FHIR_FORMAT_KEY,))
            conn.commit()
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        self.assertFalse(ready(self.path))
        with closing(sqlite3.connect(self.path)) as conn:
            conn.execute("UPDATE clinic_runtime_settings SET value = ? WHERE key = ?", (FHIR_FORMAT, FHIR_FORMAT_KEY))
            conn.commit()
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        self.assertTrue(ready(self.path))
        self.path.rename(self.path.with_suffix(".moved"))


if __name__ == "__main__":
    unittest.main()
