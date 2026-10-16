"""讀卡橋接 → patient register 自動驗收。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from src.api.main import app
from src.app.bootstrap import get_shadow_store


def main() -> int:
    print("=" * 50)
    print("NHI card read-and-register test")
    print("=" * 50)

    get_shadow_store().initialize()
    client = TestClient(app)
    failed = 0

    r = client.post("/nhi/v1/card/read-and-register", params={"mock": "true"})
    if r.status_code != 201:
        print("[FAIL] mock register", r.status_code, r.text)
        failed += 1
    else:
        data = r.json()
        print("[PASS] mock register", data["patientId"], data.get("cardSource"))
        if data.get("validation", {}).get("idNo") != "A123456789":
            print("[FAIL] idNo", data)
            failed += 1
        else:
            print("[PASS] idNo A123456789")

        dual = client.get(f"/sandbox/dual-layer/Patient/{data['patientId']}")
        if dual.status_code != 200:
            print("[FAIL] dual-layer")
            failed += 1
        else:
            print("[PASS] dual-layer Patient")

    r2 = client.post("/nhi/v1/card/read-and-register", params={"mock": "true"})
    if r2.status_code != 201 or r2.json().get("created") is not False:
        print("[FAIL] idempotent update", r2.text)
        failed += 1
    else:
        print("[PASS] same idNo updates existing")

    print("=" * 50)
    if failed:
        print(f"RESULT: FAILED ({failed})")
        return 1
    print("RESULT: ALL PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
