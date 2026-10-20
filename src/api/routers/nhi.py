"""健保署患者進場 API — 沙盒 2 嚴格校驗層（獨立於寬鬆 FHIR POST）。"""

from __future__ import annotations

from datetime import date, datetime
import json
import re
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from src.api.schemas.nhi_allergy import NhiAllergyIntake, NhiAllergyRegisterResponse
from src.api.schemas.nhi_media import NhiMediaIntake, NhiMediaRegisterResponse
from src.api.schemas.nhi_condition import NhiConditionIntake, NhiConditionRegisterResponse
from src.api.schemas.nhi_encounter import NhiEncounterIntake, NhiEncounterRegisterResponse
from src.api.schemas.nhi_medication import NhiMedicationIntake, NhiMedicationRegisterResponse
from src.api.schemas.nhi_patient import NhiPatientRegisterResponse
from src.api.schemas.nhi_observation import NhiObservationIntake, NhiObservationRegisterResponse
from src.api.schemas.nhi_soap import NhiSoapIntake, NhiSoapRegisterResponse
from src.app.bootstrap import get_fhir_repository, get_shadow_store
from src.core.encounter_extensions import attach_previsit_extension, previsit_completed
from src.core.nhi_allergy_fhir_mapper import extract_allergy_stickers, nhi_allergy_to_fhir
from src.core.nhi_previsit_validators import NhiPreVisitIntake
from src.core.nhi_observation_fhir_mapper import (
    extract_observation_stickers,
    nhi_observation_to_fhir,
)
from src.core.nhi_fhir_mapper import (
    extract_nhi_stickers_from_patient,
    nhi_intake_to_fhir_patient,
)
from src.core.nhi_soap_fhir_mapper import (
    encounter_reason_patch,
    extract_soap_stickers_from_composition,
    nhi_soap_to_fhir_composition,
)
from src.api.routers.encounter import _attach_queue_meta
from src.core.encounter_queue import fhir_status_from_queue
from src.core.icd_crosswalk import browse_codes, browse_headings, map_code, search_codes, search_icd10_book
from src.core.nhi_card_bridge import (
    CardReadResult,
    read_card_profile,
    profile_to_patient_intake,
    write_visit_to_card,
    console_diagnose,
)
from src.core.nhi_seq_bridge import request_seq_rollback, request_visit_number
from src.core.encounter_extensions import attach_reg_extension, extract_reg_meta, put_reg_string
from src.core.nhi_clinical_mappers import (
    extract_condition_stickers,
    extract_medication_stickers,
    nhi_condition_to_fhir,
    nhi_encounter_to_fhir,
    nhi_medication_to_fhir,
)
from src.core.nhi_media_fhir_mapper import extract_media_stickers, nhi_media_to_fhir
from src.core.nhi_validators import NhiPatientIntake, NhiValidationError
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore

router = APIRouter(prefix="/nhi", tags=["NHI-健保署進場"])


def _store() -> SqliteShadowStore:
    store = get_shadow_store()
    assert isinstance(store, SqliteShadowStore)
    return store


def _ensure_chart_on_payload(
    store: SqliteShadowStore,
    fhir_payload: dict[str, Any],
    *,
    existing_id: str | None,
) -> dict[str, Any]:
    """新建取號；更新時保留既有病歷號，避免讀卡覆蓋清空。"""
    if existing_id:
        existing = store.get_cached_resource("Patient", existing_id) or {}
        keep_chart = None
        for ident in existing.get("identifier") or []:
            if isinstance(ident, dict) and (
                ident.get("use") == "secondary" or "chart" in str(ident.get("system") or "")
            ):
                if str(ident.get("value") or "").strip():
                    keep_chart = ident
                    break
        if keep_chart:
            idents = [
                i
                for i in (fhir_payload.get("identifier") or [])
                if not (
                    isinstance(i, dict)
                    and (i.get("use") == "secondary" or "chart" in str(i.get("system") or ""))
                )
            ]
            idents.append(keep_chart)
            fhir_payload["identifier"] = idents
        return fhir_payload

    med = store.next_medical_no()
    idents = list(fhir_payload.get("identifier") or [])
    idents.append(
        {
            "use": "secondary",
            "system": "https://clinic.org/chart-number",
            "value": med,
        }
    )
    fhir_payload["identifier"] = idents
    return fhir_payload


def _patient_validation(store, resource: dict[str, Any], intake: NhiPatientIntake) -> dict[str, Any]:
    """對到舊病歷時，畫面上的證號、姓名、生日用庫內的，不用這次帶進來的。"""
    from src.core.patient_match import roc7_from_iso

    patient_id = str(resource.get("id") or "")
    stickers = extract_nhi_stickers_from_patient(resource)
    names = resource.get("name") or []
    name = ""
    if names and isinstance(names[0], dict):
        text = str(names[0].get("text") or "").strip()
        if text:
            name = text
        else:
            given = names[0].get("given") or []
            name = f"{names[0].get('family') or ''}{''.join(str(part) for part in given)}"
    birth_iso = str(resource.get("birthDate") or "")[:10]
    roc = str(stickers.get("birthdayRoc") or "").strip() or roc7_from_iso(birth_iso) or intake.birthday
    stored_id = ""
    if patient_id:
        stored_id = store.get_patient_id_no(patient_id) or ""
    return {
        "idNo": stored_id or stickers.get("idNo") or intake.idNo,
        "birthdayRoc": roc,
        "sex": stickers.get("sex") or intake.sex,
        "birthDateIso": birth_iso or None,
        "patientName": "".join(name.split()) or (intake.patientName or ""),
    }


def _save_nhi_patient(intake: NhiPatientIntake) -> tuple[dict[str, Any], bool]:
    """身分證已在庫內就原樣帶回，不覆蓋姓名生日。沒有才新建，病歷號為最大號加 1。"""
    from src.core.context import current_operator_identity

    store = _store()
    existing_id = store.find_patient_id_by_id_no(intake.idNo)
    if existing_id:
        existing = store.get_cached_resource("Patient", existing_id)
        if existing:
            return existing, False
    repo = get_fhir_repository()
    fhir_payload = nhi_intake_to_fhir_patient(intake)
    fhir_payload = _ensure_chart_on_payload(store, fhir_payload, existing_id=None)

    token = current_operator_identity.set("System_NHI_Card")
    try:
        return repo.create_resource("Patient", fhir_payload), True
    finally:
        current_operator_identity.reset(token)


