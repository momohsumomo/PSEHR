"""Condition（診斷 / ICD-10）API — 沙盒 2，僅 Swagger 驗證。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from src.api.schemas.condition import ConditionBody
from src.app.bootstrap import get_fhir_repository, get_shadow_store
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore

router = APIRouter(prefix="/fhir", tags=["Condition"])


def _store() -> SqliteShadowStore:
    store = get_shadow_store()
    assert isinstance(store, SqliteShadowStore)
    return store


def _patient_ref(patient_id: str) -> str:
    return patient_id if patient_id.startswith("Patient/") else f"Patient/{patient_id}"


@router.get("/Condition")
def list_conditions(
    patient: str | None = Query(None),
    encounter: str | None = Query(None),
) -> dict[str, Any]:
    entries = _store().list_conditions(patient_id=patient, encounter_id=encounter)
    return {
        "resourceType": "Bundle",
        "type": "searchset",
        "total": len(entries),
        "entry": entries,
    }


@router.get("/Condition/{condition_id}")
def get_condition(condition_id: str) -> dict[str, Any]:
    repo = get_fhir_repository()
    resource = repo.read_resource("Condition", condition_id)
    if resource is None:
        raise HTTPException(status_code=404, detail=f"Condition/{condition_id} not found")
    dual = _store().get_dual_layer("Condition", condition_id)
    if dual:
        return {"resource": resource, "indexMeta": dual.get("indexLayer")}
    return resource


@router.post("/Condition", status_code=201)
def create_condition(body: ConditionBody) -> dict[str, Any]:
    repo = get_fhir_repository()
    patient_id = body.subject.reference.split("/")[-1]
    if repo.read_resource("Patient", patient_id) is None:
        raise HTTPException(status_code=400, detail=f"Patient/{patient_id} 不存在")
    if body.encounter:
        enc_id = body.encounter.reference.split("/")[-1]
        if repo.read_resource("Encounter", enc_id) is None:
            raise HTTPException(status_code=400, detail=f"Encounter/{enc_id} 不存在")
    try:
        payload = body.to_fhir_dict()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    created = repo.create_resource("Condition", payload)
    entry = next(
        (e for e in _store().list_conditions() if e["resource"]["id"] == created["id"]),
        None,
    )
    return entry or {"resource": created}


@router.put("/Condition/{condition_id}")
def update_condition(condition_id: str, body: ConditionBody) -> dict[str, Any]:
    repo = get_fhir_repository()
    try:
        payload = body.to_fhir_dict()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    payload["id"] = condition_id
    home = _store().condition_encounter_id(condition_id)
    incoming = ""
    enc = payload.get("encounter")
    if isinstance(enc, dict) and enc.get("reference"):
        incoming = str(enc["reference"]).split("/")[-1]
    if home and incoming and home != incoming:
        raise HTTPException(status_code=409, detail="這筆病名屬於另一筆看診，不能改掛到這次")
    # Lean import keeps the diagnosis on condition_index without a cache row.
    # Saving the chart must create that row. Do not 404, and do not delete it.
    updated = repo.update_resource("Condition", condition_id, payload)
    dual = _store().get_dual_layer("Condition", condition_id)
    return {"resource": updated, "indexMeta": dual.get("indexLayer") if dual else None}
