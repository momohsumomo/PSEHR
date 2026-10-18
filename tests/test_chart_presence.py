import unittest

from src.core.chart_presence import claim, clear_for_tests, held_encounter_ids, release


class ChartPresenceTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_for_tests()

    def test_another_workstation_is_blocked_while_the_chart_is_open(self):
        self.assertTrue(claim("enc-1", "desk", now=10))
        self.assertFalse(claim("enc-1", "doctor", now=20))
        self.assertEqual(held_encounter_ids(["enc-1"], now=20), {"enc-1"})

    def test_the_same_workstation_can_keep_its_own_chart(self):
        self.assertTrue(claim("enc-1", "doctor", now=10))
        self.assertTrue(claim("enc-1", "doctor", now=20))

    def test_leaving_the_chart_frees_it(self):
        claim("enc-1", "doctor", now=10)
        release("enc-1", "doctor")
        self.assertEqual(held_encounter_ids(["enc-1"], now=11), set())
        self.assertTrue(claim("enc-1", "desk", now=11))

    def test_a_quiet_screen_stops_counting_as_open(self):
        claim("enc-1", "doctor", now=10)
        self.assertEqual(held_encounter_ids(["enc-1"], now=56), set())
        self.assertTrue(claim("enc-1", "desk", now=56))
