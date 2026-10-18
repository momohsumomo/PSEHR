"""NHI 6.0 console start/restart helpers (Windows clinic workstation)."""

from __future__ import annotations

import os
import re
import socket
import subprocess
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from src.core.nhi_cshis6_client import Cshis6Client, DEFAULT_CONSOLE_BASE

CONSOLE_PROCESS_NAMES = ("ciet6001s01.exe", "cies6001s04.exe")
DEFAULT_CONSOLE_EXE = Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "NHI" / "cshis6" / "ciet6001s01.exe"
DEFAULT_PORT = 5066
FIX_PORT_BAT = "fix-nhi-cshis6-port-5066.bat"


def _console_port(console_base: str) -> int:
    try:
        parsed = urlparse(console_base)
        if parsed.port:
            return int(parsed.port)
    except Exception:
        pass
    return DEFAULT_PORT


def tcp_port_excluded_by_windows(port: int) -> bool:
    if os.name != "nt":
        return False
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


def is_port_listening(port: int, host: str = "127.0.0.1") -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.6)
            return sock.connect_ex((host, port)) == 0
    except Exception:
        return False


def _pids_for_image(image_name: str) -> list[int]:
    if os.name != "nt":
        return []
    try:
        raw = subprocess.check_output(
            ["tasklist", "/FI", f"IMAGENAME eq {image_name}", "/FO", "CSV", "/NH"],
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=8,
        )
    except Exception:
        return []
    pids: list[int] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line or "No tasks" in line or "INFO:" in line:
            continue
        parts = [p.strip('"') for p in line.split('","')]
        if len(parts) >= 2 and parts[1].isdigit():
            pids.append(int(parts[1]))
    return pids


def find_console_processes() -> list[int]:
    seen: set[int] = set()
    out: list[int] = []
    for name in CONSOLE_PROCESS_NAMES:
        for pid in _pids_for_image(name):
            if pid not in seen:
                seen.add(pid)
                out.append(pid)
    return out


def console_runtime_snapshot(*, console_base: str = DEFAULT_CONSOLE_BASE) -> dict[str, Any]:
    port = _console_port(console_base)
    processes = find_console_processes()
    listening = is_port_listening(port)
    excluded = tcp_port_excluded_by_windows(port)
    exe = DEFAULT_CONSOLE_EXE
    return {
        "processRunning": bool(processes),
        "processPids": processes,
        "portListening": listening,
        "port": port,
        "portExcluded": excluded,
        "exeFound": exe.is_file(),
        "exePath": str(exe),
    }


def _kill_console_processes() -> int:
    if os.name != "nt":
        return 0
    killed = 0
    for name in CONSOLE_PROCESS_NAMES:
        try:
            proc = subprocess.run(
                ["taskkill", "/F", "/IM", name],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=10,
            )
            if proc.returncode == 0:
                killed += 1
        except Exception:
            continue
    return killed


def _ensure_smart_card_service() -> bool:
    if os.name != "nt":
        return False
    try:
        subprocess.run(["sc", "config", "SCardSvr", "start=", "auto"], capture_output=True, timeout=8)
        proc = subprocess.run(["net", "start", "SCardSvr"], capture_output=True, text=True, timeout=15)
        out = (proc.stdout or "").lower()
        return proc.returncode == 0 or "already been started" in out
    except Exception:
        return False


def _start_console_exe() -> int | None:
    exe = DEFAULT_CONSOLE_EXE
    if not exe.is_file():
        return None
    flags = 0
    if os.name == "nt" and hasattr(subprocess, "DETACHED_PROCESS"):
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    proc = subprocess.Popen(
        [str(exe)],
        cwd=str(exe.parent),
        creationflags=flags,
    )
    return proc.pid


def _wait_for_probe(client: Cshis6Client, *, timeout_sec: float = 20.0) -> bool:
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        if client.probe():
            return True
        time.sleep(1.0)
    return False


def decide_repair_action(
    *,
    reachable: bool,
    process_running: bool,
    port_listening: bool,
    desk_action: str | None = None,
) -> str:
    """Return start | restart | none."""
    if reachable and desk_action not in ("restart_software", "start_software"):
        return "none"
    if reachable and desk_action == "restart_software":
        return "restart"
    if not reachable:
        if process_running:
            return "restart"
        return "start"
    return "restart"


def _msg_started(action: str) -> str:
    return "\u91cd\u555f" if action == "restart" else "\u555f\u52d5"


