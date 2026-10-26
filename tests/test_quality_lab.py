# -*- coding: utf-8 -*-
"""KOH is a category-1 lab result. The zip name is the bureau's daily name."""

import tempfile
import unittest
import zipfile
from pathlib import Path

from src.core.quality_lab import (
    QualityLabDraft,
    QualityLabError,
    alloc_serial,
    build_lab_xml,
    order_category,
    pack_zip,
    zip_name,
)


def _xml(**overrides: str) -> bytes:
    draft = QualityLabDraft(
        order_code=overrides.get("order_code", "13017C"),
        order_name=overrides.get("order_name", "KOH"),
        result=overrides.get("result", "\u9670\u6027"),
        unit=overrides.get("unit", ""),
        specimen=overrides.get("specimen", "\u76ae\u819a"),
    )
    return build_lab_xml(
        draft,
        hosp="3521013662",
        id_no="A123456789",
        birthday="0740315",
        treat_at="1151025182336",
        treat_seq="W001",
        uploaded_at="1151025183000",
    )


class QualityLabTest(unittest.TestCase):
    def test_koh_is_a_result_not_a_narrative(self) -> None:
        self.assertEqual(order_category("13017C"), "1")
        self.assertEqual(order_category("AC19616321"), "")

    def test_xml_keeps_the_result_and_drops_a_cash_mark_character(self) -> None:
        raw = _xml(result="1 < 2").decode("big5")
        self.assertIn("<h1>1</h1>", raw)
        self.assertIn("<h15>13017C</h15>", raw)
        self.assertIn("<h7>W001</h7>", raw)
        self.assertIn("<r4>1 \uff1c 2</r4>", raw)
        self.assertNotIn("<r5>", raw)
        self.assertNotIn("<r7>", raw)

    def test_unit_is_the_measure_when_one_is_given(self) -> None:
        raw = _xml(unit="mg/dL").decode("big5")
        self.assertIn("<r5>mg/dL</r5>", raw)

    def test_zip_name_is_hosp_day_and_serial(self) -> None:
        self.assertEqual(zip_name("3521013662", "1151025183000", "001"), "35210136621151025001.zip")

    def test_zip_holds_one_xml(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = pack_zip(_xml(), "35210136621151025001.zip", Path(folder))
            with zipfile.ZipFile(path) as archive:
                names = archive.namelist()
            self.assertEqual(names, ["35210136621151025001.xml"])

    def test_serial_counts_within_the_day(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.assertEqual(alloc_serial(root, "1151025"), "001")
            self.assertEqual(alloc_serial(root, "1151025"), "002")

    def test_missing_card_time_is_refused(self) -> None:
        with self.assertRaises(QualityLabError):
            build_lab_xml(
                QualityLabDraft(order_code="13017C", order_name="KOH", result="\u9670\u6027"),
                hosp="3521013662",
                id_no="A123456789",
                birthday="0740315",
                treat_at="",
                treat_seq="W001",
                uploaded_at="1151025183000",
            )


if __name__ == "__main__":
    unittest.main()
