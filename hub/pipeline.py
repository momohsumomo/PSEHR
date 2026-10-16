"""Hub 主管線：拉檔 → diff → 閘門 → LLM → 發布／事件。"""

from __future__ import annotations

import logging
from typing import Any

from hub import config
from hub.diff import diff_snapshots
from hub.fetch_nhi import fetch_nhi_drug_records
from hub.fetch_tfda import fetch_tfda_control_sources
from hub.gates import evaluate_gates
from hub.llm_verify import verify_diff_with_llm
from hub.nodes import HubNode
from hub.normalize import normalize_records
from hub.control_join import apply_control_classes
from hub.publish import build_pack, publish_pack
from hub.workspace import (
    emit_event,
    ensure_dirs,
    load_previous_snapshot,
    save_snapshot,
    write_run,
)

logger = logging.getLogger("hub.pipeline")


class HubRun:
    def __init__(self) -> None:
        self.nodes: list[dict[str, Any]] = []
        self.failed_node: str | None = None
        self.error_code: str | None = None
        self.error_message: str | None = None
        self.status = "running"
        self.published_version: str | None = None
        self.event_path: str | None = None

    def ok(self, node: HubNode, code: str, message: str, detail: dict | None = None) -> None:
        self.nodes.append(
            {"node": node.value, "ok": True, "code": code, "message": message, "detail": detail or {}}
        )

    def fail(self, node: HubNode, code: str, message: str, detail: dict | None = None) -> dict[str, Any]:
        self.nodes.append(
            {"node": node.value, "ok": False, "code": code, "message": message, "detail": detail or {}}
        )
        self.failed_node = node.value
        self.error_code = code
        self.error_message = message
        self.status = "failed"
        return self.finish(published=False, event_kind="hub_failure")

    def diagnosis(self) -> str:
        if self.status == "success":
            return f"成功：已發布 {self.published_version}"
        if self.status == "skipped_no_change":
            return "無需更新：與上一 snapshot 無實質差異（未發布新版）"
        if self.status == "blocked_event":
            return (
                f"已擋下自動發布（事件）於 [{self.failed_node}] "
                f"{self.error_code}: {self.error_message}；見 {self.event_path}"
            )
        return (
            f"失敗於 [{self.failed_node}] {self.error_code}: {self.error_message}"
            + (f"；事件 {self.event_path}" if self.event_path else "")
        )

    def finish(self, *, published: bool, event_kind: str | None = None) -> dict[str, Any]:
        result = {
            "status": self.status,
            "failedNode": self.failed_node,
            "errorCode": self.error_code,
            "errorMessage": self.error_message,
            "publishedVersion": self.published_version,
            "eventPath": self.event_path,
            "nodes": self.nodes,
            "diagnosis": self.diagnosis(),
            "publishDir": str(config.PUBLISH_DIR),
            "workspace": str(config.WORKSPACE),
        }
        path = write_run(result)
        result["runPath"] = str(path)
        if event_kind and self.status in ("failed", "blocked_event"):
            # already emitted in callers sometimes
            pass
        logger.info(result["diagnosis"])
        return result


