# -*- coding: utf-8 -*-
"""This PC reports printers, card software and VPN to the clinic site.

The page reads that report from the same URL. It does not call 127.0.0.1.
"""

from __future__ import annotations

import socket
import threading
import time
import uuid
from typing import Any

_LOCK = threading.Lock()
_REPORTS: dict[str, dict[str, Any]] = {}
_JOBS: dict[str, dict[str, Any]] = {}
_VPN_AT = 0.0
_VPN_OK = False
_KEEP_FIELDS = ("ok", "edge", "sumatra", "printers", "card6", "vpn")


def viewer_ip(peer: str, forwarded_for: str) -> str:
    host = (peer or "").strip()
    if host.startswith("::ffff:"):
        host = host[7:]
    if host in {"127.0.0.1", "::1"}:
        parts = [part.strip() for part in (forwarded_for or "").split(",") if part.strip()]
        if parts:
            return parts[-1]
    return host


def local_ipv4() -> set[str]:
    found = {"127.0.0.1"}
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("8.8.8.8", 80))
        found.add(probe.getsockname()[0])
        probe.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.add(info[4][0])
    except OSError:
        pass
    return found


def is_host_ip(ip: str) -> bool:
    return ip in local_ipv4()


def remember_report(ip: str, payload: dict[str, Any]) -> None:
    health = {key: payload.get(key) for key in _KEEP_FIELDS if key in payload}
    printers = health.get("printers")
    if isinstance(printers, dict):
        health["printers"] = [printers]
    with _LOCK:
        _REPORTS[ip] = {"at": time.time(), "health": health}
        _drop_old_unlocked()


def fresh_report(ip: str, max_age: float = 25.0) -> dict[str, Any] | None:
    with _LOCK:
        row = _REPORTS.get(ip)
    if not row:
        return None
    if time.time() - float(row["at"]) > max_age:
        return None
    health = row.get("health")
    return dict(health) if isinstance(health, dict) else None


def host_status() -> dict[str, Any]:
    from src.core.local_print import desk_print_status

    status = dict(desk_print_status(fresh=False))
    status["vpn"] = _vpn_reachable()
    status["reported"] = True
    status["self"] = True
    return status


def enqueue(ip: str, body: dict[str, Any], *, state: str = "queued") -> str:
    job_id = uuid.uuid4().hex
    feed = str(body.get("feed") or "").strip().lower()
    if feed not in {"portrait", "landscape"}:
        feed = ""
    kind = str(body.get("kind") or "print").strip() or "print"
    job = {
        "id": job_id,
        "ip": ip,
        "kind": kind,
        "html": str(body.get("html") or ""),
        "printerName": str(body.get("printerName") or ""),
        "widthMm": body.get("widthMm") or 0,
        "heightMm": body.get("heightMm") or 0,
        "feed": feed,
        "fileName": str(body.get("fileName") or ""),
        "fileB64": str(body.get("fileB64") or ""),
        "state": state,
        "detail": "",
        "printer": "",
        "at": time.time(),
    }
    with _LOCK:
        _JOBS[job_id] = job
        _drop_old_unlocked()
    return job_id


def take_jobs(ip: str) -> list[dict[str, Any]]:
    with _LOCK:
        rows = [job for job in _JOBS.values() if job["ip"] == ip and job["state"] == "queued"]
        for job in rows:
            job["state"] = "printing"
        return [
            {
                "id": job["id"],
                "kind": job.get("kind") or "print",
                "html": job["html"],
                "printerName": job["printerName"],
                "widthMm": job["widthMm"],
                "heightMm": job["heightMm"],
                "feed": job["feed"],
                "fileName": job.get("fileName") or "",
                "fileB64": job.get("fileB64") or "",
            }
            for job in rows
        ]


def finish_job(ip: str, job_id: str, *, ok: bool, printer: str = "", detail: str = "") -> bool:
    with _LOCK:
        job = _JOBS.get(job_id)
        if not job or job["ip"] != ip:
            return False
        job["state"] = "done" if ok else "error"
        job["printer"] = printer
        job["detail"] = detail[:300]
        job["html"] = ""
        job["fileB64"] = ""
        return True


def job_view(job_id: str) -> dict[str, Any] | None:
    with _LOCK:
        job = _JOBS.get(job_id)
        if not job:
            return None
        return {
            "id": job_id,
            "state": job["state"],
            "printer": job["printer"],
            "detail": job["detail"],
        }


def _drop_old_unlocked() -> None:
    cutoff = time.time() - 900
    stale = [job_id for job_id, job in _JOBS.items() if float(job["at"]) < cutoff]
    for job_id in stale:
        _JOBS.pop(job_id, None)


def _vpn_reachable() -> bool:
    global _VPN_AT, _VPN_OK
    now = time.time()
    if now - _VPN_AT < 15:
        return _VPN_OK
    ok = False
    try:
        with socket.create_connection(("medvpndc.nhi.gov.tw", 443), timeout=2.0):
            ok = True
    except OSError:
        ok = False
    _VPN_AT = now
    _VPN_OK = ok
    return ok
