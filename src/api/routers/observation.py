"""Observation 查詢 API（沙盒 2）。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from src.app.bootstrap import get_fhir_repository, get_shadow_store
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore

router = APIRouter(prefix="/fhir", tags=["Observation"])


def _store() -> SqliteShadowStore:
    store = get_shadow_store()
    assert isinstance(store, SqliteShadowStore)
    return store


@router.get("/Observation")
def list_observations(
    patient: str | None = Query(None),
    encounter: str | None = Query(None),
) -> dict[str, Any]:
    entries = _store().list_observations(patient_id=patient, encounter_id=encounter)
    return {
        "resourceType": "Bundle",
        "type": "searchset",
        "total": len(entries),
        "entry": entries,
    }


@router.get("/Observation/{observation_id}")
def get_observation(observation_id: str) -> dict[str, Any]:
    repo = get_fhir_repository()
    resource = repo.read_resource("Observation", observation_id)
    if resource is None:
        raise HTTPException(status_code=404, detail=f"Observation/{observation_id} not found")
    dual = _store().get_dual_layer("Observation", observation_id)
    if dual:
        return {"resource": resource, "indexMeta": dual.get("indexLayer")}
    return resource
