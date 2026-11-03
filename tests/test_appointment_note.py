import unittest

from src.infrastructure.sqlite_shadow_store import _note_after_checkin

WORD = "\u9810\u7d04"


class AppointmentNoteTests(unittest.TestCase):
    def test_kept_while_still_appointment(self):
        self.assertEqual(_note_after_checkin(WORD, True), WORD)

    def test_hidden_after_checkin(self):
        self.assertEqual(_note_after_checkin(WORD, False), "")
        self.assertEqual(_note_after_checkin(f" {WORD} ", False), "")

    def test_other_notes_untouched(self):
        other = WORD + "\u4e0b\u9031\u56de\u8a3a"
        self.assertEqual(_note_after_checkin(other, False), other)
        self.assertEqual(_note_after_checkin("", False), "")


if __name__ == "__main__":
    unittest.main()
