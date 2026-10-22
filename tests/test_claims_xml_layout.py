"""Monthly claim XML should follow this clinic's filed visit shape."""

import unittest

from src.claims.yisheng_rules import apply_daily_drug_fee, claim_supply_days, daily_drug_fee, pharmacy_supply_days, shorter_flat_days
from src.claims.engine import (
    ClaimEncounterRecord,
    ClaimMedLine,
    ClaimsSummary,
    _billed_quantity,
    _catalog_lookup,
)
from src.claims.xml_export_nhi import render_nhi_outpatient_xml


def _summary(rec: ClaimEncounterRecord) -> ClaimsSummary:
    return ClaimsSummary(
        yearMonth="2026-01",
        yearMonthRoc="11501",
        finishedEncounters=1,
        totalConsultationPoints=rec.consultationPoints,
        totalDrugPoints=rec.drugPoints,
        totalPoints=rec.totalPoints,
        records=[rec],
    )


def _visit(**kwargs) -> ClaimEncounterRecord:
    base = dict(
        encounterId="enc-1",
        queueNumber=1,
        patientId="X000000000",
        patientName="test",
        diagnoses="L70.0",
        consultationPoints=220,
        drugPoints=28,
        totalPoints=248,
        doctorId="A000000000",
        encounterDate="2026-01-15",
        caseNo="01",
        treatSeq="0001",
        copayPoints=50,
        medications=[
            ClaimMedLine(
                medicationRequestId="mr-1",
                nhiCode="AC37344100",
                drugText="cream",
                daysSupply=7,
                quantity=14,
                unitPrice=2,
                linePoints=28,
                priceSource="snapshot",
                useage="BID",
                doseEach=1,
                routeCode="PO",
            )
        ],
    )
    base.update(kwargs)
    return ClaimEncounterRecord(**base)


class ClaimsXmlLayoutTest(unittest.TestCase):
    def test_pdata_sits_inside_dbody_and_drug_sig_is_written(self):
        _test_pdata_sits_inside_dbody_and_drug_sig_is_written()

    def test_card_id_is_copied_only_when_stored(self):
        _test_card_id_is_copied_only_when_stored()

    def test_drug_copay_is_the_amount_above_basic(self):
        _test_drug_copay_is_the_amount_above_basic()

    def test_zero_point_order_is_unpriced_kind(self):
        _test_zero_point_order_is_unpriced_kind()

    def test_dose_times_frequency_times_days_is_the_billed_total(self):
        _test_dose_times_frequency_times_days_is_the_billed_total()

    def test_unknown_usage_is_not_multiplied(self):
        _test_unknown_usage_is_not_multiplied()

    def test_delegate_lab_writes_institution_and_one_decimal(self):
        _test_delegate_lab_writes_institution_and_one_decimal()

    def test_plain_order_keeps_one_decimal_without_lab_code(self):
        _test_plain_order_keeps_one_decimal_without_lab_code()

    def test_makeup_card_and_referral_are_written_only_when_stored(self):
        _test_makeup_card_and_referral_are_written_only_when_stored()

    def test_spec_treat_codes_follow_the_visit_then_the_diagnosis(self):
        _test_spec_treat_codes_follow_the_visit_then_the_diagnosis()

    def test_missing_dose_still_writes_two_decimals(self):
        _test_missing_dose_still_writes_two_decimals()

    def test_bid_pc_files_the_package_total_not_the_dose(self):
        dose, total = _billed_quantity(
            raw_qty=2.5,
            qty_known=True,
            days=3,
            sig="bid/pc",
            nhi_code="AC46614143",
            usages={"bid/pc": (0.0, "3")},
        )
        self.assertEqual(dose, 2.5)
        self.assertEqual(total, 1.0)
        dose2, total2 = _billed_quantity(
            raw_qty=2.5,
            qty_known=True,
            days=3,
            sig="bid/pc",
            nhi_code="AC46614143",
            usages={"bid/pc": (0.0, "3")},
            total_qty=2,
        )
        self.assertEqual(dose2, 2.5)
        self.assertEqual(total2, 2.0)

    def test_case_01_three_days_uses_daily_drug_fee(self):
        rec = _visit(
            caseNo="01",
            medications=[
                ClaimMedLine(
                    medicationRequestId="mr-1",
                    nhiCode="AC37344100",
                    drugText="cream",
                    daysSupply=3,
                    quantity=3,
                    unitPrice=2,
                    linePoints=6,
                    priceSource="snapshot",
                    useage="QD",
                    doseEach=1,
                    routeCode="PO",
                )
            ],
        )
        points = apply_daily_drug_fee(rec, days=3, case="01")
        self.assertEqual(points, 66)
        xml = render_nhi_outpatient_xml(_summary(rec))
        self.assertIn("<p3>4</p3>\n<p4>AC37344100</p4>", xml)
        self.assertIn("<p4>AC37344100</p4>", xml)
        self.assertIn("<p1>3</p1>", xml)
        self.assertIn("<p11>0.00</p11>", xml)
        self.assertIn("<p12>0</p12>", xml)
        self.assertIn("<p3>1</p3>\n<p4>MA1</p4>", xml)
        self.assertIn("<p12>66</p12>", xml)
        self.assertNotIn("<p4>MA1</p4>\n<p5>", xml)
        self.assertEqual(daily_drug_fee(3, bottled_kinds=1, age=8), ("MA2", 31, 93))
        self.assertEqual(daily_drug_fee(3, bottled_kinds=1, age=20), ("MA1", 22, 66))
        self.assertIsNone(daily_drug_fee(4))
        other = _visit(
            caseNo="04",
            medications=[
                ClaimMedLine(
                    medicationRequestId="mr-2",
                    nhiCode="AC37344100",
                    drugText="cream",
                    daysSupply=3,
                    quantity=3,
                    unitPrice=2,
                    linePoints=6,
                    priceSource="snapshot",
                )
            ],
        )
        self.assertEqual(apply_daily_drug_fee(other, days=3, case="04"), 6)
        self.assertEqual(other.medications[0].linePoints, 6)
        mixed = [
            ClaimMedLine("o", "ORAL", "tab", 3, 1, 1, 1, "snapshot", routeCode="PO"),
            ClaimMedLine("t", "CREAM", "cream", 7, 1, 1, 1, "snapshot", routeCode="TOPI"),
        ]
        self.assertEqual(claim_supply_days(mixed), 3)
        self.assertEqual(pharmacy_supply_days(mixed), 7)
        self.assertEqual(shorter_flat_days(mixed), 3)
        long = [
            ClaimMedLine("o", "ORAL", "tab", 5, 1, 1, 1, "snapshot", routeCode="PO"),
            ClaimMedLine("t", "CREAM", "cream", 14, 1, 1, 1, "snapshot", routeCode="TOPI"),
        ]
        self.assertEqual(pharmacy_supply_days(long), 14)
        self.assertIsNone(shorter_flat_days(long))
        _dose, total = _billed_quantity(
            raw_qty=15,
            qty_known=True,
            days=3,
            sig="AsOrde",
            nhi_code="AC39368100",
            usages={"AsOrde": (0.0, "")},
        )
        self.assertEqual(total, 15.0)

    def test_clinic_usage_table_turns_bid_dose_into_total(self):
        usages, _routes = _catalog_lookup(object())
        dose, total = _billed_quantity(
            raw_qty=1,
            qty_known=True,
            days=3,
            sig="BID",
            nhi_code="AC37344100",
            usages=usages,
        )
        self.assertEqual(dose, 1)
        self.assertEqual(total, 6)


