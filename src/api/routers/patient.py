from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from src.api.schemas.patient import PatientBody
from src.app.bootstrap import get_fhir_repository, get_shadow_store
from src.core.patient_visit_history import build_patient_visit_records, chief_complaint_text
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore


router = APIRouter(prefix="/fhir", tags=["Patient"])


@router.get("/Patient")
def list_patients(
    name: str | None = Query(None, description="篩選病患姓名"),
    identifier: str | None = Query(None, description="篩選身分證字號或病歷號"),
    q: str | None = Query(None, description="綜合搜尋：姓名／身分證／手機／生日"),
    match: str | None = Query(None, description="typed＝只對上輸入格式所屬欄位"),
    phone: str | None = Query(None, description="篩選電話／手機"),
    birthday: str | None = Query(None, description="篩選民國生日，如 0820117 或 82.1.17"),
    limit: int = Query(100, alias="_count", description="限制筆數"),
    offset: int = Query(0, alias="_offset", description="偏移量"),
) -> dict[str, Any]:
    repo = get_fhir_repository()
    params = {}
    if name:
        params["name"] = name
    if identifier:
        params["identifier"] = identifier
    if q:
        params["q"] = q
    if match:
        params["match"] = match
    if phone:
        params["phone"] = phone
    if birthday:
        params["birthday"] = birthday
    params["_count"] = str(limit)
    params["_offset"] = str(offset)
    
    entries = repo.search("Patient", params)
    
    # 獲取本機快取中所有 Patient 的實際總數
    store = get_shadow_store()
    total_count = store.count_resources("Patient") if hasattr(store, "count_resources") else len(entries)
    
    return {
        "resourceType": "Bundle",
        "type": "searchset",
        "total": total_count,
        "entry": [{"resource": r} for r in entries],
    }


@router.get("/Patient/roster")
def patient_roster() -> dict[str, Any]:
    """右側名單：全部病患的病歷號／姓名／生日／電話，不讀整份病歷。"""
    items = get_shadow_store().list_patient_roster()
    return {"total": len(items), "items": items}


@router.get("/Patient/idCategorySettings")
def list_id_category_settings() -> list[dict[str, Any]]:
    store = get_shadow_store()
    return store.get_id_category_settings()


@router.post("/Patient/idCategorySettings")
def save_id_category_settings(settings: list[dict[str, Any]]) -> dict[str, str]:
    store = get_shadow_store()
    store.save_id_category_settings(settings)
    return {"status": "ok"}


@router.delete("/Patient/idCategorySettings/{code}")
def delete_id_category_setting(code: str) -> dict[str, str]:
    store = get_shadow_store()
    store.delete_id_category_setting(code)
    return {"status": "ok"}


@router.get("/Patient/next-medical-no")
def next_medical_no() -> dict[str, str]:
    """全庫流水病歷號（至少 6 碼）。"""
    store = get_shadow_store()
    if not hasattr(store, "next_medical_no"):
        raise HTTPException(status_code=501, detail="影子庫不支援取號")
    return {"medicalNo": store.next_medical_no()}


@router.get("/Patient/audit-status")
def patient_audit_status() -> dict[str, Any]:
    """修改稽核是否已正式上線啟用。"""
    store = get_shadow_store()
    if hasattr(store, "get_audit_status"):
        return store.get_audit_status()
    return {"recordingEnabled": False, "goLiveAt": None, "modificationCount": 0}


