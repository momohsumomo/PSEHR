from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from src.api.schemas.allergy_intolerance import AllergyIntoleranceBody
from src.app.bootstrap import get_fhir_repository

router = APIRouter(prefix="/fhir", tags=["AllergyIntolerance"])


def _patient_reference(patient_id: str) -> str:
    return patient_id if patient_id.startswith("Patient/") else f"Patient/{patient_id}"


def _matches_patient(resource: dict[str, Any], patient_ref: str) -> bool:
    patient = resource.get("patient") or {}
    ref = patient.get("reference", "")
    return ref == patient_ref or ref.endswith(f"/{patient_ref.split('/')[-1]}")


@router.get("/AllergyIntolerance")
def list_allergies(
    patient: str | None = Query(None, description="病人 ID 或 Patient/{id}"),
) -> dict[str, Any]:
    repo = get_fhir_repository()
    entries = repo.search("AllergyIntolerance")
    if patient:
        patient_ref = _patient_reference(patient)
        entries = [r for r in entries if _matches_patient(r, patient_ref)]
    return {
        "resourceType": "Bundle",
        "type": "searchset",
        "total": len(entries),
        "entry": [{"resource": r} for r in entries],
    }


@router.get("/AllergyIntolerance/{allergy_id}")
def get_allergy(allergy_id: str) -> dict[str, Any]:
    repo = get_fhir_repository()
    resource = repo.read_resource("AllergyIntolerance", allergy_id)
    if resource is None:
        raise HTTPException(status_code=404, detail=f"AllergyIntolerance/{allergy_id} not found")
    return resource


@router.post("/AllergyIntolerance", status_code=201)
def create_allergy(body: AllergyIntoleranceBody) -> dict[str, Any]:
    repo = get_fhir_repository()
    patient_id = body.patient.reference.split("/")[-1]
    if repo.read_resource("Patient", patient_id) is None:
        raise HTTPException(
            status_code=400,
            detail=f"Patient/{patient_id} 不存在，請先建立病人",
        )
    return repo.create_resource("AllergyIntolerance", body.to_fhir_dict())


@router.put("/AllergyIntolerance/{allergy_id}")
def update_allergy(allergy_id: str, body: AllergyIntoleranceBody) -> dict[str, Any]:
    repo = get_fhir_repository()
    if repo.read_resource("AllergyIntolerance", allergy_id) is None:
        raise HTTPException(status_code=404, detail=f"AllergyIntolerance/{allergy_id} not found")
    payload = body.to_fhir_dict()
    payload["id"] = allergy_id
    return repo.update_resource("AllergyIntolerance", allergy_id, payload)
