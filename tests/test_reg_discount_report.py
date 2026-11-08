"""Registration-fee discounts are measured against each month's own base fee."""

import json
import sqlite3
import unittest

from src.core.encounter_extensions import attach_reg_extension
from src.core.reg_discount_report import reg_discount_report


def _db(visits):
    conn = sqlite3.connect(":memory:")
    conn.executescript(
        """
        CREATE TABLE encounter_index (resource_id TEXT, patient_id TEXT, encounter_date TEXT, queue_status TEXT, fhir_status TEXT);
        CREATE TABLE patient_index (resource_id TEXT, id_category TEXT, birthday_roc TEXT);
        CREATE TABLE resource_cache (resource_type TEXT, resource_id TEXT, payload_json TEXT);
        """
    )
    for i, (day, cat, birth, fee, extra) in enumerate(visits):
        pid, eid = f"p{i}", f"e{i}"
        conn.execute("INSERT INTO patient_index VALUES (?, ?, ?)", (pid, cat, birth))
        conn.execute("INSERT INTO encounter_index VALUES (?, ?, ?, 'finished', 'finished')", (eid, pid, day))
        payload = attach_reg_extension({}, {"regFee": fee, "caseNo": "01", **extra})
        conn.execute("INSERT INTO resource_cache VALUES ('Encounter', ?, ?)", (eid, json.dumps(payload)))
    return conn


class RegDiscountReportTest(unittest.TestCase):
    def test_each_month_uses_its_own_base(self):
        visits = [("2025-05-02", "D", "0800101", "150", {})] * 3 + [
            ("2025-05-03", "S", "1000101", "80", {}),
            ("2026-05-02", "D", "0800101", "200", {}),
            ("2026-05-02", "D", "0800101", "200", {}),
            ("2026-05-03", "S", "1000101", "100", {}),
            ("2026-05-03", "A", "0800101", "0", {}),
            ("2026-05-03", "D", "0800101", "0", {"caseNo": "\u81ea"}),
        ]
        rep = reg_discount_report(_db(visits), "2025-01-01", "2026-12-31")
        self.assertEqual([r["base"] for r in rep["rows"]], [150, 200])
        self.assertEqual(rep["totals"]["total"], 70 + 100)
        cats = {r["cat"]: r for r in rep["sections"][0]["rows"]}
        self.assertEqual(set(cats), {"S"})
        self.assertEqual(cats["S"]["count"], 2)

    def test_visit_identity_wins_and_ordinary_splits_by_age(self):
        visits = [("2026-10-01", "D", "0800101", "200", {})] * 3 + [
            ("2026-10-02", "D", "1000101", "100", {"idCategory": "C"}),
            ("2026-10-02", "D", "0950101", "100", {}),
        ]
        rep = reg_discount_report(_db(visits), "2026-10-01", "2026-10-31")
        cats = {r["cat"]: r["amount"] for r in rep["sections"][0]["rows"]}
        self.assertEqual(cats["C"], 100)
        self.assertEqual(cats["\u4e00\u822c\uff1a18\uff5e24\u6b72\u5b78\u751f"], 100)


if __name__ == "__main__":
    unittest.main()
