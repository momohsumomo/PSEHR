import unittest

from src.claims.nocard_seq import claim_seq_for, pair_nocard
from src.claims.xml_export_nhi import _treat_seq


class NocardSeqTests(unittest.TestCase):
    def test_bad_card_is_b000_only_with_a_real_id(self) -> None:
        reason, seq = pair_nocard(
            mode="badCard",
            reason="",
            treat_seq="",
            treatment_number="1" * 20,
        )
        self.assertEqual(reason, "\u5361\u7247\u4e0d\u826f")
        self.assertEqual(seq, "B000")

    def test_failed_nocard_does_not_invent_a_sequence(self) -> None:
        _reason, seq = pair_nocard(
            mode="badCard",
            reason="",
            treat_seq="",
            treatment_number="",
        )
        self.assertEqual(seq, "")

    def test_other_reasons_keep_their_codes(self) -> None:
        self.assertEqual(claim_seq_for("noCard", "\u8b80\u5361\u6a5f\u6545\u969c"), "A000")
        self.assertEqual(claim_seq_for("noCard", "\u505c\u96fb"), "F000")
        self.assertEqual(claim_seq_for("childNoCard", "\u5152\u5c11\u7121\u5361\u4f8b\u5916"), "G000")
        self.assertEqual(claim_seq_for("ic", ""), "")

    def test_monthly_seq_keeps_letter_codes(self) -> None:
        self.assertEqual(_treat_seq("B000"), "B000")
        self.assertEqual(_treat_seq("123456"), "3456")
        self.assertEqual(_treat_seq(""), "")


if __name__ == "__main__":
    unittest.main()
