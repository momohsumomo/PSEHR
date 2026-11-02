import asyncio
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

from src.core.drug_price_refresh import PAST_CHANGED, apply_pipeline_result
from src.spoke import hydrator as hydrator_mod
from src.spoke.drug_price import clear_price_cache, lookup_drug_price
from src.spoke.pack_history import past_price_changes
from src.spoke.pack_models import sha256_canonical_payload
from src.spoke.pack_store import PackStore


def row(code: str, price: float, start: str, end: str | None = None) -> dict:
    return {"nhiCode": code, "price": price, "startDate": start, "endDate": end}


def pack(version: str, drugs: list[dict], effective: str = "2026-10-03") -> dict:
    body = {
        "version": version,
        "effectiveFrom": effective,
        "publishedAt": effective + "T00:00:00+00:00",
        "publishMode": "auto",
        "resources": {"drugs": drugs},
    }
    body["checksumSha256"] = sha256_canonical_payload(body)
    return body


TODAY = date(2026, 11, 3)


class PastPriceTest(unittest.TestCase):
    def test_same_history_passes(self) -> None:
        old = pack("a", [row("A1", 10.0, "2026-01-01")])
        new = pack("b", [row("A1", 10.0, "2026-01-01")])
        self.assertEqual(past_price_changes(old, new, TODAY), [])

    def test_monthly_new_price_passes(self) -> None:
        old = pack("a", [row("A1", 10.0, "2026-01-01")])
        new = pack(
            "b",
            [row("A1", 10.0, "2026-01-01", "2026-10-31"), row("A1", 9.0, "2026-11-01")],
        )
        self.assertEqual(past_price_changes(old, new, TODAY), [])

    def test_repriced_past_is_flagged(self) -> None:
        old = pack("a", [row("A1", 10.0, "2026-01-01")])
        new = pack("b", [row("A1", 100.0, "2026-01-01")])
        hits = past_price_changes(old, new, TODAY)
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["now"], 100.0)

    def test_dropped_past_is_flagged(self) -> None:
        old = pack("a", [row("A1", 10.0, "2026-01-01"), row("B2", 5.0, "2025-06-01")])
        new = pack("b", [row("A1", 10.0, "2026-01-01")])
        hits = past_price_changes(old, new, TODAY)
        self.assertEqual([h["nhiCode"] for h in hits], ["B2"])

    def test_cut_short_without_successor_is_flagged(self) -> None:
        old = pack("a", [row("A1", 10.0, "2026-01-01")])
        new = pack("b", [row("A1", 10.0, "2026-01-01", "2026-05-31")])
        self.assertEqual(len(past_price_changes(old, new, TODAY)), 1)

    def test_zero_price_filled_in_passes(self) -> None:
        old = pack("a", [row("X1", 0.0, "2026-10-01")])
        new = pack("b", [row("X1", 172.0, "2026-10-01")])
        self.assertEqual(past_price_changes(old, new, TODAY), [])

    def test_future_row_may_change(self) -> None:
        old = pack("a", [row("A1", 10.0, "2026-12-01")])
        new = pack("b", [row("A1", 12.0, "2026-12-01")])
        self.assertEqual(past_price_changes(old, new, TODAY), [])


class RollbackTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.store = PackStore(Path(self.tmp.name) / "p.db")
        self.store.initialize()
        clear_price_cache()

    def tearDown(self) -> None:
        clear_price_cache()
        self.tmp.cleanup()

    def test_stop_falls_back_and_resume_returns(self) -> None:
        self.store.install_package(pack("2026.10.0", [row("A1", 10.0, "2026-01-01")], "2026-10-01"))
        self.store.install_package(pack("2026.11.0", [row("A1", 99.0, "2026-01-01")], "2026-11-01"))
        self.assertEqual(lookup_drug_price("A1", "2026-10-15", pack_store=self.store)["unitPrice"], 99.0)

        self.store.set_active("2026.11.0", False)
        clear_price_cache()
        self.assertEqual(self.store.latest_active_version(), "2026.10.0")
        self.assertEqual(lookup_drug_price("A1", "2026-10-15", pack_store=self.store)["unitPrice"], 10.0)

        self.store.set_active("2026.11.0", True)
        clear_price_cache()
        self.assertEqual(self.store.latest_active_version(), "2026.11.0")

    def test_cannot_stop_the_only_version(self) -> None:
        self.store.install_package(pack("2026.10.0", [row("A1", 10.0, "2026-01-01")]))
        with self.assertRaises(ValueError):
            self.store.set_active("2026.10.0", False)
        with self.assertRaises(LookupError):
            self.store.set_active("nope", False)

    def _hydrate(self, candidate: dict) -> dict:
        with mock.patch.object(hydrator_mod, "hub_packages_url", return_value=""), mock.patch.object(
            hydrator_mod, "hub_packages_dir", return_value=Path(self.tmp.name)
        ), mock.patch.object(
            hydrator_mod, "list_local_manifest", return_value=[{"version": candidate["version"]}]
        ), mock.patch.object(hydrator_mod, "load_local_pack", return_value=candidate):
            return asyncio.run(hydrator_mod.PackHydrator(self.store).run_once()).to_dict()

    def test_hydrate_refuses_rewritten_history(self) -> None:
        old_rows = [row(f"A{i:03d}", 10.0, "2026-01-01") for i in range(30)]
        self.store.install_package(pack("2026.10.0", old_rows, "2026-10-01"))
        bad = pack("2026.11.0", [row(f"A{i:03d}", 1.0, "2026-01-01") for i in range(30)], "2026-11-01")
        out = self._hydrate(bad)
        self.assertEqual(out["status"], "failed")
        self.assertEqual(out["errorCode"], hydrator_mod.PAST_PRICE_CHANGED)
        self.assertEqual(self.store.latest_active_version(), "2026.10.0")
        self.assertIsNone(self.store.get_package("2026.11.0"))

    def test_hydrate_installs_normal_month(self) -> None:
        self.store.install_package(pack("2026.10.0", [row("A1", 10.0, "2026-01-01")], "2026-10-01"))
        good = pack(
            "2026.11.0",
            [row("A1", 10.0, "2026-01-01", "2026-10-31"), row("A1", 9.0, "2026-11-01")],
            "2026-11-01",
        )
        out = self._hydrate(good)
        self.assertEqual(out["status"], "success")
        self.assertEqual(lookup_drug_price("A1", "2026-11-02", pack_store=self.store)["unitPrice"], 9.0)
        self.assertEqual(lookup_drug_price("A1", "2026-10-30", pack_store=self.store)["unitPrice"], 10.0)


class MessageTest(unittest.TestCase):
    def test_past_change_is_explained(self) -> None:
        out = apply_pipeline_result(
            {},
            {"status": "success"},
            today=TODAY,
            install=lambda: {"status": "failed", "errorCode": "PAST_PRICE_CHANGED"},
        )
        self.assertEqual(out["detail"], PAST_CHANGED)


if __name__ == "__main__":
    unittest.main()
