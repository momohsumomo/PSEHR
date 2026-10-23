"""Care Online booking import. Keeps an existing birthday."""

from __future__ import annotations

import json
import re
import urllib.request
from pathlib import Path
from typing import Any

from src.core.nhi_encounter_validators import NhiEncounterIntake
from src.core.nhi_fhir_mapper import nhi_intake_to_fhir_patient
from src.core.nhi_validators import (
    NhiPatientIntake,
    NhiValidationError,
    validate_roc_birthday7,
    validate_taiwan_id_no,
    validate_taiwan_id_no_format,
)

_TOKEN_FILE = Path(r"Z:\SC\dat\ScPub.ini")
_BOOK_URL = "https://careonline.com.tw/api/Registration/GetBookings?visitingDate="
_UA = "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)"
_CLINIC_EXT = "https://clinic.org/fhir/StructureDefinition/patient-clinic-ext"


def _token() -> str:
    if not _TOKEN_FILE.is_file():
        raise FileNotFoundError("missing ScPub.ini care-online token")
    text = _TOKEN_FILE.read_bytes().decode("cp950", errors="replace")
    for line in text.splitlines():
        if "=" not in line:
            continue
        value = line.split("=", 1)[1].strip()
        if value.startswith("eyJ"):
            return value
    raise FileNotFoundError("ScPub.ini has no care-online token")


def fetch_bookings(visiting_date: str) -> list[dict[str, Any]]:
    url = _BOOK_URL + visiting_date
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": "Bearer " + _token(),
            "Accept": "application/json",
            "User-Agent": _UA,
        },
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    return []


def _roc7(iso_birth: str) -> str | None:
    text = (iso_birth or "").strip()[:10]
    parts = text.split("-")
    if len(parts) != 3:
        return None
    try:
        year, month, day = int(parts[0]), int(parts[1]), int(parts[2])
    except ValueError:
        return None
    if year < 1912 or not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    return f"{year - 1911:03d}{month:02d}{day:02d}"


def _sex(raw: str, id_no: str) -> str | None:
    text = (raw or "").strip()
    if text in {"\u7537", "M", "m", "1"}:
        return "M"
    if text in {"\u5973", "F", "f", "2"}:
        return "F"
    if len(id_no) >= 2 and id_no[1] in {"1", "A", "C", "8"}:
        return "M"
    if len(id_no) >= 2 and id_no[1] in {"2", "B", "D", "9"}:
        return "F"
    return None


_CLOCK_RE = re.compile(r"(?<!\d)(\d{1,2}):(\d{2})")


def _visit_clock(row: dict[str, Any]) -> str:
    """Use a clock the booking actually sent. Do not invent 00:00 when none exists."""
    keys = [k for k in row if re.search(r"time|clock|slot", str(k), re.I)]
    for key in keys:
        raw = str(row.get(key) or "")
        match = _CLOCK_RE.search(raw)
        if not match:
            continue
        hour, minute = int(match.group(1)), int(match.group(2))
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return f"{hour:02d}:{minute:02d}:00"
    return ""


def _mobile_number(row: dict[str, Any]) -> str:
    """Care Online splits a mobile into a 4-digit prefix and a 6-digit tail."""
    area = re.sub(r"\D", "", str(row.get("MobilePhoneNumberAreaCode") or ""))
    number = re.sub(r"\D", "", str(row.get("MobilePhoneNumber") or ""))
    if area and number and not number.startswith(area):
        return area + number
    return number or area


