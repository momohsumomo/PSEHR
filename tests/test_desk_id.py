import unittest

from src.core.nhi_encounter_validators import NhiEncounterIntake
from src.core.nhi_validators import NhiValidationError, _old_arc_ok, screen_desk_id


def _one_old_arc() -> str:
    for n in range(100_000_000):
        text = f"AB{n:08d}"
        if _old_arc_ok(text):
            return text
    raise AssertionError("no sample")


class DeskIdTests(unittest.TestCase):
    def test_blank_and_national_and_other(self) -> None:
        self.assertEqual(screen_desk_id(""), "")
        self.assertEqual(screen_desk_id("  a123456789 "), "A123456789")
        self.assertEqual(screen_desk_id("PA998877"), "PA998877")
        self.assertEqual(screen_desk_id("fc12345678"), "FC12345678")
        with self.assertRaises(NhiValidationError):
            screen_desk_id("A123456788")
        with self.assertRaises(NhiValidationError):
            screen_desk_id("\u738b\u5c0f\u660e")

    def test_old_arc_check_digit(self) -> None:
        good = _one_old_arc()
        self.assertEqual(screen_desk_id(good), good)
        bad = good[:-1] + ("0" if good[-1] != "0" else "1")
        self.assertEqual(screen_desk_id(bad), bad)

    def test_register_keeps_blank_and_two_letter_ids(self) -> None:
        blank = NhiEncounterIntake(patientId="p1", patientIdNo="  ")
        self.assertIsNone(blank.patientIdNo)
        two = NhiEncounterIntake(patientId="p1", patientIdNo="fc12345678")
        self.assertEqual(two.patientIdNo, "FC12345678")
        digits = NhiEncounterIntake(patientId="p1", patientIdNo="103318")
        self.assertEqual(digits.patientIdNo, "103318")


if __name__ == "__main__":
    unittest.main()
