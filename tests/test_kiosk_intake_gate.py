"""Who may fill the waiting-room intake, and where the answer goes."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from src.api.routers.kiosk import doctor_saved_encounters, intake_access
from src.core.encounter_extensions import (
    REG_EXTENSION_URL,
    attach_previsit_extension,
    previsit_text,
)
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore


def _booked() -> dict:
    return {
        "resourceType": "Encounter",
        "id": "enc-1",
        "extension": [{"url": REG_EXTENSION_URL, "extension": [{"url": "prebook", "valueBoolean": True}]}],
    }


class KioskIntakeGateTest(unittest.TestCase):
    def test_appointment_not_checked_in_cannot_fill(self) -> None:
        self.assertEqual(intake_access(_booked(), "waiting", saved=False, held=False), "appointment")

    def test_checked_in_appointment_can_fill(self) -> None:
        self.assertEqual(intake_access(_booked(), "in_progress", saved=False, held=False), "open")
        plain = {"resourceType": "Encounter", "id": "enc-2"}
        self.assertEqual(intake_access(plain, "waiting", saved=False, held=False), "open")

    def test_doctor_saved_or_finished_is_seen(self) -> None:
        plain = {"resourceType": "Encounter", "id": "enc-2"}
        self.assertEqual(intake_access(plain, "waiting", saved=True, held=False), "seen")
        self.assertEqual(intake_access(plain, "finished", saved=False, held=False), "seen")

    def test_saved_visits_come_from_note_diagnosis_or_drug(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = SqliteShadowStore(Path(tmp) / "t.db")
            store.initialize()
            with store._connect() as conn:
                conn.execute(
                    "INSERT INTO clinical_note_index (resource_id, encounter_id, patient_id, chief_complaint)"
                    " VALUES ('n1', 'enc-note', 'p1', 'x')"
                )
                conn.execute(
                    "INSERT INTO condition_index (resource_id, patient_id, encounter_id) VALUES ('c1', 'p1', 'enc-dx')"
                )
                conn.execute(
                    "INSERT INTO medication_request_index (resource_id, patient_id, encounter_id, status)"
                    " VALUES ('m1', 'p1', 'enc-cancel', 'cancelled')"
                )
                saved = doctor_saved_encounters(conn, ["enc-note", "enc-dx", "enc-cancel", "enc-none"])
            conn = getattr(store._local, "conn", None)
            if conn is not None:
                conn.close()
                store._local.conn = None
        self.assertEqual(saved, {"enc-note", "enc-dx"})

    def test_intake_is_not_the_chief_complaint(self) -> None:
        enc = {"resourceType": "Encounter", "id": "enc-1", "reasonCode": [{"text": "doctor wrote this"}]}
        out = attach_previsit_extension(
            enc, chief_complaint="Itching on the scalp.", symptom_tags=["scalp"], submitted_at="2026-11-21T10:00:00+08:00"
        )
        self.assertEqual(out["reasonCode"], [{"text": "doctor wrote this"}])
        self.assertEqual(previsit_text(out), "Itching on the scalp.")

    def test_filling_again_drops_an_old_kiosk_sentence_from_the_complaint(self) -> None:
        old = attach_previsit_extension(
            {"resourceType": "Encounter", "id": "enc-1"},
            chief_complaint="Itching on the scalp.",
            symptom_tags=[],
            submitted_at="2026-11-21T10:00:00+08:00",
        )
        old["reasonCode"] = [{"text": "Itching on the scalp."}]
        out = attach_previsit_extension(
            old, chief_complaint="Pain on the R hand.", symptom_tags=[], submitted_at="2026-11-21T10:05:00+08:00"
        )
        self.assertNotIn("reasonCode", out)
        self.assertEqual(previsit_text(out), "Pain on the R hand.")


if __name__ == "__main__":
    unittest.main()
