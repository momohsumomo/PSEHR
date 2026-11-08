"""Monthly claim reports in fee statistics follow the claim engine's numbers."""

import unittest
from unittest import mock

from src.claims.engine import ClaimEncounterRecord, ClaimsSummary
from src.core import claim_month_reports as reports


def _rec(i: int, **kw) -> ClaimEncounterRecord:
    base = dict(
        encounterId=f"e{i}",
        queueNumber=i,
        patientId=f"P{i % 3}",
        patientName="t",
        diagnoses="L70.0",
        consultationPoints=220,
        drugPoints=30,
        totalPoints=289,
        caseNo="01",
        encounterDate="2026-09-01",
        doctorId="D1",
        pharmacistId="R1",
        consultCode="00112C",
        consultFull=397,
        pharmacyCode="05203C",
        pharmacyPoints=39,
        pharmacyBase=39,
        pharmacyFull=39,
        copayPoints=50,
        applyPoints=239,
        daysSupply=3,
    )
    base.update(kw)
    return ClaimEncounterRecord(**base)


class _Store:
    def _connect(self):
        raise RuntimeError("no db")


def _summary(records):
    return ClaimsSummary(
        yearMonth="2026-09",
        yearMonthRoc="11509",
        finishedEncounters=len(records),
        totalConsultationPoints=0,
        totalDrugPoints=0,
        totalPoints=0,
        records=records,
    )


class ClaimMonthReportsTest(unittest.TestCase):
    def setUp(self):
        self.records = [
            _rec(1),
            _rec(2, caseNo="04", daysSupply=28),
            _rec(3, pharmacyCode="05234D", pharmacyPoints=0, pharmacyBase=20),
            _rec(4, claimable=False, caseNo="01", totalPoints=100),
        ]
        patcher = mock.patch.object(reports, "_summary", return_value=_summary(self.records))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_sheet_totals_apply_points_and_explains_adjustment(self):
        rep = reports.claim_sheet_report(_Store(), "2026-09")
        self.assertEqual(rep["totals"]["count"], 3)
        self.assertEqual(rep["totals"]["apply"], 239 * 3)
        self.assertEqual(rep["rows"][-1]["case"], "\u81ea")
        adjust = rep["sections"][1]
        before = adjust["rows"][0]["points"]
        self.assertEqual(before, 239 * 3 + (397 - 220) * 3 + 39)
        self.assertEqual(before + adjust["rows"][1]["points"] + adjust["rows"][2]["points"], adjust["totals"]["points"])

    def test_analysis_uses_unadjusted_consult(self):
        rep = reports.claim_analysis_report(_Store(), "2026-09")
        self.assertEqual(rep["totals"]["consult"], 397 * 3)
        self.assertEqual(rep["totals"]["days"], 3 + 28 + 3)
        days = rep["sections"][0]
        self.assertEqual(days["rows"][0]["d28"], 1)

    def test_pharmacist_counts_by_day_and_code(self):
        rep = reports.pharmacist_report(_Store(), "2026-09")
        self.assertEqual(len(rep["rows"]), 30)
        self.assertEqual(rep["rows"][0]["p0"], 3)
        codes = {r["code"]: r for r in rep["sections"][0]["rows"]}
        self.assertEqual(codes["05234D"]["base"], 20)
        self.assertEqual(codes["05203C"]["count"], 2)


if __name__ == "__main__":
    unittest.main()
