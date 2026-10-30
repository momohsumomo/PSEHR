import tempfile
import unittest
from pathlib import Path

from src.core.app_update import begin_apply, read_stamp, read_version, select_program, write_stamp
from src.core.github_release import pick_release, recent_releases


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

    def test_picks_newer_publish_when_tag_name_sorts_earlier(self) -> None:
        items = [
            {"tag_name": "program-2026.10.21.9", "published_at": "2026-10-21T09:18:32Z"},
            {"tag_name": "program-2026.10.21.10", "published_at": "2026-10-21T09:33:00Z"},
        ]
        self.assertEqual(pick_release(items, "program-")["tag_name"], "program-2026.10.21.10")

    def test_window_keeps_two_and_three_back_after_a_newer_publish(self) -> None:
        items = [
            {"tag_name": "program-2026.10.29.5", "published_at": "2026-10-29T12:00:00Z", "zipball_url": "http://example/5"},
            {"tag_name": "program-2026.10.29.4", "published_at": "2026-10-29T10:00:00Z", "zipball_url": "http://example/4"},
            {"tag_name": "program-2026.10.29.3", "published_at": "2026-10-29T08:00:00Z", "zipball_url": "http://example/3"},
            {"tag_name": "program-2026.10.29.2", "published_at": "2026-10-29T06:00:00Z", "zipball_url": "http://example/2"},
            {"tag_name": "program-2026.10.29.1", "published_at": "2026-10-29T04:00:00Z", "zipball_url": "http://example/1"},
            {"tag_name": "drug-pack-2026.10.1", "published_at": "2026-10-29T13:00:00Z"},
        ]
        names = [item["tag_name"] for item in recent_releases(items, "program-", 5)]
        self.assertEqual(
            names,
            [
                "program-2026.10.29.5",
                "program-2026.10.29.4",
                "program-2026.10.29.3",
                "program-2026.10.29.2",
                "program-2026.10.29.1",
            ],
        )
        self.assertEqual(select_program(items)["version"], "program-2026.10.29.5")
        self.assertEqual(select_program(items, "program-2026.10.29.3")["version"], "program-2026.10.29.3")
        self.assertEqual(select_program(items, "program-2026.10.29.2")["zipUrl"], "http://example/2")
        with self.assertRaises(RuntimeError):
            select_program(items, "program-2026.10.20")
        with self.assertRaises(RuntimeError):
            select_program(items, "main")

    def test_dev_tree_refuses_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".git").mkdir()
            with self.assertRaises(RuntimeError) as caught:
                begin_apply(root)
            self.assertIn("GitHub", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
