import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.core import visit_certificate
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore


class VisitCertificateTests(unittest.TestCase):
    def test_save_then_reload_and_update_same_row(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            store = SqliteShadowStore(Path(tmp) / "t.db")
            store.initialize()
            with mock.patch.object(visit_certificate, "get_shadow_store", return_value=store):
                self.assertIsNone(visit_certificate.find_for_visit("Encounter/e1"))
                first = visit_certificate.save_for_visit(
                    {
                        "encounterId": "Encounter/e1",
                        "docNo": "A1",
                        "diagnosis": "L20.9 eczema",
                        "order": "rest three days",
                        "appointment": "back in one week",
                        "english": True,
                    }
                )
                self.assertEqual(first["encounterId"], "e1")
                self.assertEqual(first["diagnosis"], "L20.9 eczema")
                self.assertTrue(first["english"])
                second = visit_certificate.save_for_visit(
                    {"encounterId": "e1", "docNo": "A2", "diagnosis": "L30.9", "order": "", "english": False}
                )
                self.assertEqual(second["id"], first["id"])
                again = visit_certificate.find_for_visit("e1")
                self.assertEqual(again["docNo"], "A2")
                self.assertEqual(again["diagnosis"], "L30.9")
                self.assertEqual(again["appointment"], "")
                self.assertFalse(again["english"])

    def test_blank_number_continues_after_yisheng(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            store = SqliteShadowStore(Path(tmp) / "t.db")
            store.initialize()
            store.set_json_setting(visit_certificate.YISHENG_MAX_KEY, 2552)
            with mock.patch.object(visit_certificate, "get_shadow_store", return_value=store):
                self.assertEqual(visit_certificate.next_serial(), "00002553")
                first = visit_certificate.save_for_visit({"encounterId": "e1", "docNo": "", "diagnosis": "a"})
                self.assertEqual(first["docNo"], "00002553")
                kept = visit_certificate.save_for_visit({"encounterId": "e1", "docNo": "", "diagnosis": "b"})
                self.assertEqual(kept["docNo"], "00002553")
                second = visit_certificate.save_for_visit({"encounterId": "e2", "docNo": "", "diagnosis": "c"})
                self.assertEqual(second["docNo"], "00002554")

    def test_refuses_without_visit(self) -> None:
        with self.assertRaises(ValueError):
            visit_certificate.save_for_visit({"encounterId": "", "diagnosis": "x"})


if __name__ == "__main__":
    unittest.main()