@router.post(
    "/v1/patient/register",
    status_code=201,
    response_model=NhiPatientRegisterResponse,
    summary="健保患者進場（第5頁 idNo/birthday/sex + 第9頁姓名）",
)
def register_nhi_patient(body: NhiPatientIntake) -> dict[str, Any]:
    """
    1. Pydantic 秒級校驗健保署欄位格式
    2. 轉譯為標準 FHIR Patient
    3. 寫入 SQLite 雙層（cache + patient_index）
    """
    try:
        resource, created = _save_nhi_patient(body)
    except NhiValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except HTTPException:
        raise

    store = _store()
    patient_id = str(resource["id"])
    dual = store.get_dual_layer("Patient", patient_id)
    stickers = extract_nhi_stickers_from_patient(resource)
    face = _patient_validation(store, resource, body)

    return {
        "created": created,
        "patientId": patient_id,
        "validation": face,
        "nhiStickers": stickers,
        "resource": resource,
        "indexLayer": dual.get("indexLayer") if dual else None,
    }


def _resolve_encounter_patient(store: SqliteShadowStore, encounter_id: str) -> tuple[dict[str, Any], str]:
    encounter = store.get_cached_resource("Encounter", encounter_id)
    if encounter is None:
        raise HTTPException(status_code=404, detail=f"Encounter/{encounter_id} 不存在")
    subject = encounter.get("subject") or {}
    ref = subject.get("reference", "")
    patient_id = ref.split("/")[-1] if ref else ""
    if not patient_id:
        raise HTTPException(status_code=422, detail="Encounter 缺少 subject.reference")
    patient = store.get_cached_resource("Patient", patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail=f"Patient/{patient_id} 不存在")
    return encounter, patient_id


@router.post(
    "/v1/soap/register",
    status_code=201,
    response_model=NhiSoapRegisterResponse,
    summary="門診 SOAP 落庫（CC/S/O/A/P 嚴格 Schema）",
)
def register_nhi_soap(body: NhiSoapIntake) -> dict[str, Any]:
    if body.encounterId != body.encounterId.strip():
        raise HTTPException(status_code=422, detail="encounterId 無效")

    store = _store()
    encounter, patient_id = _resolve_encounter_patient(store, body.encounterId)

    if body.patientIdNo:
        stored_id_no = store.get_patient_id_no(patient_id)
        if stored_id_no and stored_id_no != body.patientIdNo:
            raise HTTPException(
                status_code=422,
                detail=f"patientIdNo 與 Encounter 病人不符（庫內 {stored_id_no}）",
            )

    try:
        fhir_composition = nhi_soap_to_fhir_composition(
            body, patient_id=patient_id, encounter_id=body.encounterId
        )
    except NhiValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    repo = get_fhir_repository()
    existing_comp_id = store.find_soap_composition_id_by_encounter(body.encounterId)

    if existing_comp_id:
        fhir_composition["id"] = existing_comp_id
        composition = repo.update_resource("Composition", existing_comp_id, fhir_composition)
        created = False
    else:
        composition = repo.create_resource("Composition", fhir_composition)
        created = True

    comp_id = str(composition["id"])
    enc_patch = {**encounter, **encounter_reason_patch(body.chiefComplaint)}
    repo.update_resource("Encounter", body.encounterId, enc_patch)

    try:
        from src.core.cc_learn import observe

        observe(store.db_path, body.encounterId, body.chiefComplaint)
    except Exception:
        import logging

        logging.getLogger("cc_learn").exception("cc learn observe failed")

    dual = store.get_dual_layer("Composition", comp_id)
    stickers = extract_soap_stickers_from_composition(composition)

    return {
        "created": created,
        "compositionId": comp_id,
        "encounterId": body.encounterId,
        "patientId": patient_id,
        "validation": {
            "encounterId": body.encounterId,
            "chiefComplaint": body.chiefComplaint,
            "hasSubjective": bool(body.subjective),
            "hasObjective": bool(body.objective),
            "assessmentLength": len(body.assessment),
            "planLength": len(body.plan),
        },
        "soapStickers": stickers,
        "resource": composition,
        "indexLayer": dual.get("indexLayer") if dual else None,
        "encounterReasonSynced": True,
    }


@router.get(
    "/v1/soap/by-encounter/{encounter_id}",
    summary="依 Encounter 查詢 SOAP 雙層貼紙",
)
def get_soap_by_encounter(encounter_id: str) -> dict[str, Any]:
    store = _store()
    comp_id = store.find_soap_composition_id_by_encounter(encounter_id)
    if not comp_id:
        raise HTTPException(status_code=404, detail=f"Encounter/{encounter_id} 尚無 SOAP")
    dual = store.get_dual_layer("Composition", comp_id)
    if dual is None:
        raise HTTPException(status_code=404, detail="Composition 不存在")
    return dual


@router.post(
    "/v1/observation/register",
    status_code=201,
    response_model=NhiObservationRegisterResponse,
    summary="生命徵象 Observation 落庫（嚴格 LOINC + 數值）",
)
def register_nhi_observation(body: NhiObservationIntake) -> dict[str, Any]:
    store = _store()
    _, patient_id = _resolve_encounter_patient(store, body.encounterId)

    if body.patientIdNo:
        stored_id_no = store.get_patient_id_no(patient_id)
        if stored_id_no and stored_id_no != body.patientIdNo:
            raise HTTPException(
                status_code=422,
                detail=f"patientIdNo 與 Encounter 病人不符（庫內 {stored_id_no}）",
            )

    try:
        loinc, _, unit = body.resolved_coding()
        fhir_obs = nhi_observation_to_fhir(
            body, patient_id=patient_id, encounter_id=body.encounterId
        )
    except NhiValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    repo = get_fhir_repository()
    resource = repo.create_resource("Observation", fhir_obs)
    obs_id = str(resource["id"])
    dual = store.get_dual_layer("Observation", obs_id)
    stickers = extract_observation_stickers(resource)

    return {
        "created": True,
        "observationId": obs_id,
        "encounterId": body.encounterId,
        "patientId": patient_id,
        "loincCode": loinc,
        "value": body.value,
        "unit": unit,
        "observationStickers": stickers,
        "resource": resource,
        "indexLayer": dual.get("indexLayer") if dual else None,
    }


