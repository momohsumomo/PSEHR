import unittest

from src.core.register_guard import duplicate_register_message


def _row(pid: str, shift: str, number: int, status: str = "waiting") -> dict:
    return {"queueMeta": {"patientId": pid, "shift": shift, "queueNumber": number, "queueStatus": status}}


class RegisterGuardTest(unittest.TestCase):
    def test_same_person_same_shift_needs_confirm(self) -> None:
        msg = duplicate_register_message(
            [_row("p1", "\u4e0b\u5348", 3)],
            patient_id="p1",
            shift="\u4e0b\u5348",
            queue_number=9,
            confirm=False,
        )
        self.assertTrue(msg)

    def test_confirm_allows(self) -> None:
        msg = duplicate_register_message(
            [_row("p1", "\u4e0b\u5348", 3)],
            patient_id="p1",
            shift="\u4e0b\u5348",
            queue_number=3,
            confirm=True,
        )
        self.assertEqual(msg, "")

    def test_other_shift_is_not_a_clash(self) -> None:
        msg = duplicate_register_message(
            [_row("p1", "\u4e0a\u5348", 3)],
            patient_id="p1",
            shift="\u4e0b\u5348",
            queue_number=3,
            confirm=False,
        )
        self.assertEqual(msg, "")

    def test_taken_number_blocks_another_person(self) -> None:
        msg = duplicate_register_message(
            [_row("p1", "\u4e0b\u5348", 3)],
            patient_id="p2",
            shift="\u4e0b\u5348",
            queue_number=3,
            confirm=False,
        )
        self.assertTrue(msg)


if __name__ == "__main__":
    unittest.main()
