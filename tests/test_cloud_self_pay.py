# -*- coding: utf-8 -*-
"""Cloud save drops a cash line. Monthly claims and the daily upload already do."""

import unittest

from src.core.nhi_card_bridge import cloud_order_from_request


def _line(code: str, *, pay: str = "", memo: str = "", sig: str = "QD") -> dict:
    return {
        "indexMeta": {
            "nhiCode": code,
            "daysSupply": 3,
            "quantity": 0.5,
            "payMark": pay,
            "memo": memo,
        },
        "resource": {"dosageInstruction": [{"text": sig}]},
    }


class CloudSelfPayTest(unittest.TestCase):
    def test_cash_mark_is_not_a_cloud_order(self) -> None:
        self.assertIsNone(cloud_order_from_request(_line("PP", pay="\u81ea", sig="AsOrde")))

    def test_bracket_note_is_not_a_cloud_order(self) -> None:
        self.assertIsNone(cloud_order_from_request(_line("AC00000000", memo="[")))

    def test_insurance_line_is_kept(self) -> None:
        item = cloud_order_from_request(_line("AC19616321", sig="AsOrde"))
        self.assertIsNotNone(item)
        assert item is not None
        self.assertEqual(item["nhiCode"], "AC19616321")
        self.assertEqual(item["sig"], "AsOrde")
        self.assertEqual(item["days"], 3)

    def test_mixed_visit_keeps_only_insurance_lines(self) -> None:
        rows = [
            _line("PP", pay="\u81ea"),
            _line("AC19616321"),
            _line("XX", memo="note ["),
        ]
        kept = [cloud_order_from_request(row) for row in rows]
        codes = [item["nhiCode"] for item in kept if item]
        self.assertEqual(codes, ["AC19616321"])


if __name__ == "__main__":
    unittest.main()
