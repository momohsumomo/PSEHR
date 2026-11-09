import unittest
from unittest import mock

from src.core import nhi_referral


def _sign(id_no: str) -> dict:
    return {"hcIdNo": id_no, "hospitalId": "H", "signature": "s", "clientRandom": "r", "samId": "S", "hcId": "C"}


class CardSwapTest(unittest.TestCase):
    def test_other_card_is_not_queried(self):
        with mock.patch("src.core.nhi_seq_bridge.posted_sign", return_value=_sign("B123456789")), \
                mock.patch.object(nhi_referral, "request_json") as call:
            out = nhi_referral.query_referrals("A123456789", desk_sign={"x": 1})
        call.assert_not_called()
        self.assertFalse(out["ok"])
        self.assertEqual(out["reason"], nhi_referral.CARD_SWAPPED)
        self.assertEqual(out["slips"], [])

    def test_same_card_is_queried(self):
        with mock.patch("src.core.nhi_seq_bridge.posted_sign", return_value=_sign("a123456789")), \
                mock.patch.object(nhi_referral, "request_json", return_value=(200, {"RtnCode": "00", "sub": []})) as call:
            out = nhi_referral.query_referrals("A123456789", desk_sign={"x": 1})
        call.assert_called_once()
        self.assertEqual(call.call_args.kwargs["body"]["sPatId"], "A123456789")
        self.assertTrue(out["ok"])


if __name__ == "__main__":
    unittest.main()
