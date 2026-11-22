import tempfile
import unittest
from pathlib import Path

from src.core.encounter_extensions import extract_book, put_book
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore


def _enc(eid: str, **extra):
    body = {
        "resourceType": "Encounter",
        "id": eid,
        "status": "arrived",
        "subject": {"reference": "Patient/p1"},
        "period": {"start": "2026-10-24T09:00:00"},
    }
    body.update(extra)
    return body


class EncounterBookTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.store = SqliteShadowStore(Path(self.tmp.name) / "t.db")
        self.store.initialize()

    def tearDown(self):
        conn = getattr(self.store._local, "conn", None)
        if conn is not None:
            conn.close()
        self.tmp.cleanup()

    def _index(self, eid: str):
        with self.store._connect() as conn:
            row = conn.execute("SELECT * FROM encounter_index WHERE resource_id = ?", (eid,)).fetchone()
            return dict(row) if row is not None and hasattr(row, "keys") else row

    def test_put_and_extract_keep_spaces_and_types(self):
        payload = _enc("e0")
        put_book(payload, {"reg_cc": "   $  ", "times_no": 3, "owe_card": 1})
        got = extract_book(payload)
        self.assertEqual(got["reg_cc"], "   $  ")
        self.assertEqual(got["times_no"], 3)
        self.assertEqual(got["owe_card"], 1)
        put_book(payload, {"reg_cc": "", "times_no": None, "owe_card": None})
        self.assertFalse(any("encounter-book" in e["url"] for e in payload.get("extension", [])))

    def test_index_columns_come_from_book(self):
        payload = _enc("e1")
        put_book(payload, {"claim_doctor_id": "D1", "treat_seq": "0007", "slot_time": "09:00:00"})
        self.store.cache_resource("Encounter", "e1", payload)
        with self.store._connect() as conn:
            row = conn.execute(
                "SELECT claim_doctor_id, treat_seq, slot_time, owe_card FROM encounter_index WHERE resource_id='e1'"
            ).fetchone()
        self.assertEqual(tuple(row), ("D1", "0007", "09:00:00", 0))

    def test_rebuilt_payload_without_book_keeps_stored_book(self):
        payload = _enc("e2")
        put_book(payload, {"claim_pharmacist_id": "P9"})
        self.store.cache_resource("Encounter", "e2", payload)
        self.store.cache_resource("Encounter", "e2", _enc("e2", status="finished"))
        stored = self.store.get_cached_resource("Encounter", "e2")
        self.assertEqual(extract_book(stored)["claim_pharmacist_id"], "P9")
        with self.store._connect() as conn:
            got = conn.execute("SELECT claim_pharmacist_id FROM encounter_index WHERE resource_id='e2'").fetchone()
        self.assertEqual(got[0], "P9")

    def test_queue_status_change_reaches_json(self):
        self.store.cache_resource("Encounter", "e3", _enc("e3"))
        self.store.update_encounter_queue_status("e3", "cancelled", "cancelled")
        stored = self.store.get_cached_resource("Encounter", "e3")
        self.assertEqual(stored["status"], "cancelled")
        queue = next(e for e in stored["extension"] if e["url"].endswith("encounter-queue"))
        self.assertEqual({s["url"]: s.get("valueCode") for s in queue["extension"]}["queueStatus"], "cancelled")
        with self.store._connect() as conn:
            got = conn.execute("SELECT queue_status FROM encounter_index WHERE resource_id='e3'").fetchone()
        self.assertEqual(got[0], "cancelled")

    def test_first_visit_cash_book_mark_lands_in_book(self):
        self.store.cache_resource("Encounter", "e4", _enc("e4"))
        stored = self.store.get_cached_resource("Encounter", "e4")
        self.assertEqual(extract_book(stored)["reg_cc"], "   $  ")
        with self.store._connect() as conn:
            got = conn.execute("SELECT reg_cc FROM encounter_index WHERE resource_id='e4'").fetchone()
        self.assertEqual(got[0], "   $  ")


if __name__ == "__main__":
    unittest.main()