@router.get("/Patient/{patient_id}/modifications")
def list_patient_modifications(
    patient_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """病患主檔修改紀錄（責任機制／稽核）。"""
    store = get_shadow_store()
    if not hasattr(store, "list_audit_modifications"):
        raise HTTPException(status_code=501, detail="影子庫不支援稽核查詢")
    rows = store.list_audit_modifications(
        resource_type="Patient",
        resource_id=patient_id,
        limit=limit,
        offset=offset,
    )
    return {"resourceType": "AuditBundle", "total": len(rows), "entry": rows}


@router.get("/Patient/{patient_id}/family")
def list_patient_family(patient_id: str) -> dict[str, Any]:
    """家族清單：同電話／手機或同住址。"""
    store = get_shadow_store()
    if not isinstance(store, SqliteShadowStore):
        raise HTTPException(status_code=501, detail="僅 SQLite 影子庫支援")
    rows = store.list_family_members(patient_id)
    return {"resourceType": "Bundle", "total": len(rows), "entry": rows}


@router.get("/Patient/{patient_id}/visits")
def list_patient_visits(
    patient_id: str,
    limit: int = Query(200, ge=1, le=500),
    light: bool = Query(True, description="True=清單瞬開（無處方本體）；False=含完整診斷／處方"),
    exclude_encounter_id: str | None = Query(None),
) -> dict[str, Any]:
    """病患歷次就診 — 預設 light 清單（對齊醫聖瞬開歷史列）。"""
    store = get_shadow_store()
    if not isinstance(store, SqliteShadowStore):
        raise HTTPException(status_code=501, detail="僅 SQLite 影子庫支援")
    pid = patient_id.split("/")[-1]
    if store.get_cached_resource("Patient", pid) is None:
        if get_fhir_repository().read_resource("Patient", pid) is None:
            raise HTTPException(status_code=404, detail=f"Patient/{pid} not found")
    visits = build_patient_visit_records(
        store,
        pid,
        limit=limit,
        light=light,
        exclude_encounter_id=exclude_encounter_id,
    )
    return {"resourceType": "VisitBundle", "total": len(visits), "entry": visits, "light": light}


@router.get("/Patient/{patient_id}/visits/{encounter_id}")
def get_patient_visit_detail(patient_id: str, encounter_id: str) -> dict[str, Any]:
    """單次就診細項（選歷史列時再載診斷／處方）。"""
    from src.core.patient_visit_history import enrich_visit_detail

    store = get_shadow_store()
    if not isinstance(store, SqliteShadowStore):
        raise HTTPException(status_code=501, detail="僅 SQLite 影子庫支援")
    pid = patient_id.split("/")[-1]
    eid = encounter_id.split("/")[-1]
    summaries = store.list_visit_summaries_for_patient(pid, limit=500)
    hit = next((v for v in summaries if v.get("encounterId") == eid), None)
    if not hit:
        raise HTTPException(status_code=404, detail="visit not found")
    hit["chiefComplaint"] = chief_complaint_text(hit.get("chiefComplaint"))
    return enrich_visit_detail(store, hit)


@router.get("/Patient/{patient_id}")
def get_patient(patient_id: str) -> dict[str, Any]:
    repo = get_fhir_repository()
    resource = repo.read_resource("Patient", patient_id)
    if resource is None:
        raise HTTPException(status_code=404, detail=f"Patient/{patient_id} not found")
    return resource


@router.post("/Patient", status_code=201)
def create_patient(body: PatientBody) -> dict[str, Any]:
    store = get_shadow_store()
    payload = body.to_fhir_dict()
    # 若前端沒帶病歷號，後端自動取號
    has_chart = False
    for ident in payload.get("identifier") or []:
        if isinstance(ident, dict) and (
            ident.get("use") == "secondary"
            or "chart" in str(ident.get("system") or "")
        ):
            if str(ident.get("value") or "").strip():
                has_chart = True
                break
    if not has_chart and hasattr(store, "next_medical_no"):
        med = store.next_medical_no()
        idents = list(payload.get("identifier") or [])
        idents.append(
            {
                "use": "secondary",
                "system": "https://clinic.org/chart-number",
                "value": med,
            }
        )
        payload["identifier"] = idents
    repo = get_fhir_repository()
    return repo.create_resource("Patient", payload)


@router.put("/Patient/{patient_id}")
def update_patient(patient_id: str, body: PatientBody) -> dict[str, Any]:
    repo = get_fhir_repository()
    if repo.read_resource("Patient", patient_id) is None:
        raise HTTPException(status_code=404, detail=f"Patient/{patient_id} not found")
    payload = body.to_fhir_dict()
    payload["id"] = patient_id
    return repo.update_resource("Patient", patient_id, payload)


@router.delete("/Patient/{patient_id}", status_code=204)
def delete_patient(patient_id: str) -> None:
    repo = get_fhir_repository()
    if repo.read_resource("Patient", patient_id) is None:
        raise HTTPException(status_code=404, detail=f"Patient/{patient_id} not found")
    repo.delete_resource("Patient", patient_id)

