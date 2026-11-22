import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.core import side_records
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore


class SideRecordsFhirTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.store = SqliteShadowStore(Path(self.tmp.name) / "t.db")
        self.store.initialize()

    def tearDown(self):
        conn = getattr(self.store._local, "conn", None)
        if conn is not None:
            conn.close()
        self.tmp.cleanup()

    def _row(self, table, where, params):
        with self.store._connect() as conn:
            hit = conn.execute(f"SELECT * FROM {table} WHERE {where}", params).fetchone()
            return dict(hit) if hit else None

    def _resource(self, table, key):
        spec = side_records.SPECS[table]
        return self.store.get_cached_resource(spec.rtype, side_records.resource_id(table, key))

    def test_round_trip_keeps_blank_and_null_apart(self):
        row = {"rel": "a/b.jpg", "chart_no": "", "file_name": "b.jpg", "modified": None, "size_bytes": 12, "noted_at": "x"}
        payload = side_records.to_resource("look_file", row)
        spec, back, retired = side_records.from_resource(payload)
        self.assertEqual(spec.table, "look_file")
        self.assertFalse(retired)
        self.assertEqual(back["chart_no"], "")
        self.assertNotIn("modified", back)
        self.assertEqual(back["size_bytes"], 12)

    def test_staff_pin_stays_out_of_fhir(self):
        self.store.save_staff({"id": "s9", "name": "N", "role": "R", "nhiId": None, "certNo": "", "pin": "4321"})
        self.assertEqual(self._row("clinic_staff", "id=?", ("s9",))["pin"], "4321")
        payload = self._resource("clinic_staff", "s9")
        self.assertNotIn("4321", str(payload))
        self.store.save_staff({"id": "s9", "name": "N2", "role": "R", "pin": "4321"})
        self.assertEqual(self._row("clinic_staff", "id=?", ("s9",))["name"], "N2")
        self.store.delete_staff("s9")
        self.assertIsNone(self._row("clinic_staff", "id=?", ("s9",)))
        kept = self._resource("clinic_staff", "s9")
        self.assertFalse(kept["active"])
        self.assertTrue(side_records.from_resource(kept)[2])

    def test_look_media_does_not_enter_media_index(self):
        self.store.put_side_row(
            "look_file",
            {"rel": "0001/x.jpg", "chart_no": "0001", "file_name": "x.jpg", "modified": "2026-10-01", "size_bytes": 5, "noted_at": "t"},
        )
        self.assertEqual(self._row("look_file", "rel=?", ("0001/x.jpg",))["size_bytes"], 5)
        with self.store._connect() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM media_index").fetchone()[0], 0)
        self.store.patch_side_rows("look_file", "rel=?", ("0001/x.jpg",), {"modified": "2026-10-02"})
        self.assertEqual(self._row("look_file", "rel=?", ("0001/x.jpg",))["modified"], "2026-10-02")
        self.assertIn("2026-10-02", str(self._resource("look_file", "0001/x.jpg")))

    def test_referral_save_and_remove_go_through_fhir(self):
        from src.core import referral_desk

        self.store.cache_resource("Encounter", "e1", {
            "resourceType": "Encounter", "id": "e1", "status": "finished",
            "subject": {"reference": "Patient/p1"}, "period": {"start": "2026-10-01T09:00:00"},
        })
        with mock.patch.object(referral_desk, "get_shadow_store", return_value=self.store):
            saved = referral_desk.save_slip({"kind": "out", "encounterId": "e1", "destHosp": "H", "historyText": "h"})
            slip_id = saved["id"]
            payload = self._resource("referral_slip", slip_id)
            self.assertEqual(payload["resourceType"], "ServiceRequest")
            self.assertEqual(payload["subject"]["reference"], "Patient/p1")
            self.assertEqual(payload["encounter"]["reference"], "Encounter/e1")
            self.assertEqual(self._row("referral_slip", "id=?", (slip_id,))["history_text"], "h")
            referral_desk.mark_uploaded(slip_id, local_id="L", nhi_id="N", status="up")
            self.assertEqual(self._row("referral_slip", "id=?", (slip_id,))["nhi_id"], "N")
            referral_desk.remove_slip(slip_id)
            self.assertIsNone(self._row("referral_slip", "id=?", (slip_id,)))
            self.assertEqual(self._resource("referral_slip", slip_id)["status"], "entered-in-error")


if __name__ == "__main__":
    unittest.main()
