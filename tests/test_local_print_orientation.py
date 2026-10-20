import unittest

from src.core.local_print import printer_job_settings, short_edge_portrait


class PrinterOrientationTest(unittest.TestCase):
    def test_a4_certificate_is_portrait(self):
        self.assertEqual(
            printer_job_settings(210, 297),
            "paper=A4,portrait,noscale,disable-auto-rotation",
        )

    def test_a4_landscape_stays_landscape(self):
        self.assertEqual(
            printer_job_settings(297, 210),
            "paper=A4,landscape,noscale,disable-auto-rotation",
        )

    def test_receipt_does_not_force_a4(self):
        self.assertEqual(printer_job_settings(114, 101.6), "noscale,disable-auto-rotation")

    def test_feed_can_turn_a_portrait_form(self):
        self.assertEqual(
            printer_job_settings(210, 297, "landscape"),
            "paper=A4,landscape,noscale",
        )

    def test_feed_matching_the_form_stays_locked(self):
        self.assertEqual(
            printer_job_settings(210, 297, "portrait"),
            "paper=A4,portrait,noscale,disable-auto-rotation",
        )

    def test_wide_short_sheet_turns_onto_the_driver_form(self):
        self.assertEqual(short_edge_portrait(210, 93, "portrait"), (93, 210, True))
        self.assertEqual(
            printer_job_settings(93, 210, "portrait"),
            "portrait,noscale,disable-auto-rotation",
        )

    def test_wide_short_sheet_landscape_stays_wide(self):
        self.assertEqual(short_edge_portrait(210, 93, "landscape"), (210, 93, False))

    def test_wide_short_sheet_can_stay_landscape(self):
        self.assertEqual(
            printer_job_settings(210, 93, "landscape"),
            "landscape,noscale,disable-auto-rotation",
        )


if __name__ == "__main__":
    unittest.main()
