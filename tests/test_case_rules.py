# -*- coding: utf-8 -*-
"""Official case rules by default; clinic overrides only when enabled."""

from __future__ import annotations

import unittest

from src.claims.case_rules import (
    CaseRules,
    ClinicRules,
    CoreRules,
    assign_case,
    file_case_rules,
    validate_clinic_payload,
)


def _rules(**clinic_kwargs: object) -> CaseRules:
    base = file_case_rules()
    clinic = ClinicRules(
        enabled=bool(clinic_kwargs.get("enabled", False)),
        extra_chronic_icd10=frozenset(clinic_kwargs.get("extra", ())),  # type: ignore[arg-type]
        order_codes_to_09=frozenset(clinic_kwargs.get("orders", ())),  # type: ignore[arg-type]
        order_to_09_beaten_by_04=bool(clinic_kwargs.get("beaten", True)),
    )
    return CaseRules(core=base.core, clinic=clinic, official_chronic=base.official_chronic)


class OfficialCaseTests(unittest.TestCase):
    def test_shipped_config_marks_skin_orders_09(self) -> None:
        rules = file_case_rules()
        self.assertTrue(rules.clinic.enabled)
        self.assertIn("51020C", rules.clinic.order_codes_to_09)
        self.assertFalse(rules.clinic.order_to_09_beaten_by_04)
        self.assertEqual(rules.clinic.extra_chronic_icd10, frozenset())
        self.assertEqual(rules.core.official_chronic_min_days, 7)
        self.assertTrue(rules.core.acute_plus_chronic_to_09)
        self.assertTrue(rules.core.general_outside_dispense_to_09)
        self.assertFalse(rules.clinic.case_09_fixed_consult)
        self.assertIn("E119", rules.official_chronic)
        self.assertIn("B3783", rules.special_dx)
        self.assertNotIn("L309", rules.special_dx)

    def test_deposit_case_is_not_claimed(self) -> None:
        case, _reason = assign_case(
            stored="\u81ea",
            days=3,
            dispense="0",
            diagnosis_codes=["L700"],
            order_codes=[],
            self_pay=False,
        )
        self.assertEqual(case, "9X")

    def test_long_course_without_official_chronic_is_04(self) -> None:
        case, _reason = assign_case(
            stored="01",
            days=14,
            dispense="0",
            diagnosis_codes=["L700"],
            order_codes=[],
            self_pay=False,
        )
        self.assertEqual(case, "04")

    def test_eczema_seven_days_is_04(self) -> None:
        case, _reason = assign_case(
            stored="01",
            days=7,
            dispense="0",
            diagnosis_codes=["L309"],
            order_codes=[],
            self_pay=False,
            rules=file_case_rules(),
        )
        self.assertEqual(case, "04")

    def test_special_short_course_is_04(self) -> None:
        case, _reason = assign_case(
            stored="01",
            days=3,
            dispense="0",
            diagnosis_codes=["B3783"],
            order_codes=[],
            self_pay=False,
            rules=file_case_rules(),
        )
        self.assertEqual(case, "04")

    def test_incision_overrides_seven_day_04(self) -> None:
        case, _reason = assign_case(
            stored="01",
            days=7,
            dispense="0",
            diagnosis_codes=["L309"],
            order_codes=["51020C"],
            self_pay=False,
            rules=file_case_rules(),
        )
        self.assertEqual(case, "09")

    def test_skin_order_is_09(self) -> None:
        case, _reason = assign_case(
            stored="01",
            days=3,
            dispense="0",
            diagnosis_codes=["L309"],
            order_codes=["51022C"],
            self_pay=False,
            rules=file_case_rules(),
        )
        self.assertEqual(case, "09")

    def test_official_chronic_full_days_is_04(self) -> None:
        case, _reason = assign_case(
            stored="01",
            days=7,
            dispense="0",
            diagnosis_codes=["E119"],
            order_codes=[],
            self_pay=False,
        )
        self.assertEqual(case, "04")

    def test_official_chronic_short_stays_01(self) -> None:
        case, _reason = assign_case(
            stored="01",
            days=3,
            dispense="0",
            diagnosis_codes=["C73"],
            order_codes=[],
            self_pay=False,
        )
        self.assertEqual(case, "01")

    def test_official_acute_plus_chronic_is_09(self) -> None:
        case, _reason = assign_case(
            stored="01",
            days=14,
            dispense="0",
            diagnosis_codes=["E119", "L309"],
            order_codes=["51022C"],
            self_pay=False,
        )
        self.assertEqual(case, "09")

    def test_general_outside_dispense_is_09(self) -> None:
        case, _reason = assign_case(
            stored="01",
            days=3,
            dispense="2",
            diagnosis_codes=["L700"],
            order_codes=[],
            self_pay=False,
        )
        self.assertEqual(case, "09")

    def test_official_chronic_04_beats_outside_dispense(self) -> None:
        case, _reason = assign_case(
            stored="01",
            days=14,
            dispense="2",
            diagnosis_codes=["E119"],
            order_codes=[],
            self_pay=False,
        )
        self.assertEqual(case, "04")


