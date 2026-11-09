"""Yisheng-imported patients keep their sex and ROC birthday after a re-save."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from src.infrastructure.sqlite_shadow_store import (
    SqliteShadowStore,
    _apply_index_migrations,
    _patient_index_fields,
)

_CLINIC = "https://clinic.org/fhir/StructureDefinition/patient-clinic-ext"


def _close(store: SqliteShadowStore) -> None:
    conn = getattr(store._local, "conn", None)
    if conn is not None:
        conn.close()
        store._local.conn = None


def _imported(gender: str, roc_in_clinic: str | None = None) -> dict:
    subs = [{"url": "idCategory", "valueString": "D"}]
    if roc_in_clinic:
        subs.append({"url": "birthdayRoc", "valueString": roc_in_clinic})
    return {
        "resourceType": "Patient",
        "id": "p1",
        "gender": gender,
        "birthDate": "1970-05-24",
        "extension": [{"url": _CLINIC, "extension": subs}],
    }


class PatientIndexSexFallbackTest(unittest.TestCase):
    def test_gender_fills_sex_without_card_block(self) -> None:
        self.assertEqual(_patient_index_fields(_imported("female"))["sex"], "F")
        self.assertEqual(_patient_index_fields(_imported("male"))["sex"], "M")

    def test_roc_from_clinic_block_or_birth_date(self) -> None:
        self.assertEqual(_patient_index_fields(_imported("female", "0590524"))["birthday_roc"], "0590524")
        self.assertEqual(_patient_index_fields(_imported("female"))["birthday_roc"], "0590524")

    def test_card_block_still_wins(self) -> None:
        payload = _imported("male")
        payload["extension"].append(
            {
                "url": "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/nhi-card-basic",
                "extension": [{"url": "sex", "valueCode": "F"}, {"url": "birthdayRoc", "valueString": "0590525"}],
            }
        )
        fields = _patient_index_fields(payload)
        self.assertEqual((fields["sex"], fields["birthday_roc"]), ("F", "0590525"))

    def test_startup_repairs_blank_rows(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = SqliteShadowStore(Path(tmp) / "t.db")
            store.initialize()
            try:
                with store._connect() as conn:
                    conn.execute(
                        "INSERT INTO resource_cache (resource_type, resource_id, payload_json) VALUES ('Patient', 'p1', ?)",
                        (json.dumps(_imported("female")),),
                    )
                    conn.execute(
                        "INSERT INTO patient_index (resource_id, birth_date, sex, birthday_roc) VALUES ('p1', '1970-05-24', NULL, NULL)"
                    )
                    _apply_index_migrations(conn)
                    row = conn.execute(
                        "SELECT sex, birthday_roc FROM patient_index WHERE resource_id='p1'"
                    ).fetchone()
                self.assertEqual(tuple(row), ("F", "0590524"))
            finally:
                _close(store)


if __name__ == "__main__":
    unittest.main()
