# -*- coding: utf-8 -*-
import unittest

from src.claims.engine import _filed_copay_code, _under_three


def _code(stored: str = "", paid: float = 50, drug: int = 0, mark: str = "", child: bool = False, case: str = "01") -> str:
    return _filed_copay_code(stored, paid=paid, drug_copay=drug, card_mark=mark, under_three=child, case_no=case)


class FiledCopayCodeTests(unittest.TestCase):
    def test_desk_code_is_kept(self) -> None:
        self.assertEqual(_code("001", paid=0), "001")

    def test_blank_ordinary_visit_is_d12_or_d24(self) -> None:
        self.assertEqual(_code(), "D12")
        self.assertEqual(_code(paid=70, drug=20), "D24")

    def test_under_three_with_nothing_collected_is_902(self) -> None:
        self.assertEqual(_code(paid=0, child=True), "902")
        self.assertEqual(_code(paid=50, child=True), "D12")

    def test_exemption_follows_the_card_mark_only(self) -> None:
        self.assertEqual(_code(paid=0, mark="2"), "004")
        self.assertEqual(_code(paid=0, mark="1"), "003")
        self.assertEqual(_code(paid=0, mark="4"), "D12")

    def test_clinic_discount_files_as_ordinary(self) -> None:
        self.assertEqual(_code(paid=0), "D12")

    def test_other_cases_are_left_alone(self) -> None:
        self.assertEqual(_code(case="08"), "")

    def test_third_birthday_ends_902(self) -> None:
        self.assertTrue(_under_three("2023-11-01", "2026-10-31"))
        self.assertFalse(_under_three("2023-10-31", "2026-10-31"))


if __name__ == "__main__":
    unittest.main()
