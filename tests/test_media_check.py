# -*- coding: utf-8 -*-
import unittest

from src.claims.engine import ClaimEncounterRecord, ClaimMedLine
from src.claims.media_check import add_unfinished, check_media
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

    def test_missing_birthday_blocks(self) -> None:
        report = check_media([_visit(birthdayRoc="", birthDate="")])
        self.assertFalse(report["canExport"])
        self.assertTrue(any(row["code"] == "birthday" for row in report["blocks"]))

    def test_same_diagnosis_warns_only_when_the_month_is_heavy(self) -> None:
        visits = [
            _visit(encounterId=f"v{n}", encounterDate=f"2026-01-{3 * n + 1:02d}") for n in range(6)
        ]
        five = check_media(visits[:5])
        self.assertFalse(any(row["code"] == "dx-repeat" for row in five["warnings"]))
        six = check_media(visits)
        self.assertEqual(sum(1 for row in six["warnings"] if row["code"] == "dx-repeat"), 1)

    def test_liquid_quantity_below_dose_is_not_warned(self) -> None:
        report = check_media([
            _visit(medications=[ClaimMedLine("m", "MA1", "syrup", 0, 1, 22, 66, "daily", doseEach=2.0)]),
        ])
        self.assertFalse(any(row["code"] == "qty" for row in report["warnings"]))

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

    def test_open_deposit_is_listed_first_and_left_out(self) -> None:
        held = _visit(encounterId="d", claimable=False, depositOpen=True, medicalNo="099003")
        repeats = [
            _visit(encounterId=f"r{n}", encounterDate=f"2026-01-{n + 2:02d}") for n in range(3)
        ]
        report = check_media([*repeats, held])
        self.assertEqual(report["claimable"], 3)
        self.assertEqual(report["warnings"][0]["code"], "deposit-open")

    def test_unfinished_visits_are_warned_on_top(self) -> None:
        report = add_unfinished(
            check_media([_visit()]),
            [{"medicalNo": "099004", "encounterDate": "2026-01-31", "status": "waiting"}],
        )
        self.assertTrue(report["canExport"])
        self.assertEqual(report["warnings"][0]["code"], "unfinished")
        self.assertEqual(report["unfinished"], 1)

    def test_lab_billed_by_the_clinic_is_warned(self) -> None:
        own = check_media([
            _visit(
                treatmentPoints=50,
                medications=[
                    ClaimMedLine("m", "MA1", "daily", 0, 3, 22, 66, "daily"),
                    ClaimMedLine("g", "09005C", "glucose", 0, 1, 50, 50, "snapshot"),
                ],
            ),
        ])
        self.assertTrue(any(row["code"] == "lab-own" for row in own["warnings"]))
        sent = check_media([
            _visit(
                medications=[
                    ClaimMedLine("m", "MA1", "daily", 0, 3, 22, 66, "daily"),
                    ClaimMedLine("g", "09005C", "glucose", 0, 1, 0, 0, "snapshot", payMark="\u4ea4"),
                ],
            ),
        ])
        self.assertFalse(any(row["code"] == "lab-own" for row in sent["warnings"]))

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
