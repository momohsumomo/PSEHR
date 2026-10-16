"""權威 FHIR 儲存抽象層（Local-First：未來可換 GCP Healthcare API / PostgreSQL）。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class FhirRepository(ABC):
    """上層業務與 UI 只依賴此介面，不直接碰底層 FHIR Server 實作。"""

    @abstractmethod
    def read_resource(self, resource_type: str, resource_id: str) -> dict[str, Any] | None:
        """讀取單一 FHIR 資源（例如 Patient/{id}）。"""

    @abstractmethod
    def create_resource(self, resource_type: str, resource: dict[str, Any]) -> dict[str, Any]:
        """建立 FHIR 資源，回傳含 server 指派 id 的完整資源。"""

    @abstractmethod
    def update_resource(
        self, resource_type: str, resource_id: str, resource: dict[str, Any]
    ) -> dict[str, Any]:
        """更新既有 FHIR 資源。"""

    @abstractmethod
    def search(
        self, resource_type: str, params: dict[str, str] | None = None
    ) -> list[dict[str, Any]]:
        """條件查詢（對應 FHIR _search）。"""

    @abstractmethod
    def delete_resource(self, resource_type: str, resource_id: str) -> None:
        """刪除既有 FHIR 資源。"""

