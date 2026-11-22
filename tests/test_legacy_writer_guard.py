import sqlite3
import tempfile
import unittest
from pathlib import Path

from scripts.legacy_writer_guard import is_final, refuse_on_final_db
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore


class LegacyWriterGuardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db = Path(self.tmp.name) / "t.db"

    def tearDown(self):
        self.tmp.cleanup()

    def test_old_db_is_allowed(self):
        conn = sqlite3.connect(self.db)
        conn.execute("CREATE TABLE encounter_index (resource_id TEXT)")
        conn.close()
        self.assertFalse(is_final(self.db))
        refuse_on_final_db(["--db-path", str(self.db)])

    def test_converted_db_is_refused(self):
        store = SqliteShadowStore(self.db)
        store.initialize()
        conn = getattr(store._local, "conn", None)
        if conn is not None:
            conn.close()
        self.assertTrue(is_final(self.db))
        with self.assertRaises(SystemExit):
            refuse_on_final_db(["--db-path", str(self.db)])
        with self.assertRaises(SystemExit):
            refuse_on_final_db([f"--db={self.db}"])


if __name__ == "__main__":
    unittest.main()
