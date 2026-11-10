"""Self-pay paper referrals: reopen on the visit, never upload, never feed the claim."""

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.api.routers import referral as route
from src.claims import engine
from src.core import referral_desk
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore


def _close(store: SqliteShadowStore) -> None:
    conn = getattr(store._local, "conn", None)
    if conn is not None:
        conn.close()
        store._local.conn = None


class ReferralPaperSlipTest(unittest.TestCase):
    def test_paper_slip_reopens_and_stays_off_nhi(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            store = SqliteShadowStore(Path(tmp) / "t.db")
            store.initialize()
            try:
                with mock.patch.object(referral_desk, "get_shadow_store", return_value=store):
                    nhi = referral_desk.save_slip(
                        {"kind": "out", "encounterId": "e-nhi", "destCode": "0421040011", "fax": "06-1"}
                    )
                    paper = referral_desk.save_slip(
                        {"kind": "out", "encounterId": "e-self", "destCode": "0421040011", "paper": "Y"}
                    )
                    referral_desk.mark_uploaded(nhi["id"], local_id="L1", nhi_id="N1", status="done")
                    referral_desk.save_slip({"kind": "out", "id": nhi["id"], "encounterId": "e-nhi", "destCode": "0421040011"})
                    self.assertEqual(referral_desk.get_slip(nhi["id"])["status"], "done")
                    again = route.referral_out_for("e-self")["item"]
                    self.assertEqual(again["id"], paper["id"])
                    self.assertEqual(again["paper"], "Y")
                    self.assertEqual(route.referral_out_for("e-nhi")["item"]["fax"], "06-1")
                    self.assertIsNone(route.referral_out_for("e-none")["item"])
                    refused = route._pack_upload(again)
                    self.assertFalse(refused["ok"])
                    codes = engine._outbound_referral_codes(store)
                self.assertEqual(codes, {"e-nhi": "0421040011"})
                self.assertTrue(nhi["id"])
            finally:
                _close(store)


if __name__ == "__main__":
    unittest.main()