def _write_mobile(repo: Any, patient_id: str, mobile: str) -> None:
    """Fill a missing mobile. A stored tail of the same number is replaced. A different number stays."""
    full = re.sub(r"\D", "", mobile or "")
    if len(full) < 10 or not patient_id:
        return
    current = repo.read_resource("Patient", patient_id)
    if not isinstance(current, dict):
        return
    telecom = [item for item in (current.get("telecom") or []) if isinstance(item, dict)]
    tail = full[-6:]

    def digits(value: object) -> str:
        return re.sub(r"\D", "", str(value or ""))

    for tel in telecom:
        if tel.get("system") != "phone":
            continue
        have = digits(tel.get("value"))
        if have == full or (len(have) >= 10 and have.endswith(tail)):
            return
    replaced = False
    for tel in telecom:
        if tel.get("system") != "phone" or tel.get("use") != "mobile":
            continue
        have = digits(tel.get("value"))
        if not have or have == tail or full.endswith(have):
            tel["value"] = full
            replaced = True
            break
    if not replaced:
        telecom.append({"system": "phone", "value": full, "use": "mobile"})
    repo.update_resource("Patient", patient_id, {**current, "telecom": telecom})


def _shift(raw: str) -> str:
    text = (raw or "").strip()
    if "\u665a" in text:
        return "\u665a\u4e0a"
    if "\u4e0b" in text:
        return "\u4e0b\u5348"
    return "\u4e0a\u5348"


def _set_identity_d(payload: dict[str, Any]) -> None:
    exts = list(payload.get("extension") or [])
    clinic = None
    for ext in exts:
        if _CLINIC_EXT in str(ext.get("url") or ""):
            clinic = ext
            break
    if clinic is None:
        clinic = {"url": _CLINIC_EXT, "extension": []}
        exts.append(clinic)
    subs = list(clinic.get("extension") or [])
    found = False
    for sub in subs:
        if sub.get("url") == "idCategory":
            sub["valueString"] = "D"
            found = True
    if not found:
        subs.append({"url": "idCategory", "valueString": "D"})
    clinic["extension"] = subs
    payload["extension"] = exts


