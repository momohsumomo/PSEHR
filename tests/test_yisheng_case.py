# -*- coding: utf-8 -*-
"""Yisheng case rules used by the monthly claim file."""

from __future__ import annotations

import unittest

from src.claims.yisheng_rules import (
    child_addon_points,
    child_rate_percent,
    consult_at,
    half_up_points,
    pharmacy_for,
)


class ConsultTests(unittest.TestCase):
    def test_monthly_cap_is_22_days(self) -> None:
        self.assertEqual(consult_at(770, 23, 40, "2026-09-01")[0], "00110C")
        self.assertEqual(consult_at(771, 23, 40, "2026-09-01")[0], "00224C")
        self.assertEqual(consult_at(990, 23, 40, "2026-09-01")[0], "00224C")
        self.assertEqual(consult_at(991, 23, 40, "2026-09-01")[0], "00112C")
        self.assertEqual(consult_at(1430, 23, 40, "2026-09-01")[0], "00112C")
        self.assertEqual(consult_at(1431, 23, 40, "2026-09-01")[0], "00114C")
        self.assertEqual(consult_at(1870, 23, 40, "2026-09-01")[0], "00114C")
        self.assertEqual(consult_at(1871, 23, 40, "2026-09-01"), ("00116C", 70, 70, 100.0))

    def test_may_through_july_use_the_25_day_schedule(self) -> None:
        # June opened more than 25 days: cap 25, first band 30 wide → 750.
        self.assertEqual(consult_at(750, 26, 40, "2026-06-01")[0], "00110C")
        self.assertEqual(consult_at(751, 26, 40, "2026-06-01")[0], "00224C")
        self.assertEqual(consult_at(1000, 26, 40, "2026-06-01")[0], "00224C")
        self.assertEqual(consult_at(1001, 26, 40, "2026-06-01")[0], "00112C")
        # May opened 24 days, under the cap, so the quota is 24 x 30.
        self.assertEqual(consult_at(720, 24, 40, "2026-05-15")[0], "00110C")
        self.assertEqual(consult_at(721, 24, 40, "2026-05-15")[0], "00224C")

    def test_age_amount_on_the_top_band(self) -> None:
        self.assertEqual(consult_at(1, 23, 2)[1], 484)
        self.assertEqual(consult_at(1, 23, 5)[1], 397)
        self.assertEqual(consult_at(1, 23, 70)[1], 397)
        self.assertEqual(consult_at(1, 23, 80)[1], 424)

    def test_pharmacy_by_days(self) -> None:
        self.assertEqual(pharmacy_for(3, "0")[0], "05203C")
        self.assertEqual(pharmacy_for(14, "0")[0], "05207C")
        self.assertEqual(pharmacy_for(28, "0")[0], "05211C")
        self.assertEqual(pharmacy_for(7, "2"), ("", 0))

    def test_suture_child_addon_rounds_half_up(self) -> None:
        # 2 years old: 303 x 1.2 = 363.6, filed as 364. Adult and other codes stay put.
        self.assertEqual(
            child_addon_points("48026C", 303, 1, "2024-08-14", "2026-09-05"),
            (120, 364),
        )
        self.assertIsNone(child_addon_points("48026C", 303, 1, "1983-05-17", "2026-09-13"))
        self.assertIsNone(child_addon_points("51004C", 303, 1, "2024-08-14", "2026-09-05"))

    def test_pharmacy_day_cap(self) -> None:
        from src.claims.yisheng_rules import pharmacy_day_adjustment

        self.assertIsNone(pharmacy_day_adjustment(80, 39))
        self.assertEqual(pharmacy_day_adjustment(81, 39), ("05234D", 20))
        self.assertEqual(pharmacy_day_adjustment(101, 39), ("05234D", 0))

    def test_higher_pharmacy_fee_keeps_the_full_slot(self) -> None:
        from src.claims.engine import ClaimEncounterRecord, _apply_pharmacy_day_cap

        def rec(n: int, points: float) -> ClaimEncounterRecord:
            return ClaimEncounterRecord(
                encounterId=f"e{n}",
                queueNumber=n,
                patientId="p",
                patientName="",
                diagnoses="",
                consultationPoints=0,
                drugPoints=0,
                totalPoints=points,
                doctorId="dr",
                encounterDate="2026-09-01",
                pharmacyCode="05203C",
                pharmacyPoints=points,
                pharmacyBase=points,
                pharmacyRate=100,
            )

        rows = [rec(i, 39) for i in range(1, 81)]
        rows.append(rec(200, 51))
        _apply_pharmacy_day_cap(rows)
        high = next(r for r in rows if r.encounterId == "e200")
        cut = [r for r in rows if r.pharmacyCode == "05234D"]
        self.assertEqual(high.pharmacyCode, "05203C")
        self.assertEqual(high.pharmacyPoints, 51)
        self.assertEqual(len(cut), 1)
        self.assertEqual(cut[0].pharmacyPoints, 20)
        # Table points are halved first. The child rate is applied to that unit.
        self.assertEqual(half_up_points(20 * 120 / 100), 24)
        self.assertEqual(half_up_points(20 * 130 / 100), 26)

    def test_points_round_half_up_per_line(self) -> None:
        self.assertEqual(half_up_points(10.5), 11)
        self.assertEqual(half_up_points(88.2), 88)
        self.assertEqual(half_up_points(39 * 120 / 100), 47)
        self.assertEqual(half_up_points(39 * 130 / 100), 51)

    def test_accepted_referral_keeps_the_first_band_without_using_a_slot(self) -> None:
        from src.claims.engine import ClaimEncounterRecord, ClaimMedLine, _apply_consult_volume

        def line(code: str) -> ClaimMedLine:
            return ClaimMedLine(
                medicationRequestId=code,
                nhiCode=code,
                drugText="",
                daysSupply=0,
                quantity=1,
                unitPrice=0,
                linePoints=0,
                priceSource="snapshot",
            )

        def visit(n: int, code: str = "") -> ClaimEncounterRecord:
            meds = [line(code)] if code else []
            return ClaimEncounterRecord(
                encounterId=f"e{n}",
                queueNumber=n,
                patientId="p",
                patientName="",
                diagnoses="",
                consultationPoints=0,
                drugPoints=0,
                totalPoints=0,
                medications=meds,
                doctorId="dr",
                birthDate="1980-01-01",
                encounterDate="2026-09-01",
                caseNo="01",
            )

        # 22 open days, first band ends at 770. The referral does not take a slot.
        rows = []
        for i in range(1, 772):
            rec = visit(i)
            rec.encounterDate = f"2026-08-{(i % 22) + 1:02d}"
            rows.append(rec)
        referred = visit(900, "01038C")
        referred.encounterDate = "2026-08-01"
        rows.append(referred)
        _apply_consult_volume(rows)
        referred = next(r for r in rows if r.encounterId == "e900")
        self.assertEqual(sum(1 for r in rows if r.consultCode == "00110C"), 771)
        self.assertEqual(sum(1 for r in rows if r.consultCode == "00224C"), 1)
        self.assertEqual(referred.consultCode, "00110C")
        self.assertEqual(referred.consultationPoints, 397)

    def test_pharmacy_child_rate_follows_age(self) -> None:
        self.assertEqual(child_rate_percent("2024-08-14", "2026-09-05"), 120)
        self.assertEqual(child_rate_percent("2025-03-01", "2026-09-05"), 130)
        self.assertEqual(child_rate_percent("2026-06-01", "2026-09-05"), 160)
        self.assertEqual(child_rate_percent("2010-01-01", "2026-09-05"), 100)


class PayMarkTests(unittest.TestCase):
    def test_history_type_6_is_outside_lab(self) -> None:
        from src.core.nhi_clinical_mappers import yisheng_selftype_to_pay_mark

        self.assertEqual(yisheng_selftype_to_pay_mark("6"), "\u4ea4")
        self.assertEqual(yisheng_selftype_to_pay_mark("0"), "")
        self.assertEqual(yisheng_selftype_to_pay_mark("1"), "\u81ea")


if __name__ == "__main__":
    unittest.main()
