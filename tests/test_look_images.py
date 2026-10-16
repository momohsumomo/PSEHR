"""Chart photo names: 6-digit chart + 2 base36 chars."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from src.core.look_images import list_look_files, look_name, next_look_serial, write_look_image, charts_with_images


class LookImageNameTests(unittest.TestCase):
    def test_folder_and_serial(self) -> None:
        self.assertEqual(look_name("101190", 0, ".jpg"), "10119000.JPG")
        self.assertEqual(look_name("1190", 10, "png"), "0011900A.png")
        self.assertEqual(look_name("101190", 36, ".JPG"), "10119010.JPG")
        self.assertEqual(look_name("101190", 1295, ".JPG"), "101190ZZ.JPG")

    def test_next_serial_does_not_reuse_or_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["WUNDADI_LOOK_DIR"] = tmp
            try:
                first = write_look_image("101190", b"one", ".JPG")
                second = write_look_image("101190", b"two", ".jpg")
                self.assertEqual(first["name"], "10119000.JPG")
                self.assertEqual(second["name"], "10119001.JPG")
                self.assertEqual(Path(first["rel"]).as_posix(), "10/11/90/10119000.JPG")
                names = [item["name"] for item in list_look_files("101190")]
                self.assertEqual(names, ["10119001.JPG", "10119000.JPG"])
                self.assertRegex(list_look_files("101190")[0]["modified"], r"^\d{4}-\d{2}-\d{2}$")
                self.assertEqual(next_look_serial("101190"), 2)
                (Path(tmp) / "10" / "11" / "90" / "1011900A.JPG").write_bytes(b"gap")
                self.assertEqual(next_look_serial("101190"), 11)
            finally:
                os.environ.pop("WUNDADI_LOOK_DIR", None)

    def test_charts_with_images_uses_file_date(self) -> None:
        from datetime import datetime

        with tempfile.TemporaryDirectory() as tmp:
            os.environ["WUNDADI_LOOK_DIR"] = tmp
            try:
                new = write_look_image("101190", b"new", ".JPG")
                old = write_look_image("102200", b"old", ".JPG")
                old_path = Path(tmp) / old["rel"]
                stamp = datetime(2020, 1, 2, 12, 0, 0).timestamp()
                os.utime(old_path, (stamp, stamp))
                today = datetime.now().date().isoformat()
                self.assertEqual(charts_with_images(today, today), {"101190"})
                self.assertEqual(charts_with_images("2020-01-02", "2020-01-02"), {"102200"})
                self.assertIn(new["name"], "10119000.JPG")
            finally:
                os.environ.pop("WUNDADI_LOOK_DIR", None)


if __name__ == "__main__":
    unittest.main()
