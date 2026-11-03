import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.core import referral_inbox
from src.core.encounter_extensions import REG_EXTENSION_URL
from src.core.nhi_referral import ReferralSlip
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore

PERSON = "A123456789"
NOT_TAKEN = "\u672a\u53d7\u7406"
TAKEN = "\u5df2\u53d7\u7406"


def _slip(serial: str, hosp: str, opened: str, status: str = NOT_TAKEN, kind: str = "2") -> ReferralSlip:
    return ReferralSlip(
        serial=serial,
        hosp_seq="",
        open_date=opened,
        kind=kind,
        summary="",
        deleted=False,
        hosp_id=hosp,
        hosp_name="H" + hosp,
        status=status,
    )


class PendingIncomingTests(unittest.TestCase):
    def _run(self, slips, check):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            store = SqliteShadowStore(Path(tmp) / "t.db")
            store.initialize()
            with mock.patch.object(referral_inbox, "get_shadow_store", return_value=store):
                referral_inbox.remember_download(PERSON, slips)
                check()

    def test_picks_the_notice_from_the_chosen_hospital(self):
        def check():
            hit = referral_inbox.pending_incoming(PERSON, "111")
            self.assertIsNotNone(hit)
            self.assertEqual(hit.serial, "S1")

        self._run([_slip("S1", "111", "20261103"), _slip("S2", "222", "20261104")], check)

    def test_other_hospital_is_not_taken(self):
        def check():
            self.assertIsNone(referral_inbox.pending_incoming(PERSON, "999"))

        self._run([_slip("S1", "111", "20261103")], check)

    def test_without_hospital_takes_newest(self):
        def check():
            self.assertEqual(referral_inbox.pending_incoming(PERSON).serial, "S2")

        self._run([_slip("S1", "111", "20261101"), _slip("S2", "222", "20261103")], check)

    def test_accepted_outbound_and_bureau_taken_are_skipped(self):
        def check():
            self.assertIsNone(referral_inbox.pending_incoming(PERSON))
            referral_inbox.mark_accepted("S1")

        self._run(
            [
                _slip("S3", "111", "20261103", status=TAKEN),
                _slip("S4", "111", "20261103", kind="1"),
            ],
            check,
        )

    def test_desk_acceptance_alone_does_not_hold_the_notice(self):
        def check():
            referral_inbox.mark_accepted("S1")
            self.assertEqual(referral_inbox.pending_incoming(PERSON, "111").serial, "S1")

        self._run([_slip("S1", "111", "20261103")], check)

    def _visit(self, store, status: str) -> None:
        payload = {
            "resourceType": "Encounter",
            "id": "e1",
            "status": status,
            "extension": [
                {
                    "url": REG_EXTENSION_URL,
                    "extension": [
                        {"url": "acceptReferral", "valueString": "1"},
                        {"url": "referralSeq", "valueString": "S1"},
                    ],
                }
            ],
        }
        with store._connect() as conn:
            conn.execute("INSERT INTO patient_index (resource_id, id_no) VALUES ('p1', ?)", (PERSON,))
            conn.execute("INSERT INTO encounter_index (resource_id, patient_id, encounter_date) VALUES ('e1', 'p1', '2026-11-03')")
            conn.execute(
                "INSERT INTO resource_cache (resource_type, resource_id, payload_json) VALUES ('Encounter', 'e1', ?)",
                (json.dumps(payload),),
            )

    def _with_visit(self, status: str):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            store = SqliteShadowStore(Path(tmp) / "t.db")
            store.initialize()
            self._visit(store, status)
            with mock.patch.object(referral_inbox, "get_shadow_store", return_value=store):
                referral_inbox.remember_download(PERSON, [_slip("S1", "111", "20261103")])
                referral_inbox.mark_accepted("S1")
                return referral_inbox.pending_incoming(PERSON, "111")

    def test_standing_visit_holds_the_notice(self):
        self.assertIsNone(self._with_visit("arrived"))

    def test_cancelled_visit_gives_the_notice_back(self):
        hit = self._with_visit("cancelled")
        self.assertIsNotNone(hit)
        self.assertEqual(hit.serial, "S1")


if __name__ == "__main__":
    unittest.main()
