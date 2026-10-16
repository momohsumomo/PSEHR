"""規則 Pack 契約與單次 Hydrate 執行結果（可診斷）。"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

from src.spoke.nodes import HydrateNode

REQUIRED_PACK_FIELDS = (
    "version",
    "effectiveFrom",
    "checksumSha256",
    "publishedAt",
    "publishMode",
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def sha256_canonical_payload(payload: dict[str, Any]) -> str:
    """對 resources（或整包扣除 checksum 欄位）做穩定雜湊。"""
    body = {k: v for k, v in payload.items() if k != "checksumSha256"}
    raw = json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


@dataclass
class NodeResult:
    node: HydrateNode
    ok: bool
    code: str
    message: str
    detail: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "node": self.node.value,
            "ok": self.ok,
            "code": self.code,
            "message": self.message,
            "detail": self.detail,
        }


@dataclass
class HydrateRunResult:
    run_id: int | None
    status: str  # success | failed | skipped_up_to_date
    started_at: str
    finished_at: str
    nodes: list[NodeResult]
    failed_node: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    candidate_version: str | None = None
    installed_version: str | None = None
    fallback_version: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "runId": self.run_id,
            "status": self.status,
            "startedAt": self.started_at,
            "finishedAt": self.finished_at,
            "failedNode": self.failed_node,
            "errorCode": self.error_code,
            "errorMessage": self.error_message,
            "candidateVersion": self.candidate_version,
            "installedVersion": self.installed_version,
            "fallbackVersion": self.fallback_version,
            "nodes": [n.to_dict() for n in self.nodes],
            "diagnosis": self.diagnosis_line(),
        }

    def diagnosis_line(self) -> str:
        if self.status == "success":
            return f"成功：已安裝／啟用 {self.installed_version or self.candidate_version}"
        if self.status == "skipped_up_to_date":
            return f"無需更新：本機已是最新（{self.fallback_version or self.installed_version}）"
        node = self.failed_node or "unknown"
        return (
            f"失敗於節點 [{node}] "
            f"code={self.error_code} — {self.error_message}；"
            f"診所繼續使用 fallback={self.fallback_version or '（無已安裝版）'}"
        )


def validate_pack_schema(pack: dict[str, Any]) -> tuple[bool, str, dict[str, Any]]:
    missing = [k for k in REQUIRED_PACK_FIELDS if not pack.get(k)]
    if missing:
        return False, "SCHEMA_MISSING_FIELDS", {"missing": missing}
    if not isinstance(pack.get("version"), str) or not str(pack["version"]).strip():
        return False, "SCHEMA_BAD_VERSION", {}
    try:
        date.fromisoformat(str(pack["effectiveFrom"])[:10])
    except ValueError:
        return False, "SCHEMA_BAD_EFFECTIVE_FROM", {"effectiveFrom": pack.get("effectiveFrom")}
    et = pack.get("effectiveTo")
    if et not in (None, ""):
        try:
            date.fromisoformat(str(et)[:10])
        except ValueError:
            return False, "SCHEMA_BAD_EFFECTIVE_TO", {"effectiveTo": et}
    mode = pack.get("publishMode")
    if mode not in ("auto", "manual"):
        return False, "SCHEMA_BAD_PUBLISH_MODE", {"publishMode": mode}
    if "resources" not in pack or not isinstance(pack["resources"], dict):
        return False, "SCHEMA_MISSING_RESOURCES", {}
    return True, "OK", {}


def verify_pack_checksum(pack: dict[str, Any]) -> tuple[bool, str, dict[str, Any]]:
    declared = str(pack.get("checksumSha256") or "").lower().strip()
    if not declared:
        return False, "CHECKSUM_MISSING", {}
    actual = sha256_canonical_payload(pack)
    if actual != declared:
        return False, "CHECKSUM_MISMATCH", {"declared": declared, "actual": actual}
    return True, "OK", {"checksumSha256": actual}
