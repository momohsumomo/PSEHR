"""健保患者進場 API 自動驗收（沙盒 2）。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from src.api.main import app
from src.app.bootstrap import get_shadow_store


def main() -> int:
    print("=" * 50)
    print("NHI patient intake test")
    print("=" * 50)

    store = get_shadow_store()
    store.initialize()
    client = TestClient(app)
    failed = 0

    # 有效身分證（檢查碼通過）
    valid_body = {
        "idNo": "A123456789",
        "birthday": "0740315",
        "sex": "M",
        "patientName": "測試健保",
    }

    r = client.post("/nhi/v1/patient/register", json=valid_body)
    if r.status_code != 201:
        print("[FAIL] register valid", r.status_code, r.text)
        failed += 1
    else:
        data = r.json()
        print("[PASS] register valid", data["patientId"])
        if data["validation"]["birthDateIso"] != "1985-03-15":
            print("[FAIL] birthDateIso", data["validation"])
            failed += 1
        else:
            print("[PASS] birthDateIso 1985-03-15")
        idx = data.get("indexLayer") or {}
        if idx.get("idNo") != "A123456789" or idx.get("sex") != "M":
            print("[FAIL] indexLayer", idx)
            failed += 1
        else:
            print("[PASS] indexLayer idNo/sex")

        dual = client.get(f"/sandbox/dual-layer/Patient/{data['patientId']}")
        if dual.status_code != 200:
            print("[FAIL] dual-layer", dual.text)
            failed += 1
        else:
            print("[PASS] dual-layer Patient")

    # 重複 idNo → update
    r2 = client.post("/nhi/v1/patient/register", json=valid_body)
    if r2.status_code != 201 or r2.json().get("created") is not False:
        print("[FAIL] idempotent update", r2.status_code, r2.text)
        failed += 1
    else:
        print("[PASS] same idNo updates existing")

    # 非法欄位
    bad_cases = [
        {"idNo": "G221458682", "birthday": "0740315", "sex": "M"},
        {"idNo": "A123456789", "birthday": "0741331", "sex": "M"},
        {"idNo": "A123456789", "birthday": "0740315", "sex": "X"},
    ]
    for body in bad_cases:
        br = client.post("/nhi/v1/patient/register", json=body)
        if br.status_code != 422:
            print("[FAIL] expect 422", body, br.status_code)
            failed += 1
        else:
            print("[PASS] rejected", body.get("sex") or body.get("birthday"))

    print("=" * 50)
    if failed:
        print(f"RESULT: FAILED ({failed})")
        return 1
    print("RESULT: ALL PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
