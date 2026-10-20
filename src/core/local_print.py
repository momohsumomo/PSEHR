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
import threading
import time
import urllib.request
import winreg
from pathlib import Path

def find_edge() -> Path | None:
    for raw in (
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ):
        path = Path(raw)
        if path.is_file():
            return path
    return None


def card6_exe() -> Path:
    pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    return Path(pf86) / "NHI" / "cshis6" / "ciet6001s01.exe"


def local_card6() -> dict:
    """6.0 only. A 5.x install does not count as ready."""
    exe = card6_exe()
    installed = exe.is_file()
    pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    legacy = (not installed) and any(
        Path(raw).exists()
        for raw in (
            r"C:\NHI",
            str(Path(pf86) / "NHI" / "cshis"),
            str(Path(pf86) / "NHI" / "CsHis"),
        )
    )
    running = False
    if installed:
        try:
            with socket.create_connection(("127.0.0.1", 5066), 0.4):
                running = True
        except OSError:
            running = False
    return {"installed": installed, "running": running, "legacy5": legacy}


def start_local_card6() -> dict:
    info = local_card6()
    if not info["installed"]:
        if info["legacy5"]:
            message = "\u9019\u53f0\u662f 5.XX\uff0c\u6c92\u6709\u8b80\u5361\u8edf\u9ad4 6.0\u30026.0 \u8981\u5f9e\u5065\u4fdd\u5c08\u7db2\u5b89\u88dd\uff0c\u9019\u88e1\u4e0d\u6703\u81ea\u5df1\u4e0b\u8f09\u3002"
        else:
            message = "\u9019\u53f0\u6c92\u6709\u8b80\u5361\u8edf\u9ad4 6.0\u3002\u8981\u5f9e\u5065\u4fdd\u5c08\u7db2\u5b89\u88dd\uff0c\u9019\u88e1\u4e0d\u6703\u81ea\u5df1\u4e0b\u8f09\u3002"
        return {"ok": False, "message": message, **info}
    if info["running"]:
        return {"ok": True, "message": "\u9019\u53f0\u7684\u8b80\u5361\u8edf\u9ad4 6.0 \u5df2\u7d93\u5728\u8dd1\u3002", **info}
    subprocess.Popen([str(card6_exe())], close_fds=True)
    return {"ok": True, "message": "\u5df2\u7d93\u958b\u555f\u9019\u53f0\u7684\u8b80\u5361\u8edf\u9ad4 6.0\u3002", **info}
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
    edge = find_edge()
    if edge is None:
        raise RuntimeError("\u9019\u53f0\u96fb\u8166\u6c92\u6709 Microsoft Edge\uff0c\u7121\u6cd5\u7d44\u5217\u5370\u6a94\u3002")
    folder = pdf_path.parent
    html_path = folder / "slip.html"
    html_path.write_text(html, encoding="utf-8")
    profile = folder / "edge-profile"
    proc = subprocess.Popen(
        [
            str(edge),
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


def desk_print_status(*, fresh: bool = False) -> dict:
    global _PRINT_CACHE
    if fresh:
        _PRINT_CACHE = None
    return {
        "ok": True,
        "edge": find_edge() is not None,
        "sumatra": find_sumatra() is not None,
        "printers": printer_rows(),
        "card6": local_card6(),
    }


def _registry_sumatra() -> list[Path]:
    paths: list[Path] = []
    try:
        import winreg
    except ImportError:
        return paths
    keys = (
        (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\App Paths\SumatraPDF.exe"),
        (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\App Paths\SumatraPDF.exe"),
        (winreg.HKEY_LOCAL_MACHINE, r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\SumatraPDF.exe"),
    )
    for hive, name in keys:
        try:
            with winreg.OpenKey(hive, name) as key:
                value, _ = winreg.QueryValueEx(key, "")
        except OSError:
            continue
        text = str(value or "").strip().strip('"')
        if text:
            paths.append(Path(text))
    return paths


def find_sumatra() -> Path | None:
    local = os.environ.get("LOCALAPPDATA", "")
    candidates = [
        Path(__file__).resolve().parents[2] / "\u5ba2\u6236\u7aef" / "SumatraPDF.exe",
        Path(local) / "SumatraPDF" / "SumatraPDF.exe",
        Path(local) / "Wundadi" / "print" / "SumatraPDF.exe",
        Path(r"C:\Program Files\SumatraPDF\SumatraPDF.exe"),
        Path(r"C:\Program Files (x86)\SumatraPDF\SumatraPDF.exe"),
        *_registry_sumatra(),
    ]
    for path in candidates:
        if path.is_file():
            return path
    found = shutil.which("SumatraPDF")
    return Path(found) if found else None


def ensure_sumatra() -> str:
    """SumatraPDF is installed by the clinic. This does not download it."""
    found = find_sumatra()
    if found is not None:
        return str(found)
    raise RuntimeError(sumatra_missing_message())


def sumatra_missing_message() -> str:
    local = os.environ.get("LOCALAPPDATA", "")
    folder = str(Path(local) / "Wundadi" / "print")
    return (
        "\u9019\u53f0\u96fb\u8166\u9084\u6c92\u5b89\u88dd\u5217\u5370\u7a0b\u5f0f SumatraPDF\u3002"
        "\u8acb\u5148\u5b89\u88dd\u5f8c\u518d\u5217\u5370\u3002"
        "\u4e0b\u8f09\uff1a" + _SUMATRA_URL + "\u3002"
        "\u4e5f\u53ef\u4ee5\u628a SumatraPDF.exe \u653e\u5230 " + folder
    )


def short_edge_portrait(width_mm: float, height_mm: float, feed: str | None) -> tuple[float, float, bool]:
    """Wide slip plus portrait feed matches the receipt driver.

    That driver stores the form as the short edge by the long edge, portrait
    (93.0 x 210.0 mm). The on-screen sheet stays wide; the job turns 90 degrees.
    """
    width = float(width_mm)
    height = float(height_mm)
    if (feed or "").strip().lower() == "portrait" and width > height + 2:
        return height, width, True
    return width, height, False


def _rotate_onto_short_edge(html: str, visual_w: float, visual_h: float) -> str:
    short = float(visual_h)
    long = float(visual_w)
    style = (
        '<style id="ys-short-edge">'
        "@page{size:%smm %smm;margin:0 !important;}"
        "html,body{margin:0 !important;padding:0 !important;width:%smm !important;height:%smm !important;"
        "overflow:hidden !important;background:#fff !important;}"
        ".ys-rot{width:%smm;height:%smm;transform-origin:top left;"
        "transform:rotate(90deg) translateY(-%smm);}"
        "</style>"
    ) % (short, long, short, long, long, short, short)
    if "</head>" in html:
        html = html.replace("</head>", style + "</head>", 1)
    else:
        html = style + html
    lower = html.lower()
    start = lower.find("<body")
    if start < 0:
        return '<div class="ys-rot">' + html + "</div>"
    open_end = html.find(">", start)
    close = lower.rfind("</body>")
    if open_end < 0 or close < 0 or close < open_end:
        return html
    return html[: open_end + 1] + '<div class="ys-rot">' + html[open_end + 1 : close] + "</div>" + html[close:]


def printer_job_settings(width_mm: float, height_mm: float, feed: str | None = None) -> str:
    """Page size sets the form. feed is how this printer takes the paper.

    When feed matches the form, lock rotation so the driver's last job cannot flip it.
    When feed differs, leave rotation on so the same form turns onto that feed.
    """
    page_landscape = float(width_mm) > float(height_mm) + 2
    chosen = (feed or "").strip().lower()
    if chosen == "landscape":
        want_landscape = True
    elif chosen == "portrait":
        want_landscape = False
    else:
        want_landscape = page_landscape
    orient = "landscape" if want_landscape else "portrait"
    turned = want_landscape != page_landscape
    lock = "noscale" if turned else "noscale,disable-auto-rotation"
    paper = ""
    if abs(width_mm - 210) <= 2 and abs(height_mm - 297) <= 2:
        paper = "paper=A4,"
    elif abs(width_mm - 297) <= 2 and abs(height_mm - 210) <= 2:
        paper = "paper=A4,"
    elif abs(width_mm - 148) <= 2 and abs(height_mm - 210) <= 2:
        paper = "paper=A5,"
    elif abs(width_mm - 210) <= 2 and abs(height_mm - 148) <= 2:
        paper = "paper=A5,"
    if paper:
        return paper + orient + "," + lock
    if chosen in {"portrait", "landscape"}:
        return orient + "," + lock
    return lock


def print_html_to_printer(
    *,
    html: str,
    printer_name: str,
    width_mm: float,
    height_mm: float,
    feed: str = "",
) -> str:
    printer = _match_printer(printer_name)
    exe = find_sumatra()
    if exe is None:
        raise RuntimeError(sumatra_missing_message())
    folder = Path(tempfile.mkdtemp(prefix="wundadi-print-"))
    pdf_path = folder / "slip.pdf"
    page_w, page_h, turn = short_edge_portrait(width_mm, height_mm, feed)
    page_html = _rotate_onto_short_edge(html, width_mm, height_mm) if turn else html
    page_feed = "portrait" if turn else feed
    render_html_pdf(page_html, pdf_path, width_mm=page_w, height_mm=page_h)
    proc = subprocess.run(
        [
            str(exe),
            "-silent",
            "-print-to",
            printer,
            "-print-settings",
            printer_job_settings(page_w, page_h, page_feed),
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


def queue_html_print(
    *,
    html: str,
    printer_name: str,
    width_mm: float,
    height_mm: float,
    feed: str = "",
) -> str:
    """Accept the job and return. Rendering and the printer run on a background thread."""
    printer = _match_printer(printer_name)
    if find_sumatra() is None:
        raise RuntimeError(sumatra_missing_message())

    def run() -> None:
        try:
            print_html_to_printer(
                html=html,
                printer_name=printer,
                width_mm=width_mm,
                height_mm=height_mm,
                feed=feed,
            )
        except Exception:
            return

    threading.Thread(target=run, name="wundadi-print-job", daemon=True).start()
    return printer


def _match_printer(printer_name: str) -> str:
    want = printer_name.strip()
    if not want:
        raise RuntimeError("\u9019\u4e00\u5217\u9084\u6c92\u9078\u5370\u8868\u6a5f\u3002")
    for name in installed_printers():
        if name == want:
            return name
    raise RuntimeError("\u9019\u53f0\u96fb\u8166\u770b\u4e0d\u5230\u9019\u53f0\u5370\u8868\u6a5f\uff1a" + want)
