# -*- coding: utf-8 -*-
"""Send a slip to a named Windows printer. The browser dialog cannot choose one."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
import winreg
from pathlib import Path

_EDGE = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
_SUMATRA_URL = "https://www.sumatrapdfreader.org/download-free-pdf-viewer"


def installed_printers() -> list[str]:
    names: list[str] = []
    seen: set[str] = set()

    def add(name: str) -> None:
        text = name.strip()
        if text.startswith("S-1-") and ":" in text:
            text = text.split(":", 1)[1].strip()
        if not text or text in seen:
            return
        seen.add(text)
        names.append(text)

    try:
        key = winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"SYSTEM\CurrentControlSet\Control\Print\Printers",
        )
        index = 0
        while True:
            try:
                add(winreg.EnumKey(key, index))
                index += 1
            except OSError:
                break
    except OSError:
        pass

    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Printers\Connections")
        index = 0
        while True:
            try:
                raw = winreg.EnumKey(key, index)
                index += 1
                parts = raw.split(",")
                if len(parts) >= 4 and parts[2] and parts[3]:
                    add("\\\\" + parts[2] + "\\" + parts[3])
                else:
                    add(raw)
            except OSError:
                break
    except OSError:
        pass
    return names


def render_html_pdf(html: str, pdf_path: Path) -> None:
    if not _EDGE.is_file():
        raise RuntimeError("\u9019\u53f0\u96fb\u8166\u6c92\u6709 Microsoft Edge\uff0c\u7121\u6cd5\u7d44\u5217\u5370\u6a94\u3002")
    folder = pdf_path.parent
    html_path = folder / "slip.html"
    html_path.write_text(html, encoding="utf-8")
    profile = folder / "edge-profile"
    proc = subprocess.run(
        [
            str(_EDGE),
            "--headless=new",
            "--disable-gpu",
            f"--user-data-dir={profile}",
            "--no-pdf-header-footer",
            f"--print-to-pdf={pdf_path}",
            html_path.as_uri(),
        ],
        capture_output=True,
        timeout=40,
        check=False,
    )
    if not pdf_path.is_file() or pdf_path.stat().st_size < 100:
        err = (proc.stderr or b"").decode("utf-8", errors="replace")[-400:]
        raise RuntimeError("\u5217\u5370\u6a94\u6c92\u8f49\u51fa\u4f86\u3002" + err)


_PRINT_CACHE: tuple[float, list[dict]] | None = None


def printer_rows() -> list[dict]:
    """Name plus whether Windows marks that printer offline. Cached a few seconds."""
    global _PRINT_CACHE
    now = time.time()
    if _PRINT_CACHE is not None and now - _PRINT_CACHE[0] < 12:
        return _PRINT_CACHE[1]
    rows = _query_printer_rows()
    _PRINT_CACHE = (now, rows)
    return rows


def _is_device_printer(name: str, port: str) -> bool:
    port_key = port.strip().upper()
    if port_key.startswith(("PORTPROMPT", "NUL", "FILE", "SHRFAX")):
        return False
    folded = name.casefold()
    if "pdf" in folded or "xps" in folded or "onenote" in folded or "fax" in folded:
        return False
    if "\u50b3\u771f" in name:
        return False
    return True


def _query_printer_rows() -> list[dict]:
    command = (
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
        "$rows = @(Get-CimInstance -ClassName Win32_Printer | "
        "Select-Object Name, WorkOffline, PrinterStatus, Default, PortName); "
        "if ($rows.Count -eq 0) { '[]' } else { $rows | ConvertTo-Json -Compress }"
    )
    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", command],
            capture_output=True,
            timeout=8,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return [{"name": name, "online": None} for name in installed_printers()]
    raw = (proc.stdout or b"").decode("utf-8", errors="replace").strip()
    if not raw:
        return [{"name": name, "online": None} for name in installed_printers()]
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return [{"name": name, "online": None} for name in installed_printers()]
    items = parsed if isinstance(parsed, list) else [parsed]
    rows: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        name = str(item.get("Name") or "").strip()
        if not name:
            continue
        offline = bool(item.get("WorkOffline"))
        try:
            status = int(item.get("PrinterStatus") or 0)
        except (TypeError, ValueError):
            status = 0
        # 7 = Offline. WorkOffline is the flag Windows shows when the device is not ready.
        online = (not offline) and status != 7
        port = str(item.get("PortName") or "")
        rows.append({
            "name": name,
            "online": online,
            "default": bool(item.get("Default")),
            "device": _is_device_printer(name, port),
        })
    return rows or [{"name": name, "online": None} for name in installed_printers()]


def desk_print_status() -> dict:
    return {
        "ok": True,
        "edge": _EDGE.is_file(),
        "sumatra": find_sumatra() is not None,
        "printers": printer_rows(),
    }


def find_sumatra() -> Path | None:
    local = os.environ.get("LOCALAPPDATA", "")
    candidates = [
        Path(local) / "Wundadi" / "print" / "SumatraPDF.exe",
        Path(r"C:\Program Files\SumatraPDF\SumatraPDF.exe"),
        Path(r"C:\Program Files (x86)\SumatraPDF\SumatraPDF.exe"),
    ]
    for path in candidates:
        if path.is_file():
            return path
    found = shutil.which("SumatraPDF")
    return Path(found) if found else None


def sumatra_missing_message() -> str:
    local = os.environ.get("LOCALAPPDATA", "")
    folder = str(Path(local) / "Wundadi" / "print")
    return (
        "\u9019\u53f0\u96fb\u8166\u9084\u6c92\u5b89\u88dd\u5217\u5370\u7a0b\u5f0f SumatraPDF\u3002"
        "\u8acb\u5148\u5b89\u88dd\u5f8c\u518d\u5217\u5370\u3002"
        "\u4e0b\u8f09\uff1a" + _SUMATRA_URL + "\u3002"
        "\u4e5f\u53ef\u4ee5\u628a SumatraPDF.exe \u653e\u5230 " + folder
    )


def printer_job_settings(width_mm: float, height_mm: float) -> str:
    """A4 documents lock orientation. Other slips keep the printer's own paper."""
    if abs(width_mm - 210) <= 2 and abs(height_mm - 297) <= 2:
        return "paper=A4,portrait,noscale"
    if abs(width_mm - 297) <= 2 and abs(height_mm - 210) <= 2:
        return "paper=A4,landscape,noscale"
    return "noscale"