class ClinicOverrideTests(unittest.TestCase):
    def test_disabled_list_does_not_apply(self) -> None:
        rules = _rules(enabled=False, orders=("51022C",), extra=("L700",))
        case, _reason = assign_case(
            stored="01",
            days=14,
            dispense="0",
            diagnosis_codes=["L700"],
            order_codes=["51022C"],
            self_pay=False,
            rules=rules,
        )
        self.assertEqual(case, "04")

    def test_disabled_order_on_short_course_stays_01(self) -> None:
        rules = _rules(enabled=False, orders=("51022C",))
        case, _reason = assign_case(
            stored="01",
            days=3,
            dispense="0",
            diagnosis_codes=["L309"],
            order_codes=["51022C"],
            self_pay=False,
            rules=rules,
        )
        self.assertEqual(case, "01")

    def test_enabled_order_code_becomes_09(self) -> None:
        rules = _rules(enabled=True, orders=("51022C",))
        case, reason = assign_case(
            stored="01",
            days=3,
            dispense="0",
            diagnosis_codes=["L309"],
            order_codes=["51022C"],
            self_pay=False,
            rules=rules,
        )
        self.assertEqual(case, "09")
        self.assertIn("09", reason)

    def test_enabled_order_uses_clinic_sentence(self) -> None:
        note = "\u672c\u9662\u6240\u8a3b\u8a18\uff1a\u51b7\u51cd"
        rules = _rules(enabled=True, orders=("51022C",))
        rules = CaseRules(
            core=rules.core,
            clinic=ClinicRules(
                enabled=True,
                order_codes_to_09=frozenset({"51022C"}),
                order_reasons={"51022C": note},
            ),
            official_chronic=rules.official_chronic,
        )
        _case, reason = assign_case(
            stored="01",
            days=3,
            dispense="0",
            diagnosis_codes=["L309"],
            order_codes=["51022C"],
            self_pay=False,
            rules=rules,
        )
        self.assertEqual(reason, note)

    def test_official_chronic_rejected_as_extra(self) -> None:
        official = file_case_rules().official_chronic
        with self.assertRaises(ValueError):
            validate_clinic_payload(
                {"chronicRules": [{"code": "E119", "name": "\u7cd6\u5c3f\u75c5"}]},
                official,
            )

    def test_enabled_extra_chronic_full_days_is_04(self) -> None:
        rules = _rules(enabled=True, extra=("L700",))
        case, _reason = assign_case(
            stored="01",
            days=7,
            dispense="0",
            diagnosis_codes=["L700"],
            order_codes=[],
            self_pay=False,
            rules=rules,
        )
        self.assertEqual(case, "04")

    def test_04_beats_custom_order_09(self) -> None:
        rules = _rules(enabled=True, orders=("51022C",), extra=("L700",))
        case, _reason = assign_case(
            stored="01",
            days=7,
            dispense="0",
            diagnosis_codes=["L700"],
            order_codes=["51022C"],
            self_pay=False,
            rules=rules,
        )
        self.assertEqual(case, "04")

    def test_core_flags_can_be_replaced(self) -> None:
        rules = CaseRules(
            core=CoreRules(
                official_chronic_min_days=7,
                acute_plus_chronic_to_09=False,
                general_outside_dispense_to_09=False,
            ),
            clinic=ClinicRules(),
            official_chronic=frozenset({"E119"}),
        )
        mixed, _reason = assign_case(
            stored="01",
            days=14,
            dispense="0",
            diagnosis_codes=["E119", "L309"],
            order_codes=[],
            self_pay=False,
            rules=rules,
        )
        outside, _reason = assign_case(
            stored="01",
            days=3,
            dispense="2",
            diagnosis_codes=["L309"],
            order_codes=[],
            self_pay=False,
            rules=rules,
        )
        self.assertEqual(mixed, "04")
        self.assertEqual(outside, "01")


if __name__ == "__main__":
    unittest.main()
