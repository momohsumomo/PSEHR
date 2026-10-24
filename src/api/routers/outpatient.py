"""門診閉環 — 醫師工作台一次取齊（沙盒 2 → 沙盒 1 接線契約）。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from src.app.bootstrap import get_fhir_repository, get_shadow_store
from src.core.chart_presence import claim as claim_chart
from src.core.chart_presence import release as release_chart
from src.core.encounter_extensions import previsit_completed
from src.core.nhi_allergy_fhir_mapper import extract_allergy_stickers
from src.core.nhi_soap_fhir_mapper import extract_soap_stickers_from_composition
from src.core.patient_visit_history import build_patient_visit_records, chief_complaint_text
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore

router = APIRouter(prefix="/nhi/v1/outpatient", tags=["NHI-門診閉環"])


def _store() -> SqliteShadowStore:
    store = get_shadow_store()
    assert isinstance(store, SqliteShadowStore)
    return store


def _allergy_rows_for_patient(store: SqliteShadowStore, patient_id: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for resource in store.list_allergy_payloads(patient_id):
        stickers = extract_allergy_stickers(resource)
        vs = stickers.get("verificationStatus") or "unconfirmed"
        crit = resource.get("criticality")
        level = "high" if crit == "high" and vs == "confirmed" else vs
        rows.append(
            {
                "allergyId": resource.get("id"),
                "text": stickers.get("summaryText") or stickers.get("snomedCode"),
                "substance": stickers.get("rxnormSubstance"),
                "manifestation": stickers.get("snomedManifestation"),
                "level": level,
                "verificationStatus": vs,
            }
        )
    return rows


def _history_visits(
    store: SqliteShadowStore,
    patient_id: str,
    exclude_encounter_id: str,
    limit: int = 12,
) -> list[dict[str, Any]]:
    return build_patient_visit_records(
        store,
        patient_id,
        exclude_encounter_id=exclude_encounter_id,
        limit=limit,
        deep_soap=False,
    )


@router.get(
    "/workspace/{encounter_id}",
    summary="門診工作台聚合（掛號+病患+過敏+SOAP+生命徵象+診斷+處方+前次處方）",
)
def get_outpatient_workspace(
    encounter_id: str,
    history_limit: int = Query(
        0,
        ge=0,
        le=500,
        description="歷史就診筆數；預設 0（最快，歷史請另打 /Patient/{id}/visits）",
    ),
) -> dict[str, Any]:
    """
    醫師選定 Encounter 後一次載入，對齊模組六皮膚科 v0.2 中欄資料契約。
    病患端預診完成時 `preVisitCompleted=true`。
    """
    store = _store()
    encounter = store.get_cached_resource("Encounter", encounter_id)
    if encounter is None:
        raise HTTPException(status_code=404, detail=f"Encounter/{encounter_id} 不存在")

    subject = encounter.get("subject") or {}
    patient_id = (subject.get("reference") or "").split("/")[-1]
    if not patient_id:
        raise HTTPException(status_code=422, detail="Encounter 缺少病人")

    # 影子庫本機讀取（勿繞雲端 repo，選病人才夠快）
    patient = store.get_cached_resource("Patient", patient_id)
    if patient is None:
        repo = get_fhir_repository()
        patient = repo.read_resource("Patient", patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail=f"Patient/{patient_id} 不存在")

    queue_entry = store.get_encounter_queue_meta(encounter_id)
    queue_meta = (queue_entry or {}).get("queueMeta") or {}
    allergies = _allergy_rows_for_patient(store, patient_id)
    has_alert = any(a["level"] in ("confirmed", "high") for a in allergies)

    # 跟調閱病歷同一份。reasonCode 曾被掛號備註蓋過，有存檔主訴時不以它為準。
    cc = chief_complaint_text(store.lookup_chief_complaint(encounter_id))
    soap = None
    if not cc:
        for rc in encounter.get("reasonCode") or []:
            if isinstance(rc, dict) and rc.get("text"):
                cc = chief_complaint_text(str(rc["text"]))
                break
    if not cc:
        comp_id = store.find_soap_composition_id_by_encounter(encounter_id)
        if comp_id:
            comp = store.get_cached_resource("Composition", comp_id)
            if comp:
                stickers = extract_soap_stickers_from_composition(comp)
                cc = chief_complaint_text(str(stickers.get("chiefComplaint") or ""))
                soap = {
                    "compositionId": comp_id,
                    "stickers": stickers,
                    "resource": comp,
                }

    vitals = store.list_observations(patient_id=patient_id, encounter_id=encounter_id)
    diagnoses = store.list_conditions(patient_id=patient_id, encounter_id=encounter_id)
    current_meds = store.list_medication_requests(
        patient_id=patient_id, encounter_id=encounter_id
    )
    # 前次處方改由歷史面板提供；此處略過以加速首屏
    prev_enc = None
    previous_meds: list[dict[str, Any]] = []

    # 病灶圖常含 base64，首屏不撈（開病灶區再載）
    lesion_media: list[dict[str, Any]] = []
    history_visits = (
        _history_visits(store, patient_id, encounter_id, limit=history_limit)
        if history_limit > 0
        else []
    )

    return {
        "encounterId": encounter_id,
        "patientId": patient_id,
        "queueMeta": queue_meta,
        "preVisitCompleted": previsit_completed(encounter),
        "hasAllergyAlert": has_alert,
        "patient": patient,
        "encounter": encounter,
        "chiefComplaint": cc,
        "allergies": allergies,
        "soap": soap,
        "vitals": vitals,
        "diagnoses": diagnoses,
        "currentMedications": current_meds,
        "previousEncounterId": prev_enc,
        "previousMedications": previous_meds,
        "historyVisits": history_visits,
        "lesionMedia": lesion_media,
    }


class ChartOpenBody(BaseModel):
    encounterId: str = Field(..., min_length=1)
    deviceId: str = Field(..., min_length=1)


_IN_USE = "\u6b63\u5728\u88ab\u5176\u4ed6\u4eba\u4f7f\u7528\u4e2d"


@router.post("/chart-open")
def chart_open(body: ChartOpenBody) -> dict[str, bool]:
    if not claim_chart(body.encounterId, body.deviceId):
        raise HTTPException(status_code=409, detail=_IN_USE)
    return {"ok": True}


@router.post("/chart-open/release")
def chart_open_release(body: ChartOpenBody) -> dict[str, bool]:
    release_chart(body.encounterId, body.deviceId)
    return {"ok": True}