def _test_pdata_sits_inside_dbody_and_drug_sig_is_written():
    xml = render_nhi_outpatient_xml(_summary(_visit()))
    assert xml.index("<pdata>") < xml.index("</dbody>")
    assert xml.index("</dbody>") < xml.index("</ddata>")
    assert "<d57>50</d57>" in xml
    assert "<d58>0</d58>" in xml
    assert "<d59>" not in xml
    assert "<d60>" not in xml
    assert "<p1>7</p1>" in xml
    assert "<p5>1.00</p5>" in xml
    assert "<p7>BID</p7>" in xml
    assert "<p9>PO</p9>" in xml
    assert "<p10>14.0</p10>" in xml


def _test_card_id_is_copied_only_when_stored():
    xml = render_nhi_outpatient_xml(
        _summary(_visit(treatmentId="12345678901234567890"))
    )
    assert "<d60>12345678901234567890</d60>" in xml


def _test_drug_copay_is_the_amount_above_basic():
    xml = render_nhi_outpatient_xml(
        _summary(_visit(copayPoints=70, drugCopayPoints=20))
    )
    assert "<d40>70</d40>" in xml
    assert "<d57>50</d57>" in xml
    assert "<d58>20</d58>" in xml


def _test_zero_point_order_is_unpriced_kind():
    rec = _visit(
        medications=[
            ClaimMedLine(
                medicationRequestId="mr-2",
                nhiCode="51020C",
                drugText="incision",
                daysSupply=1,
                quantity=1,
                unitPrice=0,
                linePoints=0,
                priceSource="snapshot",
            )
        ]
    )
    xml = render_nhi_outpatient_xml(_summary(rec))
    assert "<p3>4</p3>" in xml
    assert "<p4>51020C</p4>" in xml
    assert "<p1>" not in xml


