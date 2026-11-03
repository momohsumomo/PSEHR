import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.core import referral_desk, referral_inbox
from src.core.encounter_extensions import REG_EXTENSION_URL
from src.core.nhi_referral import ReferralSlip, build_accept_xml
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore

PERSON = "A123456789"
NOT_TAKEN = "\u672a\u53d7\u7406"
TAKEN = "\u5df2\u53d7\u7406"


def _notice(status: str = NOT_TAKEN) -> ReferralSlip:
    return ReferralSlip(
        serial="S1",
        hosp_seq="",
        open_date="20261103",
        kind="2",
        summary="",
        deleted=False,
        hosp_id="111",
        hosp_name="H111",
        status=status,
    )


def _visit(conn, encounter_id: str, status: str = "arrived") -> None:
    payload = {
        "resourceType": "Encounter",
        "id": encounter_id,
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
    conn.execute(
        "INSERT OR REPLACE INTO encounter_index (resource_id, patient_id, encounter_date) VALUES (?, 'p1', '2026-11-03')",
        (encounter_id,),
    )
    conn.execute(
        "INSERT OR REPLACE INTO resource_cache (resource_type, resource_id, payload_json) VALUES ('Encounter', ?, ?)",
        (encounter_id, json.dumps(payload)),
    )


class AcceptFlowTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.store = SqliteShadowStore(Path(self._tmp.name) / "t.db")
        self.store.initialize()
        with self.store._connect() as conn:
            conn.execute("INSERT INTO patient_index (resource_id, id_no) VALUES ('p1', ?)", (PERSON,))
        self._patches = [
            mock.patch.object(referral_inbox, "get_shadow_store", return_value=self.store),
            mock.patch.object(referral_desk, "get_shadow_store", return_value=self.store),
        ]
        for patch in self._patches:
            patch.start()
        referral_inbox.remember_download(PERSON, [_notice()])

    def tearDown(self):
        for patch in self._patches:
            patch.stop()
        self._tmp.cleanup()

    def _accept(self, encounter_id: str):
        with self.store._connect() as conn:
            _visit(conn, encounter_id)
        return referral_desk.take_incoming("S1", encounter_id, id_no=PERSON, hosp_name="H111")

    def _cancel(self, encounter_id: str) -> None:
        with self.store._connect() as conn:
            _visit(conn, encounter_id, "cancelled")
        referral_desk.release_for_encounter(encounter_id)

    def test_accepting_moves_the_notice_to_the_reply_list(self):
        slip = self._accept("e1")
        self.assertEqual(slip["status"], referral_desk.WAITING)
        self.assertEqual(slip["encounterId"], "e1")
        self.assertEqual(slip["openedOn"], "2026-11-03")
        self.assertEqual(referral_inbox.list_downloads(), [])
        self.assertIsNone(referral_inbox.pending_incoming(PERSON))

    def test_cancel_then_register_again_asks_again_even_after_bureau_took_it(self):
        first = self._accept("e1")
        self._cancel("e1")
        released = referral_desk.get_slip(first["id"])
        self.assertEqual(released["encounterId"], "")
        self.assertEqual(released["status"], referral_desk.WAITING)
        taken = _notice(TAKEN)
        referral_inbox.remember_download(PERSON, [taken])
        self.assertEqual([row.serial for row in referral_inbox.prompts_for(PERSON, [taken])], ["S1"])
        self.assertEqual(referral_inbox.pending_incoming(PERSON).serial, "S1")
        second = self._accept("e2")
        self.assertEqual(second["id"], first["id"])
        self.assertEqual(second["encounterId"], "e2")
        self.assertEqual(referral_inbox.prompts_for(PERSON, [taken]), [])

    def test_reply_save_reuses_the_accepted_row(self):
        first = self._accept("e1")
        saved = referral_desk.save_slip(
            {"kind": "reply", "encounterId": "e1", "serial": "S1", "diagnosis": "L300", "status": "\u5df2\u5b58\u6a94"}
        )
        self.assertEqual(saved["id"], first["id"])
        with self.store._connect() as conn:
            count = conn.execute("SELECT COUNT(*) FROM referral_slip WHERE kind='reply'").fetchone()[0]
        self.assertEqual(count, 1)

    def test_waiting_row_does_not_upload_an_empty_reply(self):
        from src.api.routers import referral

        slip = self._accept("e1")
        packed = referral._pack_upload(slip)
        self.assertFalse(packed["ok"])

    def test_uploaded_reply_is_not_released_by_cancel(self):
        first = self._accept("e1")
        referral_desk.mark_uploaded(first["id"], local_id="L1", nhi_id="N1", status="\u5df2\u56de\u8986")
        self._cancel("e1")
        self.assertEqual(referral_desk.get_slip(first["id"])["encounterId"], "e1")


class AcceptFileTests(unittest.TestCase):
    def test_accept_file_has_serial_kind_and_day(self):
        text = build_accept_xml(serial="2026110300000001", hosp="1234567890", accepted_on="2026-11-03").decode("big5")
        self.assertIn("<etehosp>", text)
        self.assertIn("<h1>2026110300000001</h1>", text)
        self.assertIn("<h2>1</h2>", text)
        self.assertIn("<h3>20261103</h3>", text)


if __name__ == "__main__":
    unittest.main()