def print_html_to_printer(*, html: str, printer_name: str, width_mm: float, height_mm: float) -> str:
    printer = _match_printer(printer_name)
    exe = find_sumatra()
    if exe is None:
        raise RuntimeError(sumatra_missing_message())
    folder = Path(tempfile.mkdtemp(prefix="wundadi-print-"))
    pdf_path = folder / "slip.pdf"
    render_html_pdf(html, pdf_path)
    proc = subprocess.run(
        [
            str(exe),
            "-silent",
            "-print-to",
            printer,
            "-print-settings",
            printer_job_settings(width_mm, height_mm),
            "-exit-when-done",
            str(pdf_path),
        ],
        capture_output=True,
        timeout=60,
        check=False,
    )
    if proc.returncode not in (0, None):
        err = ((proc.stderr or b"") + (proc.stdout or b"")).decode("utf-8", errors="replace")[-300:]
        raise RuntimeError("\u5370\u8868\u6a5f\u6c92\u6709\u63a5\u4e0b\u9019\u5f35\u55ae\u3002" + err)
    return printer


def _match_printer(printer_name: str) -> str:
    want = printer_name.strip()
    if not want:
        raise RuntimeError("\u9019\u4e00\u5217\u9084\u6c92\u9078\u5370\u8868\u6a5f\u3002")
    for name in installed_printers():
        if name == want:
            return name
    raise RuntimeError("\u9019\u53f0\u96fb\u8166\u770b\u4e0d\u5230\u9019\u53f0\u5370\u8868\u6a5f\uff1a" + want)