def _test_dose_times_frequency_times_days_is_the_billed_total():
    dose, total = _billed_quantity(
        raw_qty=1,
        qty_known=True,
        days=7,
        sig="BID",
        nhi_code="AC37344100",
        usages={"BID": (2, "1")},
    )
    assert dose == 1
    assert total == 14


def _test_unknown_usage_is_not_multiplied():
    dose, total = _billed_quantity(
        raw_qty=1,
        qty_known=True,
        days=7,
        sig="QD",
        nhi_code="AC37344100",
        usages={},
    )
    assert dose is None
    assert total == 1


def _test_delegate_lab_writes_institution_and_one_decimal():
    rec = _visit(
        medications=[
            ClaimMedLine(
                medicationRequestId="mr-lab",
                nhiCode="08011C",
                drugText="lab",
                daysSupply=1,
                quantity=1,
                unitPrice=0,
                linePoints=0,
                priceSource="snapshot",
                payMark="\u4ea4",
                delegateLabCode="JY21050018",
            )
        ]
    )
    xml = render_nhi_outpatient_xml(_summary(rec))
    assert "<p2>4</p2>" in xml
    assert "<p3>4</p3>" in xml
    assert "<p4>08011C</p4>" in xml
    assert "<p10>1.0</p10>" in xml
    assert "<p24>JY21050018</p24>" in xml
    assert "<p11>" not in xml.split("<p4>08011C</p4>", 1)[1].split("</pdata>", 1)[0]


def _test_plain_order_keeps_one_decimal_without_lab_code():
    rec = _visit(
        medications=[
            ClaimMedLine(
                medicationRequestId="mr-2",
                nhiCode="51020C",
                drugText="incision",
                daysSupply=1,
                quantity=1,
                unitPrice=50,
                linePoints=50,
                priceSource="snapshot",
            )
        ]
    )
    xml = render_nhi_outpatient_xml(_summary(rec))
    block = xml.split("<p4>51020C</p4>", 1)[1].split("</pdata>", 1)[0]
    assert "<p10>1.0</p10>" in block
    assert "<p24>" not in block
    assert "<p2>" not in block


def _test_makeup_card_and_referral_are_written_only_when_stored():
    plain = render_nhi_outpatient_xml(_summary(_visit()))
    assert "<d61>" not in plain
    deposit_only = render_nhi_outpatient_xml(
        _summary(
            _visit(
                treatmentId="12345678901234567890",
                actualTreatId="09876543210987654321",
                icRemark="1",
            )
        )
    )
    assert "<d60>12345678901234567890</d60>" in deposit_only
    assert "<d61>" not in deposit_only
    assert "<d16>" not in plain
    assert "<d17>" not in plain
    assert "<d55>" not in plain
    assert "<d18>N</d18>" in plain
    marked = render_nhi_outpatient_xml(
        _summary(
            _visit(
                treatmentId="12345678901234567890",
                actualTreatId="09876543210987654321",
                icRemark="2",
                referralInMark="1",
                referralInHosp="3521013662",
                referralOutHosp="0123456789",
                copayCode="004",
                copayPoints=0,
                basicCopayPoints=50,
                drugCopayPoints=20,
            )
        )
    )
    assert "<d60>12345678901234567890</d60>" in marked
    assert "<d61>09876543210987654321</d61>" in marked
    assert "<d16>1</d16>" in marked
    assert "<d17>3521013662</d17>" in marked
    assert "<d18>Y</d18>" in marked
    assert "<d55>0123456789</d55>" in marked
    assert "<d43>70</d43>" in marked
    assert marked.index("<d41>") < marked.index("<d43>") < marked.index("<d49>")
    assert marked.index("<d55>") < marked.index("<d57>")
    assert marked.index("<d60>") < marked.index("<d61>")


def _test_spec_treat_codes_follow_the_visit_then_the_diagnosis():
    xml = render_nhi_outpatient_xml(
        _summary(_visit(specTreatCodes=["G8", "29"]))
    )
    assert "<d4>G8</d4>" in xml
    assert "<d5>29</d5>" in xml
    assert xml.index("<d4>") < xml.index("<d8>")
    plain = render_nhi_outpatient_xml(_summary(_visit()))
    assert "<d4>" not in plain


def _test_missing_dose_still_writes_two_decimals():
    rec = _visit(
        medications=[
            ClaimMedLine(
                medicationRequestId="mr-1",
                nhiCode="AC37344100",
                drugText="tab",
                daysSupply=7,
                quantity=1,
                unitPrice=2,
                linePoints=2,
                priceSource="snapshot",
                useage="QD",
                doseEach=None,
                routeCode="PO",
            )
        ]
    )
    xml = render_nhi_outpatient_xml(_summary(rec))
    assert "<p5>1.00</p5>" in xml
    assert "<p10>1.0</p10>" in xml
