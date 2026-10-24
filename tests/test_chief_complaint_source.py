"""Lookup and the chart must read the same chief complaint."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from src.core.encounter_extensions import attach_reg_extension, extract_reg_meta
from src.core.nhi_clinical_mappers import nhi_encounter_to_fhir
from src.core.nhi_encounter_validators import NhiEncounterIntake
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore


def _close(store: SqliteShadowStore) -> None:
    conn = getattr(store._local, "conn", None)
    if conn is not None:
        conn.close()
        store._local.conn = None


class ChiefComplaintSourceTest(unittest.TestCase):
    def test_lookup_uses_stored_complaint_not_the_remark(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = SqliteShadowStore(Path(tmp) / "t.db")
            store.initialize()
            with store._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO encounter_index
                      (resource_id, patient_id, encounter_date, chief_complaint)
                    VALUES ('enc-1', 'p1', '2026-10-24', ?)
                    """,
                    ("skip 4m\nfacial acne flare up",),
                )
                conn.execute(
                    """
                    INSERT INTO clinical_note_index
                      (resource_id, encounter_id, patient_id, chief_complaint)
                    VALUES ('note-1', 'enc-1', 'p1', 'HF')
                    """
                )
            self.assertEqual(
                store.lookup_chief_complaint("enc-1"),
                "skip 4m\nfacial acne flare up",
            )
            _close(store)

    def test_blank_index_falls_through_to_the_note(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = SqliteShadowStore(Path(tmp) / "t.db")
            store.initialize()
            with store._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO encounter_index
                      (resource_id, patient_id, encounter_date, chief_complaint)
                    VALUES ('enc-2', 'p1', '2026-10-24', '')
                    """
                )
                conn.execute(
                    """
                    INSERT INTO clinical_note_index
                      (resource_id, encounter_id, patient_id, chief_complaint)
                    VALUES ('note-2', 'enc-2', 'p1', 'skip 4m')
                    """
                )
            self.assertEqual(store.lookup_chief_complaint("enc-2"), "skip 4m")
            _close(store)

    def test_saving_the_complaint_updates_the_lookup_column(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = SqliteShadowStore(Path(tmp) / "t.db")
            store.initialize()
            with store._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO encounter_index
                      (resource_id, patient_id, encounter_date, chief_complaint)
                    VALUES ('enc-3', 'p1', '2026-10-24', 'HF')
                    """
                )
            store.set_encounter_chief_complaint("enc-3", "skip 4m")
            self.assertEqual(store.lookup_chief_complaint("enc-3"), "skip 4m")
            _close(store)

    def test_registration_text_is_a_visit_note_not_the_complaint(self) -> None:
        made = nhi_encounter_to_fhir(NhiEncounterIntake(patientId="p1", reasonText="HF"))
        self.assertNotIn("reasonCode", made)
        self.assertEqual(extract_reg_meta(made).get("noteMark"), "HF")

        kept = attach_reg_extension(
            {"resourceType": "Encounter", "id": "enc-1", "reasonCode": [{"text": "skip 4m"}]},
            {"noteMark": "HF"},
        )
        self.assertEqual(kept["reasonCode"], [{"text": "skip 4m"}])
        self.assertEqual(extract_reg_meta(kept).get("noteMark"), "HF")


if __name__ == "__main__":
    unittest.main()
