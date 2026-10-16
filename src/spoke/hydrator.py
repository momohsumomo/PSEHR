"""Spoke Hydrator：分節點執行，失敗必回 failedNode + code + diagnosis。"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from src.spoke.local_hub import (
    hub_packages_dir,
    hub_packages_url,
    list_local_manifest,
    load_local_pack,
)
from src.spoke.nodes import HydrateNode
from src.spoke.pack_models import (
    HydrateRunResult,
    NodeResult,
    utc_now_iso,
    validate_pack_schema,
    verify_pack_checksum,
)
from src.spoke.pack_store import PackStore

logger = logging.getLogger("spoke.hydrator")


class PackHydrator:
    def __init__(self, store: PackStore | None = None) -> None:
        self.store = store or PackStore()
        self.store.initialize()

    async def run_once(self) -> HydrateRunResult:
        started = utc_now_iso()
        run_id = self.store.begin_run(started)
        nodes: list[NodeResult] = []
        fallback = self.store.latest_active_version()
        candidate: str | None = None
        source_kind = "local"
        source_ref = ""
        manifest: list[dict[str, Any]] = []
        pack: dict[str, Any] | None = None

        def fail(
            node: HydrateNode,
            code: str,
            message: str,
            detail: dict[str, Any] | None = None,
        ) -> HydrateRunResult:
            nodes.append(
                NodeResult(node=node, ok=False, code=code, message=message, detail=detail or {})
            )
            finished = utc_now_iso()
            result = HydrateRunResult(
                run_id=run_id,
                status="failed",
                started_at=started,
                finished_at=finished,
                nodes=nodes,
                failed_node=node.value,
                error_code=code,
                error_message=message,
                candidate_version=candidate,
                fallback_version=fallback,
            )
            self.store.finish_run(run_id, result.to_dict())
            logger.warning(result.diagnosis_line())
            return result

        def ok_node(node: HydrateNode, code: str, message: str, detail: dict[str, Any] | None = None) -> None:
            nodes.append(
                NodeResult(node=node, ok=True, code=code, message=message, detail=detail or {})
            )

        # --- 1 resolve_source ---
        url = hub_packages_url()
        if url:
            source_kind = "remote"
            source_ref = url.rstrip("/")
        else:
            source_kind = "local"
            source_ref = str(hub_packages_dir())
        ok_node(
            HydrateNode.RESOLVE_SOURCE,
            "SOURCE_OK",
            f"來源模式={source_kind}",
            {"kind": source_kind, "ref": source_ref},
        )

        # --- 2 hub_reachable ---
        if source_kind == "local":
            hub_dir = hub_packages_dir()
            if not hub_dir.is_dir():
                return fail(
                    HydrateNode.HUB_REACHABLE,
                    "HUB_DIR_MISSING",
                    f"本機 Hub 目錄不存在：{hub_dir}",
                    {"path": str(hub_dir)},
                )
            ok_node(
                HydrateNode.HUB_REACHABLE,
                "HUB_DIR_OK",
                "本機 Hub 目錄可讀",
                {"path": str(hub_dir)},
            )
        else:
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    r = await client.get(f"{source_ref}/manifest")
                    if r.status_code >= 400:
                        return fail(
                            HydrateNode.HUB_REACHABLE,
                            "HUB_HTTP_BAD_STATUS",
                            f"Hub manifest HTTP {r.status_code}",
                            {"status": r.status_code, "url": f"{source_ref}/manifest"},
                        )
            except Exception as exc:
                return fail(
                    HydrateNode.HUB_REACHABLE,
                    "HUB_UNREACHABLE",
                    f"無法連線 Hub：{exc}",
                    {"url": source_ref},
                )
            ok_node(HydrateNode.HUB_REACHABLE, "HUB_HTTP_OK", "遠端 Hub 可連")

        # --- 3 fetch_manifest ---
        try:
            if source_kind == "local":
                manifest = list_local_manifest()
            else:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    r = await client.get(f"{source_ref}/manifest")
                    r.raise_for_status()
                    body = r.json()
                    manifest = body if isinstance(body, list) else body.get("packages") or []
        except Exception as exc:
            return fail(
                HydrateNode.FETCH_MANIFEST,
                "MANIFEST_FETCH_FAILED",
                f"拉取版本清單失敗：{exc}",
            )
        if not manifest:
            return fail(
                HydrateNode.FETCH_MANIFEST,
                "MANIFEST_EMPTY",
                "Hub 版本清單為空（尚未發布任何 Pack）",
            )
        ok_node(
            HydrateNode.FETCH_MANIFEST,
            "MANIFEST_OK",
            f"清單 {len(manifest)} 筆",
            {"count": len(manifest), "versions": [m.get("version") for m in manifest[:10]]},
        )

        # --- 4 select_candidate ---
        installed = {row["version"] for row in self.store.list_installed()}
        # 取清單第一筆「尚未安裝」者；若都已安裝則 up to date
        candidate_meta = None
        for item in manifest:
            ver = item.get("version")
            if ver and ver not in installed:
                candidate_meta = item
                candidate = str(ver)
                break
        if candidate_meta is None:
            # 全部都有 → 視為最新
            top = manifest[0].get("version")
            ok_node(
                HydrateNode.SELECT_CANDIDATE,
                "NO_UPDATE",
                "本機已具備清單中全部版本（或已最新）",
                {"latestOnHub": top, "installed": sorted(installed)},
            )
            ok_node(HydrateNode.COMPLETE, "UP_TO_DATE", "無需下載")
            finished = utc_now_iso()
            result = HydrateRunResult(
                run_id=run_id,
                status="skipped_up_to_date",
                started_at=started,
                finished_at=finished,
                nodes=nodes,
                installed_version=fallback,
                fallback_version=fallback,
                candidate_version=str(top) if top else None,
            )
            self.store.finish_run(run_id, result.to_dict())
            return result

        ok_node(
            HydrateNode.SELECT_CANDIDATE,
            "CANDIDATE_SELECTED",
            f"候選版 {candidate}",
            {"version": candidate},
        )

        # --- 5 download_pack ---
        try:
            if source_kind == "local":
                pack = load_local_pack(str(candidate))
                if pack is None:
                    return fail(
                        HydrateNode.DOWNLOAD_PACK,
                        "PACK_FILE_MISSING",
                        f"找不到 Pack 檔：{candidate}.json",
                        {"version": candidate},
                    )
            else:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    r = await client.get(f"{source_ref}/packages/{candidate}")
                    if r.status_code >= 400:
                        return fail(
                            HydrateNode.DOWNLOAD_PACK,
                            "PACK_HTTP_BAD_STATUS",
                            f"下載 Pack HTTP {r.status_code}",
                            {"status": r.status_code, "version": candidate},
                        )
                    pack = r.json()
        except Exception as exc:
            return fail(
                HydrateNode.DOWNLOAD_PACK,
                "PACK_DOWNLOAD_FAILED",
                f"下載失敗：{exc}",
                {"version": candidate},
            )
        ok_node(HydrateNode.DOWNLOAD_PACK, "DOWNLOAD_OK", f"已取得 {candidate}")

        assert pack is not None

        # --- 6 verify_checksum ---
        c_ok, c_code, c_detail = verify_pack_checksum(pack)
        if not c_ok:
            return fail(
                HydrateNode.VERIFY_CHECKSUM,
                c_code,
                "Checksum 不符或缺失（可能檔案損壞或遭竄改）",
                c_detail,
            )
        ok_node(HydrateNode.VERIFY_CHECKSUM, "CHECKSUM_OK", "Checksum 通過", c_detail)

        # --- 7 validate_schema ---
        s_ok, s_code, s_detail = validate_pack_schema(pack)
        if not s_ok:
            return fail(
                HydrateNode.VALIDATE_SCHEMA,
                s_code,
                "Pack schema 不合法",
                s_detail,
            )
        if pack.get("version") != candidate:
            return fail(
                HydrateNode.VALIDATE_SCHEMA,
                "VERSION_MISMATCH",
                f"檔內 version={pack.get('version')} 與候選 {candidate} 不一致",
            )
        ok_node(HydrateNode.VALIDATE_SCHEMA, "SCHEMA_OK", "Schema 通過")

        # --- 8 install_local ---
        try:
            self.store.install_package(pack)
        except Exception as exc:
            return fail(
                HydrateNode.INSTALL_LOCAL,
                "INSTALL_FAILED",
                f"寫入本機失敗：{exc}",
                {"version": candidate},
            )
        ok_node(HydrateNode.INSTALL_LOCAL, "INSTALL_OK", f"已寫入 {candidate}")

        # --- 9 activate ---
        ok_node(
            HydrateNode.ACTIVATE,
            "ACTIVE",
            "已啟用（active=1），可由 target_date 選用",
            {
                "version": candidate,
                "effectiveFrom": pack.get("effectiveFrom"),
                "effectiveTo": pack.get("effectiveTo"),
            },
        )

        # --- 10 complete ---
        ok_node(HydrateNode.COMPLETE, "SUCCESS", "Hydrate 完成")
        finished = utc_now_iso()
        result = HydrateRunResult(
            run_id=run_id,
            status="success",
            started_at=started,
            finished_at=finished,
            nodes=nodes,
            candidate_version=candidate,
            installed_version=candidate,
            fallback_version=fallback,
        )
        self.store.finish_run(run_id, result.to_dict())
        logger.info(result.diagnosis_line())
        return result