@router.post(
    "/v1/allergy/register",
    status_code=201,
    response_model=NhiAllergyRegisterResponse,
    summary="過敏紀錄落庫（SNOMED 過敏原 + RxNorm 成分 + SNOMED 症狀）",
)
def register_nhi_allergy(body: NhiAllergyIntake) -> dict[str, Any]:
    store = _store()
    patient = store.get_cached_resource("Patient", body.patientId)
    if patient is None:
        raise HTTPException(status_code=404, detail=f"Patient/{body.patientId} 不存在")

    if body.patientIdNo:
        stored_id_no = store.get_patient_id_no(body.patientId)
        if stored_id_no and stored_id_no != body.patientIdNo:
            raise HTTPException(
                status_code=422,
                detail=f"patientIdNo 與庫內病人不符（庫內 {stored_id_no}）",
            )

    try:
        fhir_allergy = nhi_allergy_to_fhir(body)
    except NhiValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    repo = get_fhir_repository()
    resource = repo.create_resource("AllergyIntolerance", fhir_allergy)
    allergy_id = str(resource["id"])
    dual = store.get_dual_layer("AllergyIntolerance", allergy_id)
    stickers = extract_allergy_stickers(resource)

    return {
        "created": True,
        "allergyId": allergy_id,
        "patientId": body.patientId,
        "validation": {
            "patientId": body.patientId,
            "verificationStatus": body.verificationStatus,
            "allergenSnomedCode": body.allergenSnomedCode,
            "substanceRxnormCode": body.substanceRxnormCode,
            "manifestationSnomedCode": body.manifestationSnomedCode,
        },
        "allergyStickers": stickers,
        "resource": resource,
        "indexLayer": dual.get("indexLayer") if dual else None,
    }


@router.get(
    "/v1/allergy/by-patient/{patient_id}",
    summary="依病人查詢過敏雙層貼紙列表",
)
def list_allergies_by_patient(patient_id: str) -> dict[str, Any]:
    store = _store()
    pid = patient_id.split("/")[-1]
    items: list[dict[str, Any]] = []
    for aid in store.list_allergy_resource_ids(pid):
        dual = store.get_dual_layer("AllergyIntolerance", aid)
        if dual:
            items.append(dual)
    return {
        "patientId": pid,
        "total": len(items),
        "entries": items,
    }


@router.post(
    "/v1/previsit/submit",
    status_code=201,
    summary="病患預診提交（自助 CC → 寫入 Encounter 並標記完成）",
)
def submit_previsit(body: NhiPreVisitIntake) -> dict[str, Any]:
    store = _store()
    encounter, patient_id = _resolve_encounter_patient(store, body.encounterId)

    if body.patientIdNo:
        stored_id_no = store.get_patient_id_no(patient_id)
        if stored_id_no and stored_id_no != body.patientIdNo:
            raise HTTPException(
                status_code=422,
                detail=f"patientIdNo 與 Encounter 病人不符（庫內 {stored_id_no}）",
            )

    if previsit_completed(encounter):
        raise HTTPException(status_code=409, detail="此就診已提交過預診")

    try:
        tags = [str(t) for t in body.symptomTags]
        patched = attach_previsit_extension(
            encounter,
            chief_complaint=body.chiefComplaint,
            symptom_tags=tags,
            submitted_at=body.submitted_iso(),
        )
    except NhiValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    repo = get_fhir_repository()
    updated = repo.update_resource("Encounter", body.encounterId, patched)

    try:
        from src.core.cc_learn import observe

        observe(store.db_path, body.encounterId, body.chiefComplaint)
    except Exception:
        import logging

        logging.getLogger("cc_learn").exception("cc learn observe failed")

    return {
        "encounterId": body.encounterId,
        "patientId": patient_id,
        "preVisitCompleted": True,
        "chiefComplaint": body.chiefComplaint,
        "symptomTags": tags,
        "hasDrugAllergyHistory": body.hasDrugAllergyHistory,
        "encounter": updated,
    }


@router.post(
    "/v1/media/register",
    status_code=201,
    response_model=NhiMediaRegisterResponse,
    summary="病灶 Media 上傳（Base64 + 部位標籤）",
)
def register_nhi_media(body: NhiMediaIntake) -> dict[str, Any]:
    store = _store()
    _, patient_id = _resolve_encounter_patient(store, body.encounterId)

    if body.patientIdNo:
        stored_id_no = store.get_patient_id_no(patient_id)
        if stored_id_no and stored_id_no != body.patientIdNo:
            raise HTTPException(
                status_code=422,
                detail=f"patientIdNo 與 Encounter 病人不符（庫內 {stored_id_no}）",
            )

    try:
        fhir_media = nhi_media_to_fhir(
            body, patient_id=patient_id, encounter_id=body.encounterId
        )
    except NhiValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    repo = get_fhir_repository()
    resource = repo.create_resource("Media", fhir_media)
    media_id = str(resource["id"])
    dual = store.get_dual_layer("Media", media_id)
    stickers = extract_media_stickers(resource)

    return {
        "created": True,
        "mediaId": media_id,
        "encounterId": body.encounterId,
        "patientId": patient_id,
        "siteLabel": body.siteLabel,
        "mediaStickers": stickers,
        "resource": resource,
        "indexLayer": dual.get("indexLayer") if dual else None,
    }


@router.get(
    "/v1/media/by-encounter/{encounter_id}",
    summary="依 Encounter 查詢病灶 Media 列表（索引層，不含大圖 Base64）",
)
def list_media_by_encounter(encounter_id: str) -> dict[str, Any]:
    store = _store()
    entries = store.list_media(encounter_id=encounter_id)
    return {
        "encounterId": encounter_id.split("/")[-1],
        "total": len(entries),
        "entry": entries,
    }


def _pair_nocard_claim(body: NhiEncounterIntake) -> None:
    from src.claims.nocard_seq import pair_nocard

    reason, seq = pair_nocard(
        mode=body.icException or "",
        reason=body.noCardReason or "",
        treat_seq=body.treatSeq or "",
        treatment_number=body.treatmentNumber or "",
    )
    if reason:
        body.noCardReason = reason
    if seq:
        body.treatSeq = seq


def _require_nhi_visit_for_register(body: NhiEncounterIntake) -> None:
    """健保掛號必須已向健保局取號；自費／預掛才可無序號。禁止只讀卡就掛進清單。"""
    if body.prebook:
        return
    mode = (body.icException or ("paper" if body.paperCard else "ic")).strip() or "ic"
    if mode == "selfPay":
        return
    if mode == "deposit":
        return
    if mode in {"noCard", "childNoCard", "pregnantNoCard", "badCard", "paper"}:
        if not (body.treatmentNumber or "").strip():
            raise HTTPException(
                status_code=422,
                detail="無卡／卡片不良／紙卡須先向健保局取得就醫識別碼，不可只讀卡掛號。",
            )
        return
    if not (body.treatSeq or "").strip():
        raise HTTPException(
            status_code=422,
            detail="健保掛號須先向健保局取得就醫序號，不可只讀卡掛號。",
        )


