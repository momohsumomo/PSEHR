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

    def test_reuse_sample_keeps_lists_and_refills_lookups(self):
        import json

        from src.infrastructure.sqlite_shadow_store import SqliteShadowStore

        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            store = SqliteShadowStore(Path(tmp) / "s.db")
            store.initialize()
            with store._connect() as conn:
                conn.execute(
                    "INSERT INTO encounter_index (resource_id, patient_id, encounter_date, queue_number, "
                    "queue_status, fhir_status) VALUES ('e1', 'p1', '2026-01-02', 1, 'finished', 'finished')"
                )
                conn.execute(
                    "INSERT INTO patient_index (resource_id, medical_no, id_no) VALUES ('p1', 'M1', 'I1')"
                )
            sample = {"days": ["2026-01-02"], "icDays": [], "months": [], "encounters": ["e1"],
                      "indexOnlyEncounters": ["e1"], "patients": ["p1"]}
            prior = Path(tmp) / "prior"
            prior.mkdir()
            (prior / "manifest.json").write_text(json.dumps({"sample": sample}), encoding="utf-8")
            got = fb._reuse_sample(store, prior)
            self.assertEqual({k: got[k] for k in sample}, sample)
            self.assertEqual(got["patientOf"], {"e1": "p1"})
            self.assertEqual(got["medicalNo"], {"p1": "M1"})
            self.assertEqual(got["idNo"], {"p1": "I1"})


if __name__ == "__main__":
    unittest.main()