def import_care_bookings(visiting_date: str) -> dict[str, Any]:
    from src.api.routers.nhi import register_nhi_encounter
    from src.app.bootstrap import get_fhir_repository, get_shadow_store
    from src.core.context import current_operator_identity

    day = (visiting_date or "").strip()[:10]
    if len(day) != 10:
        raise ValueError("date must be YYYY-MM-DD")
    bookings = fetch_bookings(day)
    store = get_shadow_store()
    repo = get_fhir_repository()
    imported = 0
    created_patients = 0
    skipped = 0
    birthday_kept = 0
    linked_by_name = 0
    errors: list[str] = []

    for row in bookings:
        mobile = _mobile_number(row)
        id_no = str(row.get("IDNo") or "").strip().upper()
        name = f"{row.get('LastName') or ''}{row.get('FirstName') or ''}".strip()
        label = name or id_no or "(no name)"
        if not id_no:
            errors.append(label + ": no id")
            continue
        try:
            queue_no = int(str(row.get("RegistrationNo") or "").strip())
        except ValueError:
            errors.append(label + ": no queue number")
            continue
        from src.core.patient_match import birth_iso_from_any, compact_person_name, match_patient

        iso_birth = birth_iso_from_any(str(row.get("Birthday") or ""))
        matched = match_patient(store, id_no=id_no, name=name, birth_iso=iso_birth)
        link_note = None
        if matched.kind == "id" and matched.patient_id:
            with store._connect() as conn:
                birth_row = conn.execute(
                    "SELECT birth_date FROM patient_index WHERE resource_id = ?",
                    (matched.patient_id,),
                ).fetchone()
                taken = conn.execute(
                    """
                    SELECT 1 FROM encounter_index
                    WHERE patient_id = ? AND encounter_date = ?
                      AND queue_status NOT IN ('cancelled', 'entered-in-error')
                    LIMIT 1
                    """,
                    (matched.patient_id, day),
                ).fetchone()
            if birth_row and str(birth_row["birth_date"] or "").strip():
                birthday_kept += 1
            if mobile:
                try:
                    _write_mobile(repo, matched.patient_id, mobile)
                except Exception:
                    errors.append(f"{label}：手機沒寫進原病歷")
            if taken:
                skipped += 1
                continue
            patient_id = matched.patient_id
        elif matched.kind == "name_birth" and matched.patient_id:
            taken = None
            with store._connect() as conn:
                taken = conn.execute(
                    """
                    SELECT 1 FROM encounter_index
                    WHERE patient_id = ? AND encounter_date = ?
                      AND queue_status NOT IN ('cancelled', 'entered-in-error')
                    LIMIT 1
                    """,
                    (matched.patient_id, day),
                ).fetchone()
            if mobile:
                try:
                    _write_mobile(repo, matched.patient_id, mobile)
                except Exception:
                    errors.append(f"{label}：手機沒寫進原病歷")
            if taken:
                skipped += 1
                continue
            patient_id = matched.patient_id
            stored_id = store.get_patient_id_no(patient_id) or ""
            if stored_id:
                id_no = stored_id
            linked_by_name += 1
            link_note = "照護線上證號與病歷不同，已掛入同名同生日舊病歷，未改證號"
        else:
            if name and iso_birth:
                hits = store.find_patient_ids_by_exact_name_birth(compact_person_name(name), iso_birth)
                if len(hits) > 1:
                    errors.append(label + ": same name and birthday on more than one chart; created a new chart")
            roc = _roc7(str(row.get("Birthday") or ""))
            sex = _sex(str(row.get("Sex") or ""), id_no)
            if not roc or not sex or not name:
                errors.append(f"{label}：姓名、生日或性別不齊，這筆沒掛")
                continue
            try:
                roc = validate_roc_birthday7(roc)
            except NhiValidationError:
                errors.append(f"{label}：生日不是有效的民國日期，這筆沒掛")
                continue
            checksum_note = None
            try:
                validate_taiwan_id_no(id_no)
                intake = NhiPatientIntake(
                    idNo=id_no, birthday=roc, sex=sex, patientName=name
                )
            except (NhiValidationError, Exception) as exc:
                text = str(exc)
                try:
                    id_no = validate_taiwan_id_no_format(id_no)
                except NhiValidationError:
                    errors.append(f"{label}：身分證格式不對，這筆沒掛")
                    continue
                if "檢查碼" not in text and "idNo" not in text:
                    errors.append(f"{label}：資料沒過檢查，這筆沒掛")
                    continue
                intake = NhiPatientIntake.model_construct(
                    idNo=id_no, birthday=roc, sex=sex, patientName=name
                )
                checksum_note = "照護線上身分證檢查碼不符，已先建檔，請到場再核對證號"
            if checksum_note:
                link_note = checksum_note
            payload = nhi_intake_to_fhir_patient(intake)
            _set_identity_d(payload)
            if mobile:
                payload["telecom"] = [{"system": "phone", "value": mobile, "use": "mobile"}]
            address = " ".join(
                x
                for x in (
                    str(row.get("County") or "").strip(),
                    str(row.get("Town") or "").strip(),
                    str(row.get("Address") or "").strip(),
                )
                if x
            )
            if address:
                payload["address"] = [{"text": address}]
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
            token = current_operator_identity.set("CareOnline")
            try:
                created = repo.create_resource("Patient", payload)
            finally:
                current_operator_identity.reset(token)
            patient_id = str(created["id"])
            created_patients += 1

        shift = _shift(str(row.get("ClinicTime") or ""))
        body = NhiEncounterIntake(
            patientId=patient_id,
            patientIdNo=id_no,
            encounterDate=day,
            prebook=True,
            payType="prebook",
            icException="ic",
            caseNo="04",
            copayCode="D12",
            shift=shift,
            queueNumber=queue_no,
            visitClock=_visit_clock(row) or None,
            doctorName=str(row.get("Doctor") or "").strip() or None,
            reasonText=link_note,
        )
        try:
            register_nhi_encounter(body)
        except Exception as exc:
            detail = getattr(exc, "detail", None) or str(exc)
            errors.append(label + ": " + str(detail))
            continue
        imported += 1

    return {
        "date": day,
        "fetched": len(bookings),
        "imported": imported,
        "createdPatients": created_patients,
        "skippedExisting": skipped,
        "birthdayKept": birthday_kept,
        "linkedByNameBirth": linked_by_name,
        "errors": errors[:30],
    }
