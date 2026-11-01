import unittest

from src.core.nhi_cshis6_client import status_hint
from src.core.nhi_seq_bridge import request_hc_content_update


class Cshis6StatusTests(unittest.TestCase):
    def test_3201_is_card_past_validity(self) -> None:
        self.assertEqual(status_hint(3201), "\u9019\u5f35\u5361\u8d85\u904e\u6709\u6548\u671f\u9650")

    def test_3213_is_zero_visit_slots(self) -> None:
        self.assertEqual(status_hint(3213), "\u9019\u5f35\u5361\u7684\u5c31\u91ab\u53ef\u7528\u6b21\u6578\u662f\u96f6")

    def test_3100_names_the_signature_failure(self) -> None:
        self.assertIn("\u9a57\u8b49\u7c3d\u7ae0\u5931\u6557", status_hint(3100))

    def test_format_errors_share_one_hint(self) -> None:
        self.assertIn("3050", status_hint(3050))
        self.assertIn("\u683c\u5f0f", status_hint(3050))

    def test_card_update_refuses_without_a_desk_signature(self) -> None:
        result = request_hc_content_update(desk_sign={})
        self.assertFalse(result.ok)
        self.assertIn("NEED_DESK_SIGN", result.reason)


if __name__ == "__main__":
    unittest.main()
