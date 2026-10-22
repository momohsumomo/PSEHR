# -*- coding: utf-8 -*-
import unittest

from src.claims.engine import ClaimEncounterRecord, ClaimMedLine
from src.claims.media_check import check_media
from src.claims.specialty_templates import list_templates, merge_order_rules


def _visit(**kwargs: object) -> ClaimEncounterRecord:
    base = dict(
        encounterId="e1",
        queueNumber=1,
        patientId="A123456789",
        patientName="",
        diagnoses="L700",
        consultationPoints=220,
        drugPoints=66,
        totalPoints=286,
        medications=[
            ClaimMedLine("m", "MA1", "daily", 0, 3, 22, 66, "daily"),
        ],
        doctorId="DOC",
        birthDate="1980-01-01",
        birthdayRoc="0690101",
        encounterDate="2026-01-02",
        caseNo="01",
        diagnosisCodes=["L700"],
        claimable=True,
        medicalNo="099001",
    )
    base.update(kwargs)
    return ClaimEncounterRecord(**base)  # type: ignore[arg-type]


class MediaCheckTests(unittest.TestCase):
    def test_clean_visit_can_export(self) -> None:
        report = check_media([_visit()])
        self.assertEqual(report["blockCount"], 0)
        self.assertTrue(report["canExport"])

    def test_missing_birthday_blocks_and_repeat_dx_only_warns(self) -> None:
        first = _visit(encounterId="a", encounterDate="2026-01-02")
        second = _visit(
            encounterId="b",
            encounterDate="2026-01-20",
            birthdayRoc="",
            birthDate="",
            medicalNo="099002",
        )
        report = check_media([first, second])
        self.assertFalse(report["canExport"])
        self.assertTrue(any(row["code"] == "birthday" for row in report["blocks"]))
        self.assertTrue(any(row["code"] == "dx-repeat" for row in report["warnings"]))

    def test_external_cause_cannot_be_the_primary_diagnosis(self) -> None:
        blocked = check_media([
            _visit(diagnosisCodes=["W260XXA", "S61001A"], diagnoses="W260XXA"),
        ])
        self.assertFalse(blocked["canExport"])
        self.assertTrue(any(row["code"] == "dx-external" for row in blocked["blocks"]))

        warned = check_media([
            _visit(diagnosisCodes=["S61001A", "W260XXA"], diagnoses="S61001A"),
        ])
        self.assertTrue(warned["canExport"])
        self.assertTrue(any(row["code"] == "dx-external-2" for row in warned["warnings"]))

    def test_preventive_primary_warns_without_blocking(self) -> None:
        report = check_media([
            _visit(diagnosisCodes=["Z1289"], diagnoses="Z1289", caseNo="04"),
        ])
        self.assertEqual(report["blockCount"], 0)
        self.assertTrue(report["canExport"])
        self.assertTrue(any(row["code"] == "a3" for row in report["warnings"]))

    def test_procedure_points_are_not_a_drug_sum_error(self) -> None:
        report = check_media([
            _visit(
                drugPoints=8,
                treatmentPoints=250,
                medications=[
                    ClaimMedLine("d", "AC43306100", "tab", 5, 1, 1.5, 8, "pack"),
                    ClaimMedLine("p", "51022C", "cryo", 1, 1, 250, 250, "snapshot"),
                ],
            ),
        ])
        self.assertFalse(any(row["code"] == "drug-sum" for row in report["blocks"]))
        self.assertTrue(report["canExport"])

    def test_dermatology_template_merges_orders(self) -> None:
        ids = [row["id"] for row in list_templates()]
        self.assertIn("dermatology", ids)
        merged = merge_order_rules(
            [{"code": "51020C", "name": "old", "reason": "keep"}],
            [{"code": "51020C", "name": "new", "reason": "skip"}, {"code": "51022C", "name": "cryo", "reason": "add"}],
        )
        self.assertEqual([row["code"] for row in merged], ["51020C", "51022C"])
        self.assertEqual(merged[0]["reason"], "keep")


if __name__ == "__main__":
    unittest.main()
