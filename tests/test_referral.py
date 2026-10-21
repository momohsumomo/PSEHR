"""Referral slip parsing. No network."""
import unittest

from src.core.nhi_referral import choose_incoming, parse_slips
from src.core.referral_desk import physician_ids


SAMPLE = (
    '{"RtnCode":"00","RtnNum":"2","sub":[{"oEtData":"'
    "\u672c\u8cc7\u6599\u5df2\u88ab\u6771\u5340\u865b\u64ec\u8a3a\u522a\u9664\u3002,"
    '2021004112345678,35012000002021032600004,20261012,4,'
    "\u63a5\u53d7_\u8f49\u56de,3545010000,"
    "\u6771\u5340\u865b\u64ec\u8a3a,\u672a\u53d7\u7406,2,20270110"
    '"},{"oEtData":"'
    "\u81fa\u5317\u865b\u64ec\u8a3a\u65bc2019\u5e745\u67083\u65e5\u958b\u7acb\u8f49\u8a3a\u55ae\u81f3\u672c\u9662\u6240\uff0c"
    "\u76ee\u524d\u72c0\u614b\u70ba\u5df2\u53d7\u7406\u672a\u56de\u5fa9\u3002,"
    '2019002112345678,35012000002019050300004,20190503,2,'
    "\u63a5\u53d7\u8f49\u8a3a,3501200000,"
    "\u81fa\u5317\u865b\u64ec\u8a3a,\u5df2\u53d7\u7406\u672a\u56de\u5fa9,,20190801"
    '"}]}'
)


class ReferralParseTests(unittest.TestCase):
    def test_picks_live_incoming_not_deleted(self) -> None:
        slips = parse_slips(SAMPLE)
        self.assertEqual(len(slips), 2)
        chosen = choose_incoming(slips)
        self.assertIsNotNone(chosen)
        assert chosen is not None
        self.assertEqual(chosen.serial, "2019002112345678")
        self.assertEqual(chosen.kind, "2")
        self.assertFalse(chosen.deleted)

    def test_physician_list_keeps_id_and_drops_pin(self) -> None:
        rows = physician_ids(
            [
                {"name": "\u7532", "nhiId": "A123456789", "pin": "1234"},
                {"name": "\u4e59", "nhiId": "not-an-id", "pin": "9999"},
            ]
        )
        self.assertEqual(rows, [{"name": "\u7532", "nhiId": "A123456789"}])
        self.assertNotIn("pin", rows[0])


if __name__ == "__main__":
    unittest.main()
