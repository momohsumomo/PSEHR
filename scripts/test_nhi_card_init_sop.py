"""讀卡 Init SOP：不依賴讀卡機廠牌／槽數。不連真主控台、不取號。"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.core.nhi_card_init_sop import (
    DESK_RESEAT_CARD,
    DESK_RESTART_SOFTWARE,
    DESK_UNPLUG_READER,
    KIND_DEAD,
    KIND_EMPTY,
    KIND_HC,
    KIND_HPC,
    KIND_PARTIAL,
    classify_slot,
    run_card_init_sop,
)


def _hc_ok() -> dict:
    return {
        "statusCode": 0,
        "idNo": "A123456789",
        "birthday": "0740315",
        "sex": "F",
        "name": "測",
        "cardId": "900000000711",
    }


class FakeClient:
    def __init__(self) -> None:
        self.probe_ok = True
        self.readers = ["R1", "R2"]
        self.default = "R1"
        self.current = "R1"
        self.sam_status = 2
        self.initialized = True
        self.list_timeout = False
        self.set_timeout_readers: set[str] = set()
        self.by_reader: dict[str, dict] = {
            "R1": {"hc": {"statusCode": 1102}, "hpc": {"statusCode": 1102}},
            "R2": {"hc": {"statusCode": 1102}, "hpc": {"statusCode": 1102}},
        }

    def probe(self) -> bool:
        return self.probe_ok

    def list_pcsc_readers_safe(self, timeout_sec: float = 5.0) -> dict:
        if self.list_timeout:
            return {"timedOut": True, "readers": []}
        return {"timedOut": False, "readers": list(self.readers)}

    def get_default_pcsc_reader(self) -> str:
        return self.default

    def set_default_pcsc_reader_safe(self, reader_name: str, timeout_sec: float = 4.0) -> dict:
        if reader_name in self.set_timeout_readers:
            return {"timedOut": True, "statusCode": 1119}
        self.current = reader_name
        self.default = reader_name
        return {"timedOut": False, "statusCode": 0}

    def set_default_pcsc_reader(self, reader_name: str) -> dict:
        return self.set_default_pcsc_reader_safe(reader_name)

    def ensure_session(self) -> dict:
        return {
            "initialized": self.initialized,
            "status": {
                "initialized": self.initialized,
                "sam": {"status": self.sam_status, "type": 1},
                "hc": {"status": 0, "type": 0},
                "hpc": {"status": 0, "type": 0},
            },
        }

    def status(self) -> dict:
        return self.ensure_session()

    def hc_basic_safe(self, timeout_sec: float = 5.0) -> dict:
        slot = self.by_reader.get(self.current) or {}
        return dict(slot.get("hc") or {"statusCode": 1102})

    def hpc_basic_safe(self, timeout_sec: float = 5.0) -> dict:
        slot = self.by_reader.get(self.current) or {}
        return dict(slot.get("hpc") or {"statusCode": 1102})


def main() -> int:
    failed = 0

    def check(name: str, cond: bool, detail: str = "") -> None:
        nonlocal failed
        if cond:
            print("[PASS]", name)
        else:
            failed += 1
            print("[FAIL]", name, detail)

    kind, profile, _ = classify_slot({"statusCode": 1102}, {"statusCode": 1102})
    check("1102+1102=empty", kind == KIND_EMPTY)

    kind, profile, _ = classify_slot(_hc_ok(), {"statusCode": 1102})
    check("complete HC", kind == KIND_HC and profile is not None and profile["idNo"] == "A123456789")

    kind, _, _ = classify_slot(
        {"statusCode": 0, "idNo": "A1"},
        {"statusCode": 1102},
    )
    check("missing fields=partial", kind == KIND_PARTIAL)

    kind, _, _ = classify_slot({"statusCode": 1500}, {"statusCode": 1102})
    check("1500=partial", kind == KIND_PARTIAL)

    kind, _, _ = classify_slot({"statusCode": 1103}, {"statusCode": 0, "cardSn": "HPC"})
    check("1103+hpc=hpc slot", kind == KIND_HPC)

    kind, _, _ = classify_slot({"timedOut": True, "statusCode": 1119}, {"timedOut": True})
    check("both timeout=dead", kind == KIND_DEAD)

    client = FakeClient()
    client.probe_ok = False
    sop = run_card_init_sop(client)
    check("console down → restart software", not sop.ok and sop.human_action == DESK_RESTART_SOFTWARE)
    check("console copy", "關掉" in sop.message and "讀卡軟體" in sop.message)

    client = FakeClient()
    client.readers = []
    sop = run_card_init_sop(client)
    check("no readers → unplug reader", not sop.ok and sop.human_action == DESK_UNPLUG_READER)

    client = FakeClient()
    client.set_timeout_readers = {"R1", "R2"}
    sop = run_card_init_sop(client)
    check("all silent → unplug both", not sop.ok and sop.human_action == DESK_UNPLUG_READER and all(s.kind == KIND_DEAD for s in sop.slots))
    check("both readers copy", "兩台" in sop.message)

    client = FakeClient()
    client.by_reader = {
        "R1": {"hc": {"statusCode": 1102}, "hpc": {"statusCode": 1102}},
        "R2": {"hc": {"statusCode": 1102}, "hpc": {"statusCode": 1102}},
    }
    sop = run_card_init_sop(client)
    check("empty → reseat card", not sop.ok and sop.human_action == DESK_RESEAT_CARD)
    check("empty kinds", all(s.kind == KIND_EMPTY for s in sop.slots))
    check("empty copy has 健保卡", "健保卡" in sop.message)

    client = FakeClient()
    client.default = "R1"
    client.by_reader = {
        "R1": {"hc": {"statusCode": 1103}, "hpc": {"statusCode": 0, "cardSn": "HPC1"}},
        "R2": {"hc": _hc_ok(), "hpc": {"statusCode": 1102}},
    }
    sop = run_card_init_sop(client)
    check("swap default to HC slot", sop.ok and sop.profile is not None)
    check("auto-fixed plain", sop.ok and any("健保卡那一台" in x for x in sop.auto_fixed))
    check("locked R2", sop.default_reader == "R2")

    client = FakeClient()
    client.readers = ["ONLY"]
    client.default = "ONLY"
    client.current = "ONLY"
    client.by_reader = {"ONLY": {"hc": _hc_ok(), "hpc": {"statusCode": 1102}}}
    sop = run_card_init_sop(client)
    check("single reader any brand", sop.ok and not sop.auto_fixed)

    client = FakeClient()
    client.by_reader = {
        "R1": {"hc": {"statusCode": 0, "idNo": "A1"}, "hpc": {"statusCode": 1102}},
        "R2": {"hc": {"statusCode": 1102}, "hpc": {"statusCode": 1102}},
    }
    sop = run_card_init_sop(client)
    check("partial → reseat card", not sop.ok and sop.human_action == DESK_RESEAT_CARD)

    client = FakeClient()
    client.by_reader = {
        "R1": {"hc": {"statusCode": 1103}, "hpc": {"statusCode": 0, "cardSn": "HPC"}},
        "R2": {"hc": {"statusCode": 1102}, "hpc": {"statusCode": 1102}},
    }
    sop = run_card_init_sop(client)
    check("hpc + empty → reseat", not sop.ok and sop.human_action == DESK_RESEAT_CARD)
    check("hpc + empty copy", "空的那一台" in sop.message)

    client = FakeClient()
    client.set_timeout_readers = {"R2"}
    client.by_reader = {
        "R1": {"hc": {"statusCode": 1103}, "hpc": {"statusCode": 0, "cardSn": "HPC"}},
        "R2": {"hc": {"statusCode": 1102}, "hpc": {"statusCode": 1102}},
    }
    sop = run_card_init_sop(client)
    check("dead HC reader named 健保卡", not sop.ok and sop.human_action == DESK_UNPLUG_READER)
    check("which is 健保卡", sop.desk_which == "健保卡" and "健保卡那台讀卡機" in sop.message)

    print("=" * 40)
    if failed:
        print(f"RESULT: FAILED ({failed})")
        return 1
    print("RESULT: ALL PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