def _apply_manual_slot(payload: dict[str, Any], body: NhiEncounterIntake, encounter_date: str) -> None:
    """手改就診時間（清單時鐘）與就診序號（當日流水號）。"""
    clock = (body.visitClock or "").strip()
    if clock:
        parts = clock.split(":")
        if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
            hh = int(parts[0])
            mm = int(parts[1])
            if 0 <= hh <= 23 and 0 <= mm <= 59:
                ss = 0
                if len(parts) >= 3 and parts[2].isdigit():
                    ss = int(parts[2])
                if ss > 59:
                    ss = 0
                day = (encounter_date or "")[:10]
                start = str((payload.get("period") or {}).get("start") or "")
                if not day and "T" in start:
                    day = start.split("T", 1)[0]
                if day:
                    period = dict(payload.get("period") or {})
                    period["start"] = f"{day}T{hh:02d}:{mm:02d}:{ss:02d}+08:00"
                    payload["period"] = period
    if body.queueNumber is None:
        return
    status = "waiting"
    for ext in payload.get("extension") or []:
        if ext.get("url") != "https://wundadi.tw/fhir/StructureDefinition/encounter-queue":
            continue
        for sub in ext.get("extension") or []:
            if sub.get("url") == "queueStatus" and sub.get("valueCode"):
                status = str(sub["valueCode"])
    _attach_queue_meta(payload, int(body.queueNumber), status)


@router.post("/v1/care-online/import", summary="匯入指定日期的照護線上預約")
def import_care_online(visitingDate: str = Query(..., description="YYYY-MM-DD")) -> dict[str, Any]:
    from src.core.care_online_import import import_care_bookings

    try:
        return import_care_bookings(visitingDate)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"照護線上讀取失敗：{exc}") from exc


@router.post(
    "/v1/encounter/register",
    status_code=201,
    response_model=NhiEncounterRegisterResponse,
    summary="今日掛號 Encounter（嚴格 patientId + 候診狀態）",
)
def register_nhi_encounter(body: NhiEncounterIntake) -> dict[str, Any]:
    store = _store()
    repo = get_fhir_repository()
    patient_id = body.patientId
    if store.get_cached_resource("Patient", patient_id) is None:
        raise HTTPException(status_code=404, detail=f"Patient/{patient_id} 不存在")

    if body.patientIdNo:
        stored_id_no = store.get_patient_id_no(patient_id)
        if stored_id_no and stored_id_no != body.patientIdNo:
            raise HTTPException(
                status_code=422,
                detail=f"patientIdNo 與庫內病人不符（庫內 {stored_id_no}）",
            )

    _pair_nocard_claim(body)
    _require_nhi_visit_for_register(body)

    try:
        payload = nhi_encounter_to_fhir(body)
    except NhiValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    encounter_date = body.encounterDate or date.today().isoformat()
    queue_status = body.queueStatus
    queue_number = (
        int(body.queueNumber)
        if body.queueNumber is not None
        else store.next_queue_number(encounter_date)
    )
    payload["status"] = fhir_status_from_queue(queue_status)
    if not payload.get("period"):
        if body.encounterDate:
            curr_time_str = datetime.now().time().isoformat(timespec="seconds")
            payload["period"] = {"start": f"{encounter_date}T{curr_time_str}"}
        else:
            payload["period"] = {"start": datetime.now().astimezone().isoformat(timespec="seconds")}
    _attach_queue_meta(payload, queue_number, queue_status)
    _apply_manual_slot(payload, body, encounter_date)

    created = repo.create_resource("Encounter", payload)
    encounter_id = str(created["id"])
    entry = next(
        (e for e in store.list_encounters_for_date(encounter_date) if e["resource"]["id"] == encounter_id),
        None,
    )
    queue_meta = (entry or {}).get("queueMeta") or {}

    return {
        "created": True,
        "encounterId": encounter_id,
        "patientId": patient_id,
        "queueNumber": queue_number,
        "queueStatus": queue_status,
        "validation": {
            "patientId": patient_id,
            "queueStatus": queue_status,
            "reasonText": body.reasonText,
        },
        "resource": created,
        "queueMeta": queue_meta,
    }


@router.patch(
    "/v1/encounter/{encounter_id}/reg",
    summary="修改此次掛號資料（掛號編輯／F3）",
)
def patch_encounter_reg(encounter_id: str, body: NhiEncounterIntake) -> dict[str, Any]:
    _pair_nocard_claim(body)
    store = _store()
    repo = get_fhir_repository()
    existing = repo.read_resource("Encounter", encounter_id)
    if existing is None:
        raise HTTPException(status_code=404, detail=f"Encounter/{encounter_id} 不存在")
    payload = attach_reg_extension(
        dict(existing),
        {
            "caseNo": body.caseNo,
            "copayCode": body.copayCode,
            "dispense": body.dispense,
            "treatSeq": body.treatSeq,
            "treatmentNumber": body.treatmentNumber,
            "treatDateTime": body.treatDateTime,
            "room": body.room,
            "shift": body.shift,
            "afterCheck": body.afterCheck,
            "treatmentItem": body.treatmentItem,
            "hcId": body.hcId,
            "hcIdNo": body.hcIdNo,
            "paperCard": body.paperCard,
            "icException": body.icException,
            "noCardReason": body.noCardReason,
            "pharmacist": body.pharmacist,
            "doctorId": body.doctorId,
            "doctorName": body.doctorName,
            "payType": body.payType,
            "regFee": body.regFee,
            "copayAmt": body.copayAmt,
            "deposit": body.deposit,
            "securitySign": body.securitySign,
            "samId": body.samId,
            "icUploadDate": body.icUploadDate,
            "consultFee": body.consultFee,
            "drugFee": body.drugFee,
            "materialFee": body.materialFee,
            "burdenFee": body.burdenFee,
            "totalFee": body.totalFee,
            "selfPay": body.selfPay,
            "referralSeq": body.referralSeq,
            "referralHospId": body.referralHospId,
            "referralHospName": body.referralHospName,
            "referralDate": body.referralDate,
            "acceptReferral": body.acceptReferral,
            "prebook": body.prebook,
            "cardWritten": body.cardWritten,
        },
    )
    # Check-in replaces the appointment. forespeak 預 would keep the Yu column.
    if not body.prebook:
        put_reg_string(payload, "forespeak", "")
    if body.reasonText:
        payload["reasonCode"] = [{"text": body.reasonText}]
    enc_date = ""
    start = str((payload.get("period") or {}).get("start") or "")
    if "T" in start:
        enc_date = start.split("T", 1)[0]
    _apply_manual_slot(payload, body, enc_date)
    updated = repo.update_resource("Encounter", encounter_id, payload)
    row = store.get_encounter_queue_meta(encounter_id)
    return {
        "ok": True,
        "encounterId": encounter_id,
        "resource": updated,
        "queueMeta": (row or {}).get("queueMeta"),
    }


