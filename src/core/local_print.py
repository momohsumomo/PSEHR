# -*- coding: utf-8 -*-
"""Send a slip to a named Windows printer. The browser dialog cannot choose one."""

from __future__ import annotations

import base64
import json
import os
import shutil
import socket
import struct
import subprocess
import tempfile
import time
import urllib.request
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


def _stop_process(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    subprocess.run(
        ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
        capture_output=True,
        check=False,
    )
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


def _wait_debug_port(profile: Path, proc: subprocess.Popen) -> int:
    marker = profile / "DevToolsActivePort"
    deadline = time.time() + 15
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError("\u5217\u5370\u7a0b\u5f0f\u6c92\u6709\u7559\u4e0b\u4f86\u3002")
        if marker.is_file():
            line = marker.read_text(encoding="utf-8", errors="replace").splitlines()
            if line and line[0].strip().isdigit():
                return int(line[0].strip())
        time.sleep(0.05)
    raise RuntimeError("\u5217\u5370\u7a0b\u5f0f\u6c92\u6709\u958b\u597d\u3002")


class _Cdp:
    def __init__(self, url: str) -> None:
        rest = url.split("://", 1)[1]
        hostport, path = rest.split("/", 1)
        host, port_s = hostport.rsplit(":", 1)
        self.sock = socket.create_connection((host, int(port_s)), timeout=20)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        req = (
            f"GET /{path} HTTP/1.1\r\n"
            f"Host: {hostport}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode("ascii"))
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("\u5217\u5370\u7a0b\u5f0f\u4e2d\u65b7\u3002")
            buf += chunk
        self._next = 0

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass

    def call(self, method: str, params: dict | None = None, timeout: float = 30) -> dict:
        self._next += 1
        mid = self._next
        self._send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = json.loads(self._recv_text())
            if msg.get("id") != mid:
                continue
            if msg.get("error"):
                raise RuntimeError(str(msg["error"]))
            result = msg.get("result")
            return result if isinstance(result, dict) else {}
        raise RuntimeError("\u5217\u5370\u6a94\u6392\u7248\u8d85\u6642\u3002")

    def _send(self, text: str) -> None:
        data = text.encode("utf-8")
        header = bytearray([0x81])
        n = len(data)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header.extend(struct.pack("!H", n))
        else:
            header.append(0x80 | 127)
            header.extend(struct.pack("!Q", n))
        mask = os.urandom(4)
        header.extend(mask)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        self.sock.sendall(header + masked)

    def _recv_exact(self, n: int) -> bytes:
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise RuntimeError("\u5217\u5370\u7a0b\u5f0f\u4e2d\u65b7\u3002")
            buf += chunk
        return buf

    def _recv_text(self) -> str:
        while True:
            b0, b1 = self._recv_exact(2)
            opcode = b0 & 0x0F
            length = b1 & 0x7F
            if length == 126:
                length = struct.unpack("!H", self._recv_exact(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self._recv_exact(8))[0]
            if b1 & 0x80:
                mask = self._recv_exact(4)
                data = bytes(b ^ mask[i % 4] for i, b in enumerate(self._recv_exact(length)))
            else:
                data = self._recv_exact(length)
            if opcode == 0x9:
                self._send_pong(data)
                continue
            if opcode == 0x8:
                raise RuntimeError("\u5217\u5370\u7a0b\u5f0f\u4e2d\u65b7\u3002")
            if opcode == 0x1:
                return data.decode("utf-8")

    def _send_pong(self, data: bytes) -> None:
        header = bytearray([0x8A, 0x80 | len(data)])
        mask = os.urandom(4)
        header.extend(mask)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        self.sock.sendall(header + masked)


def _print_page_pdf(port: int, url: str, pdf_path: Path, width_mm: float, height_mm: float) -> None:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=5) as res:
        pages = json.loads(res.read().decode("utf-8"))
    ws = ""
    for page in pages:
        if isinstance(page, dict) and page.get("type") == "page" and page.get("webSocketDebuggerUrl"):
            ws = str(page["webSocketDebuggerUrl"])
            break
    if not ws:
        raise RuntimeError("\u5217\u5370\u7a0b\u5f0f\u6c92\u6709\u958b\u597d\u3002")
    width = width_mm if width_mm > 0 else 210
    height = height_mm if height_mm > 0 else 297
    cdp = _Cdp(ws)
    try:
        cdp.call("Page.enable")
        cdp.call("Page.navigate", {"url": url})
        deadline = time.time() + 15
        while time.time() < deadline:
            state = cdp.call(
                "Runtime.evaluate",
                {"expression": "document.readyState", "returnByValue": True},
            )
            if (state.get("result") or {}).get("value") == "complete":
                break
            time.sleep(0.05)
        result = cdp.call(
            "Page.printToPDF",
            {
                "landscape": False,
                "displayHeaderFooter": False,
                "printBackground": True,
                "scale": 1,
                "paperWidth": width / 25.4,
                "paperHeight": height / 25.4,
                "marginTop": 0,
                "marginBottom": 0,
                "marginLeft": 0,
                "marginRight": 0,
                "preferCSSPageSize": False,
                "generateDocumentOutline": False,
            },
            timeout=40,
        )
    finally:
        cdp.close()
    raw = base64.b64decode(str(result.get("data") or ""))
    pdf_path.write_bytes(raw)


def render_html_pdf(html: str, pdf_path: Path, *, width_mm: float = 210, height_mm: float = 297) -> None:
    """PDF page size and margins come from this job, not from Edge or Chrome print settings."""
    if not _EDGE.is_file():
        raise RuntimeError("\u9019\u53f0\u96fb\u8166\u6c92\u6709 Microsoft Edge\uff0c\u7121\u6cd5\u7d44\u5217\u5370\u6a94\u3002")
    folder = pdf_path.parent
    html_path = folder / "slip.html"
    html_path.write_text(html, encoding="utf-8")
    profile = folder / "edge-profile"
    proc = subprocess.Popen(
        [
            str(_EDGE),
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
            "--disable-sync",
            f"--user-data-dir={profile}",
            "--remote-debugging-port=0",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        port = _wait_debug_port(profile, proc)
        _print_page_pdf(port, html_path.as_uri(), pdf_path, width_mm, height_mm)
    finally:
        _stop_process(proc)
    if not pdf_path.is_file() or pdf_path.stat().st_size < 100:
        raise RuntimeError("\u5217\u5370\u6a94\u6c92\u8f49\u51fa\u4f86\u3002")


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


_SUMATRA_ZIP = "https://www.sumatrapdfreader.org/dl/rel/3.5.2/SumatraPDF-3.5.2-64.zip"


def ensure_sumatra() -> str:
    """Download the free SumatraPDF portable build into this PC's print folder."""
    found = find_sumatra()
    if found is not None:
        return str(found)
    import io
    import urllib.request
    import zipfile

    dest_dir = Path(os.environ.get("LOCALAPPDATA", "")) / "Wundadi" / "print"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / "SumatraPDF.exe"
    req = urllib.request.Request(_SUMATRA_ZIP, headers={"User-Agent": "PSEHR"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            blob = resp.read()
    except Exception as exc:
        raise RuntimeError(
            "\u4e0b\u8f09\u5217\u5370\u7a0b\u5f0f\u5931\u6557\uff1a" + str(exc) + "\u3002" + _SUMATRA_URL
        ) from exc
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        name = next((item for item in zf.namelist() if item.lower().endswith("sumatrapdf.exe")), "")
        if not name:
            raise RuntimeError("\u4e0b\u8f09\u6a94\u88e1\u6c92\u6709 SumatraPDF.exe\u3002" + _SUMATRA_URL)
        dest.write_bytes(zf.read(name))
    return str(dest)


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
    """Page width and height decide direction. Do not follow the printer's last job.

    disable-auto-rotation stops Sumatra from turning a portrait page sideways
    when the printer driver still remembers landscape.
    """
    lock = "noscale,disable-auto-rotation"
    if abs(width_mm - 210) <= 2 and abs(height_mm - 297) <= 2:
        return "paper=A4,portrait," + lock
    if abs(width_mm - 297) <= 2 and abs(height_mm - 210) <= 2:
        return "paper=A4,landscape," + lock
    if abs(width_mm - 148) <= 2 and abs(height_mm - 210) <= 2:
        return "paper=A5,portrait," + lock
    if abs(width_mm - 210) <= 2 and abs(height_mm - 148) <= 2:
        return "paper=A5,landscape," + lock
    return lock


def print_html_to_printer(*, html: str, printer_name: str, width_mm: float, height_mm: float) -> str:
    printer = _match_printer(printer_name)
    exe = find_sumatra()
    if exe is None:
        raise RuntimeError(sumatra_missing_message())
    folder = Path(tempfile.mkdtemp(prefix="wundadi-print-"))
    pdf_path = folder / "slip.pdf"
    render_html_pdf(html, pdf_path, width_mm=width_mm, height_mm=height_mm)
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
