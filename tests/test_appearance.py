import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from src.core import appearance


class AppearanceTest(unittest.TestCase):
    def test_keeps_hex_colors_only(self) -> None:
        with TemporaryDirectory() as folder:
            path = Path(folder) / "appearance.json"
            path.write_text(
                json.dumps(
                    {
                        "clinic": {"chrome": "#c9deb4", "nope": "red", "chromeDark": "javascript:alert(1)"},
                        "byStaff": {"a1": {"inputBg": "#F6F1A8"}},
                    }
                ),
                encoding="utf-8",
            )
            with patch.object(appearance, "_PATH", path):
                got = appearance.load_appearance()
        self.assertEqual(got["clinic"], {"chrome": "#C9DEB4"})
        self.assertEqual(got["byStaff"], {"a1": {"inputBg": "#F6F1A8"}})

    def test_missing_file_is_empty(self) -> None:
        with patch.object(appearance, "_PATH", Path("data") / "no-such-appearance.json"):
            got = appearance.load_appearance()
        self.assertEqual(got, {"clinic": {}, "byStaff": {}})


if __name__ == "__main__":
    unittest.main()
