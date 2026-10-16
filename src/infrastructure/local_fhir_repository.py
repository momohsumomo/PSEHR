"""Local-First 權威層過渡實作：讀寫先走 ShadowStore，權威 FHIR 上雲待 Phase 0 接上。"""

from __future__ import annotations

from typing import Any
from fastapi import HTTPException

from src.core.interfaces.fhir_repository import FhirRepository
from src.core.interfaces.shadow_store import ShadowStore
from src.infrastructure.sqlite_shadow_store import PatientKeyConflict


class LocalFirstFhirRepository(FhirRepository):
    """
    現階段以影子庫為準；未來可新增 GcpHealthcareFhirRepository 等實作，
    透過依賴注入替換，業務層與 UI 無需修改。
    """

    def __init__(self, shadow: ShadowStore) -> None:
        self._shadow = shadow

    def read_resource(self, resource_type: str, resource_id: str) -> dict[str, Any] | None:
        return self._shadow.get_cached_resource(resource_type, resource_id)

    def create_resource(self, resource_type: str, resource: dict[str, Any]) -> dict[str, Any]:
        resource_id = resource.get("id") or self._new_local_id(resource_type)
        body = {**resource, "resourceType": resource_type, "id": resource_id}
        try:
            self._shadow.cache_resource(resource_type, resource_id, body)
        except PatientKeyConflict as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        self._shadow.enqueue_sync("create", resource_type, resource_id, body)
        return body

    def update_resource(
        self, resource_type: str, resource_id: str, resource: dict[str, Any]
    ) -> dict[str, Any]:
        body = {**resource, "resourceType": resource_type, "id": resource_id}
        try:
            self._shadow.cache_resource(resource_type, resource_id, body)
        except PatientKeyConflict as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        self._shadow.enqueue_sync("update", resource_type, resource_id, body)
        return body

    def delete_resource(self, resource_type: str, resource_id: str) -> None:
        self._shadow.delete_cached_resource(resource_type, resource_id)
        self._shadow.enqueue_sync("delete", resource_type, resource_id, {})

    def search(
        self, resource_type: str, params: dict[str, str] | None = None
    ) -> list[dict[str, Any]]:
        limit = 100
        offset = 0
        if params:
            if "_count" in params:
                try:
                    limit = int(params["_count"])
                except ValueError:
                    pass
            if "_offset" in params:
                try:
                    offset = int(params["_offset"])
                except ValueError:
                    pass

        if resource_type == "Patient" and params:
            search_fn = getattr(self._shadow, "search_patients", None)
            if search_fn:
                return search_fn(params)
        return self._shadow.list_cached_resources(resource_type, limit=limit, offset=offset)

    @staticmethod
    def _new_local_id(resource_type: str) -> str:
        import uuid

        return f"local-{resource_type.lower()}-{uuid.uuid4().hex[:12]}"
