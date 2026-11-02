import unittest
from datetime import date, datetime

from src.claims import export_log
from src.claims.engine import ClaimEncounterRecord, ClaimsSummary


class FakeStore:
    def __init__(self) -> None:
        self.data: dict = {}

    def get_json_setting(self, key, default=None):
        return self.data.get(key, default)

    def set_json_setting(self, key, value) -> None:
        self.data[key] = value


def rec(eid: str, points: float = 300.0, claimable: bool = True) -> ClaimEncounterRecord:
    r = ClaimEncounterRecord(
        encounterId=eid,
        queueNumber=1,
        patientId="",
        patientName="",
        diagnoses="",
        consultationPoints=points,
        drugPoints=0.0,
        totalPoints=points,
        applyPoints=points,
    )
    r.claimable = claimable
    return r


def summary(records) -> ClaimsSummary:
    kept = [r for r in records if r.claimable]
    total = sum(r.consultationPoints for r in kept)
    return ClaimsSummary(
        yearMonth="2026-10",
        yearMonthRoc="11510",
        finishedEncounters=len(kept),
        totalConsultationPoints=total,
        totalDrugPoints=0.0,
        totalPoints=total,
        records=records,
    )


class MonthOpenTest(unittest.TestCase):
    def test_last_month_is_closed(self) -> None:
        self.assertFalse(export_log.month_open("2026-10", date(2026, 11, 2)))

    def test_this_and_future_month_are_open(self) -> None:
        self.assertTrue(export_log.month_open("2026-11", date(2026, 11, 2)))
        self.assertTrue(export_log.month_open("2026-12", date(2026, 11, 2)))


class BubaoTest(unittest.TestCase):
    def test_bubao_keeps_only_visits_not_filed(self) -> None:
        store = FakeStore()
        first = summary([rec("a"), rec("b"), rec("late", claimable=False)])
        export_log.record(store, first, "songhe", now=datetime(2026, 11, 5, 9, 0))
        log = export_log.load(store, "2026-10")
        self.assertTrue(export_log.has_songhe(log))
        self.assertEqual(log["history"][0]["count"], 2)
        self.assertEqual(log["history"][0]["points"], 600)

        later = summary([rec("a"), rec("b"), rec("late")])
        extra = export_log.only_new(later, log)
        self.assertEqual([r.encounterId for r in extra.records if r.claimable], ["late"])
        self.assertEqual(extra.finishedEncounters, 1)
        self.assertEqual(extra.totalPoints, 300.0)
        self.assertTrue(later.records[0].claimable)

    def test_second_bubao_has_nothing_new(self) -> None:
        store = FakeStore()
        export_log.record(store, summary([rec("a")]), "songhe")
        export_log.record(store, summary([rec("late")]), "bubao")
        log = export_log.load(store, "2026-10")
        again = export_log.only_new(summary([rec("a"), rec("late")]), log)
        self.assertEqual(again.finishedEncounters, 0)

    def test_no_songhe_means_no_bubao(self) -> None:
        self.assertFalse(export_log.has_songhe(export_log.load(FakeStore(), "2026-10")))


if __name__ == "__main__":
    unittest.main()
