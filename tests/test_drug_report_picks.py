# -*- coding: utf-8 -*-
import unittest

from src.core.clinic_reports import _norm, _picked, clean_drug_picks, drug_costs


class DrugPickTests(unittest.TestCase):
    def test_clean_keeps_order_and_drops_repeats(self) -> None:
        picks = clean_drug_picks(
            [
                {"code": "bc14966100", "name": "Roaccutane 20MG"},
                {"code": "", "name": "Derma Lightening", "alt": ["HQH10", "Derma Lightening"]},
                {"code": "BC14966100", "name": "again"},
                {"code": "", "name": "  "},
                "junk",
            ]
        )
        self.assertEqual([p["code"] for p in picks], ["BC14966100", ""])
        self.assertEqual(picks[1]["alt"], ["HQH10"])

    def test_code_pick_matches_code_only(self) -> None:
        picks = clean_drug_picks([{"code": "BC14966100", "name": "Roaccutane 20MG"}])
        self.assertTrue(_picked(picks, "BC14966100", _norm("anything")))
        self.assertFalse(_picked(picks, "", _norm("Roaccutane 20MG")))

    def test_name_pick_matches_other_names_without_code(self) -> None:
        picks = clean_drug_picks([{"code": "", "name": "Derma Lightening", "alt": ["HQH10"]}])
        self.assertTrue(_picked(picks, "", _norm("hqh10")))
        self.assertTrue(_picked(picks, "", _norm("Derma  Lightening")))
        self.assertFalse(_picked(picks, "AC123", _norm("HQH10")))

    def test_costs_prefer_later_rows(self) -> None:
        by_code, by_name = drug_costs(
            [
                {"nhiCode": "BC14966100", "name": "Roaccutane 20MG", "unitCost": 55.8},
                {"nhiCode": "", "name": "Derma Lightening", "customName": "HQH10", "cost": 120},
                {"nhiCode": "BC14966100", "name": "Roaccutane 20MG", "unitCost": 57},
                {"nhiCode": "X1", "name": "free", "unitCost": 0},
            ]
        )
        self.assertEqual(by_code["BC14966100"], 57)
        self.assertEqual(by_name["HQH10"], 120)
        self.assertNotIn("X1", by_code)


if __name__ == "__main__":
    unittest.main()
