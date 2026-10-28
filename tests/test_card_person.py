import unittest

from src.core.nhi_seq_bridge import reject_other_card


class CardPersonTest(unittest.TestCase):
    def test_same_person_can_take_a_number(self) -> None:
        self.assertIsNone(reject_other_card("A123456789", "a123456789"))

    def test_another_card_is_refused(self) -> None:
        self.assertIsNotNone(reject_other_card("A123456789", "B123456789"))

    def test_missing_card_id_is_refused_when_the_chart_has_one(self) -> None:
        self.assertIsNotNone(reject_other_card("A123456789", ""))

    def test_no_chart_id_does_not_invent_a_mismatch(self) -> None:
        self.assertIsNone(reject_other_card("", "B123456789"))


if __name__ == "__main__":
    unittest.main()
