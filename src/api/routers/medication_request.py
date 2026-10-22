"""MedicationRequest（處方 / 健保碼）API — 沙盒 2。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from src.api.schemas.medication_request import MedicationRequestBody
from src.app.bootstrap import get_fhir_repository, get_shadow_store
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore

router = APIRouter(prefix="/fhir", tags=["MedicationRequest"])


class RetainChartBody(BaseModel):
    medicationIds: list[str] | None = None
    conditionIds: list[str] | None = None


@router.post("/Encounter/{encounter_id}/retain-chart")
def retain_encounter_chart(encounter_id: str, body: RetainChartBody) -> dict[str, bool]:
    """The last chart save replaces what the screen and the claim file read."""
    _store().retain_encounter_chart(
        encounter_id,
        medication_ids=body.medicationIds,
        condition_ids=body.conditionIds,
    )
    return {"ok": True}


def _store() -> SqliteShadowStore:
    store = get_shadow_store()
    assert isinstance(store, SqliteShadowStore)
    return store


@router.get("/MedicationRequest/previous")
def list_previous_medication_requests(
    patient: str = Query(..., description="病人 ID"),
    excludeEncounter: str | None = Query(
        None, description="排除當次 Encounter（取最近已完成就診的處方）"
    ),
) -> dict[str, Any]:
    """前次處方（皮膚科 v0.2 §4.6 一鍵複製來源）。"""
    store = _store()
    prev_enc = store.find_last_finished_encounter_id(
        patient, exclude_encounter_id=excludeEncounter
    )
    if not prev_enc:
        return {
            "resourceType": "Bundle",
            "type": "searchset",
            "total": 0,
            "previousEncounterId": None,
            "entry": [],
        }
    entries = store.list_medication_requests(patient_id=patient, encounter_id=prev_enc)
    return {
        "resourceType": "Bundle",
        "type": "searchset",
        "total": len(entries),
        "previousEncounterId": prev_enc,
        "entry": entries,
    }


@router.get("/MedicationRequest")
def list_medication_requests(
    patient: str | None = Query(None),
    encounter: str | None = Query(None),
) -> dict[str, Any]:
    entries = _store().list_medication_requests(patient_id=patient, encounter_id=encounter)
    return {
        "resourceType": "Bundle",
        "type": "searchset",
        "total": len(entries),
        "entry": entries,
    }


@router.get("/MedicationRequest/{medication_id}")
def get_medication_request(medication_id: str) -> dict[str, Any]:
    repo = get_fhir_repository()
    resource = repo.read_resource("MedicationRequest", medication_id)
    if resource is None:
        raise HTTPException(status_code=404, detail=f"MedicationRequest/{medication_id} not found")
    dual = _store().get_dual_layer("MedicationRequest", medication_id)
    if dual:
        return {"resource": resource, "indexMeta": dual.get("indexLayer")}
    return resource


@router.post("/MedicationRequest", status_code=201)
def create_medication_request(body: MedicationRequestBody) -> dict[str, Any]:
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
    created = repo.create_resource("MedicationRequest", payload)
    entry = next(
        (e for e in _store().list_medication_requests() if e["resource"]["id"] == created["id"]),
        None,
    )
    return entry or {"resource": created}


@router.put("/MedicationRequest/{medication_id}")
def update_medication_request(medication_id: str, body: MedicationRequestBody) -> dict[str, Any]:
    repo = get_fhir_repository()
    try:
        payload = body.to_fhir_dict()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    payload["id"] = medication_id
    # Same as Condition: the order can exist only on the index. Save creates the cache row.
    updated = repo.update_resource("MedicationRequest", medication_id, payload)
    dual = _store().get_dual_layer("MedicationRequest", medication_id)
    return {"resource": updated, "indexMeta": dual.get("indexLayer") if dual else None}
