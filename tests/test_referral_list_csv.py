import base64
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.api.routers import referral as route
from src.core import referral_desk, referral_inbox
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore

PERSON = "A123456789"
HEAD = [
    "\u8f49\u8a3a\u55ae\u5e8f\u865f", "\u8eab\u5206\u8b49\u865f", "\u59d3\u540d", "\u958b\u55ae\u65e5\u671f",
    "\u6709\u6548\u671f\u9650", "\u8f49\u51fa\u9662\u6240\u4ee3\u78bc", "\u8f49\u51fa\u9662\u6240",
    "\u72c0\u614b", "\u9662\u6240\u81ea\u7de8\u5e8f\u865f",
]
ROW = [
    "'2026101312345678", "A123456789", "\u6e2c\u8a66", "115/10/13", "116/01/11", "'3512345678",
    "\u6e2c\u8a66\u8a3a\u6240", "\u672a\u53d7\u7406", "'35123456782026101300001",
]


def _csv(encoding: str, bom: bool) -> bytes:
    text = ",".join(HEAD) + "\r\n" + ",".join(ROW) + "\r\n"
    data = text.encode(encoding)
    return (b"\xef\xbb\xbf" + data) if bom else data


class ListCsvTest(unittest.TestCase):
    def test_parse_utf8_bom_and_big5(self):
        for raw in (_csv("utf-8", True), _csv("cp950", False)):
            rows = referral_inbox.parse_list_csv(raw)
            self.assertEqual(len(rows), 1)
            self.assertEqual(referral_inbox._cell(rows[0], HEAD[0]), "2026101312345678")

    def test_roc_dates_become_western(self):
        self.assertEqual(referral_inbox._ymd("115/10/13"), "20261013")
        self.assertEqual(referral_inbox._ymd("115/11/16 18:01:34"), "20261116")
        self.assertEqual(referral_inbox._ymd("1151013"), "20261013")
        self.assertEqual(referral_inbox._ymd("20261013"), "20261013")

    def test_pull_apply_from_raw_file_feeds_registration_match(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            store = SqliteShadowStore(Path(tmp) / "t.db")
            store.initialize()
            with mock.patch.object(referral_inbox, "get_shadow_store", return_value=store), \
                    mock.patch.object(referral_desk, "get_shadow_store", return_value=store), \
                    mock.patch.object(route, "get_shadow_store", return_value=store):
                body = route.ReferralPullApplyBody(
                    localId="L1", kind="2", csvB64=base64.b64encode(_csv("utf-8", True)).decode("ascii")
                )
                applied = route.referral_pull_apply(body)
                out = route.referral_pending(route.ReferralQueryBody(idNo=PERSON))
        self.assertEqual(applied["count"], 1)
        self.assertEqual(len(out["slips"]), 1)
        slip = out["slips"][0]
        self.assertEqual(slip["serial"], "2026101312345678")
        self.assertEqual(slip["hospId"], "3512345678")
        self.assertEqual(slip["openDate"], "20261013")

    def test_pull_asks_for_ninety_days(self):
        self.assertEqual(route.LIST_WINDOW_DAYS, 90)


if __name__ == "__main__":
    unittest.main()
