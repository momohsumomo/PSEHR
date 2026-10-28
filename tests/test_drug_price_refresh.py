import unittest
from datetime import date

from src.core.drug_price_refresh import (
    CHECKSUM_FAIL,
    FETCH_FAIL,
    INSTALLED,
    OVERDUE,
    SAME,
    apply_pipeline_result,
    is_due,
    plain_block,
    public_view,
)


class DueTest(unittest.TestCase):
    def test_same_month_is_not_due(self) -> None:
        state = {"lastSuccessOn": "2026-10-02", "status": "success"}
        self.assertFalse(is_due(state, date(2026, 10, 28)))

    def test_previous_month_is_due(self) -> None:
        state = {"lastSuccessOn": "2026-09-30", "status": "success"}
        self.assertTrue(is_due(state, date(2026, 10, 1)))

    def test_failed_today_waits(self) -> None:
        state = {"lastAttemptOn": "2026-10-28", "status": "blocked_event"}
        self.assertFalse(is_due(state, date(2026, 10, 28)))
        self.assertTrue(is_due(state, date(2026, 10, 29)))

    def test_never_run_is_due(self) -> None:
        self.assertTrue(is_due({}, date(2026, 10, 28)))


class ResultTest(unittest.TestCase):
    def test_success_installs_and_keeps_version(self) -> None:
        seen: list[str] = []

        def install() -> dict:
            seen.append("install")
            return {"status": "success", "installedVersion": "2026.10.0"}

        out = apply_pipeline_result(
            {},
            {"status": "success", "publishedVersion": "2026.10.0"},
            today=date(2026, 10, 28),
            install=install,
        )
        self.assertEqual(seen, ["install"])
        self.assertEqual(out["status"], "success")
        self.assertEqual(out["version"], "2026.10.0")
        self.assertEqual(out["detail"], INSTALLED)
        view = public_view(out, date(2026, 10, 28))
        self.assertEqual(view["notice"], "")

    def test_checksum_failure_does_not_count(self) -> None:
        out = apply_pipeline_result(
            {},
            {"status": "success", "publishedVersion": "2026.10.0"},
            today=date(2026, 10, 28),
            install=lambda: {"status": "failed"},
        )
        self.assertEqual(out["status"], "failed")
        self.assertEqual(out["detail"], CHECKSUM_FAIL)
        self.assertNotIn("lastSuccessOn", out)
        self.assertEqual(public_view(out, date(2026, 10, 28))["notice"], CHECKSUM_FAIL)

    def test_unchanged_catalog_counts_as_this_month(self) -> None:
        out = apply_pipeline_result(
            {"version": "2026.09.0"},
            {"status": "skipped_no_change"},
            today=date(2026, 10, 28),
            install=lambda: (_ for _ in ()).throw(AssertionError("should not install")),
        )
        self.assertEqual(out["detail"], SAME)
        self.assertEqual(out["lastSuccessOn"], "2026-10-28")
        self.assertEqual(public_view(out, date(2026, 10, 28))["notice"], "")

    def test_block_keeps_previous_and_explains(self) -> None:
        out = apply_pipeline_result(
            {"version": "2026.09.0", "lastSuccessOn": "2026-09-01"},
            {"status": "blocked_event", "errorMessage": "CATALOG_TOO_SMALL"},
            today=date(2026, 10, 28),
            install=lambda: (_ for _ in ()).throw(AssertionError("should not install")),
        )
        self.assertEqual(out["lastSuccessOn"], "2026-09-01")
        self.assertIn("\u6574\u4efd\u592a\u5c11", out["detail"])
        self.assertEqual(public_view(out, date(2026, 10, 28))["notice"], out["detail"])

    def test_overdue_when_never_succeeded(self) -> None:
        self.assertEqual(public_view({}, date(2026, 10, 28))["notice"], OVERDUE)

    def test_fetch_failure_message(self) -> None:
        out = apply_pipeline_result(
            {},
            {"status": "failed"},
            today=date(2026, 10, 28),
            install=lambda: {},
        )
        self.assertEqual(out["detail"], FETCH_FAIL)

    def test_plain_block_names(self) -> None:
        text = plain_block("CATALOG_WIPED,PRICE_SPIKE>=200%")
        self.assertIn("\u5169\u6210", text)
        self.assertIn("\u5169\u500d", text)


if __name__ == "__main__":
    unittest.main()
