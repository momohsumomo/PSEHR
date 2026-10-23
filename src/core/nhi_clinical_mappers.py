"""NHI 門診臨床進場 → FHIR 資源。"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from src.api.schemas.common import Reference
from src.api.schemas.condition import ConditionBody
from src.api.schemas.encounter import EncounterBody
from src.api.schemas.medication_request import DosageInstruction, MedicationRequestBody
from src.core.nhi_condition_validators import NhiConditionIntake
from src.core.encounter_extensions import attach_reg_extension
from src.core.nhi_encounter_validators import NhiEncounterIntake
from src.core.nhi_medication_validators import NhiMedicationIntake
from src.core.terminology import extract_terminology_stickers


def extract_condition_stickers(resource: dict[str, Any]) -> dict[str, str | None]:
    return extract_terminology_stickers(resource.get("code"))


def extract_medication_stickers(resource: dict[str, Any]) -> dict[str, str | None]:
    return extract_terminology_stickers(resource.get("medicationCodeableConcept"))


def nhi_condition_to_fhir(intake: NhiConditionIntake, *, patient_id: str) -> dict[str, Any]:
    body = ConditionBody(
        clinicalStatus=None,
        summaryText=intake.summaryText,
        icd10Code=intake.icd10Code,
        snomedCode=intake.snomedCode,
        nhiIcd10Code=intake.nhiIcd10Code,
        subject=Reference(reference=f"Patient/{patient_id}"),
        encounter=Reference(reference=f"Encounter/{intake.encounterId}"),
        recordedDate=date.today().isoformat(),
    )
    data = body.to_fhir_dict()
    if not data.get("clinicalStatus"):
        data["clinicalStatus"] = {
            "coding": [
                {
                    "system": "http://terminology.hl7.org/CodeSystem/condition-clinical",
                    "code": "active",
                }
            ]
        }
    return data


BILLING_EXT_BASE = "https://wundadi.local/fhir/StructureDefinition/medication-billing"
# 醫聖 HISTORY.SELFTYPE / MEMO → 計費註／「註」符號
PAY_MARK_EXT = f"{BILLING_EXT_BASE}/payMark"
MEMO_MARK_EXT = f"{BILLING_EXT_BASE}/memoMark"


def yisheng_selftype_to_pay_mark(selftype: str | int | None) -> str:
    """HISTORY.SELFTYPE → RxPayMark（空白＝健保）。"""
    s = str(selftype or "").strip()
    if s in {"", "0"}:
        return ""
    if s == "1":
        return "自"
    if s == "6":
        # 醫令型態 6 是交付檢驗（檢驗所做）。申報要列出來，點數是 0。
        return "交"
    if s == "4":
        return "申"
    return "自"


def extract_rx_marks(resource: dict[str, Any]) -> tuple[str, str]:
    pay, memo = "", ""
    for ext in resource.get("extension") or []:
        if not isinstance(ext, dict):
            continue
        url = str(ext.get("url") or "")
        if url.endswith("/payMark") or url == PAY_MARK_EXT:
            pay = str(ext.get("valueString") or "")
        elif url.endswith("/memoMark") or url == MEMO_MARK_EXT:
            memo = str(ext.get("valueString") or "")
    return pay, memo


def nhi_medication_to_fhir(
    intake: NhiMedicationIntake,
    *,
    patient_id: str,
    target_date: str | None = None,
    resolved_unit_price: float | None = None,
    pack_version: str | None = None,
) -> dict[str, Any]:
    from src.claims.yisheng_rules import is_order_code

    sig = (intake.sig or "").strip()
    if not sig and not is_order_code(intake.nhiCode or ""):
        sig = "\u4f9d\u91ab\u56d1"
    days = int(intake.daysSupply or 1)
    qty = float(intake.quantity if intake.quantity is not None else 1)
    unit_price = intake.unitPrice if intake.unitPrice is not None else resolved_unit_price

    body = MedicationRequestBody(
        status="active",
        drugText=intake.drugText,
        nhiCode=intake.nhiCode,
        rxnormCode=intake.rxnormCode,
        subject=Reference(reference=f"Patient/{patient_id}"),
        encounter=Reference(reference=f"Encounter/{intake.encounterId}"),
        dosageInstruction=[DosageInstruction(text=sig)],
    )
    data = body.to_fhir_dict()
    data["dispenseRequest"] = {
        "quantity": {"value": qty},
        "expectedSupplyDuration": {
            "value": days,
            "unit": "d",
            "system": "http://unitsofmeasure.org",
            "code": "d",
        },
    }
    extensions: list[dict[str, Any]] = [
        {"url": f"{BILLING_EXT_BASE}/daysSupply", "valueInteger": days},
        {"url": f"{BILLING_EXT_BASE}/quantity", "valueDecimal": qty},
    ]
    if unit_price is not None:
        extensions.append(
            {"url": f"{BILLING_EXT_BASE}/unitPrice", "valueDecimal": float(unit_price)}
        )
    if pack_version:
        extensions.append(
            {"url": f"{BILLING_EXT_BASE}/packVersion", "valueString": str(pack_version)}
        )
    if target_date:
        extensions.append(
            {
                "url": f"{BILLING_EXT_BASE}/priceDate",
                "valueDate": str(target_date)[:10],
            }
        )
    if intake.bodySite is not None:
        extensions.append(
            {"url": f"{BILLING_EXT_BASE}/bodySite", "valueString": intake.bodySite.strip()}
        )
    if getattr(intake, "tradeName", None) is not None:
        extensions.append(
            {"url": f"{BILLING_EXT_BASE}/tradeName", "valueString": str(intake.tradeName).strip()}
        )
    if intake.payMark is not None:
        extensions.append({"url": PAY_MARK_EXT, "valueString": intake.payMark.strip()})
    if intake.memo is not None:
        extensions.append({"url": MEMO_MARK_EXT, "valueString": intake.memo.strip()})
    data["extension"] = extensions
    return data


def nhi_encounter_to_fhir(intake: NhiEncounterIntake) -> dict[str, Any]:
    enc_date = date.fromisoformat(intake.encounterDate) if intake.encounterDate else date.today()
    body = EncounterBody(
        status="arrived",
        subject=Reference(reference=f"Patient/{intake.patientId}"),
        encounterDate=enc_date,
        queueStatus=intake.queueStatus,
    )
    data = body.to_fhir_dict()
    if intake.reasonText:
        data["reasonCode"] = [{"text": intake.reasonText}]
    if not data.get("period"):
        if intake.encounterDate:
            # 用指定的就醫日加上目前時間
            curr_time_str = datetime.now().time().isoformat(timespec="seconds")
            data["period"] = {"start": f"{intake.encounterDate}T{curr_time_str}"}
        else:
            data["period"] = {"start": datetime.now().astimezone().isoformat(timespec="seconds")}
    data = attach_reg_extension(
        data,
        {
            "caseNo": intake.caseNo,
            "copayCode": intake.copayCode,
            "dispense": intake.dispense,
            "treatSeq": intake.treatSeq,
            "treatmentNumber": intake.treatmentNumber,
            "treatDateTime": intake.treatDateTime,
            "securitySign": intake.securitySign,
            "samId": intake.samId,
            "room": intake.room,
            "shift": intake.shift,
            "afterCheck": intake.afterCheck,
            "treatmentItem": intake.treatmentItem,
            "hcId": intake.hcId,
            "hcIdNo": intake.hcIdNo,
            "paperCard": intake.paperCard,
            "icException": intake.icException,
            "noCardReason": intake.noCardReason,
            "pharmacist": intake.pharmacist,
            "doctorId": intake.doctorId,
            "doctorName": intake.doctorName,
            "payType": intake.payType,
            "regFee": intake.regFee,
            "copayAmt": intake.copayAmt,
            "deposit": intake.deposit,
            "consultFee": intake.consultFee,
            "drugFee": intake.drugFee,
            "materialFee": intake.materialFee,
            "burdenFee": intake.burdenFee,
            "drugCopay": intake.drugCopay,
            "cardIdentity": intake.cardIdentity,
            "totalFee": getattr(intake, "totalFee", None),
            "selfPay": intake.selfPay,
            "referralSeq": intake.referralSeq,
            "referralHospId": intake.referralHospId,
            "referralHospName": intake.referralHospName,
            "referralDate": intake.referralDate,
            "acceptReferral": intake.acceptReferral,
            "prebook": intake.prebook,
        },
    )
    return data