@router.post(
    "/v1/condition/register",
    status_code=201,
    response_model=NhiConditionRegisterResponse,
    summary="門診診斷 Condition 落庫（ICD-10 / SNOMED / 健保 ICD 至少一項）",
)
def register_nhi_condition(body: NhiConditionIntake) -> dict[str, Any]:
    _claim_icd9_as_icd10(body)
    store = _store()
    _, patient_id = _resolve_encounter_patient(store, body.encounterId)

    if body.patientIdNo:
        stored_id_no = store.get_patient_id_no(patient_id)
        if stored_id_no and stored_id_no != body.patientIdNo:
            raise HTTPException(
                status_code=422,
                detail=f"patientIdNo 與 Encounter 病人不符（庫內 {stored_id_no}）",
            )

    try:
        fhir_condition = nhi_condition_to_fhir(body, patient_id=patient_id)
    except (NhiValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    repo = get_fhir_repository()
    resource = repo.create_resource("Condition", fhir_condition)
    condition_id = str(resource["id"])
    dual = store.get_dual_layer("Condition", condition_id)
    stickers = extract_condition_stickers(resource)

    return {
        "created": True,
        "conditionId": condition_id,
        "encounterId": body.encounterId,
        "patientId": patient_id,
        "validation": {
            "encounterId": body.encounterId,
            "summaryText": body.summaryText,
            "icd10Code": body.icd10Code,
            "snomedCode": body.snomedCode,
            "nhiIcd10Code": body.nhiIcd10Code,
        },
        "conditionStickers": stickers,
        "resource": resource,
        "indexLayer": dual.get("indexLayer") if dual else None,
    }


class NhiIcdCrosswalkIn(BaseModel):
    code: str = ""
    text: str | None = None


def _claim_icd9_as_icd10(body: NhiConditionIntake) -> None:
    """A stored ICD-9 must not go out as the claim code."""
    raw = (body.icd10Code or body.nhiIcd10Code or "").strip()
    compact = re.sub(r"[^A-Za-z0-9]", "", raw).upper()
    if not compact or (compact[0].isalpha() and compact[0] not in ("V", "E")):
        return
    mapped = map_code(raw, body.summaryText)
    if mapped.input_kind != "icd9" or not mapped.icd10:
        return
    body.icd10Code = mapped.icd10
    body.nhiIcd10Code = mapped.nhi_icd10


@router.post("/v1/diagnosis/crosswalk", summary="ICD-9 or ICD-10 to one billable NHI ICD-10")
def crosswalk_diagnosis(body: NhiIcdCrosswalkIn) -> dict[str, Any]:
    return map_code(body.code, body.text).as_dict()


@router.get("/v1/diagnosis/search", summary="Find a diagnosis by Chinese, English, ICD-9, or ICD-10")
def search_diagnosis(q: str = Query("", max_length=40)) -> dict[str, Any]:
    return {"hits": search_codes(q)}


@router.get("/v1/diagnosis/book", summary="Search the full ICD-10-CM book, outside the clinic short list")
def diagnosis_book(q: str = Query("", max_length=40)) -> dict[str, Any]:
    return {"hits": search_icd10_book(q)}


@router.get("/v1/diagnosis/browse", summary="ICD-9 chapter groups or the codes under one group")
def browse_diagnosis(
    lo: int = Query(0, ge=0, le=999),
    hi: int = Query(0, ge=0, le=999),
    letter: str = Query("", max_length=1),
    prefix: str = Query("", max_length=8),
) -> dict[str, Any]:
    if prefix.strip():
        return {"groups": [], "codes": browse_codes(prefix)}
    return {"groups": browse_headings(lo, hi, letter), "codes": []}


@router.post(
    "/v1/medication/register",
    status_code=201,
    response_model=NhiMedicationRegisterResponse,
    summary="門診處方 MedicationRequest 落庫（健保藥品碼必填）",
)
def register_nhi_medication(body: NhiMedicationIntake) -> dict[str, Any]:
    store = _store()
    _, patient_id = _resolve_encounter_patient(store, body.encounterId)

    if body.patientIdNo:
        stored_id_no = store.get_patient_id_no(patient_id)
        if stored_id_no and stored_id_no != body.patientIdNo:
            raise HTTPException(
                status_code=422,
                detail=f"patientIdNo 與 Encounter 病人不符（庫內 {stored_id_no}）",
            )

    enc = store.get_cached_resource("Encounter", body.encounterId) or {}
    target_date = None
    period = enc.get("period") or {}
    if isinstance(period, dict) and period.get("start"):
        target_date = str(period["start"])[:10]
    if not target_date:
        q = store.get_encounter_queue_meta(body.encounterId) or {}
        qm = q.get("queueMeta") or {}
        target_date = (qm.get("encounterDate") or q.get("encounterDate") or "")[:10] or None
    if not target_date:
        from datetime import date as _date

        target_date = _date.today().isoformat()

    resolved_price = None
    pack_version = None
    if body.unitPrice is None and body.nhiCode and target_date:
        from src.spoke.drug_price import lookup_drug_price

        looked = lookup_drug_price(body.nhiCode, target_date)
        if looked:
            resolved_price = looked["unitPrice"]
            pack_version = looked.get("packVersion")

    try:
        fhir_med = nhi_medication_to_fhir(
            body,
            patient_id=patient_id,
            target_date=target_date,
            resolved_unit_price=resolved_price,
            pack_version=pack_version,
        )
    except (NhiValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    repo = get_fhir_repository()
    resource = repo.create_resource("MedicationRequest", fhir_med)
    med_id = str(resource["id"])
    dual = store.get_dual_layer("MedicationRequest", med_id)
    stickers = extract_medication_stickers(resource)
    index_layer = dual.get("indexLayer") if dual else None

    return {
        "created": True,
        "medicationRequestId": med_id,
        "encounterId": body.encounterId,
        "patientId": patient_id,
        "validation": {
            "encounterId": body.encounterId,
            "drugText": body.drugText,
            "nhiCode": body.nhiCode,
            "rxnormCode": body.rxnormCode,
            "sig": body.sig,
            "daysSupply": body.daysSupply or 1,
            "quantity": body.quantity if body.quantity is not None else 1,
            "unitPrice": (index_layer or {}).get("unitPrice"),
            "packVersion": (index_layer or {}).get("packVersion"),
            "priceDate": target_date,
        },
        "medicationStickers": stickers,
        "resource": resource,
        "indexLayer": index_layer,
    }


@router.get(
    "/v1/card/console-status",
    summary="6.0 主控台三卡診斷（SAM／健保卡／醫事卡，只讀不取號）",
)
def card_console_status(
    consoleBase: str = Query("https://localhost:5066", description="讀卡機主控台基底 URL"),
    light: bool = Query(False, description="true＝只讀 Status，不打健保卡／醫事卡 Basic"),
) -> dict[str, Any]:
    del consoleBase, light
    return {"reachable": False, "reason": "NEED_DESK_SIGN"}


@router.get(
    "/v1/vpn-reach",
    summary="\u53ea\u554f\u9019\u53f0\u96fb\u8166\u901a\u4e0d\u901a\u5f97\u4e86\u5065\u4fdd VPN \u4e3b\u6a5f\uff0c\u4e0d\u767b\u5165\u3001\u4e0d\u9ede\u7db2\u9801",
)
def vpn_reach() -> dict[str, Any]:
    import socket

    ok = False
    try:
        with socket.create_connection(("medvpndc.nhi.gov.tw", 443), timeout=2.0):
            ok = True
    except OSError:
        ok = False
    return {"reachable": ok}


@router.post(
    "/v1/card/console-fix",
    summary="讀卡軟體除錯：未啟動則啟動，異常則重啟",
)
def card_console_fix(
    consoleBase: str = Query("https://localhost:5066", description="讀卡機主控台基底 URL"),
) -> dict[str, Any]:
    del consoleBase
    return {"ok": False, "action": "unsupported", "message": "NEED_DESK_SIGN"}


@router.post(
    "/v1/card/read-and-register",
    status_code=201,
    response_model=NhiPatientRegisterResponse,
    summary="讀卡→健保患者進場（主控台或 Mock，沙盒3橋接）",
)
def card_read_and_register(
    body: dict[str, Any] | None = None,
    mock: bool = Query(False, description="true 時強制 Mock 卡，不呼叫主控台"),
) -> dict[str, Any]:
    """
    1. 探測讀卡機主控台（:5066）；mock=true 才用假卡
    2. 取得完整 idNo/birthday/sex 後呼叫與 /v1/patient/register 相同落庫邏輯
    3. 部份讀取或主控台失敗：直接 422，不改走假卡、不重試卡住
    """
    try:
        basic = (body or {}).get("basic") if isinstance(body, dict) else None
        if mock:
            card = read_card_profile(use_mock=True)
        elif isinstance(basic, dict):
            from src.core.nhi_card_init_sop import map_hc_basic

            profile = map_hc_basic(basic)
            if not profile:
                raise HTTPException(status_code=422, detail="\u9019\u53f0\u8b80\u5230\u7684\u5065\u4fdd\u5361\u8cc7\u6599\u4e0d\u5b8c\u6574\u3002")
            card = CardReadResult(source="desk", profile=profile, consoleReachable=True, consoleError=None)
        else:
            raise HTTPException(status_code=422, detail="NEED_DESK_SIGN")
        if not card.profile:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": card.consoleError or "讀卡失敗，未取得完整卡片資料",
                    "diagnose": card.diagnose,
                    "autoFixed": card.autoFixed or [],
                },
            )
        intake = profile_to_patient_intake(card.profile)
        from src.core.patient_match import birth_iso_from_any, match_patient

        store = _store()
        matched = match_patient(
            store,
            id_no=intake.idNo,
            name=intake.patientName or "",
            birth_iso=birth_iso_from_any(intake.birthday),
        )
        note = card.consoleError
        if matched.patient_id:
            resource = store.get_cached_resource("Patient", matched.patient_id)
            created = False
            if resource is None:
                resource, created = _save_nhi_patient(intake)
            elif matched.kind == "name_birth":
                extra = "證號與病歷不同，已對到同名同生日的舊病歷，未改證號。"
                note = f"{note} {extra}".strip() if note else extra
        else:
            resource, created = _save_nhi_patient(intake)
    except NhiValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    store = _store()
    patient_id = str(resource["id"])
    dual = store.get_dual_layer("Patient", patient_id)
    stickers = extract_nhi_stickers_from_patient(resource)
    face = _patient_validation(store, resource, intake)

    return {
        "created": created,
        "patientId": patient_id,
        "cardSource": card.source,
        "consoleReachable": card.consoleReachable,
        "cardBridgeNote": note,
        "validation": {
            **face,
            "cardId": card.profile.get("cardId") or "",
        },
        "nhiStickers": stickers,
        "resource": resource,
        "indexLayer": dual.get("indexLayer") if dual else None,
    }


