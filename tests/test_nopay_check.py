import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.claims import nopay_rules
from src.claims.engine import ClaimEncounterRecord, ClaimMedLine
from src.claims.nopay_check import dx_match, evaluate


def _line(code: str, points: float, qty: float = 1, price: float | None = None) -> ClaimMedLine:
    return ClaimMedLine(
        medicationRequestId="m",
        nhiCode=code,
        drugText="",
        daysSupply=3,
        quantity=qty,
        unitPrice=price,
        linePoints=points,
        priceSource="snapshot",
    )


def _rec(n: int, *, day: str = "2026-10-05", dx=("L309",), lines=(), person: str = "", doctor: str = "D1",
         case: str = "01", drug: float = 0.0) -> ClaimEncounterRecord:
    return ClaimEncounterRecord(
        encounterId=f"e{n}",
        queueNumber=n,
        patientId=person or f"P{n}",
        patientName="",
        diagnoses="",
        consultationPoints=300,
        drugPoints=drug,
        totalPoints=300 + drug,
        medications=list(lines),
        doctorId=doctor,
        encounterDate=day,
        caseNo=case,
        diagnosisCodes=list(dx),
        birthDate="1980-01-01",
        medicalNo=f"M{n}",
    )


def _facts(table):
    return lambda code: table.get(code, {})


class DxMatchTest(unittest.TestCase):
    def test_prefix_range_exclusion_and_seventh(self):
        self.assertTrue(dx_match("J06.9", ["J00-J06"]))
        self.assertFalse(dx_match("J10", ["J00-J06"]))
        self.assertFalse(dx_match("I109", ["I10", "!I109"]))
        self.assertTrue(dx_match("T2001XA", ["T20-T32@AD"]))
        self.assertFalse(dx_match("T2001XS", ["T20-T32@AD"]))


class EvaluateTest(unittest.TestCase):
    def test_rate_over_threshold_estimates_deduction(self):
        rules = {"version": "t", "indicators": [{
            "id": "053", "name": "x", "kind": "rate", "base": {}, "hit": {"orders": ["51017C"]},
            "threshold": 0.1, "penalty": "orders"}]}
        recs = [_rec(i, lines=[_line("51017C", 100)] if i < 4 else []) for i in range(10)]
        out = evaluate(recs, rules, dept="11", facts=_facts({}))
        item = out["items"][0]
        self.assertTrue(item["over"])
        self.assertEqual((item["numerator"], item["denominator"]), (4, 10))
        self.assertEqual(item["deduction"], 300)
        self.assertEqual(len(item["cases"]), 4)

    def test_dept_filter_skips_other_departments(self):
        rules = {"indicators": [{
            "id": "001", "name": "eye", "kind": "rate", "base": {"dept": ["10"]},
            "hit": {"orders": ["23401C"]}, "threshold": 0.3, "penalty": "orders"}]}
        recs = [_rec(i, lines=[_line("23401C", 50)]) for i in range(5)]
        item = evaluate(recs, rules, dept="11", facts=_facts({}))["items"][0]
        self.assertFalse(item["applies"])
        self.assertFalse(item["over"])

    def test_cap_per_patient_month(self):
        rules = {"indicators": [{
            "id": "029", "name": "cap", "kind": "cap", "group": "patient_month",
            "orders": ["06504C", "06505C"], "cap": 3}]}
        recs = [_rec(i, day=f"2026-10-0{i + 1}", person="A", lines=[_line("06504C", 40)]) for i in range(5)]
        recs.append(_rec(9, person="B", lines=[_line("06505C", 40)]))
        item = evaluate(recs, rules, dept="11", facts=_facts({}))["items"][0]
        self.assertTrue(item["over"])
        self.assertEqual(item["overGroups"], 1)
        self.assertEqual(item["deduction"], 80)

    def test_rx_dup_keeps_highest_price_same_form(self):
        rules = {"indicators": [{"id": "054", "name": "tears", "kind": "rx_dup", "atc": ["S01XA20"], "sameForm": True}]}
        facts = _facts({
            "AAAAAAAAAA": {"atc": "S01XA20", "form": "eye"},
            "BBBBBBBBBB": {"atc": "S01XA20", "form": "eye"},
        })
        recs = [_rec(1, lines=[_line("AAAAAAAAAA", 90, price=30), _line("BBBBBBBBBB", 60, price=20)])]
        item = evaluate(recs, rules, dept="11", facts=facts)["items"][0]
        self.assertTrue(item["over"])
        self.assertEqual(item["deduction"], 60)

    def test_effective_date_skips_earlier_months(self):
        rules = {"indicators": [{"id": "x", "name": "x", "kind": "external", "effective": "2026-11-01",
                                 "base": {}}]}
        self.assertEqual(evaluate([_rec(1)], rules, dept="11", facts=_facts({}))["items"], [])

    def test_bundled_rules_validate_and_run(self):
        rules = json.loads(nopay_rules.BUNDLED.read_text(encoding="utf-8"))
        self.assertEqual(nopay_rules.validate(rules), "")
        out = evaluate([_rec(i) for i in range(3)], rules, dept="11", facts=_facts({}))
        self.assertEqual(out["overCount"], 0)


class LoadRulesTest(unittest.TestCase):
    def test_newer_download_wins(self):
        bundled = json.loads(nopay_rules.BUNDLED.read_text(encoding="utf-8"))
        newer = dict(bundled, version="9999.01.01")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "nopay_indicators.json"
            path.write_text(json.dumps(newer), encoding="utf-8")
            with mock.patch.object(nopay_rules, "downloaded_path", return_value=path):
                self.assertEqual(nopay_rules.load_rules()["version"], "9999.01.01")
            path.write_text(json.dumps(dict(bundled, version="2000.01.01")), encoding="utf-8")
            with mock.patch.object(nopay_rules, "downloaded_path", return_value=path):
                self.assertEqual(nopay_rules.load_rules()["version"], bundled["version"])

    def test_broken_download_is_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "nopay_indicators.json"
            path.write_text(json.dumps({"schema": 1, "version": "9999", "indicators": [{"kind": "magic"}]}),
                            encoding="utf-8")
            with mock.patch.object(nopay_rules, "downloaded_path", return_value=path):
                self.assertNotEqual(nopay_rules.load_rules()["version"], "9999")


if __name__ == "__main__":
    unittest.main()
