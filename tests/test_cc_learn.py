import tempfile
import unittest
from pathlib import Path

from src.core.cc_learn import bootstrap, observe, suggest_suffix


class CcLearnTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "learn.db"
        import sqlite3

        conn = sqlite3.connect(self.db)
        conn.execute(
            "CREATE TABLE encounter_index (resource_id TEXT, chief_complaint TEXT)"
        )
        conn.commit()
        conn.close()
        bootstrap(self.db)

    def tearDown(self):
        self.tmp.cleanup()

    def test_second_visit_teaches_the_line(self):
        observe(self.db, "e1", "Alpha itch spot")
        self.assertEqual(suggest_suffix(self.db, "Al"), "")
        observe(self.db, "e2", "Alpha itch spot")
        self.assertEqual(suggest_suffix(self.db, "Al"), "pha itch spot")

    def test_editing_a_visit_moves_the_count(self):
        observe(self.db, "e1", "Alpha itch spot")
        observe(self.db, "e2", "Alpha itch spot")
        observe(self.db, "e1", "Beta swelling arm")
        self.assertEqual(suggest_suffix(self.db, "Al"), "")
        observe(self.db, "e3", "Beta swelling arm")
        self.assertEqual(suggest_suffix(self.db, "Be"), "ta swelling arm")

    def test_next_line_is_the_common_pair(self):
        text = "Alpha itch spot\nBeta swelling arm"
        observe(self.db, "e1", text)
        observe(self.db, "e2", text)
        self.assertEqual(suggest_suffix(self.db, "", "Alpha itch spot"), "Beta swelling arm")

    def test_same_save_does_not_double_count(self):
        observe(self.db, "e1", "Alpha itch spot")
        observe(self.db, "e1", "Alpha itch spot")
        observe(self.db, "e2", "Alpha itch spot")
        self.assertEqual(suggest_suffix(self.db, "Al"), "pha itch spot")

    def test_placeholder_is_not_a_complaint(self):
        observe(self.db, "e1", "\u9580\u8a3a\u639b\u865f")
        observe(self.db, "e2", "\u9580\u8a3a\u639b\u865f")
        self.assertEqual(suggest_suffix(self.db, "\u9580\u8a3a"), "")


if __name__ == "__main__":
    unittest.main()
