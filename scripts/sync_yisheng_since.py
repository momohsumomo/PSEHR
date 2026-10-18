# -*- coding: utf-8 -*-
"""Copy Yisheng visits from a date forward into shadow.db.

Does not delete charts, does not replace the database, does not upload.
Existing visits on those days are updated to the current register status.
Missing visits and drug lines are inserted.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.backfill_cash_book import _iter_fields
from scripts.import_yisheng_data import load_maintell_map, md5_id, parse_dbf_header, parse_roc_date, read_dbf_records
from scripts.import_yisheng_lean import _clean
from src.core.encounter_extensions import (
    QUEUE_EXTENSION_URL,
    REG_EXTENSION_URL,
    attach_reg_extension,
    put_reg_string,
)
from src.core.nhi_clinical_mappers import yisheng_selftype_to_pay_mark
from src.core.yisheng_register_fields import (
    decode_register_time,
    map_visit_state,
    parse_serno,
    slot_to_shift,
)
from scripts.backfill_claim_source import _staff_by_serial


def _num(value: str) -> float | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _fee(value: str) -> int:
    n = _num(value)
    if n is None:
        return 0
    return int(n)


def _set_queue(payload: dict, number: int, status: str, fhir: str) -> None:
    payload["status"] = fhir
    extensions = payload.setdefault("extension", [])
    target = None
    for ext in extensions:
        url = str(ext.get("url") or "")
        if url == QUEUE_EXTENSION_URL or url.endswith("/queue"):
            target = ext
            break
    if target is None:
        target = {"url": QUEUE_EXTENSION_URL, "extension": []}
        extensions.append(target)
    subs = target.setdefault("extension", [])
    seen_n = seen_s = False
    for sub in subs:
        if sub.get("url") == "queueNumber":
            sub["valueInteger"] = number
            seen_n = True
        elif sub.get("url") == "queueStatus":
            sub["valueCode"] = status
            seen_s = True
    if not seen_n:
        subs.append({"url": "queueNumber", "valueInteger": number})
    if not seen_s:
        subs.append({"url": "queueStatus", "valueCode": status})


def _read_fpt(path: Path):
    if not path.is_file():
        return None, 64
    handle = open(path, "rb")
    head = handle.read(16)
    block = int.from_bytes(head[6:8], "big") or 64
    return handle, block


def _memo(handle, block: int, token: str | None) -> str | None:
    if handle is None:
        return None
    text = (token or "").strip()
    if not text.isdigit():
        return None
    n = int(text)
    if n <= 0:
        return None
    handle.seek(n * block)
    meta = handle.read(8)
    if len(meta) < 8:
        return None
    length = int.from_bytes(meta[4:8], "big")
    if length <= 0 or length > 4000:
        return None
    raw = handle.read(length)
    cleaned = " ".join(raw.decode("cp950", errors="ignore").split())
    return cleaned or None


def _patient_stub(pid: str, row: dict) -> str:
    name = _clean(row.get("NAME"))
    family = name[:1]
    given = name[1:]
    id_no = _clean(row.get("ID")).upper()
    med = _clean(row.get("MEDICAL_NO"))
    sex_raw = _clean(row.get("SEX"))
    sex = "F" if ("\u5973" in sex_raw or "\xa4k" in sex_raw) else "M"
    meta = parse_roc_date(_clean(row.get("BIRTHDAY")))
    birthday_roc, birth_iso = meta if meta else ("0000101", "1911-01-01")
    tel = _clean(row.get("TEL"))
    addr = _clean(row.get("ADDRESS"))
    id_cat = _clean(row.get("TYPE"))
    stub = {
        "resourceType": "Patient",
        "id": pid,
        "name": [{"text": name, "family": family, "given": [given] if given else []}],
        "gender": "female" if sex == "F" else "male",
        "birthDate": birth_iso,
        "identifier": [
            {"system": "http://www.moi.gov.tw/id", "value": id_no},
            {"use": "secondary", "system": "https://clinic.org/chart-number", "value": med},
        ],
        "telecom": [{"system": "phone", "value": tel}] if tel else [],
        "address": [{"text": addr}] if addr else [],
        "extension": [
            {
                "url": "https://clinic.org/fhir/StructureDefinition/patient-clinic-ext",
                "extension": [{"url": "idCategory", "valueString": id_cat}, {"url": "birthdayRoc", "valueString": birthday_roc}],
            }
        ],
    }
    return json.dumps(stub, ensure_ascii=False)


def _chart_ident(payload: dict) -> dict | None:
    for ident in payload.get("identifier") or []:
        if not isinstance(ident, dict):
            continue
        system = str(ident.get("system") or "")
        if ident.get("use") == "secondary" or "chart" in system:
            return ident
    return None


def align_charts(conn: sqlite3.Connection, user_dat: Path) -> dict[str, int]:
    """Yisheng chart number wins. Fills patient bodies that the index is missing.

    Does not delete visits. A local row sitting on someone else's chart number
    loses that number; the Yisheng person keeps it.
    """
    people: dict[str, dict] = {}
    owner: dict[str, str] = {}
    shared: set[str] = set()
    for row in read_dbf_records(str(user_dat)):
        id_no = _clean(row.get("ID")).upper()
        med = _clean(row.get("MEDICAL_NO"))
        if not id_no or not med:
            continue
        people[id_no] = row
        if med in owner and owner[med] != id_no:
            shared.add(med)
        owner[med] = id_no

    rows = conn.execute(
        """
        SELECT resource_id, upper(trim(COALESCE(id_no,''))) AS id_no,
               trim(COALESCE(medical_no,'')) AS med
        FROM patient_index
        """
    ).fetchall()
    released = 0
    for row in rows:
        med = row["med"]
        if not med or owner.get(med) == row["id_no"]:
            continue
        if med not in owner:
            continue
        conn.execute(
            "UPDATE patient_index SET medical_no = NULL, updated_at = datetime('now') WHERE resource_id = ?",
            (row["resource_id"],),
        )
        released += 1

    renumbered = 0
    fresh = conn.execute(
        """
        SELECT resource_id, upper(trim(COALESCE(id_no,''))) AS id_no,
               trim(COALESCE(medical_no,'')) AS med
        FROM patient_index
        """
    ).fetchall()
    for row in fresh:
        src = people.get(row["id_no"])
        if not src:
            continue
        want = _clean(src.get("MEDICAL_NO"))
        if not want or want in shared or row["med"] == want:
            continue
        conn.execute(
            "UPDATE patient_index SET medical_no = ?, updated_at = datetime('now') WHERE resource_id = ?",
            (want, row["resource_id"]),
        )
        renumbered += 1

    bodies = 0
    charts_in_body = 0
    current = conn.execute(
        """
        SELECT pi.resource_id AS resource_id, upper(trim(COALESCE(pi.id_no,''))) AS id_no,
               trim(COALESCE(pi.medical_no,'')) AS med, rc.payload_json AS payload_json
        FROM patient_index pi
        LEFT JOIN resource_cache rc
          ON rc.resource_type = 'Patient' AND rc.resource_id = pi.resource_id
        """
    ).fetchall()
    for row in current:
        src = people.get(row["id_no"])
        if not src:
            continue
        want = _clean(src.get("MEDICAL_NO"))
        pid = row["resource_id"]
        if not row["payload_json"]:
            conn.execute(
                """
                INSERT INTO resource_cache (resource_type, resource_id, payload_json, created_at, updated_at)
                VALUES ('Patient', ?, ?, datetime('now'), datetime('now'))
                """,
                (pid, _patient_stub(pid, src)),
            )
            bodies += 1
            continue
        if not want:
            continue
        try:
            payload = json.loads(row["payload_json"])
        except json.JSONDecodeError:
            continue
        ident = _chart_ident(payload)
        current_no = str((ident or {}).get("value") or "").strip()
        if current_no == want:
            continue
        if ident is None:
            payload.setdefault("identifier", []).append(
                {"use": "secondary", "system": "https://clinic.org/chart-number", "value": want}
            )
        else:
            ident["value"] = want
        conn.execute(
            """
            UPDATE resource_cache SET payload_json = ?, updated_at = datetime('now')
            WHERE resource_type = 'Patient' AND resource_id = ?
            """,
            (json.dumps(payload, ensure_ascii=False), pid),
        )
        charts_in_body += 1
    return {"released": released, "renumbered": renumbered, "bodies": bodies, "chartBodies": charts_in_body}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2026-10-09")
    ap.add_argument("--sc-root", default=r"Z:\SC")
    ap.add_argument("--db-path", default=str(ROOT / "data" / "shadow.db"))
    ap.add_argument("--align-only", action="store_true")
    args = ap.parse_args()
    since = args.since[:10]
    dat = Path(args.sc_root) / "dat"
    if not dat.is_dir():
        dat = Path(args.sc_root) / "DAT"

    print("since", since)
    if args.align_only:
        conn = sqlite3.connect(args.db_path, timeout=180)
        conn.row_factory = sqlite3.Row
        stats = align_charts(conn, dat / "USER.Dat")
        conn.commit()
        print("align", stats)
        return 0
    serial_staff = _staff_by_serial(dat)
    conn = sqlite3.connect(args.db_path, timeout=180)
    conn.row_factory = sqlite3.Row
    med_cols = {row[1] for row in conn.execute("PRAGMA table_info(medication_request_index)")}
    if "line_sort" not in med_cols:
        conn.execute("ALTER TABLE medication_request_index ADD COLUMN line_sort INTEGER")
        conn.commit()

    by_idno = {
        str(row["id_no"]).upper(): row["resource_id"]
        for row in conn.execute(
            "SELECT resource_id, id_no FROM patient_index WHERE id_no IS NOT NULL AND trim(id_no) != ''"
        )
    }
    keyword_to_patient: dict[str, str] = {}
    new_patients = 0
    for row in read_dbf_records(str(dat / "USER.Dat")):
        keyword = _clean(row.get("KEYWORD"))
        id_no = _clean(row.get("ID")).upper()
        if not keyword:
            continue
        if id_no and id_no in by_idno:
            keyword_to_patient[keyword] = by_idno[id_no]
            continue
        if not id_no:
            continue
        pid = f"local-patient-{md5_id(id_no)}"
        keyword_to_patient[keyword] = pid
        by_idno[id_no] = pid
        med = _clean(row.get("MEDICAL_NO")) or None
        if med:
            conn.execute(
                """
                UPDATE patient_index
                SET medical_no = NULL, updated_at = datetime('now')
                WHERE trim(medical_no) = ? AND upper(trim(COALESCE(id_no, ''))) != ?
                """,
                (med, id_no),
            )
        name = _clean(row.get("NAME"))
        family = name[:1]
        given = name[1:]
        sex_raw = _clean(row.get("SEX"))
        sex = "F" if ("\u5973" in sex_raw or "\xa4k" in sex_raw) else "M"
        meta = parse_roc_date(_clean(row.get("BIRTHDAY")))
        birthday_roc, birth_iso = meta if meta else ("0000101", "1911-01-01")
        conn.execute(
            """
            INSERT OR IGNORE INTO patient_index (
                resource_id, family_name, given_name, identifier, birth_date,
                id_no, birthday_roc, sex, medical_no, phone, address, id_category, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
            """,
            (
                pid, family, given, id_no, birth_iso, id_no, birthday_roc, sex,
                _clean(row.get("MEDICAL_NO")) or None,
                _clean(row.get("TEL")) or None,
                _clean(row.get("ADDRESS")) or None,
                _clean(row.get("TYPE")) or None,
            ),
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO resource_cache (
                resource_type, resource_id, payload_json, created_at, updated_at
            ) VALUES ('Patient', ?, ?, datetime('now'), datetime('now'))
            """,
            (pid, _patient_stub(pid, row)),
        )
        new_patients += 1
    conn.commit()
    print("patients linked", len(keyword_to_patient), "new", new_patients)
    print("align", align_charts(conn, dat / "USER.Dat"))
    conn.commit()

    reg_names = (
        "KEYWORD", "TIMESNO", "O_DATE", "R_DATE", "STATUS", "SLOT", "SERNO", "TIME",
        "CASENO", "PARTPAYNO", "KEYMONEY", "PARTPAYMO", "REGISTER", "SELF_PRICE",
        "RECEIPTS", "ARREARAGE", "DISCARD", "DISDRUG", "DRUG_PRICE", "TREA_PRICE",
        "ICNO", "DIAGNOSE", "FORESPEAK", "D_END", "DOCTOR", "PHARMACY", "REMARK",
    )
    visits: list[dict] = []
    preview: set[str] = set()
    for row in _iter_fields(dat / "REGISTER.Dat", reg_names):
        rmeta = parse_roc_date(_clean(row["R_DATE"]))
        if not rmeta or rmeta[1] < since:
            continue
        state = map_visit_state(
            row["STATUS"], row["D_END"], row["ICNO"],
            receipts=row["RECEIPTS"], diagnose=row["DIAGNOSE"],
            caseno=row["CASENO"], forespeak=row["FORESPEAK"],
        )
        if state.get("void"):
            continue
        keyword = _clean(row["KEYWORD"])
        pid = keyword_to_patient.get(keyword)
        if not pid:
            continue
        timesno = _clean(row["TIMESNO"])
        o_date = _clean(row["O_DATE"])
        vkey = keyword + timesno
        preview.add(vkey)
        visits.append({"row": row, "state": state, "pid": pid, "iso": rmeta[1], "vkey": vkey, "o_date": o_date, "timesno": timesno, "keyword": keyword})
    print("register rows", len(visits))

    maintell = load_maintell_map(str(dat / "MAINTELL.Dat"), preview) if (dat / "MAINTELL.Dat").is_file() else {}
    shortcut: dict[str, tuple[str, str]] = {}
    diag_path = dat / "DIAGNOSE.Dat"
    if diag_path.is_file():
        for rec in read_dbf_records(str(diag_path)):
            sick = _clean(rec.get("SICK_NO"))
            if sick:
                if sick not in shortcut:
                    shortcut[sick] = (_clean(rec.get("ICD_10CODE")), _clean(rec.get("SICK_NAME")) or _clean(rec.get("SICK_NAME1")) or sick)

    profile_raw = conn.execute(
        "SELECT value FROM clinic_runtime_settings WHERE key = ?",
        ("clinic_profile_v1",),
    ).fetchone()
    default_pharm = ""
    if profile_raw and profile_raw[0]:
        bundle = json.loads(profile_raw[0])
        default_pharm = str((bundle.get("profile") or {}).get("defaultPharmacistId") or "")

    known = {row["resource_id"] for row in conn.execute("SELECT resource_id FROM encounter_index")}
    updated = inserted = 0
    keyword_times_to_eid: dict[str, str] = {}
    eid_to_pid: dict[str, str] = {}
    for visit in visits:
        row = visit["row"]
        state = visit["state"]
        eid = f"local-encounter-{md5_id(visit['keyword'] + '-' + visit['o_date'] + '-' + visit['timesno'])}"
        keyword_times_to_eid[visit["vkey"]] = eid
        slot = decode_register_time(row["TIME"]) or (
            "14:00" if _clean(row["SLOT"]) == "2" else "18:00" if _clean(row["SLOT"]) == "3" else "09:00"
        )
        shift = slot_to_shift(row["SLOT"])
        serno = parse_serno(row["SERNO"])
        doctor = serial_staff.get(_clean(row["DOCTOR"]).zfill(2), "") if _clean(row["DOCTOR"]) else ""
        pharmacist = default_pharm if _clean(row["PHARMACY"]) == "0" else serial_staff.get(_clean(row["PHARMACY"]).zfill(2), "")
        seq = _clean(row["ICNO"])
        eid_to_pid[eid] = visit["pid"]
        chief = (maintell.get(visit["vkey"]) or "").strip()
        fees = {
            "caseNo": _clean(row["CASENO"]) or None,
            "shift": shift,
            "copayCode": _clean(row["PARTPAYNO"]) or None,
            "prebook": bool(state.get("prebook") or state.get("appointment")),
            "cardWritten": bool(state.get("card_written")),
            "regFee": _clean(row["REGISTER"]) or None,
            "copayAmt": _clean(row["PARTPAYMO"]) or None,
            "deposit": _clean(row["KEYMONEY"]) or None,
            "drugFee": _clean(row["DRUG_PRICE"]) or None,
            "treatFee": _clean(row["TREA_PRICE"]) or None,
            "selfPay": _clean(row["SELF_PRICE"]) or None,
            "cardDisc": _clean(row["DISCARD"]) or None,
            "drugDisc": _clean(row["DISDRUG"]) or None,
            "arrears": _clean(row["ARREARAGE"]) or None,
            "totalFee": _clean(row["RECEIPTS"]) or None,
            "doctorId": doctor or None,
            "pharmacist": pharmacist or None,
            "treatSeq": seq or None,
            "noteMark": _clean(row["REMARK"])[:40] or None,
        }
        fee_cols = (
            _fee(row["KEYMONEY"]), _fee(row["PARTPAYMO"]), _fee(row["DISCARD"]), _fee(row["DISDRUG"]),
            _fee(row["REGISTER"]), _fee(row["SELF_PRICE"]), _fee(row["RECEIPTS"]), _fee(row["ARREARAGE"]),
        )
        if eid in known:
            conn.execute(
                """
                UPDATE encounter_index
                SET patient_id=?, encounter_date=?, queue_number=?, queue_status=?, fhir_status=?,
                    shift=?, slot_time=?, chief_complaint=COALESCE(NULLIF(?, ''), chief_complaint),
                    claim_doctor_id=COALESCE(NULLIF(?, ''), claim_doctor_id),
                    claim_pharmacist_id=COALESCE(NULLIF(?, ''), claim_pharmacist_id),
                    treat_seq=COALESCE(NULLIF(?, ''), treat_seq),
                    copay_code=?, fee_deposit=?, fee_copay=?, fee_card_disc=?, fee_drug_disc=?,
                    fee_reg=?, fee_self=?, fee_total=?, fee_arrears=?, updated_at=datetime('now')
                WHERE resource_id=?
                """,
                (
                    visit["pid"], visit["iso"], serno, state["queue_status"], state["fhir_status"],
                    shift or None, slot, chief[:4000], doctor, pharmacist, seq, _clean(row["PARTPAYNO"]),
                    *fee_cols, eid,
                ),
            )
            cached = conn.execute(
                "SELECT payload_json FROM resource_cache WHERE resource_type='Encounter' AND resource_id=?",
                (eid,),
            ).fetchone()
            payload = json.loads(cached["payload_json"]) if cached and cached["payload_json"] else {
                "resourceType": "Encounter", "id": eid, "class": {"text": "OPD"},
                "subject": {"reference": f"Patient/{visit['pid']}"},
            }
            payload["period"] = {"start": f"{visit['iso']}T{slot}:00+08:00"}
            if chief:
                payload["reasonCode"] = [{"text": chief[:4000]}]
            _set_queue(payload, serno, state["queue_status"], state["fhir_status"])
            payload = attach_reg_extension(payload, fees)
            if seq and _fee(row["KEYMONEY"]) == 0:
                remark = _clean(row["REMARK"])[:40]
                put_reg_string(payload, "noteMark", remark)
                conn.execute(
                    "UPDATE encounter_index SET reg_remark=? WHERE resource_id=?",
                    (remark, eid),
                )
            conn.execute(
                """
                INSERT INTO resource_cache (resource_type, resource_id, payload_json, created_at, updated_at)
                VALUES ('Encounter', ?, ?, datetime('now'), datetime('now'))
                ON CONFLICT(resource_type, resource_id) DO UPDATE SET
                    payload_json=excluded.payload_json, updated_at=datetime('now')
                """,
                (eid, json.dumps(payload, ensure_ascii=False)),
            )
            updated += 1
        else:
            payload = {
                "resourceType": "Encounter",
                "id": eid,
                "status": state["fhir_status"],
                "class": {"text": "OPD"},
                "subject": {"reference": f"Patient/{visit['pid']}"},
                "period": {"start": f"{visit['iso']}T{slot}:00+08:00"},
                "reasonCode": [{"text": chief[:4000]}] if chief else [],
            }
            _set_queue(payload, serno, state["queue_status"], state["fhir_status"])
            payload = attach_reg_extension(payload, fees)
            conn.execute(
                """
                INSERT INTO encounter_index (
                    resource_id, patient_id, encounter_date, queue_number, queue_status, fhir_status,
                    shift, slot_time, chief_complaint, claim_doctor_id, claim_pharmacist_id, treat_seq, copay_code,
                    fee_deposit, fee_copay, fee_card_disc, fee_drug_disc, fee_reg, fee_self, fee_total, fee_arrears,
                    updated_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
                """,
                (
                    eid, visit["pid"], visit["iso"], serno, state["queue_status"], state["fhir_status"],
                    shift or None, slot, chief[:4000] or None, doctor or None, pharmacist or None, seq or None, _clean(row["PARTPAYNO"]),
                    *fee_cols,
                ),
            )
            conn.execute(
                """
                INSERT OR IGNORE INTO resource_cache (resource_type, resource_id, payload_json, created_at, updated_at)
                VALUES ('Encounter', ?, ?, datetime('now'), datetime('now'))
                """,
                (eid, json.dumps(payload, ensure_ascii=False)),
            )
            known.add(eid)
            inserted += 1
        sick_field = _clean(row["DIAGNOSE"])
        has_dx = conn.execute(
            "SELECT 1 FROM condition_index WHERE encounter_id = ? LIMIT 1",
            (eid,),
        ).fetchone()
        if sick_field and not has_dx:
            parts = [sick_field[i:i + 4].strip() for i in range(0, len(sick_field), 4)]
            for i, sick in enumerate([p for p in parts if p][:8]):
                icd10, dname = shortcut.get(sick, ("", sick))
                cid = f"local-condition-{md5_id(f'{eid}-{sick}-{i}')}"
                conn.execute(
                    """
                    INSERT OR IGNORE INTO condition_index (
                        resource_id, patient_id, encounter_id, icd10_code, snomed_code, nhi_icd10_code,
                        summary_text, clinical_status, updated_at
                    ) VALUES (?,?,?,?,?,?,?,?, datetime('now'))
                    """,
                    (cid, visit["pid"], eid, icd10 or None, None, icd10 or None, dname or sick, "active"),
                )
    conn.commit()
    print("encounters updated", updated, "inserted", inserted)

    have_meds: set[str] = set()
    eids = list(eid_to_pid)
    for start in range(0, len(eids), 400):
        chunk = eids[start : start + 400]
        marks = ",".join("?" for _ in chunk)
        for row in conn.execute(
            f"SELECT DISTINCT encounter_id FROM medication_request_index WHERE encounter_id IN ({marks})",
            chunk,
        ):
            have_meds.add(row[0])

    medicine: dict[str, tuple[str, str]] = {}
    for rec in read_dbf_records(str(dat / "MEDICAL.Dat")):
        drug_no = _clean(rec.get("DRUG_NO"))
        last3 = drug_no[-3:] if len(drug_no) >= 3 else drug_no
        if last3:
            nhi = _clean(rec.get("CODE"))
            medicine[last3] = (nhi, _clean(rec.get("MAKING")) or _clean(rec.get("TRADE_NAME")) or nhi or last3)
    fpt, block = _read_fpt(dat / "HISTORY.FPT")
    hist_path = str(dat / "HISTORY.Dat")
    meta = parse_dbf_header(hist_path)
    med_new = 0
    if meta:
        num_hist, header_len, rec_len, fields = meta
        sort_seen: dict[str, int] = {}
        with open(hist_path, "rb") as handle:
            handle.seek(header_len)
            for i in range(num_hist):
                data = handle.read(rec_len)
                if len(data) < rec_len:
                    break
                if data[0] == 0x2A:
                    continue
                keywords = data[1:7].decode("cp950", errors="ignore").strip()
                eid = keyword_times_to_eid.get(keywords)
                if not eid:
                    continue
                parsed = {
                    name: data[offset:offset + length].decode("cp950", errors="ignore").strip()
                    for name, typ, length, offset in fields
                }
                drug_no = _clean(parsed.get("DRUG_NO"))
                last3 = drug_no[-3:] if len(drug_no) >= 3 else drug_no
                nhi, display = medicine.get(last3, (drug_no, drug_no))
                sort_seq = _clean(parsed.get("SORT")) or "1"
                try:
                    line_sort = int(float(sort_seq))
                except ValueError:
                    line_sort = 0
                bucket = eid + "-" + sort_seq
                nth = sort_seen.get(bucket, 0)
                sort_seen[bucket] = nth + 1
                token = bucket if nth == 0 else bucket + "-" + str(nth)
                mid = f"local-medicationrequest-{md5_id(token)}"
                use_type = _clean(parsed.get("USE_TYPE")) or None
                conn.execute(
                    "UPDATE medication_request_index SET use_type=?, line_sort=? WHERE resource_id=?",
                    (use_type, line_sort, mid),
                )
                if eid in have_meds:
                    continue
                pid = eid_to_pid.get(eid)
                if not pid:
                    continue
                cur = conn.execute(
                    """
                    INSERT OR IGNORE INTO medication_request_index (
                        resource_id, patient_id, encounter_id, nhi_code, drug_text, status,
                        days_supply, quantity, unit_price, useage, pay_mark, memo_mark, body_site,
                        use_type, line_sort, updated_at
                    ) VALUES (?,?,?,?,?,'active',?,?,?,?,?,?,?,?,?, datetime('now'))
                    """,
                    (
                        mid, pid, eid, nhi or None, display,
                        int(_num(parsed.get("DAY")) or 0) or None,
                        _num(parsed.get("QTY")),
                        _num(parsed.get("PRICE")),
                        _clean(parsed.get("USEAGE")) or None,
                        yisheng_selftype_to_pay_mark(_clean(parsed.get("SELFTYPE"))) or None,
                        _clean(parsed.get("MEMO"))[:2] or None,
                        _memo(fpt, block, parsed.get("REMARK")),
                        use_type,
                        line_sort,
                    ),
                )
                med_new += cur.rowcount
    if fpt is not None:
        fpt.close()
    conn.commit()
    print("drug lines inserted", med_new)

    from scripts.backfill_ic_upload_fields import _cell, _dbf
    from src.core.encounter_extensions import extract_reg_meta

    upload_path = dat / "UPLOADIC.Dat"
    ic_filled = 0
    if upload_path.is_file():
        body, nrec, rec, offsets = _dbf(upload_path)
        wanted = set(keyword_times_to_eid)
        by_eid: dict[str, dict[str, str]] = {}
        for i in range(nrec):
            row = body[i * rec : (i + 1) * rec]
            if not row or row[0:1] == b"*":
                continue
            key = _cell(row, offsets, "KEYWORDS")
            eid = keyword_times_to_eid.get(key)
            if not eid or key not in wanted:
                continue
            by_eid[eid] = {
                "hcId": _cell(row, offsets, "CARDNO"),
                "samId": _cell(row, offsets, "SAMID"),
                "treatDateTime": _cell(row, offsets, "ICDATE"),
                "treatmentNumber": _cell(row, offsets, "IC20NOCARD"),
                "icUploadFee": _cell(row, offsets, "DECLARE").lstrip("0") or "0",
                "icCopay": _cell(row, offsets, "PARTPAYMO").lstrip("0") or "0",
                "icCaseNo": _cell(row, offsets, "ICCASENO"),
                "icRemark": _cell(row, offsets, "ICREMARK"),
            }
        ids = list(by_eid)
        for start in range(0, len(ids), 400):
            chunk = ids[start : start + 400]
            marks = ",".join("?" for _ in chunk)
            rows = conn.execute(
                f"SELECT resource_id, payload_json FROM resource_cache "
                f"WHERE resource_type='Encounter' AND resource_id IN ({marks})",
                chunk,
            ).fetchall()
            for row in rows:
                try:
                    payload = json.loads(row["payload_json"])
                except json.JSONDecodeError:
                    continue
                current = extract_reg_meta(payload)
                patch = {}
                for key, value in by_eid[row["resource_id"]].items():
                    if not value:
                        continue
                    if key == "treatmentNumber" and len(value) != 20:
                        continue
                    if str(current.get(key) or "").strip():
                        continue
                    patch[key] = value
                if not patch:
                    continue
                merged = attach_reg_extension(payload, patch)
                conn.execute(
                    "UPDATE resource_cache SET payload_json=?, updated_at=datetime('now') "
                    "WHERE resource_type='Encounter' AND resource_id=?",
                    (json.dumps(merged, ensure_ascii=False), row["resource_id"]),
                )
                ic_filled += 1
        conn.commit()
    print("ic blanks filled", ic_filled)

    refund_on = {}
    for row in _iter_fields(dat / "ACOUNT.Dat", ("KEYWORDS", "R_DATE", "TYPE", "MONEY")):
        if _clean(row["TYPE"]) != "2":
            continue
        meta = parse_roc_date(_clean(row["R_DATE"]))
        if not meta or meta[1] < since:
            continue
        key = _clean(row["KEYWORDS"])[:6]
        amount = _fee(row["MONEY"])
        if len(key) < 6 or amount <= 0:
            continue
        refund_on[key] = (meta[1], amount)

    reg_by_key = {}
    if refund_on:
        for row in _iter_fields(
            dat / "REGISTER.Dat",
            ("KEYWORD", "TIMESNO", "O_DATE", "ICNO", "KEYMONEY", "CASENO"),
        ):
            raw = _clean(row["KEYWORD"]) + _clean(row["TIMESNO"])
            padded = _clean(row["KEYWORD"]) + _clean(row["TIMESNO"]).zfill(2)
            key = raw if raw in refund_on else padded if padded in refund_on else ""
            if not key:
                continue
            if _fee(row["KEYMONEY"]) <= 0 and not _clean(row["ICNO"]):
                continue
            reg_by_key[key] = row

    upload_by_key = {}
    if refund_on and upload_path.is_file():
        for i in range(nrec):
            row = body[i * rec : (i + 1) * rec]
            if not row or row[0:1] == b"*":
                continue
            key = _cell(row, offsets, "KEYWORDS")[:6]
            if key not in reg_by_key:
                continue
            upload_by_key[key] = {
                "hcId": _cell(row, offsets, "CARDNO"),
                "samId": _cell(row, offsets, "SAMID"),
                "treatDateTime": _cell(row, offsets, "ICDATE"),
                "treatmentNumber": _cell(row, offsets, "IC20NOCARD"),
            }

    patched = 0
    from src.core.encounter_extensions import extract_reg_meta as _reg_meta
    for key, (day, amount) in refund_on.items():
        row = reg_by_key.get(key)
        if not row:
            continue
        eid = "local-encounter-" + md5_id(
            _clean(row["KEYWORD"]) + "-" + _clean(row["O_DATE"]) + "-" + _clean(row["TIMESNO"])
        )
        found = conn.execute(
            "SELECT patient_id, ic_upload_date FROM encounter_index WHERE resource_id=?",
            (eid,),
        ).fetchone()
        if not found:
            continue
        seq = _clean(row["ICNO"])
        conn.execute(
            """
            UPDATE encounter_index
            SET treat_seq=COALESCE(NULLIF(?, ''), treat_seq),
                fee_deposit=0,
                ic_upload_date=COALESCE(NULLIF(ic_upload_date, ''), ?),
                updated_at=datetime('now')
            WHERE resource_id=?
            """,
            (seq, day, eid),
        )
        cached = conn.execute(
            "SELECT payload_json FROM resource_cache WHERE resource_type='Encounter' AND resource_id=?",
            (eid,),
        ).fetchone()
        if cached and cached[0]:
            payload = json.loads(cached[0])
            current = _reg_meta(payload)
            patch = {
                "deposit": "0",
                "icException": "ic",
                "icUploadDate": day,
                "treatSeq": seq or None,
            }
            extra = upload_by_key.get(key) or {}
            for field, value in extra.items():
                if not value:
                    continue
                if field == "treatmentNumber" and len(value) != 20:
                    continue
                if str(current.get(field) or "").strip():
                    continue
                patch[field] = value
            merged = attach_reg_extension(payload, patch)
            conn.execute(
                "UPDATE resource_cache SET payload_json=?, updated_at=datetime('now') "
                "WHERE resource_type='Encounter' AND resource_id=?",
                (json.dumps(merged, ensure_ascii=False), eid),
            )
        already = conn.execute(
            "SELECT 1 FROM cash_return WHERE keywords=?",
            (key,),
        ).fetchone()
        if not already:
            person = conn.execute(
                "SELECT medical_no, identifier, family_name, given_name, id_no FROM patient_index WHERE resource_id=?",
                (found["patient_id"],),
            ).fetchone()
            chart = ""
            name = ""
            id_no = ""
            if person:
                chart = (person["medical_no"] or person["identifier"] or "").strip()
                name = f"{person['family_name'] or ''}{person['given_name'] or ''}".strip()
                id_no = (person["id_no"] or "").strip()
            conn.execute(
                """
                INSERT INTO cash_return (
                    encounter_date, amount, keywords, chart_no, patient_name, id_no, treat_seq, case_no
                ) VALUES (?,?,?,?,?,?,?,?)
                """,
                (day, amount, key, chart, name, id_no, seq, _clean(row["CASENO"])),
            )
        patched += 1
    conn.commit()
    print("deposit refunds patched", patched)
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
