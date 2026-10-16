"""本機規則 Pack 儲存與 Hydrate 執行紀錄（與臨床 sync_queue 分離）。"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from src.infrastructure.sqlite_shadow_store import DEFAULT_DB_PATH

_PACK_SCHEMA = """
CREATE TABLE IF NOT EXISTS rule_package (
    version         TEXT PRIMARY KEY,
    effective_from  TEXT NOT NULL,
    effective_to    TEXT,
    checksum_sha256 TEXT NOT NULL,
    publish_mode    TEXT NOT NULL,
    published_at    TEXT NOT NULL,
    payload_json    TEXT NOT NULL,
    installed_at    TEXT NOT NULL DEFAULT (datetime('now')),
    active          INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_rule_package_effective
    ON rule_package(effective_from, effective_to);

CREATE TABLE IF NOT EXISTS hydrate_run (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at       TEXT NOT NULL,
    finished_at      TEXT,
    status           TEXT NOT NULL,
    failed_node      TEXT,
    error_code       TEXT,
    error_message    TEXT,
    candidate_version TEXT,
    installed_version TEXT,
    fallback_version TEXT,
    nodes_json       TEXT NOT NULL,
    diagnosis        TEXT
);

CREATE INDEX IF NOT EXISTS idx_hydrate_run_started ON hydrate_run(started_at DESC);
"""


class PackStore:
    def __init__(self, db_path: Path | None = None) -> None:
        self._db_path = db_path or DEFAULT_DB_PATH

    def initialize(self) -> None:
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.executescript(_PACK_SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def list_installed(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT version, effective_from, effective_to, checksum_sha256,
                       publish_mode, published_at, installed_at, active
                FROM rule_package
                ORDER BY effective_from DESC, version DESC
                """
            ).fetchall()
        return [dict(r) for r in rows]

    def get_package(self, version: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM rule_package WHERE version = ?", (version,)
            ).fetchone()
        if not row:
            return None
        d = dict(row)
        d["payload"] = json.loads(d.pop("payload_json"))
        return d

    def latest_active_version(self) -> str | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT version FROM rule_package
                WHERE active = 1
                ORDER BY effective_from DESC, installed_at DESC
                LIMIT 1
                """
            ).fetchone()
        return str(row["version"]) if row else None

    def resolve_for_date(self, target_date: str) -> dict[str, Any] | None:
        """effective_from <= target_date 且 (effective_to IS NULL OR >= target_date)。"""
        day = target_date[:10]
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT * FROM rule_package
                WHERE active = 1
                  AND effective_from <= ?
                  AND (effective_to IS NULL OR effective_to = '' OR effective_to >= ?)
                ORDER BY effective_from DESC, version DESC
                LIMIT 1
                """,
                (day, day),
            ).fetchone()
        if not row:
            return None
        d = dict(row)
        d["payload"] = json.loads(d.pop("payload_json"))
        return d

    def install_package(self, pack: dict[str, Any]) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO rule_package (
                    version, effective_from, effective_to, checksum_sha256,
                    publish_mode, published_at, payload_json, active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(version) DO UPDATE SET
                    effective_from = excluded.effective_from,
                    effective_to = excluded.effective_to,
                    checksum_sha256 = excluded.checksum_sha256,
                    publish_mode = excluded.publish_mode,
                    published_at = excluded.published_at,
                    payload_json = excluded.payload_json,
                    installed_at = datetime('now'),
                    active = 1
                """,
                (
                    pack["version"],
                    str(pack["effectiveFrom"])[:10],
                    (str(pack["effectiveTo"])[:10] if pack.get("effectiveTo") else None),
                    str(pack["checksumSha256"]).lower(),
                    pack["publishMode"],
                    pack["publishedAt"],
                    json.dumps(pack, ensure_ascii=False),
                ),
            )

    def begin_run(self, started_at: str) -> int:
        with self._connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO hydrate_run (started_at, status, nodes_json)
                VALUES (?, 'running', '[]')
                """,
                (started_at,),
            )
            return int(cur.lastrowid)

    def finish_run(self, run_id: int, result: dict[str, Any]) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE hydrate_run SET
                    finished_at = ?,
                    status = ?,
                    failed_node = ?,
                    error_code = ?,
                    error_message = ?,
                    candidate_version = ?,
                    installed_version = ?,
                    fallback_version = ?,
                    nodes_json = ?,
                    diagnosis = ?
                WHERE id = ?
                """,
                (
                    result["finishedAt"],
                    result["status"],
                    result.get("failedNode"),
                    result.get("errorCode"),
                    result.get("errorMessage"),
                    result.get("candidateVersion"),
                    result.get("installedVersion"),
                    result.get("fallbackVersion"),
                    json.dumps(result.get("nodes") or [], ensure_ascii=False),
                    result.get("diagnosis"),
                    run_id,
                ),
            )

    def list_runs(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, started_at, finished_at, status, failed_node, error_code,
                       error_message, candidate_version, installed_version,
                       fallback_version, diagnosis, nodes_json
                FROM hydrate_run
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        out: list[dict[str, Any]] = []
        for r in rows:
            d = dict(r)
            d["nodes"] = json.loads(d.pop("nodes_json") or "[]")
            out.append(d)
        return out

    def last_run(self) -> dict[str, Any] | None:
        runs = self.list_runs(limit=1)
        return runs[0] if runs else None