class NhiCardWriteRequest(BaseModel):
    encounterId: str
    writeDx: bool = True
    writeOrders: bool = True
    consoleBase: str = "https://localhost:5066"
    deskSign: dict[str, Any] | None = None
    deskSignRx: dict[str, Any] | None = None


@router.post(
    "/v1/card/read-profile",
    summary="只讀健保卡卡面基本資料（不建檔、不掛號、不取號）",
)
def card_read_profile(body: dict[str, Any] | None = None) -> dict[str, Any]:
    """IC卡內容資訊：只用這台電腦送來的卡面，不讀伺服器的讀卡機。"""
    basic = (body or {}).get("basic") if isinstance(body, dict) else None
    if not isinstance(basic, dict):
        raise HTTPException(status_code=422, detail="NEED_DESK_SIGN")
    from src.core.nhi_card_init_sop import map_hc_basic

    profile = map_hc_basic(basic)
    card = CardReadResult(source="desk", profile=profile or {}, consoleReachable=True, consoleError=None)
    if not card.profile:
        raise HTTPException(
            status_code=422,
            detail={
                "message": card.consoleError or "讀卡失敗，未取得卡片資料",
                "diagnose": card.diagnose,
                "autoFixed": card.autoFixed or [],
            },
        )
    profile = dict(card.profile)
    return {"ok": True, "source": card.source, "profile": profile, "note": card.consoleError or ""}


@router.post(
    "/v1/card/write-visit",
    summary="診療存檔寫入健保雲端（6.0 WriteCodeFee／Prescription；失敗不假裝成功）",
)
def card_write_visit(body: NhiCardWriteRequest) -> dict[str, Any]:
    """6.0：業務端雲端寫入（非 5.x 晶片）。written=true 僅在業務端確認或合法略過（自費／無卡）。"""
    result = write_visit_to_card(
        console_base=body.consoleBase,
        payload={
            "encounterId": body.encounterId,
            "writeDx": body.writeDx,
            "writeOrders": body.writeOrders,
            "deskSign": body.deskSign,
            "deskSignRx": body.deskSignRx,
        },
    )
    status = 200 if result.written else 422
    payload = {
        "written": result.written,
        "reason": result.reason,
        "consoleReachable": result.consoleReachable,
        "source": result.source,
        "encounterId": body.encounterId,
    }
    if not result.written:
        raise HTTPException(status_code=status, detail=result.reason)
    return payload


