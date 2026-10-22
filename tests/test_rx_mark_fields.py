# -*- coding: utf-8 -*-
"""Saving a prescription keeps the self-pay mark and the memo mark."""

import unittest

from src.api.schemas.common import Reference
from src.api.schemas.medication_request import DosageInstruction, MedicationRequestBody
from src.infrastructure.sqlite_shadow_store import _medication_request_index_fields


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

    def test_missing_mark_does_not_invent_a_column_write(self) -> None:
        body = MedicationRequestBody(
            status="active",
            drugText="plain",
            nhiCode="AC00000000",
            subject=Reference(reference="Patient/p1"),
        )
        fields = _medication_request_index_fields(body.to_fhir_dict())
        self.assertNotIn("pay_mark", fields)
        self.assertNotIn("memo_mark", fields)


if __name__ == "__main__":
    unittest.main()
