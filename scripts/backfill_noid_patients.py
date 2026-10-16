# -*- coding: utf-8 -*-
"""Import charts that have no national id, plus their visits and prescriptions.

Existing patients and visits are left as they are. Nothing is deleted.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import struct
import time
from pathlib import Path

from src.core.encounter_extensions import QUEUE_EXTENSION_URL, attach_reg_extension
from src.core.nhi_clinical_mappers import (
    BILLING_EXT_BASE,
    MEMO_MARK_EXT,
    PAY_MARK_EXT,
    yisheng_selftype_to_pay_mark,
)
from src.core.nhi_soap_fhir_mapper import NHI_SOAP_EXTENSION_URL
from src.core.yisheng_register_fields import (
    decode_register_time,
    map_visit_state,
    parse_serno,
    slot_to_shift,
)

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "shadow.db"
DAT = Path(r"Z:\SC\dat")


def md5_id(value: str) -> str:
    return hashlib.md5(value.encode("utf-8")).hexdigest()[:12]


def dbf(path: Path):
    data = path.read_bytes()
    nrec, hlen, rec = struct.unpack_from("<IHH", data, 4)
    pos = 32
    fields = []
    while pos + 32 <= hlen and data[pos] != 0x0D:
        name = data[pos : pos + 11].split(b"\x00", 1)[0].decode("ascii", "replace")
        flen = data[pos + 16]
        fields.append((name, flen, pos and 0))
        pos += 32
    # re-read offsets properly
    pos = 32
    offsets = {}
    off = 1
    while pos + 32 <= hlen and data[pos] != 0x0D:
        name = data[pos : pos + 11].split(b"\x00", 1)[0].decode("ascii", "replace")
        flen = data[pos + 16]
        offsets[name] = (off, flen)
        off += flen
        pos += 32
    return data[hlen:], nrec, rec, offsets


def cell(row: bytes, offsets: dict, name: str) -> str:
    if name not in offsets:
        return ""
    a, ln = offsets[name]
    return row[a : a + ln].decode("cp950", "ignore").strip()


def roc_to_iso(text: str) -> str:
    parts = text.replace("/", ".").split(".")
    if len(parts) < 3:
        return ""
    try:
        year, month, day = int(parts[0]), int(parts[1]), int(parts[2])
    except ValueError:
        return ""
    return f"{year + 1911:04d}-{month:02d}-{day:02d}"


def roc7(text: str) -> str:
    iso = roc_to_iso(text)
    if not iso:
        return ""
    year, month, day = iso.split("-")
    return f"{int(year) - 1911:03d}{month}{day}"


def main() -> None:
    started = time.time()
    ubody, un, urec, uoff = dbf(DAT / "USER.Dat")
    people = []
    for i in range(un):
        row = ubody[i * urec : (i + 1) * urec]
        if not row or row[0:1] == b"*":
            continue
        keyword = cell(row, uoff, "KEYWORD")
        if not keyword or cell(row, uoff, "ID"):
            continue
        name = cell(row, uoff, "NAME")
        people.append(
            {
                "keyword": keyword,
                "medical": cell(row, uoff, "MEDICAL_NO"),
                "name": name,
                "birthday": cell(row, uoff, "BIRTHDAY"),
                "sex": cell(row, uoff, "SEX"),
                "tel": cell(row, uoff, "TEL"),
                "tel2": cell(row, uoff, "TEL2"),
                "address": cell(row, uoff, "ADDRESS"),
                "kind": cell(row, uoff, "KIND"),
                "memo": cell(row, uoff, "MEMO"),
                "category": cell(row, uoff, "TYPE"),
            }
        )
    print(f"charts without id {len(people)} {time.time() - started:.1f}s", flush=True)

    conn = sqlite3.connect(DB)
    known_med = {
        str(r[0]).strip()
        for r in conn.execute(
            "select medical_no from patient_index where medical_no is not null and trim(medical_no) != ''"
        )
    }
    known_enc = {r[0] for r in conn.execute("select resource_id from encounter_index")}

    patients = []
    by_kw = {}
    skipped_med = 0
    for person in people:
        med = person["medical"]
        if med and med in known_med:
            skipped_med += 1
            continue
        pid = "local-patient-" + md5_id("noid:" + person["keyword"])
        person["pid"] = pid
        by_kw[person["keyword"]] = person
        patients.append(person)
        if med:
            known_med.add(med)
    print(f"to insert {len(patients)} skipped existing chart {skipped_med}", flush=True)

    meds_map = {}
    mbody, mn, mrec, moff = dbf(DAT / "MEDICAL.Dat")
    for i in range(mn):
        row = mbody[i * mrec : (i + 1) * mrec]
        if not row or row[0:1] == b"*":
            continue
        drug_no = cell(row, moff, "DRUG_NO")
        last3 = drug_no[-3:] if len(drug_no) >= 3 else drug_no
        if last3:
            name = cell(row, moff, "MAKING") or cell(row, moff, "CHT_NAME") or cell(row, moff, "TRADE_NAME")
            meds_map[last3] = (cell(row, moff, "CODE"), name)

    shortcuts = {}
    dbody, dn, drec, doff = dbf(DAT / "DIAGNOSE.Dat")
    for i in range(dn):
        row = dbody[i * drec : (i + 1) * drec]
        if not row or row[0:1] == b"*":
            continue
        code = cell(row, doff, "SICK_NO")
        if code:
            shortcuts[code] = (
                cell(row, doff, "ICD_10CODE"),
                cell(row, doff, "SICK_NAME") or cell(row, doff, "SICK_NAME1"),
            )

    rbody, rn, rrec, roff = dbf(DAT / "REGISTER.Dat")
    visits = []
    keys = set()
    for i in range(rn):
        row = rbody[i * rrec : (i + 1) * rrec]
        if not row or row[0:1] == b"*":
            continue
        keyword = cell(row, roff, "KEYWORD")
        person = by_kw.get(keyword)
        if not person:
            continue
        state = map_visit_state(
            cell(row, roff, "STATUS"),
            cell(row, roff, "D_END"),
            cell(row, roff, "ICNO"),
            receipts=cell(row, roff, "RECEIPTS"),
            diagnose=cell(row, roff, "DIAGNOSE"),
            caseno=cell(row, roff, "CASENO"),
            forespeak=cell(row, roff, "FORESPEAK"),
        )
        if state.get("void"):
            continue
        o_raw = cell(row, roff, "O_DATE")
        r_raw = cell(row, roff, "R_DATE")
        iso_r = roc_to_iso(r_raw)
        iso_o = roc_to_iso(o_raw)
        if not iso_r and not iso_o:
            continue
        times = cell(row, roff, "TIMESNO")
        eid = "local-encounter-" + md5_id(f"{keyword}-{o_raw}-{times}")
        if eid in known_enc:
            continue
        visit_key = f"{keyword}{times}"
        keys.add(visit_key)
        visits.append(
            {
                "person": person,
                "eid": eid,
                "key": visit_key,
                "date": iso_r or iso_o,
                "opd": iso_o or iso_r,
                "state": state,
                "serno": parse_serno(cell(row, roff, "SERNO")),
                "slot": cell(row, roff, "SLOT"),
                "time": decode_register_time(cell(row, roff, "TIME")),
                "case": cell(row, roff, "CASENO"),
                "icno": cell(row, roff, "ICNO"),
                "diag": cell(row, roff, "DIAGNOSE"),
                "cc": cell(row, roff, "CC"),
                "reg": cell(row, roff, "REGISTER"),
                "copay": cell(row, roff, "PARTPAYMO"),
                "copay_code": cell(row, roff, "PARTPAYNO"),
                "deposit": cell(row, roff, "KEYMONEY"),
                "drug": cell(row, roff, "DRUG_PRICE"),
                "treat": cell(row, roff, "TREA_PRICE"),
                "self": cell(row, roff, "SELF_PRICE"),
                "card_disc": cell(row, roff, "DISCARD"),
                "drug_disc": cell(row, roff, "DISDRUG"),
                "arrears": cell(row, roff, "ARREARAGE"),
                "total": cell(row, roff, "RECEIPTS"),
            }
        )
    print(f"visits {len(visits)} {time.time() - started:.1f}s", flush=True)

    from scripts.import_yisheng_data import load_maintell_map

    maintell = load_maintell_map(str(DAT / "MAINTELL.Dat"), keys) if (DAT / "MAINTELL.Dat").is_file() else {}

    hist_lines = []
    hpath = DAT / "HISTORY.Dat"
    if hpath.is_file() and keys:
        data = hpath.read_bytes()
        nrec, hlen, rec = struct.unpack_from("<IHH", data, 4)
        pos = 32
        offsets = {}
        off = 1
        while pos + 32 <= hlen and data[pos] != 0x0D:
            name = data[pos : pos + 11].split(b"\x00", 1)[0].decode("ascii", "replace")
            flen = data[pos + 16]
            offsets[name] = (off, flen)
            off += flen
            pos += 32
        fpt = None
        fpt_block = 64
        fpt_path = DAT / "HISTORY.FPT"
        if fpt_path.is_file():
            fpt = fpt_path.open("rb")
            head = fpt.read(16)
            fpt_block = int.from_bytes(head[6:8], "big") or 64

        def memo(token: str) -> str:
            if fpt is None or not token.isdigit():
                return ""
            block = int(token)
            if block <= 0:
                return ""
            fpt.seek(block * fpt_block)
            meta = fpt.read(8)
            if len(meta) < 8:
                return ""
            length = int.from_bytes(meta[4:8], "big")
            if length <= 0 or length > 4000:
                return ""
            return " ".join(fpt.read(length).decode("cp950", "ignore").split())

        body = data[hlen:]
        key_to_visit = {v["key"]: v for v in visits}
        for i in range(nrec):
            row = body[i * rec : (i + 1) * rec]
            if not row or row[0:1] == b"*":
                continue
            key = cell(row, offsets, "KEYWORDS")
            visit = key_to_visit.get(key)
            if not visit:
                continue
            hist_lines.append((visit, row, offsets, memo(cell(row, offsets, "REMARK"))))
        if fpt is not None:
            fpt.close()
    print(f"rx lines {len(hist_lines)} {time.time() - started:.1f}s", flush=True)

    pat_cols = {r[1] for r in conn.execute("pragma table_info(patient_index)")}
    enc_cols = {r[1] for r in conn.execute("pragma table_info(encounter_index)")}
    med_cols = {r[1] for r in conn.execute("pragma table_info(medication_request_index)")}
    conn.execute("pragma synchronous=off")

    def put_cache(kind: str, rid: str, payload: dict) -> None:
        conn.execute(
            "insert or replace into resource_cache (resource_type, resource_id, payload_json, updated_at) "
            "values (?, ?, ?, datetime('now'))",
            (kind, rid, json.dumps(payload, ensure_ascii=False)),
        )

    n_pat = n_enc = n_cond = n_note = n_rx = 0
    for person in patients:
        name = person["name"]
        family, given = (name[0], name[1:]) if len(name) >= 2 else (name, "")
        sex = "F" if "\u5973" in person["sex"] else "M"
        iso = roc_to_iso(person["birthday"]) or "1911-01-01"
        roc = roc7(person["birthday"]) or "0000101"
        telecom = []
        if person["tel"]:
            telecom.append({"system": "phone", "value": person["tel"], "use": "home"})
        if person["tel2"]:
            telecom.append({"system": "phone", "value": person["tel2"], "use": "mobile"})
        payload = {
            "resourceType": "Patient",
            "id": person["pid"],
            "name": [{"family": family, "given": [given], "text": name}] if family else [{"text": name}],
            "gender": "female" if sex == "F" else "male",
            "birthDate": iso,
            "identifier": [
                {
                    "use": "secondary",
                    "system": "https://clinic.org/chart-number",
                    "value": person["medical"] or person["keyword"],
                }
            ],
            "telecom": telecom,
            "address": [{"text": person["address"], "use": "home"}] if person["address"] else [],
            "extension": [
                {
                    "url": "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/nhi-card-basic",
                    "extension": [
                        {"url": "birthdayRoc", "valueString": roc},
                        {"url": "sex", "valueCode": sex},
                    ],
                },
                {
                    "url": "https://clinic.org/fhir/StructureDefinition/patient-clinic-ext",
                    "extension": [
                        {"url": "kind", "valueString": person["kind"]},
                        {"url": "memo", "valueString": person["memo"]},
                        {"url": "idCategory", "valueString": person["category"]},
                    ],
                },
            ],
        }
        put_cache("Patient", person["pid"], payload)
        row = {
            "resource_id": person["pid"],
            "family_name": family,
            "given_name": given,
            "identifier": person["medical"] or person["keyword"],
            "birth_date": iso,
            "id_no": None,
            "birthday_roc": roc,
            "sex": sex,
            "medical_no": person["medical"] or None,
            "phone": person["tel"] or None,
            "phone2": person["tel2"] or None,
            "address": person["address"] or None,
            "id_category": person["category"] or None,
        }
        names = [k for k in row if k in pat_cols]
        conn.execute(
            f"insert into patient_index ({', '.join(names)}, updated_at) "
            f"values ({', '.join('?' for _ in names)}, datetime('now'))",
            [row[k] for k in names],
        )
        n_pat += 1

    for visit in visits:
        person = visit["person"]
        slot = visit["time"] or ("14:00" if visit["slot"] == "2" else "18:00" if visit["slot"] == "3" else "09:00")
        shift = slot_to_shift(visit["slot"])
        chief = (maintell.get(visit["key"]) or "").strip()
        payload = {
            "resourceType": "Encounter",
            "id": visit["eid"],
            "status": visit["state"]["fhir_status"],
            "class": {"code": "AMB"},
            "subject": {"reference": f"Patient/{person['pid']}"},
            "period": {"start": f"{visit['date']}T{slot}:00+08:00"},
            "extension": [
                {
                    "url": QUEUE_EXTENSION_URL,
                    "extension": [
                        {"url": "queueNumber", "valueInteger": visit["serno"]},
                        {"url": "queueStatus", "valueCode": visit["state"]["queue_status"]},
                    ],
                }
            ],
        }
        if chief:
            payload["reasonCode"] = [{"text": chief[:4000]}]
        payload = attach_reg_extension(
            payload,
            {
                "caseNo": visit["case"] or None,
                "shift": shift,
                "treatSeq": visit["icno"] or None,
                "cardWritten": bool(visit["state"].get("card_written")),
                "opdDate": visit["opd"],
                "regFee": visit["reg"] or None,
                "copayAmt": visit["copay"] or None,
                "copayCode": visit["copay_code"] or None,
                "deposit": visit["deposit"] or None,
                "drugFee": visit["drug"] or None,
                "treatFee": visit["treat"] or None,
                "selfPay": visit["self"] or None,
                "cardDisc": visit["card_disc"] or None,
                "drugDisc": visit["drug_disc"] or None,
                "arrears": visit["arrears"] or None,
                "totalFee": visit["total"] or None,
            },
        )
        put_cache("Encounter", visit["eid"], payload)
        def num(text: str) -> int:
            try:
                return int(round(float(text or 0)))
            except ValueError:
                return 0

        row = {
            "resource_id": visit["eid"],
            "patient_id": person["pid"],
            "encounter_date": visit["date"],
            "queue_number": visit["serno"],
            "queue_status": visit["state"]["queue_status"],
            "fhir_status": visit["state"]["fhir_status"],
            "chief_complaint": chief,
            "shift": shift,
            "slot_time": slot,
            "copay_code": visit["copay_code"] or None,
            "fee_reg": num(visit["reg"]),
            "fee_copay": num(visit["copay"]),
            "fee_deposit": num(visit["deposit"]),
            "fee_self": num(visit["self"]),
            "fee_total": num(visit["total"]),
            "fee_arrears": num(visit["arrears"]),
            "fee_card_disc": num(visit["card_disc"]),
            "fee_drug_disc": num(visit["drug_disc"]),
            "treat_seq": visit["icno"] or None,
        }
        names = [k for k in row if k in enc_cols]
        conn.execute(
            f"insert into encounter_index ({', '.join(names)}, updated_at) "
            f"values ({', '.join('?' for _ in names)}, datetime('now'))",
            [row[k] for k in names],
        )
        n_enc += 1
        chunks = [visit["diag"][i : i + 4].strip() for i in range(0, len(visit["diag"]), 4)]
        for seq, code in enumerate(c for c in chunks if c):
            icd, label = shortcuts.get(code, ("", code))
            cid = "local-condition-" + md5_id(f"{visit['eid']}-{code}-{seq}")
            cond = {
                "resourceType": "Condition",
                "id": cid,
                "clinicalStatus": {"coding": [{"code": "active"}]},
                "code": {"coding": [{"system": "http://hl7.org/fhir/sid/icd-10", "code": icd or code}], "text": label},
                "subject": {"reference": f"Patient/{person['pid']}"},
                "encounter": {"reference": f"Encounter/{visit['eid']}"},
                "recordedDate": visit["date"],
            }
            put_cache("Condition", cid, cond)
            conn.execute(
                "insert or replace into condition_index ("
                "resource_id, patient_id, encounter_id, icd10_code, nhi_icd10_code, summary_text, clinical_status, updated_at"
                ") values (?, ?, ?, ?, ?, ?, 'active', datetime('now'))",
                (cid, person["pid"], visit["eid"], icd or code, icd or code, label),
            )
            n_cond += 1
        if chief:
            nid = "local-composition-" + md5_id(visit["eid"])
            note = {
                "resourceType": "Composition",
                "id": nid,
                "status": "final",
                "type": {"text": "\u9580\u8a3a SOAP"},
                "subject": {"reference": f"Patient/{person['pid']}"},
                "encounter": {"reference": f"Encounter/{visit['eid']}"},
                "date": visit["date"],
                "title": "Outpatient SOAP Note",
                "section": [{"title": "Chief Complaint", "text": {"div": chief[:4000]}}],
                "extension": [
                    {
                        "url": NHI_SOAP_EXTENSION_URL,
                        "extension": [
                            {"url": "encounterId", "valueString": visit["eid"]},
                            {"url": "chiefComplaint", "valueString": chief[:4000]},
                        ],
                    }
                ],
            }
            put_cache("Composition", nid, note)
            conn.execute(
                "insert or replace into clinical_note_index ("
                "resource_id, encounter_id, patient_id, chief_complaint, composition_status, updated_at"
                ") values (?, ?, ?, ?, 'final', datetime('now'))",
                (nid, visit["eid"], person["pid"], chief[:4000]),
            )
            n_note += 1

    for visit, row, offsets, site in hist_lines:
        person = visit["person"]
        drug_no = cell(row, offsets, "DRUG_NO")
        last3 = drug_no[-3:] if len(drug_no) >= 3 else drug_no
        nhi, display = meds_map.get(last3, (drug_no, "\u672a\u5c0d\u7167\u85e5\u54c1 " + drug_no))
        sort_seq = cell(row, offsets, "SORT") or "1"
        mid = "local-medicationrequest-" + md5_id(f"{visit['eid']}-{sort_seq}")
        useage = cell(row, offsets, "USEAGE")
        use_type = cell(row, offsets, "USE_TYPE")
        pay = yisheng_selftype_to_pay_mark(cell(row, offsets, "SELFTYPE"))
        memo_mark = cell(row, offsets, "MEMO")[:2]
        try:
            days_n = int(float(cell(row, offsets, "DAY") or 0))
        except ValueError:
            days_n = 0
        try:
            qty_n = float(cell(row, offsets, "QTY") or 0)
        except ValueError:
            qty_n = 0.0
        try:
            price_n = float(cell(row, offsets, "PRICE")) if cell(row, offsets, "PRICE") else None
        except ValueError:
            price_n = None
        extensions = []
        if days_n > 0:
            extensions.append({"url": f"{BILLING_EXT_BASE}/daysSupply", "valueInteger": days_n})
        if qty_n > 0:
            extensions.append({"url": f"{BILLING_EXT_BASE}/quantity", "valueDecimal": qty_n})
        if pay:
            extensions.append({"url": PAY_MARK_EXT, "valueString": pay})
        if memo_mark:
            extensions.append({"url": MEMO_MARK_EXT, "valueString": memo_mark})
        if site:
            extensions.append({"url": f"{BILLING_EXT_BASE}/bodySite", "valueString": site})
        payload = {
            "resourceType": "MedicationRequest",
            "id": mid,
            "status": "active",
            "intent": "order",
            "medicationCodeableConcept": {
                "text": display,
                "coding": [{"system": "https://nhidcc.nhi.gov.tw/medication", "code": nhi}],
            },
            "subject": {"reference": f"Patient/{person['pid']}"},
            "encounter": {"reference": f"Encounter/{visit['eid']}"},
            "dosageInstruction": [{"text": useage}] if useage else [],
            "extension": extensions,
        }
        put_cache("MedicationRequest", mid, payload)
        idx = {
            "resource_id": mid,
            "patient_id": person["pid"],
            "encounter_id": visit["eid"],
            "nhi_code": nhi,
            "drug_text": display,
            "status": "active",
            "days_supply": days_n or None,
            "quantity": qty_n or None,
            "unit_price": price_n,
            "useage": useage or None,
            "use_type": use_type or None,
            "pay_mark": pay or None,
            "memo_mark": memo_mark or None,
            "body_site": site or None,
        }
        names = [k for k in idx if k in med_cols]
        conn.execute(
            f"insert or replace into medication_request_index ({', '.join(names)}, updated_at) "
            f"values ({', '.join('?' for _ in names)}, datetime('now'))",
            [idx[k] for k in names],
        )
        n_rx += 1

    conn.commit()
    day = conn.execute(
        "select count(1) from encounter_index where encounter_date='2026-09-29'"
    ).fetchone()[0]
    who = conn.execute(
        "select count(1) from patient_index where medical_no='103023'"
    ).fetchone()[0]
    print(
        f"patients {n_pat} visits {n_enc} dx {n_cond} notes {n_note} rx {n_rx} "
        f"day0929 {day} chart103023 {who} {time.time() - started:.1f}s",
        flush=True,
    )
    conn.close()


if __name__ == "__main__":
    main()