class NhiSeqNextRequest(BaseModel):
    treatmentItem: str = "01"
    afterCheck: str = "1"
    babyTreatment: str = ""
    paperCard: bool = False
    icException: str = "ic"
    patientIdNo: str | None = None
    noCardReason: str | None = None
    consoleBase: str = "https://localhost:5066"
    deskSign: dict[str, Any] | None = None


@router.post(
    "/v1/card/seq-next",
    summary="向健保局取得就醫序號或無卡就醫識別碼",
)
def card_seq_next(body: NhiSeqNextRequest) -> dict[str, Any]:
    """正常 IC＝Next（SAM+健保卡，不需醫事人員卡）。無卡／卡片不良／紙卡＝NoCard。自費才略過。失敗 422。"""
    mode = body.icException or ("paper" if body.paperCard else "ic")
    if mode == "badCard" and not (body.noCardReason or "").strip():
        body.noCardReason = "\u5361\u7247\u4e0d\u826f"
    if mode in {"noCard", "childNoCard", "pregnantNoCard", "badCard", "paper"} and not (
        body.noCardReason or ""
    ).strip():
        raise HTTPException(status_code=422, detail="您未使用押單方式建檔，所以請輸入無卡原因")
    result = request_visit_number(
        ic_exception=mode,
        treatment_item=body.treatmentItem,
        after_check=body.afterCheck,
        baby_treatment=body.babyTreatment,
        patient_id_no=body.patientIdNo,
        console_base=body.consoleBase,
        desk_sign=body.deskSign,
    )
    payload = {
        "ok": result.ok,
        "skipped": result.skipped,
        "reason": result.reason,
        "sequenceNumber": result.sequenceNumber,
        "treatmentNumber": result.treatmentNumber,
        "treatmentDateTime": result.treatmentDateTime,
        "isSameDay": result.isSameDay,
        "hvExpire": result.hvExpire,
        "hvExpireDate": result.hvExpireDate,
        "treatmentLimit": result.treatmentLimit,
        "statusCode": result.statusCode,
        "hcId": result.hcId,
        "hcIdNo": result.hcIdNo,
        "signature": result.signature,
        "samId": result.samId,
    }
    if not result.ok:
        raise HTTPException(status_code=422, detail=result.reason)
    return payload


@router.get(
    "/v1/deposits/open",
    summary="期限內還沒退的押單",
)
def list_open_deposits_api(idNo: str = Query(..., min_length=10, max_length=10)) -> dict[str, Any]:
    from src.claims.deposit_refund import list_open_deposits

    items = list_open_deposits(get_shadow_store(), idNo)
    return {"items": items}


