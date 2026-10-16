#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Insert REGISTER rows the lean import used to skip because O_DATE was blank.

A second run also attaches HISTORY lines that never landed on an
encounter that is already in the database, and stores HISTORY.PRICE
when the line is new. Existing rows are not replaced.

Clinic day is R_DATE. Void leftovers stay out. Existing encounter ids are not overwritten.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.import_yisheng_data import load_maintell_map, md5_id, parse_dbf_header, parse_roc_date, read_dbf_records
from src.core.encounter_extensions import QUEUE_EXTENSION_URL, attach_reg_extension
from src.core.nhi_clinical_mappers import yisheng_selftype_to_pay_mark
from src.core.yisheng_register_fields import (
    decode_register_time,
    forespeak_text,
    map_visit_state,
    parse_serno,
    remark_text,
    slot_to_shift,
)

BATCH = 4000


def _clean(value: str | None) -> str:
    return (value or "").replace("\x00", "").strip()


def _iter_fields(path: Path, names: tuple[str, ...]):
    num, hlen, rlen, fields = parse_dbf_header(str(path))
    idx = {name: (off, length) for name, _typ, length, off in fields}
    missing = [name for name in names if name not in idx]
    if missing:
        raise SystemExit(f"{path.name} missing fields: {missing}")

    def take(buf: bytes, name: str) -> str:
        off, length = idx[name]
        return buf[off : off + length].decode("cp950", errors="ignore").strip()

    with path.open("rb") as handle:
        handle.seek(hlen)
        for _ in range(num):
            buf = handle.read(rlen)
            if len(buf) < rlen:
                break
            if buf[0] == 0x2A:
                continue
            yield {name: take(buf, name) for name in names}


def _flush(cur: sqlite3.Cursor, sql: str, rows: list[tuple]) -> None:
    for i in range(0, len(rows), BATCH):
        cur.executemany(sql, rows[i : i + BATCH])


