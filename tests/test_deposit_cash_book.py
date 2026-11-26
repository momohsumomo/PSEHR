# -*- coding: utf-8 -*-
import tempfile
import unittest
from pathlib import Path

from src.claims.deposit_refund import backfill_cash_days, cash_collected
from src.core.encounter_extensions import attach_reg_extension
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore

VISIT = "local-encounter-dep1"


class DepositCashBookTest(unittest.TestCase):
    def setUp(self) -> None:
        self.store = SqliteShadowStore(Path(tempfile.mkdtemp()) / "t.db")
        self.store.initialize()

    def tearDown(self) -> None:
        held = getattr(self.store._local, "conn", None)
        if held is not None:
            held.close()
            self.store._local.conn = None

    def _visit(self, **reg: str) -> None:
        enc = attach_reg_extension(
            {
                "resourceType": "Encounter",
                "id": VISIT,
                "status": "finished",
                "subject": {"reference": "Patient/p1"},
                "period": {"start": "2026-11-01T10:00:00"},
                "extension": [
                    {
                        "url": "https://wundadi.tw/fhir/StructureDefinition/encounter-queue",
                        "extension": [
                            {"url": "queueNumber", "valueInteger": 3},
                            {"url": "queueStatus", "valueCode": "finished"},
                        ],
                    }
                ],
            },
            {
                "regFee": "200",
                "copayAmt": "50",
                "drugCopay": "40",
                "selfPay": "0",
                "deposit": "0",
                "depositPaid": "500",
                "totalFee": "790",
                "caseNo": "01",
                "copayCode": "",
                **reg,
            },
        )
        self.store.cache_resource("Patient", "p1", {"resourceType": "Patient", "id": "p1"})
        self.store.cache_resource("Encounter", VISIT, enc)

    def _days(self) -> dict:
        book = self.store.cash_book_summary("2026-11-01", "2026-11-10")
        return {d["date"]: d for d in book["days"]}

    def test_return_without_cash_day_stays_on_visit_day(self) -> None:
        self._visit()
        self.store.insert_cash_return(encounter_date="2026-11-01", amount=500, keywords=VISIT)
        by = self._days()
        self.assertEqual(by["2026-11-01"]["received"], 790)
        self.assertEqual(by["2026-11-01"]["returnSlip"], 500)
        self.assertEqual(by["2026-11-01"]["total"], 290)
        self.assertEqual(by["2026-11-01"]["drugCopay"], 40)
        returns = self.store.list_cash_returns("2026-11-01", "2026-11-01")
        self.assertEqual([(r["date"], r["amount"]) for r in returns], [("2026-11-01", 500)])

    def test_card_refund_counts_on_refund_day(self) -> None:
        self._visit()
        self.store.insert_cash_return(
            encounter_date="2026-11-01", amount=500, keywords=VISIT, cash_day="2026-11-10"
        )
        by = self._days()
        self.assertEqual(by["2026-11-01"]["received"], 790)
        self.assertEqual(by["2026-11-01"]["returnSlip"], 0)
        self.assertEqual(by["2026-11-10"]["returnSlip"], 500)
        self.assertEqual(by["2026-11-10"]["total"], -500)
        returns = self.store.list_cash_returns("2026-11-10", "2026-11-10")
        self.assertEqual([(r["date"], r["amount"]) for r in returns], [("2026-11-10", 500)])

    def test_off_book_refund_is_not_counted(self) -> None:
        self._visit()
        self.store.insert_cash_return(
            encounter_date="2026-11-01", amount=500, keywords=VISIT, cash_day="2026-11-10", cash_book=False
        )
        by = self._days()
        self.assertEqual(by["2026-11-01"]["returnSlip"], 0)
        self.assertNotIn("2026-11-10", by)
        self.assertEqual(self.store.list_cash_returns("2026-11-01", "2026-11-10"), [])

    def test_backfill_moves_card_refund_once(self) -> None:
        self._visit(icRemark="2", afterCheck="2", icUploadDate="2026-11-10", treatSeq="0007")
        self.store.insert_cash_return(encounter_date="2026-11-01", amount=500, keywords=VISIT, treat_seq="0007")
        self.assertEqual(backfill_cash_days(self.store), 1)
        by = self._days()
        self.assertEqual(by["2026-11-01"]["returnSlip"], 0)
        self.assertEqual(by["2026-11-10"]["returnSlip"], 500)
        self.assertEqual(backfill_cash_days(self.store), 0)

    def test_backfill_leaves_imported_return(self) -> None:
        self._visit()
        self.store.insert_cash_return(encounter_date="2026-11-01", amount=500, keywords=VISIT)
        self.assertEqual(backfill_cash_days(self.store), 0)
        self.assertEqual(self._days()["2026-11-01"]["returnSlip"], 500)

    def test_parts_plus_deposit_math(self) -> None:
        self.assertEqual(cash_collected(290, 0, 500), 790)


if __name__ == "__main__":
    unittest.main()
