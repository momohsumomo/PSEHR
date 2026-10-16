"""應用程式啟動：初始化 Local-First 儲存與 FHIR Repository。"""

from __future__ import annotations

from src.core.interfaces.fhir_repository import FhirRepository
from src.infrastructure.local_fhir_repository import LocalFirstFhirRepository
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore

_store: SqliteShadowStore | None = None
_repository: FhirRepository | None = None


def get_shadow_store() -> SqliteShadowStore:
    global _store
    if _store is None:
        _store = SqliteShadowStore()
        _store.initialize()
    return _store


def get_fhir_repository() -> FhirRepository:
    global _repository
    if _repository is None:
        _repository = LocalFirstFhirRepository(get_shadow_store())
    return _repository


def reset_for_tests() -> None:
    """測試用：重設單例。"""
    global _store, _repository
    _store = None
    _repository = None