def repair_console(*, console_base: str = DEFAULT_CONSOLE_BASE) -> dict[str, Any]:
    if os.name != "nt":
        return {
            "ok": False,
            "action": "unsupported",
            "message": "\u8b80\u5361\u8edf\u9ad4\u9664\u932f\u50c5\u652f\u63f4 Windows \u8a3a\u6240\u7aef\u3002",
        }

    from src.core.nhi_card_bridge import console_diagnose
    from src.core.nhi_card_init_sop import DESK_RESTART_SOFTWARE, DESK_START_SOFTWARE

    client = Cshis6Client(console_base)
    runtime = console_runtime_snapshot(console_base=console_base)
    reachable = client.probe()
    desk_action: str | None = None
    if reachable:
        snap = console_diagnose(console_base=console_base, light=True)
        desk_action = (snap.get("fault") or {}).get("deskAction")
    action = decide_repair_action(
        reachable=reachable,
        process_running=bool(runtime["processRunning"]),
        port_listening=bool(runtime["portListening"]),
        desk_action=desk_action,
    )
    if action == "none":
        return {
            "ok": True,
            "action": "none",
            "message": "\u8b80\u5361\u8edf\u9ad4\u5df2\u9023\u7dda\uff0c\u7121\u9700\u555f\u52d5\u6216\u91cd\u555f\u3002",
            "runtime": runtime,
            "status": console_diagnose(console_base=console_base, light=True),
        }

    if not runtime["exeFound"]:
        return {
            "ok": False,
            "action": action,
            "message": (
                "\u9019\u53f0\u96fb\u8166\u9084\u6c92\u6709\u5065\u4fdd\u8b80\u5361\u8edf\u9ad4 6.0\u3002"
                "\u8acb\u7528\u5065\u4fdd\u5c08\u7db2\u4e0b\u8f09\u300c\u5065\u4fdd\u8cc7\u8a0a\u7db2\u670d\u52d9\u7cfb\u7d71 6.0\u300d\uff0c"
                "\u88dd\u5728\u6709\u8b80\u5361\u6a5f\u7684\u90a3\u4e00\u53f0\u3002"
                "\u8a3a\u6240\u8a8d\u8b49\u91d1\u9470\u662f\u5065\u4fdd\u7f72\u767c\u7d66\u9019\u5bb6\u8a3a\u6240\u7684\uff0c"
                "\u4e0d\u80fd\u653e\u9032\u7a0b\u5f0f\uff0c\u4e5f\u4e0d\u80fd\u5f9e GitHub \u4e0b\u8f09\u3002"
            ),
            "runtime": runtime,
        }

    steps: list[str] = []
    if action == "restart":
        killed = _kill_console_processes()
        steps.append(f"taskkill x{killed}")
        time.sleep(1.0)

    if _ensure_smart_card_service():
        steps.append("SCardSvr")
    pid = _start_console_exe()
    if pid is None:
        return {
            "ok": False,
            "action": action,
            "message": "\u7121\u6cd5\u555f\u52d5\u4e3b\u63a7\u53f0\u884c\u7a0b\u3002",
            "runtime": runtime,
            "steps": steps,
        }
    steps.append(f"pid {pid}")

    ok = _wait_for_probe(client)
    runtime_after = console_runtime_snapshot(console_base=console_base)
    needs_port_fix = bool(runtime_after["portExcluded"] and not ok)
    verb = _msg_started(action)

    if ok:
        msg = "\u8b80\u5361\u8edf\u9ad4\u5df2\u5c31\u7dd2\uff0c\u53ef\u4ee5 IC \u8b80\u5361\u3002"
    elif needs_port_fix:
        msg = (
            f"\u4e3b\u63a7\u53f0\u5df2{verb}\uff0c\u4f46 {runtime_after['port']} \u4ecd\u7121\u6cd5\u9023\u7dda\u3002"
            f" Windows \u53ef\u80fd\u4fdd\u7559\u6b64\u57e0\uff1b\u8acb\u4ee5\u7cfb\u7d71\u7ba1\u7406\u54e1\u57f7\u884c {FIX_PORT_BAT}\u3002"
        )
    else:
        msg = (
            f"\u5df2{verb}\u8b80\u5361\u8edf\u9ad4\uff0c\u4f46 API \u5c1a\u672a\u56de\u61c9\u3002"
            "\u82e5\u5de5\u4f5c\u5217\u6709\u5716\u793a\u4ecd\u8b80\u4e0d\u5230\u5361\uff0c\u8acb\u518d\u6309\u4e00\u6b21\u9664\u932f\u6216\u624b\u52d5\u91cd\u958b\u3002"
        )

    result: dict[str, Any] = {
        "ok": ok,
        "action": action,
        "message": msg,
        "steps": steps,
        "runtime": runtime_after,
        "needsPortFix": needs_port_fix,
        "portFixBat": FIX_PORT_BAT,
    }
    if ok:
        result["status"] = console_diagnose(console_base=console_base, light=True)
    result["deskActionHint"] = DESK_START_SOFTWARE if action == "start" else DESK_RESTART_SOFTWARE
    return result
