import unittest

from hub.normalize import roc_yyyymmdd_to_iso


class RocDateTest(unittest.TestCase):
    def test_six_digit_roc_year(self) -> None:
        self.assertEqual(roc_yyyymmdd_to_iso("840301"), "1995-03-01")

    def test_seven_digit_roc_year(self) -> None:
        self.assertEqual(roc_yyyymmdd_to_iso("1001130"), "2011-11-30")

    def test_western(self) -> None:
        self.assertEqual(roc_yyyymmdd_to_iso("20260401"), "2026-04-01")

    def test_bad_month(self) -> None:
        self.assertIsNone(roc_yyyymmdd_to_iso("841301"))


if __name__ == "__main__":
    unittest.main()
