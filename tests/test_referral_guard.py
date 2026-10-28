"""Referral delete window. No network and no database."""
import unittest
from datetime import datetime

from src.core.nhi_referral import build_delete_xml, build_list_request
from src.core.referral_guard import classify


class ReferralGuardTests(unittest.TestCase):
    def test_draft_leaves_with_the_registration(self) -> None:
        row = {"kind": "out", "status": "\u8349\u7a3f", "uploadedAt": ""}
        self.assertEqual(classify(row)["action"], "draft")

    def test_outbound_inside_one_hour_can_delete(self) -> None:
        now = datetime(2026, 10, 28, 15, 0, 0)
        row = {"kind": "out", "status": "\u5df2\u4e0a\u50b3", "uploadedAt": "2026-10-28 14:10:00"}
        self.assertEqual(classify(row, now)["action"], "delete-open")

    def test_outbound_after_one_hour_stays(self) -> None:
        now = datetime(2026, 10, 28, 15, 0, 0)
        row = {"kind": "out", "status": "\u5df2\u4e0a\u50b3", "uploadedAt": "2026-10-28 13:59:00"}
        self.assertEqual(classify(row, now)["action"], "keep")

    def test_reply_same_day_can_delete(self) -> None:
        now = datetime(2026, 10, 28, 18, 0, 0)
        row = {"kind": "reply", "status": "\u5df2\u56de\u8986", "openedOn": "2026-10-28", "uploadedAt": "2026-10-28 09:00:00"}
        self.assertEqual(classify(row, now)["action"], "delete-reply")

    def test_reply_other_day_stays(self) -> None:
        now = datetime(2026, 10, 28, 18, 0, 0)
        row = {"kind": "reply", "status": "\u5df2\u56de\u8986", "openedOn": "2026-10-27", "uploadedAt": "2026-10-27 09:00:00"}
        self.assertEqual(classify(row, now)["action"], "keep")

    def test_delete_open_xml_uses_the_published_fields(self) -> None:
        xml = build_delete_xml(
            kind="out",
            hosp="3501200000",
            serial="2026102800000001",
            self_seq="",
            doctor_id="A123456789",
            reason="\u7576\u65e5\u9000\u639b",
        ).decode("big5")
        self.assertIn("<etghosp>", xml)
        self.assertIn("<h1>2026102800000001</h1>", xml)
        self.assertIn("<h2>1</h2>", xml)
        self.assertIn("<h4>A123456789</h4>", xml)
        self.assertNotIn("<h5>", xml)

    def test_delete_reply_marks_kind_two(self) -> None:
        xml = build_delete_xml(
            kind="reply",
            hosp="3501200000",
            serial="",
            self_seq="35012000002026102800001",
            doctor_id="A123456789",
            reason="\u7576\u65e5\u9000\u639b",
        ).decode("big5")
        self.assertIn("<ethhosp>", xml)
        self.assertIn("<h2>2</h2>", xml)
        self.assertIn("<h5>35012000002026102800001</h5>", xml)

    def test_list_request_matches_the_sample(self) -> None:
        body = build_list_request("20261027", "20261028").decode("ascii")
        self.assertEqual(body, "UPLOAD_S_DATE=20261027\r\nUPLOAD_E_DATE=20261028\r\n")


if __name__ == "__main__":
    unittest.main()