def main() -> int:
    dat = Path(r"Z:\SC\dat")
    db_path = ROOT / "data" / "shadow.db"
    if not (dat / "REGISTER.Dat").is_file():
        print("REGISTER not found", dat)
        return 1
    if not db_path.is_file():
        print("shadow db not found", db_path)
        return 1

    conn = sqlite3.connect(str(db_path), timeout=120)
    before = int(conn.execute("select count(*) from encounter_index").fetchone()[0])
    known_patients = {row[0] for row in conn.execute("select resource_id from patient_index")}
    known_encounters = {row[0] for row in conn.execute("select resource_id from encounter_index")}
    encounter_patient = {
        row[0]: row[1]
        for row in conn.execute("select resource_id, patient_id from encounter_index")
    }
    print("encounters before", before, "patients", len(known_patients))

    keyword_to_patient: dict[str, str] = {}
    for row in _iter_fields(dat / "USER.Dat", ("KEYWORD", "ID")):
        keyword = _clean(row["KEYWORD"])
        id_no = _clean(row["ID"]).upper()
        if not keyword or not id_no:
            continue
        pid = f"local-patient-{md5_id(id_no)}"
        if pid in known_patients:
            keyword_to_patient[keyword] = pid
    print("keyword map", len(keyword_to_patient))

    reg_names = (
        "KEYWORD",
        "TIMESNO",
        "O_DATE",
        "R_DATE",
        "STATUS",
        "D_END",
        "ICNO",
        "RECEIPTS",
        "DIAGNOSE",
        "CASENO",
        "FORESPEAK",
        "TIME",
        "SLOT",
        "SERNO",
        "REMARK",
        "REGISTER",
        "PARTPAYMO",
        "KEYMONEY",
        "PARTPAYNO",
        "DRUG_PRICE",
        "TREA_PRICE",
        "SELF_PRICE",
        "DISCARD",
        "DISDRUG",
        "ARREARAGE",
        "MAINTELL",
    )
    pending: list[dict[str, str]] = []
    repairs: list[dict[str, str]] = []
    skipped_void = 0
    skipped_no_patient = 0
    skipped_has_odate = 0
    skipped_bad_rdate = 0
    skipped_exists = 0
    for row in _iter_fields(dat / "REGISTER.Dat", reg_names):
        visit_state = map_visit_state(
            row["STATUS"],
            row["D_END"],
            row["ICNO"],
            receipts=row["RECEIPTS"],
            diagnose=row["DIAGNOSE"],
            caseno=row["CASENO"],
            forespeak=row["FORESPEAK"],
        )
        if visit_state.get("void"):
            skipped_void += 1
            continue
        if parse_roc_date(_clean(row["O_DATE"])):
            skipped_has_odate += 1
            continue
        keyword = _clean(row["KEYWORD"])
        if keyword not in keyword_to_patient:
            skipped_no_patient += 1
            continue
        if not parse_roc_date(_clean(row["R_DATE"])):
            skipped_bad_rdate += 1
            continue
        timesno = _clean(row["TIMESNO"])
        o_date = _clean(row["O_DATE"])
        eid = f"local-encounter-{md5_id(keyword + '-' + o_date + '-' + timesno)}"
        if eid in known_encounters:
            skipped_exists += 1
            pid = encounter_patient.get(eid) or keyword_to_patient.get(keyword)
            if pid:
                row["_eid"] = eid
                row["_pid"] = pid
                repairs.append(row)
            continue
        row["_eid"] = eid
        row["_pid"] = keyword_to_patient[keyword]
        row["_state"] = visit_state
        pending.append(row)
        known_encounters.add(eid)

    print(
        "pending",
        len(pending),
        "exists",
        skipped_exists,
        "no_patient",
        skipped_no_patient,
        "bad_rdate",
        skipped_bad_rdate,
        "void_seen",
        skipped_void,
        "has_odate",
        skipped_has_odate,
        "repair",
        len(repairs),
    )
    if not pending and not repairs:
        conn.close()
        print("nothing to insert")
        return 0

    print("maps...")
    medicine_map: dict[str, tuple[str, str]] = {}
    for rec in read_dbf_records(str(dat / "MEDICAL.Dat")):
        drug_no = _clean(rec.get("DRUG_NO"))
        last3 = drug_no[-3:] if len(drug_no) >= 3 else drug_no
        if not last3:
            continue
        nhi = _clean(rec.get("CODE"))
        making = _clean(rec.get("MAKING")) or _clean(rec.get("TRADE_NAME")) or nhi or last3
        medicine_map[last3] = (nhi, making)
    shortcut_map: dict[str, tuple[str, str]] = {}
    diag_path = dat / "DIAGNOSE.Dat"
    if diag_path.is_file():
        for rec in read_dbf_records(str(diag_path)):
            sick = _clean(rec.get("SICK_NO"))
            if not sick:
                continue
            shortcut_map[sick] = (
                _clean(rec.get("ICD_10CODE")),
                _clean(rec.get("SICK_NAME")) or _clean(rec.get("SICK_NAME1")) or sick,
            )
    visit_keys = {
        f"{_clean(r['KEYWORD'])}{_clean(r['TIMESNO'])}" for r in pending
    }
    visit_keys.update(
        f"{_clean(r['KEYWORD'])}{_clean(r['TIMESNO'])}" for r in repairs
    )
    maintell_map = (
        load_maintell_map(str(dat / "MAINTELL.Dat"), visit_keys)
        if (dat / "MAINTELL.Dat").is_file()
        else {}
    )

    encounter_idx: list[tuple] = []
    encounter_cache: list[tuple] = []
    condition_idx: list[tuple] = []
    clinical_notes: list[tuple] = []
    keyword_times_to_eid: dict[str, str] = {}
    eid_to_patient: dict[str, str] = {}

    for row in pending:
        keyword = _clean(row["KEYWORD"])
        timesno = _clean(row["TIMESNO"])
        vkey = f"{keyword}{timesno}"
        eid = row["_eid"]
        pid = row["_pid"]
        visit_state = row["_state"]
        iso_visit = parse_roc_date(_clean(row["R_DATE"]))[1]
        slot_raw = _clean(row["SLOT"])
        slot_time = decode_register_time(row["TIME"]) or (
            "14:00" if slot_raw == "2" else "18:00" if slot_raw == "3" else "09:00"
        )
        serno = parse_serno(row["SERNO"])
        shift = slot_to_shift(row["SLOT"])
        chief = (maintell_map.get(vkey) or "").strip() or _clean(row["MAINTELL"])
        chief = chief[:4000]
        keyword_times_to_eid[vkey] = eid
        eid_to_patient[eid] = pid
        encounter_idx.append(
            (
                eid,
                pid,
                iso_visit,
                serno,
                visit_state["queue_status"],
                visit_state["fhir_status"],
                chief or None,
                shift or None,
                slot_time,
            )
        )
        payload = {
            "resourceType": "Encounter",
            "id": eid,
            "status": visit_state["fhir_status"],
            "class": {"text": "OPD"},
            "subject": {"reference": f"Patient/{pid}"},
            "period": {"start": f"{iso_visit}T{slot_time}:00+08:00"},
            "reasonCode": [{"text": chief}] if chief else [],
            "extension": [
                {
                    "url": QUEUE_EXTENSION_URL,
                    "extension": [
                        {"url": "queueNumber", "valueInteger": serno},
                        {"url": "queueStatus", "valueCode": visit_state["queue_status"]},
                    ],
                }
            ],
        }
        payload = attach_reg_extension(
            payload,
            {
                "caseNo": _clean(row["CASENO"]) or None,
                "shift": shift,
                "noteMark": remark_text(row["REMARK"]) or None,
                "forespeak": forespeak_text(row["FORESPEAK"]) or None,
                "prebook": bool(visit_state.get("prebook") or visit_state.get("appointment")),
                "cardWritten": bool(visit_state.get("card_written")),
                "copayCode": _clean(row["PARTPAYNO"]) or None,
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
            },
        )
        encounter_cache.append(("Encounter", eid, json.dumps(payload, ensure_ascii=False)))
        if chief:
            clinical_notes.append((f"local-composition-{md5_id(eid + '-cc')}", eid, pid, chief))
        diagnose_field = _clean(row["DIAGNOSE"])
        if diagnose_field:
            parts = [diagnose_field[i : i + 4].strip() for i in range(0, len(diagnose_field), 4)]
            parts = [part for part in parts if part]
            for i, sick in enumerate(parts[:8]):
                icd10, dname = shortcut_map.get(sick, ("", ""))
                condition_idx.append(
                    (
                        f"local-condition-{md5_id(f'{eid}-{sick}-{i}')}",
                        pid,
                        eid,
                        icd10 or None,
                        None,
                        icd10 or None,
                        dname or sick,
                        "active",
                    )
                )

    for row in repairs:
        keyword = _clean(row["KEYWORD"])
        timesno = _clean(row["TIMESNO"])
        vkey = f"{keyword}{timesno}"
        keyword_times_to_eid[vkey] = row["_eid"]
        eid_to_patient[row["_eid"]] = row["_pid"]

    print("history...")
    med_rows: list[tuple] = []
    sort_seen: dict[str, int] = {}
    sort_seen_sig: set[tuple] = set()
    hist_path = dat / "HISTORY.Dat"
    hist_meta = parse_dbf_header(str(hist_path)) if hist_path.is_file() else None
    if hist_meta:
        num_hist, header_len, rec_len, fields = hist_meta
        with hist_path.open("rb") as handle:
            handle.seek(header_len)
            for i in range(num_hist):
                if i and i % 400000 == 0:
                    print("  history", i, "/", num_hist, "matched", len(med_rows))
                data = handle.read(rec_len)
                if len(data) < rec_len:
                    break
                if data[0] == 0x2A:
                    continue
                keywords = data[1:7].decode("cp950", errors="ignore").strip()
                if keywords not in visit_keys:
                    continue
                decoded = {
                    name: data[offset : offset + length].decode("cp950", errors="ignore").strip()
                    for name, _typ, length, offset in fields
                }
                eid = keyword_times_to_eid.get(keywords)
                pid = eid_to_patient.get(eid or "")
                if not eid or not pid:
                    continue
                drug_no = _clean(decoded.get("DRUG_NO"))
                last3 = drug_no[-3:] if len(drug_no) >= 3 else drug_no
                nhi, display = medicine_map.get(last3, (drug_no, f"UNMAPPED {drug_no}"))
                day_str = _clean(decoded.get("DAY"))
                qty_str = _clean(decoded.get("QTY"))
                try:
                    days_n = int(float(day_str)) if day_str else None
                except ValueError:
                    days_n = None
                try:
                    qty_n = float(qty_str) if qty_str else None
                except ValueError:
                    qty_n = None
                sort_seq = _clean(decoded.get("SORT")) or "1"
                price_str = _clean(decoded.get("PRICE"))
                try:
                    price_n = float(price_str) if price_str else None
                except ValueError:
                    price_n = None
                bucket = eid + "-" + sort_seq
                nth = sort_seen.get(bucket, 0)
                sort_seen[bucket] = nth + 1
                token = bucket if nth == 0 else bucket + "-" + str(nth)
                pay = yisheng_selftype_to_pay_mark(_clean(decoded.get("SELFTYPE"))) or None
                useage = _clean(decoded.get("USEAGE")) or None
                signature = (
                    eid,
                    nhi or "",
                    None if qty_n is None else round(float(qty_n), 3),
                    None if days_n is None else int(days_n),
                    useage or "",
                    pay or "",
                )
                if signature in sort_seen_sig:
                    continue
                sort_seen_sig.add(signature)
                med_rows.append(
                    (
                        f"local-medicationrequest-{md5_id(token)}",
                        pid,
                        eid,
                        nhi or None,
                        display,
                        "active",
                        days_n,
                        qty_n,
                        price_n,
                        useage,
                        pay,
                        _clean(decoded.get("MEMO"))[:2] or None,
                    )
                )

    print(
        "write encounters",
        len(encounter_idx),
        "conditions",
        len(condition_idx),
        "notes",
        len(clinical_notes),
        "meds",
        len(med_rows),
    )
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = OFF;")
    cur = conn.cursor()
    _flush(
        cur,
        """
        INSERT OR IGNORE INTO encounter_index (
            resource_id, patient_id, encounter_date, queue_number, queue_status, fhir_status,
            chief_complaint, shift, slot_time, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))
        """,
        encounter_idx,
    )
    _flush(
        cur,
        """
        INSERT OR IGNORE INTO resource_cache
        (resource_type, resource_id, payload_json, created_at, updated_at)
        VALUES (?,?,?, datetime('now'), datetime('now'))
        """,
        encounter_cache,
    )
    _flush(
        cur,
        """
        INSERT OR IGNORE INTO condition_index (
            resource_id, patient_id, encounter_id, icd10_code, snomed_code, nhi_icd10_code,
            summary_text, clinical_status, updated_at
        ) VALUES (?,?,?,?,?,?,?,?, datetime('now'))
        """,
        condition_idx,
    )
    _flush(
        cur,
        """
        INSERT OR IGNORE INTO clinical_note_index (
            resource_id, encounter_id, patient_id, chief_complaint, composition_status, updated_at
        ) VALUES (?,?,?,?, 'final', datetime('now'))
        """,
        clinical_notes,
    )
    _flush(
        cur,
        """
        INSERT OR IGNORE INTO medication_request_index (
            resource_id, patient_id, encounter_id, nhi_code, drug_text, status,
            days_supply, quantity, unit_price, useage, pay_mark, memo_mark, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
        """,
        med_rows,
    )
    conn.commit()
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    after = int(conn.execute("select count(*) from encounter_index").fetchone()[0])
    y2026 = int(
        conn.execute(
            "select count(*) from encounter_index where encounter_date >= '2026-01-01' and encounter_date < '2027-01-01'"
        ).fetchone()[0]
    )
    conn.close()
    print("encounters after", after, "added", after - before, "year_2026", y2026)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
