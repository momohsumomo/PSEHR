#!/usr/bin/env python3
"""
沙盒 3 — 健保署讀卡機控制軟體 6.0 獨立工具（KAN-7）

產品路線：主控台 https://localhost:5066 + 業務端 VPN API（見 checklist 模組七）
本腳本**不得**被 src/api 或 frontend import。

用法：
  python utils/nhi_reader.py health          # 探測主控台是否存活
  python utils/nhi_reader.py diagnose        # 三卡狀態（SAM／健保卡／醫事卡）
  python utils/nhi_reader.py detect          # 只插健保卡時，自動偵測預設 PC/SC
  python utils/nhi_reader.py pcsc            # PC/SC 硬體診斷（非產品路線）
  python utils/nhi_reader.py --help

依賴：requests（主控台）；pcsc 診斷需 pyscard（requirements.txt）
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import ssl
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("nhi.reader")

DEFAULT_CONSOLE_BASE = "https://localhost:5066"
FIX_PORT_BAT = "fix-nhi-cshis6-port-5066.bat"


def _insecure_https_context() -> ssl.SSLContext:
    """主控台用自簽 cshis6.crt，探測時不驗證鏈。"""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def tcp_port_excluded_by_windows(port: int) -> bool:
    """Hyper-V / WinNAT 排除範圍會讓 Kestrel 無法綁 5066（雙擊主控台像沒開）。"""
    try:
        raw = subprocess.check_output(
            ["netsh", "int", "ipv4", "show", "excludedportrange", "protocol=tcp"],
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=8,
        )
    except Exception:
        return False
    for line in raw.splitlines():
        m = re.match(r"^\s*(\d+)\s+(\d+)", line)
        if not m:
            continue
        start, end = int(m.group(1)), int(m.group(2))
        if start <= port <= end:
            return True
    return False


@dataclass
class ConsoleProbeResult:
    ok: bool
    base_url: str
    status_code: int | None
    body_preview: str
    error: str | None = None


class NhiCardConsoleClient:
    """健保署讀卡機控制軟體 — 主控台 Web API 薄封裝（路徑依署方文件調整）。"""

    def __init__(self, base_url: str = DEFAULT_CONSOLE_BASE, timeout_sec: float = 3.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_sec = timeout_sec

    def probe(self) -> ConsoleProbeResult:
        """探測主控台是否可連線（常見根路徑或 /health）。"""
        last_error = "無法連線"
        for path in (
            "/api/common/v1/Status",
            "/api/common/v1/Version",
            "/",
            "/health",
            "/api/health",
        ):
            url = f"{self.base_url}{path}"
            try:
                req = urllib.request.Request(url, method="GET")
                ctx = _insecure_https_context() if self.base_url.lower().startswith("https://") else None
                with urllib.request.urlopen(req, timeout=self.timeout_sec, context=ctx) as resp:
                    raw = resp.read(512).decode("utf-8", errors="replace")
                    return ConsoleProbeResult(
                        ok=True,
                        base_url=self.base_url,
                        status_code=resp.status,
                        body_preview=raw[:200],
                    )
            except urllib.error.HTTPError as e:
                return ConsoleProbeResult(
                    ok=True,
                    base_url=self.base_url,
                    status_code=e.code,
                    body_preview=str(e.reason),
                )
            except Exception as e:
                last_error = str(e)
                continue
        return ConsoleProbeResult(
            ok=False,
            base_url=self.base_url,
            status_code=None,
            body_preview="",
            error=last_error,
        )

    def fetch_json(self, path: str, method: str = "GET", payload: dict[str, Any] | None = None) -> Any:
        """呼叫主控台 API（路徑需對照署方 PDF，Phase 4 實作時補齊）。"""
        url = f"{self.base_url}{path}"
        data = None
        headers = {"Accept": "application/json"}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        ctx = _insecure_https_context() if self.base_url.lower().startswith("https://") else None
        with urllib.request.urlopen(req, timeout=self.timeout_sec, context=ctx) as resp:
            return json.loads(resp.read().decode("utf-8"))


def cmd_diagnose(base_url: str) -> int:
    root = Path(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from src.core.nhi_card_bridge import console_diagnose

    snap = console_diagnose(console_base=base_url)
    print("主控台：", snap.get("consoleBase"), "可達" if snap.get("reachable") else "連不到")
    if snap.get("initialized") is not None:
        print("已初始化：", snap.get("initialized"))
        print("裝置：", snap.get("deviceName") or "—")
        print("預設讀卡機：", snap.get("defaultReader") or snap.get("readerName") or "—")
        readers = snap.get("readers") or []
        print("PC/SC 清單：", readers or "（空）")
        for key, title in (("sam", "SAM 安全模組"), ("hc", "HC 健保卡"), ("hpc", "HPC 醫事卡")):
            block = snap.get(key) or {}
            print(
                f"{title}：",
                block.get("statusLabel") or "—",
                "/",
                block.get("typeLabel") or "—",
            )
        hc_read = snap.get("hcRead")
        if isinstance(hc_read, dict):
            print(
                "讀健保卡：",
                "OK" if hc_read.get("ok") else "失敗",
                hc_read.get("idNoMasked") or "",
                hc_read.get("statusHint") or "",
            )
        hpc_read = snap.get("hpcRead")
        if isinstance(hpc_read, dict):
            print(
                "讀醫事卡：",
                "OK" if hpc_read.get("ok") else "失敗",
                hpc_read.get("idNoMasked") or "",
                hpc_read.get("statusHint") or "",
            )
    print("建議：")
    for line in snap.get("advice") or []:
        print(" -", line)
    return 0 if snap.get("reachable") else 1


def cmd_sop(base_url: str) -> int:
    root = Path(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from src.core.nhi_card_init_sop import run_card_init_sop
    from src.core.nhi_cshis6_client import Cshis6Client

    client = Cshis6Client(base_url)
    sop = run_card_init_sop(client)
    print("櫃台：", sop.message)
    print("動作：", sop.human_action, sop.desk_which or "")
    for stage in sop.stages:
        mark = "OK" if stage.get("ok") else "STOP" if stage.get("stop") else "NG"
        print(f"  [{mark}] {stage.get('label')} {stage.get('detail') or ''}")
    for slot in sop.slots:
        print(f"  槽 {slot.name}：{slot.kind} {slot.detail}")
    for line in sop.auto_fixed:
        print("  已自動：", line)
    if sop.ok and sop.profile:
        print("身分證遮罩：", (sop.profile.get("idNo") or "")[:2] + "****")
    return 0 if sop.ok else 1


def cmd_detect(base_url: str) -> int:
    root = Path(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from src.core.nhi_cshis6_client import Cshis6Client, status_hint

    client = Cshis6Client(base_url)
    if not client.probe():
        logger.error("主控台連不到：%s", base_url)
        return 1
    print("請確認現在只插病人健保卡（醫事卡拔掉），再自動偵測預設 PC/SC。")
    result = client.auto_detect_pcsc_reader()
    code = result.get("statusCode")
    print("AutoDetected statusCode：", code, status_hint(code if isinstance(code, int) else None))
    print("readerName：", result.get("readerName") or client.get_default_pcsc_reader() or "—")
    return 0 if code in (0, None) else 1


def cmd_health(base_url: str) -> int:
    client = NhiCardConsoleClient(base_url)
    result = client.probe()
    if result.ok:
        logger.info("主控台可達：%s (HTTP %s)", result.base_url, result.status_code)
        if result.body_preview:
            logger.info("回應摘要：%s", result.body_preview)
        return 0
    logger.error("主控台無法連線：%s — %s", result.base_url, result.error)
    port = 5066
    m = re.search(r":(\d+)$", result.base_url.rstrip("/"))
    if m:
        port = int(m.group(1))
    if tcp_port_excluded_by_windows(port):
        logger.error(
            "Windows 已保留 TCP %s（常見於 Hyper-V / WinNAT / Docker）。"
            "主控台行程可能已啟動但 API 綁不上，雙擊會像沒開。",
            port,
        )
        logger.info("請以系統管理員執行專案根目錄 %s（UAC 按「是」）", FIX_PORT_BAT)
    else:
        logger.info("請確認已安裝並啟動「讀卡機控制軟體 6.0 主控台」")
    return 1


def cmd_pcsc() -> int:
    """可選硬體診斷 — 非產品正式路線。"""
    try:
        from smartcard.System import readers
    except ImportError:
        logger.error("請安裝 pyscard：pip install pyscard")
        return 1

    r = readers()
    if not r:
        logger.warning("未偵測到 PC/SC 讀卡機")
        return 1
    for reader in r:
        logger.info("讀卡機：%s", reader)
    logger.info("PC/SC 診斷完成（產品請改走主控台 API）")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="沙盒3：健保讀卡獨立工具")
    parser.add_argument(
        "command",
        nargs="?",
        default="health",
        choices=("health", "pcsc", "diagnose", "detect", "sop"),
        help="health=主控台探測 | diagnose=三卡狀態 | sop=逐台掃卡種 | detect=只插健保卡時自動偵測 | pcsc=硬體診斷",
    )
    parser.add_argument("--base-url", default=DEFAULT_CONSOLE_BASE, help="主控台基底 URL")
    args = parser.parse_args(argv)

    if args.command == "health":
        return cmd_health(args.base_url)
    if args.command == "diagnose":
        return cmd_diagnose(args.base_url)
    if args.command == "sop":
        return cmd_sop(args.base_url)
    if args.command == "detect":
        return cmd_detect(args.base_url)
    if args.command == "pcsc":
        return cmd_pcsc()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
