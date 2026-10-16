import unittest

from src.core.local_print import printer_job_settings


class PrinterOrientationTest(unittest.TestCase):
    def test_a4_certificate_is_portrait(self):
        self.assertEqual(printer_job_settings(210, 297), "paper=A4,portrait,noscale")

    def test_a4_landscape_stays_landscape(self):
        self.assertEqual(printer_job_settings(297, 210), "paper=A4,landscape,noscale")

    def test_receipt_does_not_force_a4(self):
        self.assertEqual(printer_job_settings(114, 101.6), "noscale")


if __name__ == "__main__":
    unittest.main()
