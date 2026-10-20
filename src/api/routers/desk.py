# -*- coding: utf-8 -*-
"""Desk status and print jobs for the computer that opened the page."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from src.core.desk_channel import (
    enqueue,
    finish_job,
    fresh_report,
    job_view,
    remember_report,
    take_jobs,
    viewer_ip,
)

router = APIRouter(prefix="/clinic/desk", tags=["Desk"])

_NO_HTML = "\u6c92\u6709\u53ef\u5217\u5370\u7684\u5167\u5bb9"
_NO_AGENT = "\u9019\u53f0\u7684\u5de5\u4f5c\u7ad9\u5de5\u5177\u9084\u6c92\u6709\u5728\u56de\u5831\u3002\u8acb\u5148\u5728\u9019\u53f0\u96d9\u64ca\u5ba2\u6236\u7aef\u8cc7\u6599\u593e\u88e1\u7684\u958b\u555f\u9580\u8a3a\u3002"
_MISSING = "\u627e\u4e0d\u5230\u9019\u5f35\u5217\u5370"


def _ip(request: Request) -> str:
    peer = request.client.host if request.client else ""
    return viewer_ip(peer, request.headers.get("x-forwarded-for") or "")


@router.post("/report")
def report(payload: dict[str, Any], request: Request) -> dict[str, Any]:
    if not isinstance(payload, dict):
        payload = {}
    remember_report(_ip(request), payload)
    return {"ok": True}


@router.get("/status")
def status(request: Request) -> dict[str, Any]:
    ip = _ip(request)
    health = fresh_report(ip)
    if not health:
        return {"reported": False}
    health["reported"] = True
    health["self"] = False
    return health


@router.post("/print")
def print_job(payload: dict[str, Any], request: Request) -> dict[str, Any]:
    if not isinstance(payload, dict) or not str(payload.get("html") or "").strip():
        raise HTTPException(status_code=400, detail=_NO_HTML)
    ip = _ip(request)
    if fresh_report(ip) is None:
        raise HTTPException(status_code=400, detail=_NO_AGENT)
    job_id = enqueue(ip, payload, state="queued")
    return {"ok": True, "id": job_id, "state": "queued"}


@router.get("/print/{job_id}")
def print_state(job_id: str) -> dict[str, Any]:
    view = job_view(job_id)
    if view is None:
        raise HTTPException(status_code=404, detail=_MISSING)
    return view


@router.get("/jobs")
def jobs(request: Request) -> dict[str, Any]:
    return {"jobs": take_jobs(_ip(request))}


@router.post("/jobs/{job_id}")
def job_result(job_id: str, payload: dict[str, Any], request: Request) -> dict[str, Any]:
    if not isinstance(payload, dict):
        payload = {}
    finish_job(
        _ip(request),
        job_id,
        ok=bool(payload.get("ok")),
        printer=str(payload.get("printer") or ""),
        detail=str(payload.get("detail") or ""),
    )
    return {"ok": True}
