"""Patient visit history aggregation for chart rail and EMR lookup."""

from __future__ import annotations

from typing import Any

from src.core.nhi_soap_fhir_mapper import extract_soap_stickers_from_composition
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore

MISSING = "\u2014"
# 掛號表單塞進 reasonCode 的占位，不是醫師寫的主訴。
_PLACEHOLDER_CC = {"\u9580\u8a3a\u639b\u865f", "\u9580\u8a3a\u767b\u8a18", "\u9810\u639b", "\u9810\u639b \u9580\u8a3a\u639b\u865f"}


def chief_complaint_text(value: str | None) -> str:
    text = str(value or "").strip()
    if text in _PLACEHOLDER_CC:
        return ""
    return text


def _reason_text(encounter: dict[str, Any]) -> str:
    for rc in encounter.get("reasonCode") or []:
        if isinstance(rc, dict) and rc.get("text"):
            return chief_complaint_text(str(rc["text"]))
    return ""


def _cc_pe_text(store: SqliteShadowStore, encounter: dict[str, Any], *, deep: bool = False) -> str:
    """主訴文字。deep=False 時只吃 Encounter.reasonCode（清單快路徑）。"""
    cc = _reason_text(encounter)
    if not deep:
        return cc
    pe = ""
    eid = str(encounter.get("id") or "")
    if eid:
        comp_id = store.find_soap_composition_id_by_encounter(eid)
        if comp_id:
            comp = store.get_cached_resource("Composition", comp_id)
            if comp:
                stickers = extract_soap_stickers_from_composition(comp)
                cc = chief_complaint_text(str(stickers.get("chiefComplaint") or cc or ""))
                pe = str(stickers.get("objective") or "")
    parts: list[str] = []
    if cc:
        parts.append(f"CC: {cc}" if pe else cc)
    if pe:
        parts.append(f"PE: {pe}")
    return "\n".join(parts)


def _slot_dept(encounter: dict[str, Any], queue_meta: dict[str, Any]) -> str:
    slot = str(queue_meta.get("slotTime") or "")
    if not slot:
        period = encounter.get("period") or {}
        start = str(period.get("start") or "")
        if "T" in start and len(start) >= 16:
            slot = start[11:16]
    dept = str(
        ((encounter.get("serviceType") or {}).get("text"))
        or ((encounter.get("class") or {}).get("display"))
        or "\u9580\u8a3a"
    )
    room = str(queue_meta.get("queueNumber") or "")
    bits = [b for b in (slot, dept, room) if b]
    return "/".join(bits) if bits else MISSING


def _doctor_display(encounter: dict[str, Any]) -> str:
    for p in encounter.get("participant") or []:
        if not isinstance(p, dict):
            continue
        indiv = p.get("individual") or {}
        display = indiv.get("display")
        if display:
            return str(display)
    return MISSING


def _group_by_encounter(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        meta = row.get("indexMeta") or {}
        eid = str(meta.get("encounterId") or "").split("/")[-1]
        if not eid:
            continue
        out.setdefault(eid, []).append(row)
    return out


def build_patient_visit_records(
    store: SqliteShadowStore,
    patient_id: str,
    *,
    exclude_encounter_id: str | None = None,
    limit: int = 50,
    deep_soap: bool = False,
    light: bool = False,
) -> list[dict[str, Any]]:
    """組歷次就診。

    light=True：清單瞬開（索引＋主訴摘要，不含完整處方 JSON）。
    light=False：含診斷／處方資源（選列細看或 Ditto 用）。
    """
    pid = patient_id.split("/")[-1]
    exclude = (exclude_encounter_id or "").split("/")[-1] or None

    if light:
        rows = store.list_visit_summaries_for_patient(
            pid, exclude_encounter_id=exclude, limit=limit
        )
        for row in rows:
            row["chiefComplaint"] = chief_complaint_text(row.get("chiefComplaint"))
        return rows

    entries = store.list_encounters_for_patient(pid, limit=limit)
    # 先裁切要的 encounter，再批次撈診斷／藥（O(1) 次查詢）
    selected: list[tuple[dict[str, Any], dict[str, Any], str]] = []
    for entry in entries:
        resource = entry.get("resource") or {}
        eid = str(resource.get("id") or "")
        if not eid:
            continue
        if exclude and eid == exclude:
            continue
        qmeta = entry.get("queueMeta") or {}
        selected.append((resource, qmeta, eid))
        if len(selected) >= limit:
            break

    if not selected:
        return []

    # 只撈這批歷史 encounter 的診斷／處方（勿整病人全歷史 JSON parse）
    eids = [eid for _, _, eid in selected]
    all_conds = _group_by_encounter(store.list_conditions(encounter_ids=eids))
    all_meds = _group_by_encounter(store.list_medication_requests(encounter_ids=eids))

    visits: list[dict[str, Any]] = []
    for resource, qmeta, eid in selected:
        diagnoses = all_conds.get(eid, [])
        medications = all_meds.get(eid, [])
        days_vals: list[int] = []
        for m in medications:
            raw = (m.get("indexMeta") or {}).get("daysSupply")
            try:
                days_vals.append(int(raw or 0))
            except (TypeError, ValueError):
                days_vals.append(0)
        rx_days = max(days_vals) if days_vals else 0
        first_dx = ""
        if diagnoses:
            meta = diagnoses[0].get("indexMeta") or {}
            first_dx = str(meta.get("summaryText") or "")
        visit_date = str(qmeta.get("encounterDate") or "")[:10]
        if not visit_date:
            period = resource.get("period") or {}
            visit_date = str(period.get("start") or "")[:10]
        visits.append(
            {
                "encounterId": eid,
                "visitDate": visit_date,
                "slotDept": _slot_dept(resource, qmeta),
                "caseNo": MISSING,
                "rxDays": str(rx_days) if rx_days else MISSING,
                "cardNo": MISSING,
                "aCode": MISSING,
                "diseaseName": first_dx or MISSING,
                "doctor": _doctor_display(resource),
                "dispense": MISSING,
                "chiefComplaint": _cc_pe_text(store, resource, deep=deep_soap),
                "diagnoses": diagnoses,
                "medications": medications,
            }
        )
    return visits


def enrich_visit_detail(
    store: SqliteShadowStore, visit: dict[str, Any]
) -> dict[str, Any]:
    """為 light 清單的一筆補齊診斷／處方。"""
    eid = str(visit.get("encounterId") or "")
    if not eid:
        return visit
    out = dict(visit)
    out["diagnoses"] = store.list_conditions(encounter_id=eid)
    out["medications"] = store.list_medication_requests(encounter_id=eid)
    return out
