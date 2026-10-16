"""將診所 .SAM 匯入健保署 6.0 雲端安全模組（官方 POST /api/settings/v1/CloudSam）。

5.x 是把檔丟進 C:\\NHI；6.0 不走那個資料夾。
不會把 SAM 檔內容印出來。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.core.nhi_cshis6_client import (  # noqa: E402
    Cshis6Client,
    nested_status,
    parse_sam_ids_from_filename,
    status_hint,
)


def find_sam_file() -> Path:
    seen: set[str] = set()
    matches: list[Path] = []
    for p in list(ROOT.glob("*.SAM")) + list(ROOT.glob("*.sam")):
        key = str(p.resolve()).lower()
        if key in seen or not p.is_file():
            continue
        seen.add(key)
        matches.append(p)
    if not matches:
        raise FileNotFoundError(
            "專案根目錄找不到 .SAM。請把診所憑證放到專案根目錄（已 gitignore）。"
        )
    if len(matches) > 1:
        print("找到多個 SAM，使用第一個：", matches[0].name)
    return matches[0]


def main() -> int:
    sam_path = find_sam_file()
    sam_id, hospital_id = parse_sam_ids_from_filename(sam_path)
    print("SAM 檔名：", sam_path.name)
    print("機構碼：", hospital_id)
    print("SAM 編號：", sam_id)
    print("大小：", sam_path.stat().st_size, "bytes")

    client = Cshis6Client()
    if not client.probe():
        print("主控台 https://localhost:5066 連不到。")
        print("請先跑 fix-nhi-cshis6-port-5066.bat，再開讀卡機控制軟體 6.0。")
        return 1

    existing = client.list_cloud_sam()
    already = any(str(s.get("samId")) == sam_id for s in existing if isinstance(s, dict))
    if already:
        print("雲端 SAM 清單已有此編號，略過匯入。")
    else:
        print("匯入雲端 SAM（需診所 VPN / 10.x）…")
        result = client.import_cloud_sam_file(sam_path)
        code = result.get("statusCode")
        print("匯入 statusCode：", code, status_hint(code if isinstance(code, int) else None))
        if code not in (0, None):
            safe = {k: v for k, v in result.items() if k != "cloudSamContext"}
            print("回傳（不含憑證本文）：", json.dumps(safe, ensure_ascii=False, default=str)[:800])
            return 1

    listed = client.list_cloud_sam()
    print("目前雲端 SAM 筆數：", len(listed))
    for item in listed:
        if isinstance(item, dict):
            print(
                " -",
                item.get("samId"),
                item.get("hospitalId"),
                item.get("hospitalShortName") or item.get("hospitalName") or "",
            )

    readers = client.list_pcsc_readers()
    print("PC/SC 讀卡機：", readers or "（空）")
    if not readers:
        print("Windows「智慧卡」服務未跑，或讀卡機沒插上。")
        print("請以系統管理員執行 fix-nhi-cshis6-port-5066.bat（會一併啟動智慧卡服務），")
        print("確認虹堡讀卡機已接 USB，再跑一次本腳本。")
        return 2

    preferred = next((r for r in readers if "CASTLE" in r.upper() or "PISCES" in r.upper()), readers[0])
    set_r = client.set_default_pcsc_reader(preferred)
    print("預設讀卡機：", preferred, "statusCode", set_r.get("statusCode"))

    print("初始化主控台，裝置：", sam_id)
    init = client.initial(sam_id)
    init_code = init.get("statusCode")
    print("Initial statusCode：", init_code, status_hint(init_code if isinstance(init_code, int) else None))

    st = client.status()
    print(
        "initialized=",
        st.get("initialized"),
        "sam=",
        nested_status(st, "sam"),
        "hc=",
        nested_status(st, "hc"),
        "reader=",
        st.get("readerName") or st.get("name"),
    )

    if nested_status(st, "sam") == 1:
        print("SAM 尚未與中心端驗證，呼叫 Verification（需 VPN）…")
        ver = client.verify_sam()
        vcode = ver.get("statusCode")
        print("Verification statusCode：", vcode, status_hint(vcode if isinstance(vcode, int) else None))
        st = client.status()
        print("驗證後 sam=", nested_status(st, "sam"), "hc=", nested_status(st, "hc"))

    if nested_status(st, "sam") == 2:
        sam_basic = client.sam_basic()
        print(
            "SAM 基本資料：",
            sam_basic.get("samId"),
            sam_basic.get("hospitalId"),
            sam_basic.get("hospitalShortName") or sam_basic.get("hospitalName") or "",
        )

    if nested_status(st, "hc") in (None, 0):
        print("請插健保卡後，門診按 F2 或再跑一次本腳本。")
        return 0 if nested_status(st, "sam") == 2 else 2

    basic = client.hc_basic()
    bcode = basic.get("statusCode")
    print("HC Basic statusCode：", bcode, status_hint(bcode if isinstance(bcode, int) else None))
    if bcode in (0, None) and basic.get("idNo"):
        id_no = str(basic.get("idNo"))
        masked = id_no[:2] + "****" + id_no[-2:] if len(id_no) >= 4 else "****"
        print("已讀到姓名長度", len(str(basic.get("name") or "")), "身分證", masked)
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
