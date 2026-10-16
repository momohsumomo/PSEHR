"""本機影子庫抽象層（Local-First：現階段 SQLite，未來實作可替換）。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class ShadowStore(ABC):
    """快取、斷線佇列、本機索引；上層不得直接寫 SQL。"""

    @abstractmethod
    def initialize(self) -> None:
        """建立或遷移本機 schema。"""

    @abstractmethod
    def cache_resource(self, resource_type: str, resource_id: str, payload: dict[str, Any]) -> None:
        """寫入本機快取。"""

    @abstractmethod
    def get_cached_resource(
        self, resource_type: str, resource_id: str
    ) -> dict[str, Any] | None:
        """讀取本機快取。"""

    @abstractmethod
    def enqueue_sync(
        self,
        operation: str,
        resource_type: str,
        resource_id: str | None,
        payload: dict[str, Any],
    ) -> int:
        """加入離線同步佇列（operation: create | update | delete）。"""

    @abstractmethod
    def dequeue_sync_batch(self, limit: int = 50) -> list[dict[str, Any]]:
        """取出待上傳佇列項目。"""

    @abstractmethod
    def mark_sync_done(self, queue_id: int) -> None:
        """標記佇列項目已同步至權威層。"""

    @abstractmethod
    def list_cached_resources(
        self, resource_type: str, limit: int = 100, offset: int = 0
    ) -> list[dict[str, Any]]:
        """列出某資源類型在本機快取中的所有項目（供 _search / UI 列表）。"""

    @abstractmethod
    def count_resources(self, resource_type: str) -> int:
        """計算本機快取中某資源類型的總數量。"""

    @abstractmethod
    def delete_cached_resource(self, resource_type: str, resource_id: str) -> None:
        """自本機快取中刪除指定資源，並清理對應之索引。"""

    @abstractmethod
    def verify_pin(self, pin: str) -> str | None:
        """驗證 PIN 碼並返回 Email，若無效則返回 None。"""

    @abstractmethod
    def get_resource_created_at(self, resource_type: str, resource_id: str) -> str | None:
        """獲取快取資源的最初建立時間。"""

    @abstractmethod
    def get_staff_list(self) -> list[dict[str, Any]]:
        """獲取所有診所員工。"""

    @abstractmethod
    def save_staff(self, staff: dict[str, Any]) -> None:
        """儲存或更新診所員工。"""

    @abstractmethod
    def delete_staff(self, staff_id: str) -> None:
        """刪除指定診所員工。"""

