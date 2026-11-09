"""A chart row switched to another code must not keep the old item's price."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from src.core.nhi_clinical_mappers import BILLING_EXT_BASE
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore


def _close(store: SqliteShadowStore) -> None:
    conn = getattr(store._local, "conn", None)
    if conn is not None:
        conn.close()
        store._local.conn = None


def _med(code: str, price: float | None = None) -> dict:
    ext = [{"url": f"{BILLING_EXT_BASE}/quantity", "valueDecimal": 1.0}]
    if price is not None:
        ext.append({"url": f"{BILLING_EXT_BASE}/unitPrice", "valueDecimal": price})
    return {
        "resourceType": "MedicationRequest",
        "status": "active",
        "medicationCodeableConcept": {
            "coding": [{"system": "https://nhidcc.nhi.gov.tw/medication", "code": code}],
            "text": code,
        },
        "subject": {"reference": "Patient/p1"},
        "encounter": {"reference": "Encounter/e1"},
        "extension": ext,
    }


class MedIndexPriceSwapTest(unittest.TestCase):
    def _price_after(self, first: dict, second: dict) -> float | None:
        with tempfile.TemporaryDirectory() as tmp:
            store = SqliteShadowStore(Path(tmp) / "t.db")
            store.initialize()
            try:
                with store._connect() as conn:
                    store._upsert_medication_request_index(conn, "m1", first)
                    store._upsert_medication_request_index(conn, "m1", second)
                    row = conn.execute(
                        "SELECT unit_price FROM medication_request_index WHERE resource_id='m1'"
                    ).fetchone()
                return row[0]
            finally:
                _close(store)

    def test_new_code_without_price_drops_the_old_price(self) -> None:
        self.assertIsNone(self._price_after(_med("51022C", 250.0), _med("AC19616321")))

    def test_same_code_without_price_keeps_the_price(self) -> None:
        self.assertEqual(self._price_after(_med("AC19616321", 11.5), _med("AC19616321")), 11.5)

    def test_sent_price_wins(self) -> None:
        self.assertEqual(self._price_after(_med("51022C", 250.0), _med("AC19616321", 11.5)), 11.5)


if __name__ == "__main__":
    unittest.main()
