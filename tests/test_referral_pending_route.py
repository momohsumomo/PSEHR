import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.api.routers import referral as route
from src.core import nhi_referral, referral_inbox
from src.core.nhi_referral import ReferralSlip
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore

PERSON = "A123456789"
NOT_TAKEN = "\u672a\u53d7\u7406"
TAKEN = "\u5df2\u53d7\u7406"


def _slip(serial: str, opened: str, status: str = NOT_TAKEN, kind: str = "2") -> ReferralSlip:
    return ReferralSlip(serial=serial, hosp_seq="", open_date=opened, kind=kind, summary="",
                        deleted=False, hosp_id="H" + serial, hosp_name="Hosp" + serial, status=status)


class PendingRouteTest(unittest.TestCase):
    def test_lists_only_open_incoming_without_bureau_call(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            store = SqliteShadowStore(Path(tmp) / "t.db")
            store.initialize()
            with mock.patch.object(referral_inbox, "get_shadow_store", return_value=store), \
                    mock.patch.object(nhi_referral, "request_json") as bureau:
                referral_inbox.remember_download(PERSON, [
                    _slip("S1", "20261101"),
                    _slip("S2", "20261105"),
                    _slip("S3", "20261106", status=TAKEN),
                    _slip("S4", "20261107", kind="1"),
                ])
                out = route.referral_pending(route.ReferralQueryBody(idNo=PERSON.lower()))
            bureau.assert_not_called()
        self.assertTrue(out["ok"])
        self.assertEqual([row["serial"] for row in out["slips"]], ["S2", "S1"])
        self.assertEqual(out["slips"][0]["summary"], "HospS2")


if __name__ == "__main__":
    unittest.main()
