import tempfile
import unittest
from pathlib import Path

from src.core.app_update import begin_apply, read_stamp, read_version, write_stamp
from src.core.github_release import pick_release


class AppUpdateTests(unittest.TestCase):
    def test_stamp_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_stamp(root, "abc123def")
            self.assertEqual(read_stamp(root), "abc123def")
            self.assertEqual(read_version(root), "")
            write_stamp(root, "abc123def", "program-2026.10.20")
            self.assertEqual(read_version(root), "program-2026.10.20")

    def test_picks_program_release_not_drug_pack(self) -> None:
        items = [
            {"tag_name": "program-2026.10.20", "zipball_url": "http://example/program"},
            {"tag_name": "drug-pack-2026.10.1"},
            {"tag_name": "program-2026.09.01"},
        ]
        self.assertEqual(pick_release(items, "program-")["tag_name"], "program-2026.10.20")
        self.assertEqual(pick_release(items, "drug-pack-")["tag_name"], "drug-pack-2026.10.1")
        self.assertIsNone(pick_release(items, "other-"))

    def test_dev_tree_refuses_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".git").mkdir()
            with self.assertRaises(RuntimeError) as caught:
                begin_apply(root)
            self.assertIn("GitHub", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
