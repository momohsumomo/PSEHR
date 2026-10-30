# -*- coding: utf-8 -*-
"""Diagnosis certificate saved with a visit."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.core.visit_certificate import find_for_visit, next_serial, save_for_visit

router = APIRouter(prefix="/clinic/certificate", tags=["Certificate"])


class CertificateBody(BaseModel):
    encounterId: str
    medicalNo: str = ""
    patientName: str = ""
    docNo: str = ""
    visitDate: str = ""
    printDate: str = ""
    diagnosis: str = ""
    order: str = ""
    appointment: str = ""
    doctor: str = ""
    english: bool = False


@router.get("")
def saved(encounterId: str = "") -> dict[str, Any]:
    return {"certificate": find_for_visit(encounterId), "nextDocNo": next_serial()}


@router.put("")
def save(body: CertificateBody) -> dict[str, Any]:
    try:
        row = save_for_visit(body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "certificate": row}
