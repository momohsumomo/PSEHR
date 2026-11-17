# -*- coding: utf-8 -*-
import tempfile
import unittest
from pathlib import Path

from src.claims.deposit_refund import cash_collected
from src.core.encounter_extensions import attach_reg_extension
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore


class DepositCashBookTest(unittest.TestCase):
    def test_cash_book_puts_return_on_visit_day(self) -> None:
        tmp = tempfile.mkdtemp()
        store = SqliteShadowStore(Path(tmp) / "t.db")
        store.initialize()
        try:
            enc = attach_reg_extension(
                {
                    "resourceType": "Encounter",
                    "id": "local-encounter-dep1",
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
                },
            )
            store.cache_resource("Patient", "p1", {"resourceType": "Patient", "id": "p1"})
            store.cache_resource("Encounter", "local-encounter-dep1", enc)
            store.insert_cash_return(
                encounter_date="2026-11-10",
                amount=500,
                keywords="local-encounter-dep1",
            )
            book = store.cash_book_summary("2026-11-01", "2026-11-10")
            by = {d["date"]: d for d in book["days"]}
            self.assertEqual(by["2026-11-01"]["received"], 790)
            self.assertEqual(by["2026-11-01"]["returnSlip"], 500)
            self.assertEqual(by["2026-11-01"]["total"], 290)
            self.assertEqual(by["2026-11-01"]["drugCopay"], 40)
            self.assertEqual(by.get("2026-11-10", {}).get("returnSlip", 0), 0)
            returns = store.list_cash_returns("2026-11-01", "2026-11-01")
            self.assertEqual(len(returns), 1)
            self.assertEqual(returns[0]["date"], "2026-11-01")
            self.assertEqual(returns[0]["amount"], 500)
        finally:
            held = getattr(store._local, "conn", None)
            if held is not None:
                held.close()
                store._local.conn = None

    def test_parts_plus_deposit_math(self) -> None:
        self.assertEqual(cash_collected(290, 0, 500), 790)


if __name__ == "__main__":
    unittest.main()
