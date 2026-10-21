"""從影子庫組月申報摘要。診察費用該月當時的合理量，藥費用就醫日的藥價期。"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from src.spoke.drug_price import lookup_drug_price

# 門診診察費暫時常數；日後可由 Pack／院所設定取代
DEFAULT_CONSULTATION_POINTS = 250.0


@dataclass
class ClaimMedLine:
    medicationRequestId: str
    nhiCode: str
    drugText: str
    daysSupply: int
    quantity: float
    unitPrice: float | None
    linePoints: float
    priceSource: str  # snapshot | pack_lookup | missing
    useage: str = ""
    doseEach: float | None = None
    routeCode: str = ""
    ratePercent: float = 100.0
    # False: case-01 daily-fee drug. Filed as order category 4, price and points 0.
    billable: bool = True


@dataclass
class ClaimEncounterRecord:
    encounterId: str
    queueNumber: int | None
    patientId: str
    patientName: str
    diagnoses: str
    consultationPoints: float
    drugPoints: float
    totalPoints: float
    medications: list[ClaimMedLine] = field(default_factory=list)
    doctorId: str = ""
    doctorName: str = ""
    pharmacist: str = ""
    pharmacistId: str = ""
    birthDate: str = ""
    birthdayRoc: str = ""
    sex: str = ""
    encounterDate: str = ""
    caseNo: str = "01"
    treatSeq: str = ""
    copayCode: str = ""
    copayPoints: float = 0.0
    dispense: str = ""
    diagnosisCodes: list[str] = field(default_factory=list)
    caseReason: str = ""
    consultCode: str = ""
    consultBase: float = 0.0
    consultRate: float = 100.0
    pharmacyCode: str = ""
    pharmacyPoints: float = 0.0
    pharmacyBase: float = 0.0
    pharmacyRate: float = 100.0
    treatmentPoints: float = 0.0
    applyPoints: float = 0.0
    daysSupply: int = 0
    claimNotes: list[str] = field(default_factory=list)
    claimable: bool = True
    treatmentId: str = ""
    # 基層西醫基本部分負擔點數。本院醫聖月檔每一筆都是 50，免部分負擔時 d40 仍為 0。
    basicCopayPoints: int = 50
    drugCopayPoints: int = 0
    medicalNo: str = ""
    # 影子庫病人編號。調閱病歷用這個找人，不拿身分證去當病人編號。
    chartPatientId: str = ""


@dataclass
class ClaimsSummary:
    yearMonth: str
    yearMonthRoc: str
    finishedEncounters: int
    totalConsultationPoints: float
    totalDrugPoints: float
    totalPoints: float
    totalPharmacyPoints: float = 0.0
    totalTreatmentPoints: float = 0.0
    records: list[ClaimEncounterRecord] = field(default_factory=list)
    packNote: str = "藥費依就醫日的藥價期；目錄沒有該期才用病歷上的單價"

    def to_statistics_dict(self) -> dict[str, Any]:
        return {
            "yearMonth": self.yearMonthRoc,
            "finishedEncounters": self.finishedEncounters,
            "totalConsultationPoints": int(round(self.totalConsultationPoints)),
            "totalDrugPoints": int(round(self.totalDrugPoints)),
            "totalPharmacyPoints": int(round(self.totalPharmacyPoints)),
            "totalTreatmentPoints": int(round(self.totalTreatmentPoints)),
            "totalPoints": int(round(self.totalPoints)),
            "pricing": {
                "consultationPerEncounter": DEFAULT_CONSULTATION_POINTS,
                "drugFormula": "unitPrice × quantity（缺價則 0）",
                "note": self.packNote,
            },
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            **self.to_statistics_dict(),
            "records": [asdict(r) for r in self.records],
        }


def _ym_to_roc(date_month: str) -> str:
    if "-" in date_month:
        y, m = date_month.split("-")[:2]
        return f"{int(y) - 1911}{m}"
    return date_month


def _extract_med_billing(resource: dict[str, Any], index_meta: dict[str, Any] | None) -> dict[str, Any]:
    meta = index_meta or {}
    days = meta.get("daysSupply")
    qty = meta.get("quantity")
    price = meta.get("unitPrice")

    dispense = resource.get("dispenseRequest") or {}
    if days is None:
        dur = dispense.get("expectedSupplyDuration") or {}
        if dur.get("value") is not None:
            days = int(float(dur["value"]))
    if qty is None:
        q = dispense.get("quantity") or {}
        if q.get("value") is not None:
            qty = float(q["value"])

    pack_version = meta.get("packVersion")
    for ext in resource.get("extension") or []:
        if not isinstance(ext, dict):
            continue
        url = str(ext.get("url") or "")
        if url.endswith("/unitPrice") and price is None and ext.get("valueDecimal") is not None:
            price = float(ext["valueDecimal"])
        if url.endswith("/daysSupply") and days is None and ext.get("valueInteger") is not None:
            days = int(ext["valueInteger"])
        if url.endswith("/quantity") and qty is None and ext.get("valueDecimal") is not None:
            qty = float(ext["valueDecimal"])
        if url.endswith("/packVersion") and not pack_version and ext.get("valueString"):
            pack_version = str(ext["valueString"])

    return {
        "daysSupply": int(days) if days is not None else 1,
        "quantity": float(qty) if qty is not None else 1.0,
        "unitPrice": float(price) if price is not None else None,
        "packVersion": pack_version,
    }


def _put_usage(usages: dict[str, tuple[float, str]], row: dict, *, replace: bool = False) -> None:
    code = str(row.get("code") or row.get("USEAGE") or "").strip()
    if not code:
        return
    if code in usages and not replace:
        return
    raw_freq = row.get("frequency")
    if raw_freq in (None, ""):
        raw_freq = row.get("FREQUENCY") or 0
    try:
        freq = float(raw_freq or 0)
    except (TypeError, ValueError):
        freq = 0.0
    mode = row.get("isTotal")
    if mode in (None, ""):
        mode = row.get("ISTOTAL") or ""
    usages[code] = (freq, str(mode))


def _live_usage_rows() -> list[dict[str, str]]:
    path = Path(r"Z:\SC\dat\USEAGE.Dat")
    if not path.is_file():
        return []
    try:
        from scripts.backfill_cash_book import _iter_fields
    except Exception:
        return []
    return list(_iter_fields(path, ("USEAGE", "ISTOTAL", "FREQUENCY")))


def _route_from(use_type: str, nhi_code: str, routes: dict[str, str]) -> str:
    direct = _CLAIM_ROUTES.get((use_type or "").strip().lower())
    if direct:
        return direct
    return routes.get((nhi_code or "").strip().upper(), "")


def _billed_quantity(
    *,
    raw_qty: float,
    qty_known: bool,
    days: int,
    sig: str,
    nhi_code: str,
    usages: dict[str, tuple[float, str]],
    total_qty: float | None = None,
) -> tuple[float | None, float]:
    """Grid qty is a dose when the usage says so. Claim p10 is the total.

    isTotal 3 (bid/pc): the package total does not follow the dose.
    With no stored total, file 1.
    """
    from src.claims.yisheng_rules import is_order_code

    total = float(raw_qty or 0) or 1.0
    if is_order_code(nhi_code) or not qty_known:
        return None, total
    hit = usages.get((sig or "").strip())
    if not hit:
        return None, total
    freq, mode = hit
    day_n = int(days or 0)
    if mode == "3" and freq <= 0:
        if total_qty is not None and float(total_qty) > 0:
            billed = float(total_qty)
        else:
            billed = 1.0
        dose = round(float(raw_qty), 2) if qty_known else None
        return dose, billed
    if mode in {"1", "2"} and freq > 0 and day_n > 0:
        return round(float(raw_qty), 2), round(float(raw_qty) * freq * day_n, 2)
    if mode == "0":
        dose = round(total / (freq * day_n), 2) if freq > 0 and day_n > 0 else None
        return dose, total
    return None, total


def _catalog_lookup(store: Any) -> tuple[dict[str, tuple[float, str]], dict[str, str]]:
    usages, routes = _shipped_catalog()
    usages = dict(usages)
    raw: Any = {}
    try:
        raw = store.get_json_setting("clinic_catalog_overrides_v1") or {}
    except Exception:
        raw = {}
    if isinstance(raw, dict):
        for row in raw.get("usages") or []:
            if not isinstance(row, dict):
                continue
            code = str(row.get("code") or "").strip()
            if not code:
                continue
            try:
                freq = float(row.get("frequency") or 0)
            except (TypeError, ValueError):
                freq = 0.0
            usages[code] = (freq, str(row.get("isTotal") or ""))
    return usages, routes


_CLAIM_ROUTES = {
    "2": "PO",
    "1": "TOPI",
    "po": "PO",
    "ext": "TOPI",
    "skin": "TOPI",
    "im": "IM",
    "iv": "IV",
    "ivd": "IV",
    "ivp": "IV",
    "sc": "SC",
    "rect": "RECT",
    "inhl": "INHL",
    "sl": "SL",
}


@lru_cache(maxsize=1)
def _shipped_catalog() -> tuple[dict[str, tuple[float, str]], dict[str, str]]:
    usages: dict[str, tuple[float, str]] = {}
    routes: dict[str, str] = {}
    path = Path(__file__).resolve().parents[2] / "frontend" / "public" / "yisheng_clinic_catalog.json"
    if not path.is_file():
        return usages, routes
    data = json.loads(path.read_text(encoding="utf-8"))
    for row in data.get("usages") or []:
        _put_usage(usages, row)
    for row in _live_usage_rows():
        _put_usage(usages, row, replace=True)
    for row in data.get("drugs") or []:
        if not isinstance(row, dict):
            continue
        code = str(row.get("nhiCode") or "").strip().upper()
        route = _CLAIM_ROUTES.get(str(row.get("route") or "").strip().lower())
        if code and route and code not in routes:
            routes[code] = route
    return usages, routes


def build_claims_summary(
    store: Any,
    date_month: str,
    *,
    consultation_points: float | None = None,
) -> ClaimsSummary:
    """date_month: YYYY-MM"""
    default_consult = DEFAULT_CONSULTATION_POINTS
    if consultation_points is None:
        try:
            from src.api.routers.clinic_settings import PROFILE_KEY, DEFAULT_PROFILE

            saved = store.get_json_setting(PROFILE_KEY) or {}
            fees = (saved.get("fees") if isinstance(saved, dict) else None) or {}
            raw = fees.get("consultFeeDefault")
            if raw is None:
                raw = DEFAULT_PROFILE["fees"]["consultFeeDefault"]
            default_consult = float(raw)
        except Exception:
            default_consult = DEFAULT_CONSULTATION_POINTS
    else:
        default_consult = float(consultation_points)

    with store._connect() as conn:
        rows = conn.execute(
            """
            SELECT
                ei.resource_id,
                ei.patient_id,
                pi.family_name,
                pi.given_name,
                pi.medical_no,
                pi.identifier,
                ei.queue_number,
                ei.encounter_date,
                pi.birth_date,
                pi.birthday_roc,
                pi.sex,
                pi.id_no,
                ei.claim_doctor_id,
                ei.claim_pharmacist_id,
                ei.treat_seq
            FROM encounter_index ei
            LEFT JOIN patient_index pi ON pi.resource_id = ei.patient_id
            WHERE ei.encounter_date LIKE ? AND ei.queue_status = 'finished'
            ORDER BY ei.queue_number ASC
            """,
            (f"{date_month}%",),
        ).fetchall()

    from src.core.encounter_extensions import extract_reg_meta

    staff_by_id, staff_by_name = _load_staff_maps(store)
    dispense_default = _clinic_dispense_code(store)

    records: list[ClaimEncounterRecord] = []

    for row in rows:
        encounter_id = row[0]
        patient_id = row[1]
        family, given = row[2], row[3]
        medical_no, identifier = row[4], row[5]
        q_num, enc_date = row[6], row[7]
        birth_date, birthday_roc, sex, id_no_col = row[8], row[9], row[10], row[11]
        claim_doctor, claim_pharm, claim_seq = row[12], row[13], row[14]
        patient_name = f"{family or ''}{given or ''}".strip() or "無姓名"
        patient_ref = id_no_col or identifier or medical_no or patient_id
        _ = patient_id

        enc_res = store.read_resource("Encounter", encounter_id) if hasattr(store, "read_resource") else None
        if enc_res is None and hasattr(store, "get_resource"):
            enc_res = store.get_resource("Encounter", encounter_id)
        # shadow store uses resource_cache via get?
        if enc_res is None:
            try:
                with store._connect() as conn:
                    r = conn.execute(
                        "SELECT payload_json FROM resource_cache WHERE resource_type=? AND resource_id=?",
                        ("Encounter", encounter_id),
                    ).fetchone()
                    if r and r[0]:
                        enc_res = json.loads(r[0]) if isinstance(r[0], str) else r[0]
            except Exception:
                enc_res = None
        reg = extract_reg_meta(enc_res or {})
        consult = default_consult
        if reg.get("consultFee"):
            try:
                consult = float(str(reg["consultFee"]).replace(",", ""))
            except Exception:
                pass

        conditions = store.list_conditions(encounter_id=encounter_id)
        diag_codes = [
            c["indexMeta"]["icd10Code"]
            for c in conditions
            if (c.get("indexMeta") or {}).get("icd10Code")
        ]
        if not diag_codes:
            diag_codes = [
                c["indexMeta"]["nhiIcd10Code"]
                for c in conditions
                if (c.get("indexMeta") or {}).get("nhiIcd10Code")
            ]
        diag_str = ",".join(str(x) for x in diag_codes if x)
        diag_list = [str(x).strip() for x in diag_codes if x]

        doctor_raw = str(reg.get("doctorId") or claim_doctor or "")
        doctor_nhi = _resolve_staff_nhi(doctor_raw, staff_by_id, staff_by_name)
        pharmacist_raw = str(reg.get("pharmacist") or claim_pharm or "")
        pharmacist_nhi = _resolve_staff_nhi(pharmacist_raw, staff_by_id, staff_by_name)

        case_no = str(reg.get("caseNo") or "01")
        treat_seq = str(reg.get("treatSeq") or claim_seq or "")
        treatment_id = str(reg.get("treatmentNumber") or "").strip()
        if len(treatment_id) != 20:
            treatment_id = ""
        copay_code = str(reg.get("copayCode") or "")
        copay_pts = 0.0
        if reg.get("copayAmt"):
            try:
                copay_pts = float(str(reg["copayAmt"]).replace(",", ""))
            except Exception:
                copay_pts = 0.0
        paid_copay = int(round(copay_pts))
        drug_copay = paid_copay - 50 if paid_copay > 50 else 0
        dispense = str(reg.get("dispense") or dispense_default or "")
        # 申報就醫日用掛號看診日。醫聖 O_DATE 有時是慢箋原處方日，和這次看診日不同。
        visit_day = str(enc_date or date_month)[:10]

        from src.claims.yisheng_rules import half_up_points, is_order_code

        med_requests = store.list_medication_requests(encounter_id=encounter_id)
        med_lines: list[ClaimMedLine] = []
        drug_points = 0.0
        usages, routes = _catalog_lookup(store)

        for m in med_requests:
            resource = m.get("resource") or {}
            meta = m.get("indexMeta") or {}
            billing = _extract_med_billing(resource, meta)
            nhi_code = str(meta.get("nhiCode") or "").strip()
            if not nhi_code:
                continue
            drug_text = str(meta.get("drugText") or "")
            unit_price = billing["unitPrice"]
            price_source = "snapshot" if unit_price is not None else "missing"

            # Drug lines use the price period that covers the visit day.
            # A later chart snapshot must not reprice an old month.
            if nhi_code and not is_order_code(nhi_code):
                looked = lookup_drug_price(nhi_code, visit_day)
                if looked:
                    unit_price = float(looked["unitPrice"])
                    price_source = "pack_history"
            elif unit_price is None and nhi_code:
                looked = lookup_drug_price(nhi_code, visit_day)
                if looked:
                    unit_price = float(looked["unitPrice"])
                    price_source = "pack_lookup"

            pay_mark = str(meta.get("payMark") or "").strip()
            if pay_mark == "\u81ea":
                continue
            # 交付檢驗、轉檢、不另計價：醫令留在檔裡，點數是 0。
            # 舊匯入把型態 6 寫成「材」，那一欄其實是交付檢驗。
            clinic_does_not_bill = pay_mark in {"\u4ea4", "\u8f49", "\u4e0d", "\u6750"}
            qty = billing["quantity"]
            sig = str(meta.get("useage") or "").strip()
            stored_total = meta.get("totalQty")
            try:
                stored_total_n = float(stored_total) if stored_total is not None else None
            except (TypeError, ValueError):
                stored_total_n = None
            # Mode 1 multiplies dose x frequency x days. Mode 3 (bid/pc) files the package total.
            dose_each, billed_qty = _billed_quantity(
                raw_qty=qty,
                qty_known=meta.get("quantity") is not None,
                days=billing["daysSupply"],
                sig=sig,
                nhi_code=nhi_code,
                usages=usages,
                total_qty=stored_total_n,
            )
            line_pts = float(unit_price or 0) * float(billed_qty)
            # p12 is an integer: qty x unit x rate, half-up. The visit total is the sum of those integers.
            filed_pts = 0.0 if clinic_does_not_bill else float(half_up_points(line_pts))
            drug_points += filed_pts
            med_lines.append(
                ClaimMedLine(
                    medicationRequestId=str(resource.get("id") or meta.get("resourceId") or ""),
                    nhiCode=nhi_code,
                    drugText=drug_text,
                    daysSupply=billing["daysSupply"],
                    quantity=billed_qty,
                    unitPrice=unit_price,
                    linePoints=filed_pts,
                    priceSource=price_source,
                    useage=sig,
                    doseEach=dose_each,
                    routeCode=""
                    if is_order_code(nhi_code)
                    else _route_from(str(meta.get("useType") or ""), nhi_code, routes),
                )
            )

        records.append(
            ClaimEncounterRecord(
                encounterId=encounter_id,
                queueNumber=q_num,
                patientId=str(patient_ref),
                patientName=patient_name,
                medicalNo=str(medical_no or ""),
                chartPatientId=str(patient_id or ""),
                diagnoses=diag_str,
                consultationPoints=consult,
                drugPoints=round(drug_points, 2),
                totalPoints=round(consult + drug_points, 2),
                medications=med_lines,
                doctorId=doctor_nhi or doctor_raw,
                doctorName=str(reg.get("doctorName") or ""),
                pharmacist=pharmacist_raw,
                pharmacistId=pharmacist_nhi,
                birthDate=str(birth_date or ""),
                birthdayRoc=str(birthday_roc or ""),
                sex=str(sex or ""),
                encounterDate=visit_day,
                caseNo=case_no,
                treatSeq=treat_seq,
                copayCode=copay_code,
                copayPoints=copay_pts,
                dispense=dispense,
                diagnosisCodes=diag_list,
                treatmentId=treatment_id,
                drugCopayPoints=drug_copay,
            )
        )

    _price_claims(records)
    claimable = [r for r in records if r.claimable]
    total_consult = round(sum(r.consultationPoints for r in claimable), 2)
    total_drug = round(sum(r.drugPoints for r in claimable), 2)
    total_pharm = round(sum(float(r.pharmacyPoints or 0) for r in claimable), 2)
    total_tx = round(sum(float(r.treatmentPoints or 0) for r in claimable), 2)
    total_points = round(total_consult + total_drug + total_pharm + total_tx, 2)

    return ClaimsSummary(
        yearMonth=date_month,
        yearMonthRoc=_ym_to_roc(date_month),
        finishedEncounters=len(claimable),
        totalConsultationPoints=total_consult,
        totalDrugPoints=total_drug,
        totalPharmacyPoints=total_pharm,
        totalTreatmentPoints=total_tx,
        totalPoints=total_points,
        records=records,
    )


def _price_claims(records: list[ClaimEncounterRecord]) -> None:
    """Fill case, consult code, and pharmacy fee. Chart text is left as stored."""
    from src.claims.case_rules import assign_case, claim_case_rules, is_chronic_dx
    from src.claims.yisheng_rules import (
        apply_daily_drug_fee,
        child_addon_points,
        child_rate_percent,
        claim_supply_days,
        daily_drug_fee,
        half_up_points,
        is_order_code,
        pharmacy_for,
        pharmacy_supply_days,
        shorter_flat_days,
        visit_notes,
    )

    ordered = sorted(
        records,
        key=lambda r: (r.encounterDate or "", r.queueNumber or 0, r.encounterId),
    )
    active_rules = claim_case_rules()
    clinic_rules = active_rules.clinic
    for rec in ordered:
        drug_lines = [m for m in rec.medications if not is_order_code(m.nhiCode)]
        order_lines = [m for m in rec.medications if is_order_code(m.nhiCode)]
        for med in order_lines:
            if float(med.linePoints or 0) <= 0:
                continue
            addon = child_addon_points(
                med.nhiCode,
                float(med.unitPrice or 0),
                float(med.quantity or 0),
                rec.birthDate,
                rec.encounterDate,
            )
            if addon is None:
                continue
            percent, points = addon
            med.ratePercent = float(percent)
            med.linePoints = float(points)
        days = claim_supply_days(drug_lines)
        ph_days = pharmacy_supply_days(drug_lines) or days
        itemized_drug = round(sum(float(m.linePoints or 0) for m in drug_lines), 2)
        priced_order = any(float(m.linePoints or 0) > 0 for m in order_lines)
        flat_days = shorter_flat_days(drug_lines)
        if (
            (rec.caseNo or "").strip() == "01"
            and not priced_order
            and flat_days
            and flat_days < days
        ):
            preview = daily_drug_fee(flat_days)
            if preview and preview[2] > itemized_drug:
                days = flat_days
                ph_days = flat_days
        tx_pts = round(sum(float(m.linePoints or 0) for m in order_lines), 2)
        chronic = is_chronic_dx(rec.diagnosisCodes)
        self_pay = (rec.caseNo or "").strip().upper() in {"9X", "\u81ea\u8cbb"}
        case, reason = assign_case(
            stored=rec.caseNo,
            days=days,
            dispense=rec.dispense,
            diagnosis_codes=rec.diagnosisCodes,
            order_codes=[m.nhiCode for m in order_lines],
            self_pay=self_pay,
            rules=active_rules,
        )
        rec.caseNo = case
        rec.caseReason = reason
        if (
            case == "01"
            and clinic_rules.project_drug_floor > 0
            and 3 < days < 7
            and itemized_drug < clinic_rules.project_drug_floor
        ):
            case = "09"
            rec.caseNo = case
            rec.caseReason = (
                "\u9662\u6240\u8a2d\u5b9a\uff1a\u7d66\u85e5 4 \u5230 6 \u5929\u4e14\u85e5\u8cbb\u4f4e\u65bc\u5c08\u6848\u5e95\u9650\uff0c\u6539\u5831 09"
            )
        rec.claimable = case != "9X"
        empty_shell = (
            rec.claimable
            and not (rec.doctorId or "").strip()
            and not (rec.treatSeq or "").strip()
            and not rec.medications
        )
        if empty_shell:
            rec.claimable = False
            rec.caseReason = "\u6c92\u6709\u91ab\u5e2b\u3001\u5c31\u91ab\u5e8f\u865f\u3001\u8a3a\u65b7\u4e5f\u6c92\u6709\u85e5\uff0c\u4e0d\u9032\u6708\u7533\u5831"
        rec.daysSupply = ph_days
        drug_pts = apply_daily_drug_fee(rec, days=days, case=case)
        rec.drugPoints = drug_pts
        rec.treatmentPoints = tx_pts
        if not rec.claimable:
            rec.consultationPoints = 0.0
        ph_code, ph_base = pharmacy_for(ph_days, rec.dispense)
        if not rec.claimable:
            ph_code, ph_base = "", 0
        rate = child_rate_percent(rec.birthDate, rec.encounterDate) if ph_base else 100
        rec.pharmacyCode = ph_code
        rec.pharmacyBase = float(ph_base)
        rec.pharmacyRate = float(rate)
        rec.pharmacyPoints = float(half_up_points(ph_base * rate / 100.0)) if ph_base else 0.0
        rec.totalPoints = round(
            float(rec.consultationPoints) + float(rec.pharmacyPoints) + drug_pts + tx_pts,
            2,
        )
        rec.applyPoints = round(max(rec.totalPoints - float(rec.copayPoints or 0), 0), 2)
        notes = visit_notes(days=days, chronic=chronic, drug_points=drug_pts, case=case)
        if rec.claimable and not rec.diagnosisCodes:
            notes.append("\u7f3a\u4e3b\u8a3a\u65b7")
        if rec.claimable and float(rec.copayPoints or 0) <= 0 and not (rec.copayCode or "").strip():
            notes.append("\u90e8\u5206\u8ca0\u64d4\u672a\u586b\uff0c\u7533\u8acb\u9ede\u5148\u4e0d\u6263\u8ca0\u64d4")
        rec.claimNotes = notes
    _apply_consult_volume(ordered)
    _apply_pharmacy_day_cap(ordered)


def _apply_consult_volume(records: list[ClaimEncounterRecord]) -> None:
    """One monthly pool per doctor. Under 6 and 75+ take 00110C first."""
    from src.claims.yisheng_rules import age_years, consult_at, is_referral_in

    groups: dict[str, list[ClaimEncounterRecord]] = {}
    for rec in records:
        if not rec.claimable or rec.caseNo not in {"01", "04", "09"}:
            continue
        groups.setdefault(rec.doctorId or "_", []).append(rec)
    for group in groups.values():
        days = len({(rec.encounterDate or "")[:10] for rec in group})
        # A visit that accepts a referral is paid at the first band and
        # does not take one of this month's quota slots.
        exempt = [
            rec for rec in group
            if is_referral_in([med.nhiCode for med in rec.medications])
        ]
        pool = [rec for rec in group if rec not in exempt]

        def sort_key(rec: ClaimEncounterRecord) -> tuple:
            age = age_years(rec.birthDate, rec.encounterDate)
            protected = age is not None and (age < 6 or age >= 75)
            return (
                0 if protected else 1,
                rec.encounterDate or "",
                rec.queueNumber or 0,
                rec.encounterId,
            )

        def assign(rec: ClaimEncounterRecord, index: int) -> None:
            age = age_years(rec.birthDate, rec.encounterDate)
            code, pts, base, rate = consult_at(index, days, age, rec.encounterDate)
            rec.consultCode = code
            rec.consultBase = float(base)
            rec.consultRate = rate
            rec.consultationPoints = float(pts)
            rec.totalPoints = round(
                float(pts) + float(rec.pharmacyPoints) + float(rec.drugPoints) + float(rec.treatmentPoints),
                2,
            )
            rec.applyPoints = round(max(rec.totalPoints - float(rec.copayPoints or 0), 0), 2)

        pool.sort(key=sort_key)
        for index, rec in enumerate(pool, start=1):
            assign(rec, index)
        for rec in exempt:
            assign(rec, 1)


def _apply_pharmacy_day_cap(records: list[ClaimEncounterRecord]) -> None:
    """Same pharmacist-day: 80 full, 81-100 half, then zero.

    The payment standard counts the day's prescriptions. It does not set
    the order, so the higher fees take the full slots.
    """
    from src.claims.yisheng_rules import half_up_points, pharmacy_day_adjustment

    groups: dict[tuple[str, str], list[ClaimEncounterRecord]] = {}
    for rec in records:
        if not rec.claimable or not rec.pharmacyCode:
            continue
        day = (rec.encounterDate or "")[:10]
        groups.setdefault((rec.doctorId or "_", day), []).append(rec)
    for group in groups.values():
        group.sort(
            key=lambda rec: (
                -float(rec.pharmacyPoints or 0),
                rec.queueNumber or 0,
                rec.encounterId,
            )
        )
        for index, rec in enumerate(group, start=1):
            adjusted = pharmacy_day_adjustment(index, int(round(float(rec.pharmacyBase or 0))))
            if adjusted is None:
                continue
            code, halved = adjusted
            rec.pharmacyCode = code
            rec.pharmacyBase = float(halved)
            rate = float(rec.pharmacyRate or 100)
            rec.pharmacyPoints = float(half_up_points(rec.pharmacyBase * rate / 100.0)) if halved else 0.0
            rec.totalPoints = round(
                float(rec.consultationPoints)
                + float(rec.pharmacyPoints)
                + float(rec.drugPoints)
                + float(rec.treatmentPoints),
                2,
            )
            rec.applyPoints = round(max(rec.totalPoints - float(rec.copayPoints or 0), 0), 2)


def _load_staff_maps(store: Any) -> tuple[dict[str, str], dict[str, str]]:
    by_id: dict[str, str] = {}
    by_name: dict[str, str] = {}
    try:
        with store._connect() as conn:
            rows = conn.execute(
                "SELECT id, name, nhi_id FROM clinic_staff WHERE status = '在職'"
            ).fetchall()
        for sid, name, nhi in rows:
            nhi_s = str(nhi or "").strip()
            if not nhi_s:
                continue
            by_id[str(sid)] = nhi_s
            if name:
                by_name[str(name).strip()] = nhi_s
    except Exception:
        pass
    return by_id, by_name


def _resolve_staff_nhi(
    raw: str,
    by_id: dict[str, str],
    by_name: dict[str, str],
) -> str:
    text = (raw or "").strip()
    if not text:
        return ""
    if text in by_id:
        return by_id[text]
    if text in by_name:
        return by_name[text]
    # already looks like personal id / professional id
    return text


def clinic_dept_code(store: Any) -> str:
    return _clinic_dept_code(store)


def clinic_dispense_code(store: Any) -> str:
    return _clinic_dispense_code(store)


def _clinic_dept_code(store: Any) -> str:
    try:
        from src.api.routers.clinic_settings import PROFILE_KEY, DEFAULT_PROFILE

        saved = store.get_json_setting(PROFILE_KEY) or {}
        profile = (saved.get("profile") if isinstance(saved, dict) else None) or {}
        raw = str(profile.get("mainDept") or DEFAULT_PROFILE["profile"]["mainDept"])
        digits = "".join(ch for ch in raw if ch.isdigit())
        return (digits[:2] or "11").zfill(2)
    except Exception:
        return "11"


def _clinic_dispense_code(store: Any) -> str:
    try:
        from src.api.routers.clinic_settings import PROFILE_KEY, DEFAULT_PROFILE

        saved = store.get_json_setting(PROFILE_KEY) or {}
        profile = (saved.get("profile") if isinstance(saved, dict) else None) or {}
        raw = str(profile.get("dispenseType") or DEFAULT_PROFILE["profile"]["dispenseType"])
        digits = "".join(ch for ch in raw if ch.isdigit())
        return (digits[:1] or "0")
    except Exception:
        return "0"