@router.post(
    "/v1/encounter/{encounter_id}/refund-deposit",
    summary="退押：核對健保卡、取號、現金退回",
)
def refund_deposit(encounter_id: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    """Card must match this deposit. Sequence comes from the bureau. No invented number."""
    from src.claims.deposit_refund import apply_refund, card_matches, prepare_refund

    store = get_shadow_store()
    prepared = prepare_refund(store, encounter_id)
    if not prepared.get("ok"):
        raise HTTPException(status_code=422, detail=str(prepared.get("reason") or "無法退押"))
    from src.core.nhi_card_init_sop import map_hc_basic

    basic = (body or {}).get("basic") if isinstance(body, dict) else None
    desk_sign = (body or {}).get("deskSign") if isinstance(body, dict) else None
    profile = map_hc_basic(basic) if isinstance(basic, dict) else None
    if not profile:
        raise HTTPException(status_code=422, detail="NEED_DESK_SIGN")
    card_id = str(profile.get("idNo") or "")
    if not card_matches(str(prepared.get("idNo") or ""), card_id):
        raise HTTPException(status_code=422, detail="\u63d2\u5361\u8eab\u5206\u8b49\u8207\u9019\u7b46\u62bc\u55ae\u4e0d\u7b26\uff0c\u672a\u53d6\u865f\u3001\u672a\u9000\u62bc\u3002")
    result = request_visit_number(ic_exception="ic", desk_sign=desk_sign if isinstance(desk_sign, dict) else None)
    if not result.ok or not (result.sequenceNumber or "").strip():
        raise HTTPException(status_code=422, detail=result.reason or "沒有取到就醫序號，沒有退押。")
    got = str(result.hcIdNo or card_id)
    if not card_matches(str(prepared.get("idNo") or ""), got):
        raise HTTPException(status_code=422, detail="插卡身分證與這筆押單不符，未退押。")
    applied = apply_refund(
        store,
        get_fhir_repository(),
        encounter_id,
        sequence_number=str(result.sequenceNumber or ""),
        treatment_number=str(result.treatmentNumber or ""),
        treat_date_time=str(result.treatmentDateTime or ""),
        signature=str(result.signature or ""),
        sam_id=str(result.samId or ""),
        hc_id=str(result.hcId or profile.get("cardId") or ""),
        hc_id_no=got,
    )
    if not applied.get("ok"):
        raise HTTPException(status_code=422, detail=str(applied.get("reason") or "沒有退押"))
    return applied


class NhiCancelRegisterRequest(BaseModel):
    encounterId: str
    mode: str  # local | ic | both
    consoleBase: str = "https://localhost:5066"
    deskSign: dict[str, Any] | None = None


def _cancel_local_encounter(store: SqliteShadowStore, encounter_id: str) -> dict[str, Any]:
    """掛號取消＝Encounter cancelled，禁止 DELETE 病歷／Media。"""
    from src.api.routers.encounter import _attach_queue_meta
    from src.core.encounter_queue import fhir_status_from_queue

    repo = get_fhir_repository()
    existing = repo.read_resource("Encounter", encounter_id)
    if existing is None:
        raise HTTPException(status_code=404, detail=f"Encounter/{encounter_id} 不存在")
    queue_number = 0
    for ext in existing.get("extension") or []:
        if ext.get("url") == "https://wundadi.tw/fhir/StructureDefinition/encounter-queue":
            for sub in ext.get("extension") or []:
                if sub.get("url") == "queueNumber":
                    queue_number = int(sub.get("valueInteger") or 0)
    payload = dict(existing)
    payload["status"] = fhir_status_from_queue("cancelled")
    payload["reasonCode"] = []
    _attach_queue_meta(payload, queue_number, "cancelled")
    store.update_encounter_queue_status(encounter_id, "cancelled", "cancelled")
    return repo.update_resource("Encounter", encounter_id, payload)


@router.post(
    "/v1/encounter/cancel",
    summary="刪除掛號（本機 cancelled；退 IC 走 SequelNumber/Rollback）",
)
def cancel_register(body: NhiCancelRegisterRequest) -> dict[str, Any]:
    mode = (body.mode or "").strip().lower()
    if mode not in {"local", "ic", "both"}:
        raise HTTPException(status_code=422, detail="mode 必須是 local（刪除）、ic（退IC）、both（刪除+退IC）")

    store = _store()
    encounter = store.get_cached_resource("Encounter", body.encounterId)
    if encounter is None:
        raise HTTPException(status_code=404, detail=f"Encounter/{body.encounterId} 不存在")

    reg = extract_reg_meta(encounter)
    subject = encounter.get("subject") or {}
    ref = str(subject.get("reference") or "")
    patient_id = ref.split("/")[-1] if ref else ""
    expected_id = store.get_patient_id_no(patient_id) if patient_id else None
    treat_dt = str(reg.get("treatDateTime") or "")
    paper = bool(reg.get("paperCard"))
    seq = str(reg.get("treatSeq") or "")

    ic_ok = False
    ic_reason = ""
    if mode in {"ic", "both"}:
        if paper or not treat_dt:
            ic_reason = (
                "本筆沒有就醫序號／就診時間（可能是紙卡或當初未取號），無法退 IC。"
                "若只要清清單，請改選「刪除」。"
            )
            if mode == "ic":
                raise HTTPException(status_code=422, detail=ic_reason)
            raise HTTPException(
                status_code=422,
                detail=ic_reason + " 未刪本機掛號。",
            )
        result = request_seq_rollback(
            treatment_date_time=treat_dt,
            expected_id_no=expected_id,
            console_base=body.consoleBase,
            desk_sign=body.deskSign,
        )
        ic_ok = result.ok
        ic_reason = result.reason
        if not result.ok:
            raise HTTPException(status_code=422, detail=ic_reason)
        if mode == "ic":
            payload = dict(encounter)
            payload = attach_reg_extension(payload, {**reg, "treatSeq": seq, "icRolledBack": "true"})
            get_fhir_repository().update_resource("Encounter", body.encounterId, payload)

    local_ok = False
    if mode in {"local", "both"}:
        _cancel_local_encounter(store, body.encounterId)
        local_ok = True

    return {
        "ok": True,
        "mode": mode,
        "localCancelled": local_ok,
        "icRolledBack": ic_ok,
        "reason": ic_reason or ("已刪本機掛號" if local_ok else ""),
        "encounterId": body.encounterId,
        "hint": "如果此人已經掛兩科以上且之前已退掛 IC，本次不要再選退 IC。",
    }


class NhiBreakTheGlassRequest(BaseModel):
    encounterId: str
    doctorPin: str
    nursePin: str
    reason: str


@router.post(
    "/v1/break-the-glass",
    status_code=200,
    summary="急診緊急破窗授權（雙人插卡聯署防線）",
)
def register_break_the_glass(body: NhiBreakTheGlassRequest) -> dict[str, Any]:
    from pydantic import BaseModel
    store = _store()
    
    # 1. 驗證 Encounter 是否存在
    encounter = store.get_cached_resource("Encounter", body.encounterId)
    if not encounter:
        raise HTTPException(status_code=404, detail="Encounter 不存在")
        
    # 2. 驗證雙 PIN 碼與角色
    with store._connect() as conn:
        doc_role_row = conn.execute(
            "SELECT role, name FROM clinic_staff WHERE pin = ? AND status IN ('在職', 'active')", (body.doctorPin,)
        ).fetchone()
        nurse_role_row = conn.execute(
            "SELECT role, name FROM clinic_staff WHERE pin = ? AND status IN ('在職', 'active')", (body.nursePin,)
        ).fetchone()
        
    if not doc_role_row:
        raise HTTPException(status_code=403, detail="DOCTOR_PIN_INVALID")
    if not nurse_role_row:
        raise HTTPException(status_code=403, detail="NURSE_PIN_INVALID")
        
    doc_role, doc_actual_name = doc_role_row
    nurse_role, nurse_actual_name = nurse_role_row
    
    # 嚴格校驗：doctorPin 的角色必須為 doctor (或含 dr/院長)
    if "doctor" not in doc_role.lower() and "dr" not in doc_role.lower() and "院長" not in doc_role:
        raise HTTPException(status_code=403, detail="DOCTOR_ROLE_REQUIRED")
        
    # nursePin 的角色必須為 nurse (或含 nu/護理)
    if "nurse" not in nurse_role.lower() and "nu" not in nurse_role.lower() and "護理" not in nurse_role:
        raise HTTPException(status_code=403, detail="NURSE_ROLE_REQUIRED")
        
    # 3. 獲取病患 ID
    subject = encounter.get("subject") or {}
    patient_id = (subject.get("reference") or "").split("/")[-1]
    
    # 4. 生成並寫入標準 FHIR AuditEvent
    recorded_time = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    audit_id = f"audit-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{body.encounterId}"
    
    audit_payload = {
        "resourceType": "AuditEvent",
        "id": audit_id,
        "type": {
            "system": "http://terminology.hl7.org/CodeSystem/audit-event-type",
            "code": "rest"
        },
        "action": "E",
        "recorded": recorded_time,
        "outcome": "0",
        "agent": [
            {
                "role": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v3-ParticipationType", "code": "AUT"}]}],
                "name": doc_actual_name,
                "requestor": True
            },
            {
                "role": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v3-ParticipationType", "code": "WIT"}]}],
                "name": nurse_actual_name,
                "requestor": False
            }
        ],
        "source": {
            "observer": {
                "display": "Emergency-VLAN-Gatekeeper"
            }
        },
        "entity": [
            {
                "what": {"reference": f"Patient/{patient_id}"},
                "description": f"Break-The-Glass emergency access. Reason: {body.reason}"
            }
        ]
    }
    
    repo = get_fhir_repository()
    repo.create_resource("AuditEvent", audit_payload)
    
    # 同步寫入陰表（audit_modifications）以利高階審計
    with store._connect() as conn:
        conn.execute(
            """
            INSERT INTO audit_modifications (resource_type, record_id, timestamp, machine_id, changed_fields, operator_identity)
            VALUES (?, ?, datetime('now'), ?, ?, ?)
            """,
            (
                "Encounter",
                f"Encounter/{body.encounterId}",
                "Emergency-Gatekeeper-PC",
                json.dumps({"break_the_glass": {"action": "override", "reason": body.reason}}, ensure_ascii=False),
                f"{doc_actual_name} (醫生) + {nurse_actual_name} (護理師) 雙人聯署"
            )
        )
        
    return {
        "status": "authorized",
        "token": f"emergency-token-{datetime.utcnow().timestamp()}",
        "expiresIn": 900,
        "auditEventId": audit_id,
        "authorizedUsers": [doc_actual_name, nurse_actual_name]
    }
