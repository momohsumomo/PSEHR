import tempfile
import unittest
from pathlib import Path

from src.core.cash_return import from_basic, is_cash_return, resource_id_for, to_basic
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore


class CashReturnFhirTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.store = SqliteShadowStore(Path(self.tmp.name) / "t.db")
        self.store.initialize()

    def tearDown(self):
        conn = getattr(self.store._local, "conn", None)
        if conn is not None:
            conn.close()
        self.tmp.cleanup()

    def _rows(self):
        with self.store._connect() as conn:
            return [dict(r) for r in conn.execute("SELECT * FROM cash_return ORDER BY id").fetchall()]

    def test_round_trip_keeps_blank_and_missing_apart(self):
        row = {"encounter_date": "2026-10-03", "amount": 500, "keywords": "A1B2C3",
               "copay_code": "", "chart_no": "X", "seg": "2", "treat_seq": None}
        basic = to_basic(row, patient_id="p1")
        self.assertTrue(is_cash_return(basic))
        self.assertEqual(basic["id"], resource_id_for("A1B2C3"))
        back = from_basic(basic)
        self.assertEqual(back["copay_code"], "")
        self.assertIsNone(back["treat_seq"])
        self.assertEqual((back["encounter_date"], back["amount"], back["seg"]), ("2026-10-03", 500, "2"))

    def test_refund_goes_through_fhir_once(self):
        self.store.cache_resource("Encounter", "e1", {
            "resourceType": "Encounter", "id": "e1", "status": "finished",
            "subject": {"reference": "Patient/p1"}, "period": {"start": "2026-10-01T09:00:00"},
        })
        for _ in range(2):
            self.store.insert_cash_return(encounter_date="2026-10-04", amount=300, keywords="e1", treat_seq="0001")
        rows = self._rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["amount"], rows[0]["treat_seq"]), (300, "0001"))
        stored = self.store.get_cached_resource("Basic", rows[0]["resource_id"])
        self.assertEqual(stored["subject"]["reference"], "Patient/p1")
        self.assertEqual(from_basic(stored)["keywords"], "e1")
        self.assertEqual(self.store.list_cash_returns("2026-10-01", "2026-10-01")[0]["amount"], 300)


if __name__ == "__main__":
    unittest.main()
