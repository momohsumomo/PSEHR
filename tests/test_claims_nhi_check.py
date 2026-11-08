"""Visits the bureau's content check rejected in fee month 115/10."""

import unittest

from src.claims.engine import (
    ClaimEncounterRecord,
    ClaimMedLine,
    ClaimsSummary,
    _filed_copay_code,
    _referral_fee_destination,
)
from src.claims.media_check import check_media
from src.claims.xml_export_nhi import render_nhi_outpatient_xml
from src.core.icd_crosswalk import claim_code


def _xml(meds: list[ClaimMedLine]) -> str:
    rec = ClaimEncounterRecord(
        encounterId="enc-1",
        queueNumber=1,
        patientId="X000000000",
        patientName="test",
        diagnoses="L700",
        consultationPoints=220,
        drugPoints=0,
        totalPoints=220,
        doctorId="A000000000",
        encounterDate="2026-10-15",
        caseNo="09",
        treatSeq="0001",
        copayPoints=50,
        medications=meds,
    )
    summary = ClaimsSummary(
        yearMonth="2026-10",
        yearMonthRoc="11510",
        finishedEncounters=1,
        totalConsultationPoints=220,
        totalDrugPoints=0,
        totalPoints=220,
        records=[rec],
    )
    return render_nhi_outpatient_xml(summary)


def _pdata(xml: str, code: str) -> str:
    for part in xml.split("<pdata>")[1:]:
        body = part.split("</pdata>")[0]
        if f"<p4>{code}</p4>" in body:
            return body
    raise AssertionError(code)


class CopayCodeTest(unittest.TestCase):
    def _code(self, stored: str, drug_copay: int, case_no: str = "01") -> str:
        return _filed_copay_code(
            stored,
            paid=50 + drug_copay,
            drug_copay=drug_copay,
            card_mark="",
            under_three=False,
            case_no=case_no,
        )

    def test_hospital_code_d10_files_as_clinic_code(self):
        self.assertEqual(self._code("D10", 0), "D12")
        self.assertEqual(self._code("D10", 20), "D24")

    def test_code_follows_the_drug_copay(self):
        self.assertEqual(self._code("D12", 20, "04"), "D24")
        self.assertEqual(self._code("D24", 0, "09"), "D12")

    def test_exemption_codes_are_kept(self):
        self.assertEqual(self._code("004", 0), "004")
        self.assertEqual(self._code("902", 0), "902")


class OrderShapeTest(unittest.TestCase):
    def test_referral_fee_is_type_g_with_dates(self):
        body = _pdata(_xml([ClaimMedLine("m", "01036C", "ref", 1, 1, 0, 0, "snapshot")]), "01036C")
        self.assertIn("<p3>G</p3>", body)
        self.assertIn("<p10>0.0</p10>", body)
        self.assertIn("<p12>0</p12>", body)
        self.assertIn("<p14>11510150000</p14>", body)
        self.assertIn("<p15>11510150000</p15>", body)
        self.assertNotIn("<p8>", body)

    def test_in_house_lab_writes_dispense_zero(self):
        body = _pdata(_xml([ClaimMedLine("m", "13017C", "koh", 1, 1, 75, 75, "snapshot")]), "13017C")
        self.assertIn("<p2>0</p2>", body)
        self.assertIn("<p3>2</p3>", body)
        proc = _pdata(_xml([ClaimMedLine("m", "51017C", "op", 1, 1, 100, 100, "snapshot")]), "51017C")
        self.assertNotIn("<p2>", proc)

    def test_drug_without_sig_files_asorde(self):
        med = ClaimMedLine("m", "AC19616321", "cream", 3, 1, 0, 0, "snapshot", useage="", routeCode="TOPI")
        body = _pdata(_xml([med]), "AC19616321")
        self.assertIn("<p7>ASORDE</p7>", body)


class DiagnosisBookTest(unittest.TestCase):
    def test_codes_missing_a_character_are_completed(self):
        self.assertEqual(claim_code("T1490"), "T1490XA")
        self.assertEqual(claim_code("L91", "keloid scar"), "L910")
        self.assertEqual(claim_code("N83", "follicular cyst of ovary"), "N8300")

    def test_valid_codes_are_kept(self):
        self.assertEqual(claim_code("L700"), "L700")
        self.assertEqual(claim_code("S80212A"), "S80212A")
        self.assertEqual(claim_code("L30.9"), "L309")


class ReferralOutTest(unittest.TestCase):
    """115/10 again: four referral-fee visits filed d18=N; their slips came from Yisheng undated."""

    def _fee(self) -> list[ClaimMedLine]:
        return [ClaimMedLine("m", "01036C", "ref", 1, 1, 0, 0, "snapshot")]

    def test_fee_visit_takes_the_undated_slip_of_that_chart(self):
        unlinked = {"1234": [("", "2026-10-20 01:05:36", "1101010012")]}
        self.assertEqual(_referral_fee_destination(self._fee(), unlinked, "001234", "2026-10-12"), "1101010012")

    def test_same_day_slip_wins(self):
        unlinked = {"1234": [("", "2026-10-21", "1101010012"), ("2026-10-12", "2026-10-12", "0401180014")]}
        self.assertEqual(_referral_fee_destination(self._fee(), unlinked, "1234", "2026-10-12"), "0401180014")

    def test_no_fee_no_destination(self):
        unlinked = {"1234": [("", "2026-10-20", "1101010012")]}
        self.assertEqual(_referral_fee_destination([], unlinked, "1234", "2026-10-12"), "")

    def test_check_blocks_fee_without_destination_and_wrong_sex(self):
        rec = ClaimEncounterRecord(
            encounterId="e", queueNumber=1, patientId="D100000000", patientName="t", diagnoses="",
            consultationPoints=220, drugPoints=0, totalPoints=220, doctorId="A000000000",
            encounterDate="2026-10-30", caseNo="09", treatSeq="0001", sex="M",
            diagnosisCodes=["N8300"], medications=self._fee(), birthdayRoc="0750211",
        )
        codes = {b["code"] for b in check_media([rec])["blocks"]}
        self.assertIn("referral-out", codes)
        self.assertIn("dx-sex", codes)
        rec.referralOutHosp = "1101010012"
        rec.diagnosisCodes = ["L0292"]
        codes = {b["code"] for b in check_media([rec])["blocks"]}
        self.assertNotIn("referral-out", codes)
        self.assertNotIn("dx-sex", codes)


if __name__ == "__main__":
    unittest.main()
