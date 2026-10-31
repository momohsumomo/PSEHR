"""Encounter（今日掛號／診間狀態）API。"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from src.api.schemas.encounter import EncounterBody, QueueStatusTransition
from src.app.bootstrap import get_fhir_repository, get_shadow_store
from src.core.chart_presence import held_encounter_ids
from src.core.encounter_extensions import QUEUE_EXTENSION_URL
from src.core.encounter_queue import fhir_status_from_queue
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore

router = APIRouter(prefix="/fhir", tags=["Encounter"])


def _today_str() -> str:
    return date.today().isoformat()


def _resolve_date(value: str | None) -> str:
    if not value or value.lower() == "today":
        return _today_str()
    return value[:10]


def _mark_open_charts(entries: list[dict[str, Any]]) -> None:
    ids = [str((e.get("resource") or {}).get("id") or "") for e in entries]
    held = held_encounter_ids(ids)
    for entry, eid in zip(entries, ids):
        meta = entry.get("queueMeta")
        if isinstance(meta, dict):
            meta["chartOpen"] = eid in held


def _patient_ref(patient_id: str) -> str:
    return patient_id if patient_id.startswith("Patient/") else f"Patient/{patient_id}"


def _iter_dates(date_from: str, date_to: str) -> list[str]:
    start = date.fromisoformat(date_from[:10])
    end = date.fromisoformat(date_to[:10])
    if end < start:
        raise HTTPException(status_code=400, detail="截止日期不可早於起始日期")
    if (end - start).days > 62:
        end = start + timedelta(days=62)
    out: list[str] = []
    cur = start
    while cur <= end:
        out.append(cur.isoformat())
        cur += timedelta(days=1)
    return out


def _attach_queue_meta(payload: dict[str, Any], queue_number: int, queue_status: str) -> dict[str, Any]:
    others = [e for e in payload.get("extension") or [] if e.get("url") != QUEUE_EXTENSION_URL]
    others.append(
        {
            "url": QUEUE_EXTENSION_URL,
            "extension": [
                {"url": "queueNumber", "valueInteger": queue_number},
                {"url": "queueStatus", "valueCode": queue_status},
            ],
        }
    )
    payload["extension"] = others
    return payload


def _store() -> SqliteShadowStore:
    store = get_shadow_store()
    assert isinstance(store, SqliteShadowStore)
    return store


@router.get("/Encounter/date-span")
def encounter_date_span() -> dict[str, Any]:
    """掛號日範圍與建議預設看診日（進診療作業用）。"""
    return _store().encounter_date_span()


@router.get("/Encounter/emr-lookup")
def emr_lookup_encounters(
    date_from: str = Query(..., alias="dateFrom", description="起始日 YYYY-MM-DD（必填）"),
    date_to: str = Query(..., alias="dateTo", description="截止日 YYYY-MM-DD（必填）"),
    patient: str | None = Query(None, description="可選：篩選病人 ID"),
    has_image: bool = Query(False, alias="hasImage", description="只留日期範圍內有建立圖像的病歷"),
    same_day: bool = Query(True, alias="sameDay", description="含當日尚未完診的掛號"),
    cc: str = Query("", description="主述內含字"),
    dx: str = Query("", description="診斷病名或代碼"),
    drug: str = Query("", description="藥品名稱或健保碼"),
) -> dict[str, Any]:
    """調閱／費用統計專用：依看診日起迄撈清單。禁止 today fallback。"""
    d0 = date_from[:10]
    d1 = date_to[:10]
    try:
        date.fromisoformat(d0)
        date.fromisoformat(d1)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="日期格式須為 YYYY-MM-DD") from exc
    if d1 < d0:
        raise HTTPException(status_code=400, detail="截止日期不可早於起始日期")

    store = _store()
    query_from = d0
    pid = _patient_ref(patient).split("/")[-1] if patient else None
    entries = store.list_encounters_for_date(query_from, date_to=d1, patient_id=pid)
    matched = store.emr_text_match_ids(query_from, d1, cc=cc, dx=dx, drug=drug)
    if matched is not None:
        entries = [entry for entry in entries if (entry.get("resource") or {}).get("id") in matched]
    if not same_day:
        today = date.today().isoformat()
        kept_day: list[dict[str, Any]] = []
        for entry in entries:
            meta = entry.get("queueMeta") or {}
            day = str(meta.get("encounterDate") or "")[:10]
            status = str(meta.get("queueStatus") or "")
            if day == today and status != "finished":
                continue
            kept_day.append(entry)
        entries = kept_day
    image_folder_ready = True
    if has_image:
        from src.core.look_images import charts_with_images, look_root

        image_folder_ready = look_root().is_dir()
        charts = charts_with_images(query_from, d1) if image_folder_ready else set()
        charts |= store.charts_with_media(query_from, d1)
        image_folder_ready = image_folder_ready or bool(charts)
        kept: list[dict[str, Any]] = []
        for entry in entries:
            meta = entry.get("queueMeta") or {}
            digits = "".join(ch for ch in str(meta.get("medicalNo") or "") if ch.isdigit())
            chart = digits[:6].zfill(6) if digits else ""
            if len(chart) == 6 and chart in charts:
                kept.append(entry)
        entries = kept
    cash_returns = [] if pid else store.list_cash_returns(query_from, d1)
    return {
        "resourceType": "Bundle",
        "type": "searchset",
        "dateFrom": query_from,
        "dateTo": d1,
        "requestedFrom": d0,
        "clipped": False,
        "hasImage": has_image,
        "imageFolderReady": image_folder_ready,
        "total": len(entries),
        "entry": entries,
        "cashReturns": cash_returns,
    }


@router.get("/Encounter/cash-book")
def cash_book_summary(
    date_from: str = Query(..., alias="dateFrom"),
    date_to: str = Query(..., alias="dateTo"),
    shift: str | None = Query(None, description="上午、下午、晚上；空值為全部"),
    finished: bool = Query(False, description="只算完診"),
) -> dict[str, Any]:
    """現金帳總計。直接加總，不回傳每一筆病歷。"""
    d0 = date_from[:10]
    d1 = date_to[:10]
    try:
        date.fromisoformat(d0)
        date.fromisoformat(d1)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="日期格式須為 YYYY-MM-DD") from exc
    if d1 < d0:
        raise HTTPException(status_code=400, detail="截止日期不可早於起始日期")
    chosen = (shift or "").strip()
    if chosen in {"", "全部"}:
        chosen = ""
    return _store().cash_book_summary(d0, d1, shift=chosen or None, finished_only=finished)


@router.get("/Encounter")
def list_encounters(
    date: str | None = Query(None, alias="date", description="YYYY-MM-DD 或 today"),
    date_from: str | None = Query(None, alias="dateFrom", description="起始日 YYYY-MM-DD（調閱病歷）"),
    date_to: str | None = Query(None, alias="dateTo", description="截止日 YYYY-MM-DD（調閱病歷）"),
    patient: str | None = Query(None, description="篩選病人 ID"),
) -> dict[str, Any]:
    """今日診間掛號清單，或特定病人的歷史掛號清單，或日期區間調閱。"""
    store = _store()
    # 如果指定了 patient 且沒有提供 date／區間，則返回該病人的所有歷史掛號
    if patient and not date and not date_from and not date_to:
        entries = store.list_encounters_for_patient(patient)
        return {
            "resourceType": "Bundle",
            "type": "searchset",
            "total": len(entries),
            "entry": entries,
        }

    # 調閱病歷：日期區間（醫聖預設依看診日撈清單，不必先指定病患）
    if date_from or date_to:
        d0 = _resolve_date(date_from or date_to)
        d1 = _resolve_date(date_to or date_from)
        entries: list[dict[str, Any]] = []
        for day in _iter_dates(d0, d1):
            entries.extend(store.list_encounters_for_date(day))
        if patient:
            patient_ref = _patient_ref(patient)
            entries = [
                e
                for e in entries
                if e["queueMeta"]["patientId"] == patient_ref.split("/")[-1]
                or e["resource"].get("subject", {}).get("reference") == patient_ref
            ]
        return {
            "resourceType": "Bundle",
            "type": "searchset",
            "dateFrom": d0,
            "dateTo": d1,
            "total": len(entries),
            "entry": entries,
        }

    requested = _resolve_date(date)
    encounter_date = requested
    entries = store.list_encounters_for_date(encounter_date)
    auto_fallback = False

    # 僅「today／省略日期」且當日空：回退到建議診日（有人數的最近一日）
    if (not date or date.lower() == "today") and not entries:
        span = store.encounter_date_span()
        suggested = span.get("suggestedDate")
        if suggested:
            encounter_date = str(suggested)
            entries = store.list_encounters_for_date(encounter_date)
            auto_fallback = encounter_date != requested

    if patient:
        patient_ref = _patient_ref(patient)
        entries = [
            e
            for e in entries
            if e["queueMeta"]["patientId"] == patient_ref.split("/")[-1]
            or e["resource"].get("subject", {}).get("reference") == patient_ref
        ]

    _mark_open_charts(entries)
    nearest = store.nearest_encounter_dates(requested)
    span = store.encounter_date_span()
    return {
        "resourceType": "Bundle",
        "type": "searchset",
        "date": encounter_date,
        "requestedDate": requested,
        "autoFallback": auto_fallback,
        "total": len(entries),
        "entry": entries,
        "dateMin": span.get("dateMin"),
        "dateMax": span.get("dateMax"),
        "suggestedDate": span.get("suggestedDate"),
        "suggestedCount": span.get("suggestedCount"),
        "nearestBefore": nearest.get("nearestBefore"),
        "nearestAfter": nearest.get("nearestAfter"),
    }


@router.get("/Encounter/{encounter_id}")
def get_encounter(encounter_id: str) -> dict[str, Any]:
    repo = get_fhir_repository()
    resource = repo.read_resource("Encounter", encounter_id)
    if resource is None:
        raise HTTPException(status_code=404, detail=f"Encounter/{encounter_id} not found")
    
    row = _store().get_encounter_queue_meta(encounter_id)
    if row:
        return {"resource": resource, "queueMeta": row["queueMeta"]}
    return resource


@router.post("/Encounter", status_code=201)
def create_encounter(body: EncounterBody) -> dict[str, Any]:
    repo = get_fhir_repository()
    store = _store()
    patient_id = body.subject.reference.split("/")[-1]
    if repo.read_resource("Patient", patient_id) is None:
        raise HTTPException(status_code=400, detail=f"Patient/{patient_id} 不存在")

    encounter_date = (body.encounterDate or date.today()).isoformat()
    queue_status = body.queueStatus or "waiting"
    queue_number = body.queueNumber or store.next_queue_number(encounter_date)
    fhir_status = body.status or fhir_status_from_queue(queue_status)

    payload = body.to_fhir_dict()
    payload["status"] = fhir_status
    if not payload.get("period"):
        payload["period"] = {"start": datetime.now().isoformat(timespec="seconds")}
    _attach_queue_meta(payload, queue_number, queue_status)

    created = repo.create_resource("Encounter", payload)
    entry = next(
        (e for e in store.list_encounters_for_date(encounter_date) if e["resource"]["id"] == created["id"]),
        None,
    )
    return entry or {"resource": created}


@router.put("/Encounter/{encounter_id}")
def update_encounter(encounter_id: str, body: EncounterBody) -> dict[str, Any]:
    repo = get_fhir_repository()
    store = _store()
    existing = repo.read_resource("Encounter", encounter_id)
    if existing is None:
        raise HTTPException(status_code=404, detail=f"Encounter/{encounter_id} not found")

    payload = body.to_fhir_dict()
    payload["id"] = encounter_id
    if body.queueNumber is not None and body.queueStatus is not None:
        _attach_queue_meta(payload, body.queueNumber, body.queueStatus)
    elif body.queueStatus is not None:
        qn = body.queueNumber or 0
        for ext in existing.get("extension") or []:
            if ext.get("url") == QUEUE_EXTENSION_URL:
                for sub in ext.get("extension") or []:
                    if sub.get("url") == "queueNumber":
                        qn = int(sub.get("valueInteger", 0))
        _attach_queue_meta(payload, qn, body.queueStatus)
        payload["status"] = fhir_status_from_queue(body.queueStatus)

    updated = repo.update_resource("Encounter", encounter_id, payload)
    row = next(
        (e for e in store.list_encounters_for_date(_today_str()) if e["resource"]["id"] == encounter_id),
        None,
    )
    return row or {"resource": updated}


@router.patch("/Encounter/{encounter_id}/queue-status")
def transition_queue_status(encounter_id: str, body: QueueStatusTransition) -> dict[str, Any]:
    """
    診間狀態一鍵變更（Swagger 操作）：
    waiting=候診中 | in_progress=看診中 | no_show=已過號 | finished=已看診
    """
    repo = get_fhir_repository()
    store = _store()
    existing = repo.read_resource("Encounter", encounter_id)
    if existing is None:
        raise HTTPException(status_code=404, detail=f"Encounter/{encounter_id} not found")

    queue_status = body.queue_status
    fhir_status = fhir_status_from_queue(queue_status)

    rows = store.list_encounters_for_date(_today_str())
    encounter_date = _today_str()
    for row in rows:
        if row["resource"].get("id") == encounter_id:
            encounter_date = row["queueMeta"]["encounterDate"]
            break

    if queue_status == "in_progress":
        for row in rows:
            rid = row["resource"].get("id")
            if rid != encounter_id and row["queueMeta"]["queueStatus"] == "in_progress":
                other = repo.read_resource("Encounter", rid)
                if other:
                    _apply_queue_transition(store, repo, rid, other, "waiting", encounter_date)

    queue_number = 0
    for ext in existing.get("extension") or []:
        if ext.get("url") == QUEUE_EXTENSION_URL:
            for sub in ext.get("extension") or []:
                if sub.get("url") == "queueNumber":
                    queue_number = int(sub.get("valueInteger", 0))

    updated_resource = _apply_queue_transition(
        store, repo, encounter_id, existing, queue_status, encounter_date, queue_number
    )
    entry = next(
        (e for e in store.list_encounters_for_date(encounter_date) if e["resource"]["id"] == encounter_id),
        None,
    )
    return entry or {"resource": updated_resource, "queueMeta": {"queueStatus": queue_status}}


def _apply_queue_transition(
    store: SqliteShadowStore,
    repo: Any,
    encounter_id: str,
    existing: dict[str, Any],
    queue_status: str,
    encounter_date: str,
    queue_number: int = 0,
) -> dict[str, Any]:
    from src.core.encounter_extensions import attach_reg_extension, extract_reg_meta

    fhir_status = fhir_status_from_queue(queue_status)
    payload = dict(existing)
    payload["status"] = fhir_status
    if queue_number:
        _attach_queue_meta(payload, queue_number, queue_status)
    else:
        for ext in payload.get("extension") or []:
            if ext.get("url") == QUEUE_EXTENSION_URL:
                for sub in ext.get("extension") or []:
                    if sub.get("url") == "queueStatus":
                        sub["valueCode"] = queue_status
    # After check-in / start visit, clear Yu (prebook) — it is live state, not history
    if queue_status != "waiting":
        reg = extract_reg_meta(payload)
        if reg.get("prebook") or reg.get("forespeak"):
            payload = attach_reg_extension(
                payload,
                {**reg, "prebook": False, "forespeak": ""},
            )
    store.update_encounter_queue_status(encounter_id, queue_status, fhir_status)
    return repo.update_resource("Encounter", encounter_id, payload)
