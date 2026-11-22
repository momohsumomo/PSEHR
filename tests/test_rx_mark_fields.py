# -*- coding: utf-8 -*-
"""Saving a prescription keeps the self-pay mark and the memo mark."""

import tempfile
import unittest
from pathlib import Path

from src.api.schemas.common import Reference
from src.api.schemas.medication_request import DosageInstruction, MedicationRequestBody
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore, _medication_request_index_fields


class RxMarkFieldsTest(unittest.TestCase):
    def test_update_body_keeps_marks_days_and_sig(self) -> None:
        body = MedicationRequestBody(
            status="active",
            drugText="Welizen f.c. tablets",
            nhiCode="AC37601100",
            subject=Reference(reference="Patient/p1"),
            encounter=Reference(reference="Encounter/e1"),
            dosageInstruction=[DosageInstruction(text="QD")],
            payMark="\u81ea",
            memo="[",
            daysSupply=7,
            quantity=1,
        )
        fields = _medication_request_index_fields(body.to_fhir_dict())
        self.assertEqual(fields["pay_mark"], "\u81ea")
        self.assertEqual(fields["memo_mark"], "[")
        self.assertEqual(fields["days_supply"], 7)
        self.assertEqual(fields["quantity"], 1)
        self.assertEqual(fields["useage"], "QD")

    def test_save_without_marks_keeps_the_stored_marks(self) -> None:
        def body(**marks):
            return MedicationRequestBody(
                status="active",
                drugText="plain",
                nhiCode="AC00000000",
                subject=Reference(reference="Patient/p1"),
                **marks,
            ).to_fhir_dict()

        plain = _medication_request_index_fields(body())
        self.assertIsNone(plain["pay_mark"])
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            store = SqliteShadowStore(Path(tmp) / "t.db")
            store.initialize()
            try:
                store.cache_resource("MedicationRequest", "m1", body(payMark="\u81ea", memo="["))
                store.cache_resource("MedicationRequest", "m1", body())
                with store._connect() as conn:
                    row = conn.execute(
                        "SELECT pay_mark, memo_mark FROM medication_request_index WHERE resource_id = 'm1'"
                    ).fetchone()
                self.assertEqual(tuple(row), ("\u81ea", "["))
                stored = _medication_request_index_fields(store.get_cached_resource("MedicationRequest", "m1"))
                self.assertEqual((stored["pay_mark"], stored["memo_mark"]), ("\u81ea", "["))
                store.cache_resource("MedicationRequest", "m1", body(payMark=""))
                self.assertIsNone(
                    _medication_request_index_fields(store.get_cached_resource("MedicationRequest", "m1"))["pay_mark"]
                )
            finally:
                conn = getattr(store._local, "conn", None)
                if conn is not None:
                    conn.close()


if __name__ == "__main__":
    unittest.main()