def run_hub_pipeline(*, fetch_limit: int | None = None) -> dict[str, Any]:
    ensure_dirs()
    run = HubRun()

    # 1 resolve_source
    run.ok(
        HubNode.RESOLVE_SOURCE,
        "SOURCE_OK",
        "健保用藥開放資料 + 食藥署管制分級",
        {
            "resourceId": config.NHI_RESOURCE_ID,
            "url": config.NHI_DATASTORE_URL,
            "tfdaLicenseUrl": config.TFDA_LICENSE_URL,
            "tfdaSalesUrl": config.TFDA_SALES_URL,
        },
    )

    # 2 fetch
    try:
        limit = config.FETCH_LIMIT if fetch_limit is None else fetch_limit

        def _prog(n: int, off: int) -> None:
            if n % 5000 == 0 or n < 2000:
                logger.info("fetch progress rows=%s offset=%s", n, off)

        raw = fetch_nhi_drug_records(limit=limit or None, progress=_prog)
    except Exception as exc:
        ev = emit_event("fetch_failed", "Hub 拉檔失敗", {"error": str(exc)})
        run.event_path = str(ev)
        return run.fail(HubNode.FETCH_REMOTE, "FETCH_FAILED", str(exc))

    if not raw:
        ev = emit_event("fetch_empty", "Hub 拉檔結果為空", {})
        run.event_path = str(ev)
        return run.fail(HubNode.FETCH_REMOTE, "FETCH_EMPTY", "遠端回傳 0 筆")

    tfda: dict[str, Any] = {}
    tfda_error: str | None = None
    try:
        tfda = fetch_tfda_control_sources()
    except Exception as exc:
        tfda_error = str(exc)
        ev = emit_event(
            "tfda_control_fetch_failed",
            "食藥署管制分級拉檔失敗；藥價仍可發布，分級本輪不更新",
            {"error": tfda_error},
        )
        run.event_path = str(ev)
        logger.warning("TFDA control fetch failed: %s", exc)

    run.ok(
        HubNode.FETCH_REMOTE,
        "FETCH_OK",
        f"取得 {len(raw)} 筆用藥列"
        + (
            f"；食藥署藥證 {tfda.get('licenseCount')}／銷售 {tfda.get('salesCount')}"
            if not tfda_error
            else f"；食藥署分級拉檔失敗（{tfda_error}）"
        ),
        {
            "rawCount": len(raw),
            "fetchLimit": limit,
            "tfdaLicenseCount": tfda.get("licenseCount"),
            "tfdaSalesCount": tfda.get("salesCount"),
            "tfdaError": tfda_error,
        },
    )

    # 3 normalize
    try:
        current = normalize_records(raw)
        control_stats: dict[str, Any] = {}
        if tfda.get("licenses") or tfda.get("sales"):
            control_stats = apply_control_classes(
                current,
                licenses=tfda.get("licenses") or [],
                sales=tfda.get("sales") or [],
            )
    except Exception as exc:
        return run.fail(HubNode.NORMALIZE, "NORMALIZE_FAILED", str(exc))
    if not current:
        return run.fail(HubNode.NORMALIZE, "NORMALIZE_EMPTY", "正規化後 0 筆")
    run.ok(
        HubNode.NORMALIZE,
        "NORMALIZE_OK",
        f"正規化 {len(current)} 鍵；管制分級對到 {control_stats.get('indexCount', 0)} 碼",
        {"keyCount": len(current), "control": {k: v for k, v in control_stats.items() if k != "controlledByNhiCode"}},
    )

    # 4 previous
    previous = load_previous_snapshot()
    has_previous = bool(previous)
    run.ok(
        HubNode.LOAD_PREVIOUS,
        "PREV_OK" if has_previous else "PREV_NONE",
        f"上版鍵數={len(previous)}" if has_previous else "無上版（首次）",
        {"previousCount": len(previous)},
    )

    # 5 diff
    diff = diff_snapshots(previous, current)
    summary = diff["summary"]
    run.ok(HubNode.DIFF, "DIFF_OK", "差異計算完成", summary)

    # 6 gates
    gate = evaluate_gates(summary, has_previous=has_previous)
    run.ok(HubNode.AUTO_GATES, "GATES_OK", f"decision={gate['decision']}", gate)

    if gate["decision"] == "auto" and not summary.get("material"):
        # 無實質差異：更新 snapshot 時間戳可選；不發布新 Pack
        save_snapshot(current, {"note": "no_material_refresh", "diff": summary})
        run.status = "skipped_no_change"
        run.ok(HubNode.COMPLETE, "NO_CHANGE", "無實質差異，不發布")
        return run.finish(published=False)

    if gate["decision"] == "block_event":
        run.status = "blocked_event"
        run.failed_node = HubNode.AUTO_GATES.value
        run.error_code = "GATE_BLOCK"
        run.error_message = ",".join(gate["reasons"])
        ev = emit_event(
            "gate_block",
            "藥價更新被自動閘門擋下，需人工處理",
            {"gate": gate, "summary": summary, "samples": diff.get("samples")},
        )
        run.event_path = str(ev)
        run.ok(HubNode.COMPLETE, "BLOCKED", "已寫事件，未發布")
        return run.finish(published=False)

    # needs_llm or first snapshot
    if gate["decision"] == "needs_llm":
        if not config.LLM_API_KEY:
            if config.LLM_REQUIRED_ON_MATERIAL:
                run.status = "blocked_event"
                run.failed_node = HubNode.LLM_VERIFY.value
                run.error_code = "LLM_REQUIRED"
                run.error_message = "有實質出入但未設定 LLM API Key，依契約不自動發布"
                ev = emit_event(
                    "llm_required",
                    "需要 LLM／人工確認後才能發布藥價 Pack",
                    {"gate": gate, "summary": summary, "samples": diff.get("samples")},
                )
                run.event_path = str(ev)
                run.nodes.append(
                    {
                        "node": HubNode.LLM_VERIFY.value,
                        "ok": False,
                        "code": "LLM_REQUIRED",
                        "message": run.error_message,
                        "detail": {},
                    }
                )
                return run.finish(published=False)
            # 開機／測試：HUB_LLM_REQUIRED_ON_MATERIAL=0 允許無 LLM 發布
            run.ok(
                HubNode.LLM_VERIFY,
                "LLM_BYPASS",
                "未設 API Key 且 HUB_LLM_REQUIRED_ON_MATERIAL=0，略過 LLM",
                {"bootstrap": True},
            )
        else:
            llm_result = verify_diff_with_llm(diff, gate)
            if not llm_result.get("ok"):
                run.status = "blocked_event"
                run.failed_node = HubNode.LLM_VERIFY.value
                run.error_code = f"LLM_{llm_result.get('verdict', 'REJECT')}".upper()
                run.error_message = str(llm_result.get("reason") or "LLM 未批准")
                ev = emit_event(
                    "llm_reject_or_uncertain",
                    "LLM 未批准自動發布（或無法核對）",
                    {"llm": llm_result, "gate": gate, "summary": summary},
                )
                run.event_path = str(ev)
                run.nodes.append(
                    {
                        "node": HubNode.LLM_VERIFY.value,
                        "ok": False,
                        "code": run.error_code,
                        "message": run.error_message,
                        "detail": llm_result,
                    }
                )
                return run.finish(published=False)
            run.ok(
                HubNode.LLM_VERIFY,
                "LLM_APPROVE",
                llm_result.get("reason") or "approve",
                {"verdict": llm_result.get("verdict")},
            )
    else:
        run.ok(HubNode.LLM_VERIFY, "LLM_SKIP", "閘門判定 auto，略過 LLM")

    # build + publish
    try:
        pack = build_pack(
            rows=current,
            diff_summary=summary,
            publish_mode="auto",
            intervention_event=None,
            controlled_by_nhi_code=control_stats.get("controlledByNhiCode") or {},
            extra_source={
                "tfdaLicenseUrl": config.TFDA_LICENSE_URL,
                "tfdaSalesUrl": config.TFDA_SALES_URL,
                "tfdaLicenseCount": tfda.get("licenseCount"),
                "tfdaSalesCount": tfda.get("salesCount"),
                "controlMatch": {
                    k: v
                    for k, v in control_stats.items()
                    if k != "controlledByNhiCode"
                },
            },
        )
        run.ok(HubNode.BUILD_PACK, "BUILD_OK", f"version={pack['version']}", {"version": pack["version"]})
        path = publish_pack(pack)
        run.published_version = pack["version"]
        run.ok(HubNode.PUBLISH, "PUBLISH_OK", f"已寫入 {path}", {"path": path})
    except Exception as exc:
        ev = emit_event("publish_failed", "Pack 發布失敗", {"error": str(exc)})
        run.event_path = str(ev)
        return run.fail(HubNode.PUBLISH, "PUBLISH_FAILED", str(exc))

    save_snapshot(
        current,
        {
            "publishedVersion": pack["version"],
            "diff": summary,
            "checksumSha256": pack["checksumSha256"],
        },
    )
    run.status = "success"
    run.ok(HubNode.COMPLETE, "SUCCESS", "Hub 管線完成")
    return run.finish(published=True)
