# -*- coding: utf-8 -*-
"""Print agent for this computer only. Bind 127.0.0.1 so a server cannot print here."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from src.core.local_print import (
    desk_print_status,
    ensure_sumatra,
    installed_printers,
    proxy_local_cshis,
    queue_html_print,
    start_local_card6,
)

HOST = "127.0.0.1"
PORT = 5310


class LocalPrintHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        return

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, payload: dict, status: int = 200) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/health":
            fresh = "fresh=1" in (self.path.split("?", 1)[1] if "?" in self.path else "")
            self._json(desk_print_status(fresh=fresh))
            return
        if path == "/printers":
            self._json({"ok": True, "printers": installed_printers()})
            return
        self._json({"detail": "not found"}, 404)

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/tools/card":
            self._json(start_local_card6())
            return
        if path == "/tools/cshis":
            try:
                length = int(self.headers.get("Content-Length") or "0")
            except ValueError:
                length = 0
            try:
                payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            except (UnicodeError, json.JSONDecodeError):
                self._json({"ok": False, "statusCode": 400}, 400)
                return
            if not isinstance(payload, dict):
                self._json({"ok": False, "statusCode": 400}, 400)
                return
            body = payload.get("body")
            self._json(proxy_local_cshis(
                str(payload.get("method") or "GET"),
                str(payload.get("path") or ""),
                body if isinstance(body, dict) else None,
            ))
            return
        if path == "/tools/sumatra":
            try:
                exe = ensure_sumatra()
            except Exception as exc:
                self._json({"ok": False, "message": str(exc)}, 400)
                return
            self._json({"ok": True, "message": exe})
            return
        if path != "/print":
            self._json({"detail": "not found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            length = 0
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            self._json({"detail": "\u5217\u5370\u5167\u5bb9\u4e0d\u662f JSON"}, 400)
            return
        if not isinstance(body, dict):
            self._json({"detail": "\u5217\u5370\u5167\u5bb9\u4e0d\u5c0d"}, 400)
            return
        html = str(body.get("html") or "")
        printer_name = str(body.get("printerName") or "")
        try:
            width = float(body.get("widthMm") or 0)
            height = float(body.get("heightMm") or 0)
        except (TypeError, ValueError):
            self._json({"detail": "\u7d19\u5f35\u9577\u5bec\u4e0d\u662f\u6578\u5b57"}, 400)
            return
        if not html.strip():
            self._json({"detail": "\u6c92\u6709\u53ef\u5217\u5370\u7684\u5167\u5bb9"}, 400)
            return
        try:
            feed = str(body.get("feed") or "").strip().lower()
            if feed not in {"portrait", "landscape"}:
                feed = ""
            used = queue_html_print(
                html=html,
                printer_name=printer_name,
                width_mm=width,
                height_mm=height,
                feed=feed,
            )
        except RuntimeError as exc:
            self._json({"detail": str(exc)}, 400)
            return
        self._json({"ok": True, "printer": used})


def start_local_print_server() -> None:
    """????E???@?_? 127.0.0.1?A?u?A??o?x?q???A???t?}?{???C"""

    def run() -> None:
        try:
            ThreadingHTTPServer.allow_reuse_address = True
            server = ThreadingHTTPServer((HOST, PORT), LocalPrintHandler)
        except OSError:
            return
        server.serve_forever()

    threading.Thread(target=run, name="wundadi-print", daemon=True).start()


def main() -> None:
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "sumatra":
        print(ensure_sumatra())
        return
    start_local_print_server()
    threading.Event().wait()


if __name__ == "__main__":
    main()
