import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("fhir_baseline", ROOT / "scripts" / "fhir_baseline.py")
fb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fb)


class FhirBaselineTest(unittest.TestCase):
    def test_output_inside_repo_is_refused(self):
        self.assertTrue(fb._inside_repo(ROOT / "data" / "x"))
        self.assertTrue(fb._inside_repo(ROOT))
        self.assertFalse(fb._inside_repo(Path(tempfile.gettempdir()) / "x"))

    def test_unc_path_is_remote(self):
        self.assertTrue(fb._is_remote(Path(r"\\host\share\shadow.db")))

    def test_volatile_keys_dropped_at_any_depth(self):
        body = {"entry": [{"chartOpen": True, "a": 1}], "chartOpen": False}
        self.assertEqual(fb._strip(body), {"entry": [{"a": 1}]})

    def test_diff_paths_reports_changed_missing_and_length(self):
        found = []
        fb._diff_paths({"a": 1, "b": [1, 2], "c": 3}, {"a": 2, "b": [1], "d": 4}, "$", found, 20)
        paths = [p for p, _, _ in found]
        self.assertIn("$.a", paths)
        self.assertIn("$.b[len]", paths)
        self.assertIn("$.c", paths)
        self.assertIn("$.d", paths)

    def test_stride_keeps_order_and_cap(self):
        self.assertEqual(fb._stride(list(range(10)), 5), [0, 2, 4, 6, 8])
        self.assertEqual(fb._stride([1, 2], 5), [1, 2])


if __name__ == "__main__":
    unittest.main()
