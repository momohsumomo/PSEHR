#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Yisheng SC -> shadow.db LEAN bulk import.

Field-map DBF columns -> index tables via executemany.
No per-row fat FHIR JSON for meds/conditions.
Only thin Patient+Encounter stubs in resource_cache.

Blank O_DATE visits are kept. The visit day is R_DATE.
Each drug line stores HISTORY.PRICE. Quantity is the on-screen QTY.

  .venv\\Scripts\\python.exe -u scripts\\import_yisheng_lean.py --sc-root Z:\\SC --replace
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.import_yisheng_data import (
    load_maintell_map,
    md5_id,
    parse_dbf_header,
    parse_roc_date,
    read_dbf_records,
)
from src.core.nhi_clinical_mappers import yisheng_selftype_to_pay_mark
from src.core.yisheng_register_fields import (
    decode_register_time,
    map_visit_state,
    parse_serno,
    slot_to_shift,
)

BATCH = 8000


def _clean(s: str | None) -> str:
    return (s or "").replace("\x00", "").strip()


def _flush(cursor: sqlite3.Cursor, sql: str, rows: list[tuple], label: str) -> int:
    if not rows:
        return 0
    total = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i : i + BATCH]
        cursor.executemany(sql, chunk)
        total += len(chunk)
        print(f"  ... {label} {total}/{len(rows)}")
    return total


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sc-root", default=r"Z:\SC")
    ap.add_argument("--db-path", default=str(ROOT / "data" / "shadow.db"))
    ap.add_argument("--replace", action="store_true")
    ap.add_argument("--limit-visits", type=int, default=0)
    args = ap.parse_args()

    dat = Path(args.sc_root) / "dat"
    if not dat.is_dir():
        dat = Path(args.sc_root) / "DAT"
    if not dat.is_dir():
        print("dat not found", args.sc_root)
        return 1

    print("=" * 56)
    print("  Yisheng SC -> shadow LEAN (index bulk, no fat FHIR meds)")
    print("=" * 56)
    print("SC:", dat)
    print("DB:", args.db_path)

    print("\n[1] MEDICAL map...")
    medicine_map: dict[str, tuple[str, str]] = {}
    for r in read_dbf_records(str(dat / "MEDICAL.Dat")):
        drug_no = _clean(r.get("DRUG_NO"))
        last3 = drug_no[-3:] if len(drug_no) >= 3 else drug_no
        if not last3:
            continue
        nhi = _clean(r.get("CODE"))
        making = _clean(r.get("MAKING")) or _clean(r.get("TRADE_NAME")) or nhi or last3
        medicine_map[last3] = (nhi, making)
    print("  drugs=", len(medicine_map))

    print("\n[2] DIAGNOSE map...")
    shortcut_map: dict[str, tuple[str, str]] = {}
    diag_path = dat / "DIAGNOSE.Dat"
    if diag_path.is_file():
        for r in read_dbf_records(str(diag_path)):
            sick = _clean(r.get("SICK_NO"))
            if not sick:
                continue
            icd10 = _clean(r.get("ICD_10CODE"))
            name = _clean(r.get("SICK_NAME")) or _clean(r.get("SICK_NAME1")) or sick
            if sick not in shortcut_map:
                shortcut_map[sick] = (icd10, name)
    print("  dx=", len(shortcut_map))

    print("\n[3] USER -> patient_index...")
    keyword_to_patient: dict[str, str] = {}
    patient_idx: list[tuple] = []
    patient_cache: list[tuple] = []
    for r in read_dbf_records(str(dat / "USER.Dat")):
        keyword = _clean(r.get("KEYWORD"))
        id_no = _clean(r.get("ID")).upper()
        if not keyword or not id_no:
            continue
        name = _clean(r.get("NAME"))
        med_no = _clean(r.get("MEDICAL_NO"))
        sex_raw = _clean(r.get("SEX"))
        sex = "F" if ("\u5973" in sex_raw or "\xa4k" in sex_raw) else "M"
        meta = parse_roc_date(_clean(r.get("BIRTHDAY")))
        birthday_roc, birth_iso = meta if meta else ("0000101", "1911-01-01")
        family = name[0] if len(name) >= 1 else ""
        given = name[1:] if len(name) >= 2 else ""
        pid = f"local-patient-{md5_id(id_no)}"
        keyword_to_patient[keyword] = pid
        tel = _clean(r.get("TEL"))
        addr = _clean(r.get("ADDRESS"))
        id_cat = _clean(r.get("TYPE"))
        patient_idx.append(
            (
                pid,
                family,
                given,
                id_no,
                birth_iso,
                id_no,
                birthday_roc,
                sex,
                med_no or None,
                tel or None,
                addr or None,
                id_cat or None,
            )
        )
        stub = {
            "resourceType": "Patient",
            "id": pid,
            "name": [{"text": name, "family": family, "given": [given] if given else []}],
            "gender": "female" if sex == "F" else "male",
            "birthDate": birth_iso,
            "identifier": [
                {"system": "http://www.moi.gov.tw/id", "value": id_no},
                {"system": "https://clinic.org/chart-number", "value": med_no},
            ],
            "telecom": [{"system": "phone", "value": tel}] if tel else [],
            "address": [{"text": addr}] if addr else [],
            "extension": [
                {
                    "url": "https://clinic.org/fhir/StructureDefinition/patient-clinic-ext",
                    "extension": [
                        {"url": "idCategory", "valueString": id_cat},
                    ],
                }
            ],
        }
        patient_cache.append(("Patient", pid, json.dumps(stub, ensure_ascii=False)))
    print("  patients=", len(patient_idx))

    print("\n[4] REGISTER -> encounter_index...")
    visit_limit = args.limit_visits if args.limit_visits and args.limit_visits > 0 else None
    reg_rows = read_dbf_records(str(dat / "REGISTER.Dat"), limit=visit_limit)
    preview_keys: set[str] = set()
    for r in reg_rows:
        kw = _clean(r.get("KEYWORD"))
        tn = _clean(r.get("TIMESNO"))
        if kw:
            preview_keys.add(f"{kw}{tn}")
    maintell_map = (
        load_maintell_map(str(dat / "MAINTELL.Dat"), preview_keys)
        if (dat / "MAINTELL.Dat").is_file()
        else {}
    )
    print("  MAINTELL=", len(maintell_map))

    visit_keys: set[str] = set()
    keyword_times_to_eid: dict[str, str] = {}
    encounter_idx: list[tuple] = []
    encounter_cache: list[tuple] = []
    clinical_notes: list[tuple] = []
    condition_idx: list[tuple] = []

    for r in reg_rows:
        keyword = _clean(r.get("KEYWORD"))
        timesno = _clean(r.get("TIMESNO"))
        o_date = _clean(r.get("O_DATE"))
        visit_state = map_visit_state(
            r.get("STATUS"),
            r.get("D_END"),
            r.get("ICNO"),
            receipts=r.get("RECEIPTS"),
            diagnose=r.get("DIAGNOSE"),
            caseno=r.get("CASENO"),
            forespeak=r.get("FORESPEAK"),
        )
        if visit_state.get("void"):
            continue
        patient_id = keyword_to_patient.get(keyword)
        if not patient_id:
            continue
        o_meta = parse_roc_date(o_date)
        r_meta = parse_roc_date(_clean(r.get("R_DATE")))
        # O_DATE is sometimes blank. The visit day is R_DATE. The encounter
        # id still uses the raw O_DATE text, including empty, so a later
        # backfill finds the same visit.
        if not o_meta and not r_meta:
            continue
        iso_visit = r_meta[1] if r_meta else o_meta[1]
        slot_time = decode_register_time(r.get("TIME")) or (
            "14:00"
            if _clean(r.get("SLOT")) == "2"
            else ("18:00" if _clean(r.get("SLOT")) == "3" else "09:00")
        )
        serno = parse_serno(r.get("SERNO"))
        shift = slot_to_shift(r.get("SLOT"))
        eid = f"local-encounter-{md5_id(f'{keyword}-{o_date}-{timesno}')}"
        vkey = f"{keyword}{timesno}"
        visit_keys.add(vkey)
        keyword_times_to_eid[vkey] = eid
        chief = (maintell_map.get(vkey) or "").strip() or _clean(r.get("MAINTELL"))
        encounter_idx.append(
            (
                eid,
                patient_id,
                iso_visit,
                serno,
                visit_state["queue_status"],
                visit_state["fhir_status"],
                chief[:4000] if chief else None,
                shift or None,
                slot_time,
            )
        )
        stub = {
            "resourceType": "Encounter",
            "id": eid,
            "status": visit_state["fhir_status"],
            "class": {"text": "OPD"},
            "subject": {"reference": f"Patient/{patient_id}"},
            "period": {"start": f"{iso_visit}T{slot_time}:00+08:00"},
            "reasonCode": [{"text": chief[:4000]}] if chief else [],
            "extension": [
                {
                    "url": "https://clinic.org/fhir/StructureDefinition/queue",
                    "extension": [
                        {"url": "queueNumber", "valueInteger": serno},
                        {"url": "queueStatus", "valueCode": visit_state["queue_status"]},
                    ],
                },
                {
                    "url": "https://clinic.org/fhir/StructureDefinition/reg",
                    "extension": [
                        {"url": "shift", "valueString": shift or ""},
                        {"url": "caseNo", "valueString": _clean(r.get("CASENO"))},
                        {"url": "forespeak", "valueString": _clean(r.get("FORESPEAK"))},
                        {"url": "noteMark", "valueString": _clean(r.get("REMARK"))[:40]},
                        {"url": "cardWritten", "valueBoolean": bool(visit_state.get("card_written"))},
                        {"url": "prebook", "valueBoolean": bool(visit_state.get("prebook") or visit_state.get("appointment"))},
                    ],
                },
            ],
        }
        encounter_cache.append(("Encounter", eid, json.dumps(stub, ensure_ascii=False)))
        if chief:
            note_id = f"local-composition-{md5_id(eid + '-cc')}"
            clinical_notes.append((note_id, eid, patient_id, chief[:4000]))

        diagnose_field = _clean(r.get("DIAGNOSE"))
        if diagnose_field:
            # Yisheng packs up to N diagnoses as contiguous 4-char SICK_NO
            parts = [
                diagnose_field[x : x + 4].strip()
                for x in range(0, len(diagnose_field), 4)
            ]
            parts = [p for p in parts if p]
            for i, sick in enumerate(parts[:8]):
                icd10, dname = shortcut_map.get(sick, ("", ""))
                if not dname:
                    dname = sick
                cid = f"local-condition-{md5_id(f'{eid}-{sick}-{i}')}"
                condition_idx.append(
                    (
                        cid,
                        patient_id,
                        eid,
                        icd10 or None,
                        None,
                        icd10 or None,
                        dname,
                        "active",
                    )
                )

    print("  encounters=", len(encounter_idx), "conditions=", len(condition_idx))

    print("\n[5] HISTORY -> medication_request_index ONLY...")
    fpt_path = dat / "HISTORY.FPT"
    fpt_file = open(fpt_path, "rb") if fpt_path.is_file() else None
    fpt_block = 64
    if fpt_file is not None:
        fpt_head = fpt_file.read(16)
        fpt_block = int.from_bytes(fpt_head[6:8], "big") or 64

    def history_memo(token: str | None) -> str | None:
        if fpt_file is None:
            return None
        text = (token or "").strip()
        if not text.isdigit():
            return None
        block = int(text)
        if block <= 0:
            return None
        fpt_file.seek(block * fpt_block)
        meta = fpt_file.read(8)
        if len(meta) < 8:
            return None
        length = int.from_bytes(meta[4:8], "big")
        if length <= 0 or length > 4000:
            return None
        raw = fpt_file.read(length)
        cleaned = " ".join(raw.decode("cp950", errors="ignore").split())
        return cleaned or None

    med_idx: list[tuple] = []
    sort_seen: dict[str, int] = {}
    sort_seen_sig: set[tuple] = set()
    hist_path = str(dat / "HISTORY.Dat")
    hist_meta = parse_dbf_header(hist_path)
    if hist_meta:
        num_hist, header_len, rec_len, fields = hist_meta
        print("  scanning", num_hist, "HISTORY rows...")
        with open(hist_path, "rb") as f:
            f.seek(header_len)
            for i in range(num_hist):
                if i and i % 200000 == 0:
                    print(f"  ... HISTORY {i}/{num_hist} matched={len(med_idx)}")
                data = f.read(rec_len)
                if len(data) < rec_len:
                    break
                if data[0] == 0x2A:
                    continue
                keywords = data[1:7].decode("cp950", errors="ignore").strip()
                if keywords not in visit_keys:
                    continue
                row = {
                    name: data[offset : offset + length]
                    .decode("cp950", errors="ignore")
                    .strip()
                    for name, typ, length, offset in fields
                }
                eid = keyword_times_to_eid[keywords]
                drug_no = _clean(row.get("DRUG_NO"))
                last3 = drug_no[-3:] if len(drug_no) >= 3 else drug_no
                nhi, display = medicine_map.get(last3, (drug_no, f"UNMAPPED {drug_no}"))
                useage = _clean(row.get("USEAGE"))
                day_str = _clean(row.get("DAY"))
                qty_str = _clean(row.get("QTY"))
                sort_seq = _clean(row.get("SORT")) or "1"
                pay_mark = yisheng_selftype_to_pay_mark(_clean(row.get("SELFTYPE")))
                memo_mark = _clean(row.get("MEMO"))[:2]
                body_site = history_memo(row.get("REMARK"))
                price_str = _clean(row.get("PRICE"))
                try:
                    days_n = int(float(day_str)) if day_str else None
                except ValueError:
                    days_n = None
                try:
                    qty_n = float(qty_str) if qty_str else None
                except ValueError:
                    qty_n = None
                try:
                    price_n = float(price_str) if price_str else None
                except ValueError:
                    price_n = None
                bucket = eid + "-" + sort_seq
                nth = sort_seen.get(bucket, 0)
                sort_seen[bucket] = nth + 1
                token = bucket if nth == 0 else bucket + "-" + str(nth)
                signature = (
                    eid,
                    nhi or "",
                    None if qty_n is None else round(float(qty_n), 3),
                    None if days_n is None else int(days_n),
                    useage or "",
                    pay_mark or "",
                    body_site or "",
                )
                if signature in sort_seen_sig:
                    continue
                sort_seen_sig.add(signature)
                mid = f"local-medicationrequest-{md5_id(token)}"
                med_idx.append(
                    (
                        mid,
                        eid,
                        nhi or None,
                        display,
                        days_n,
                        qty_n,
                        price_n,
                        useage or None,
                        pay_mark or None,
                        memo_mark or None,
                        body_site,
                    )
                )
    if fpt_file is not None:
        fpt_file.close()

    eid_to_patient = {t[0]: t[1] for t in encounter_idx}
    med_rows_final: list[tuple] = []
    for mid, eid, nhi, display, days_n, qty_n, price_n, useage, pay_mark, memo_mark, body_site in med_idx:
        pid = eid_to_patient.get(eid)
        if not pid:
            continue
        med_rows_final.append(
            (
                mid,
                pid,
                eid,
                nhi,
                display,
                "active",
                days_n,
                qty_n,
                price_n,
                useage,
                pay_mark,
                memo_mark,
                body_site,
            )
        )
    print("  medications=", len(med_rows_final))

    print("\n[6] bulk write", args.db_path)
    os.makedirs(os.path.dirname(args.db_path) or ".", exist_ok=True)
    if args.replace and os.path.exists(args.db_path):
        for suffix in ("", "-wal", "-shm"):
            p = args.db_path + suffix if suffix else args.db_path
            try:
                os.remove(p)
                print("  removed", p)
            except OSError:
                pass

    from src.infrastructure.sqlite_shadow_store import _SCHEMA, _apply_index_migrations

    conn = sqlite3.connect(args.db_path)
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = OFF;")
    conn.execute("PRAGMA temp_store = MEMORY;")
    conn.execute("PRAGMA cache_size = -200000;")
    cur = conn.cursor()
    cur.executescript(_SCHEMA)
    _apply_index_migrations(conn)
    for ddl in (
        "ALTER TABLE encounter_index ADD COLUMN chief_complaint TEXT",
        "ALTER TABLE encounter_index ADD COLUMN shift TEXT",
        "ALTER TABLE encounter_index ADD COLUMN slot_time TEXT",
        "ALTER TABLE medication_request_index ADD COLUMN useage TEXT",
        "ALTER TABLE medication_request_index ADD COLUMN pay_mark TEXT",
        "ALTER TABLE medication_request_index ADD COLUMN memo_mark TEXT",
        "ALTER TABLE medication_request_index ADD COLUMN body_site TEXT",
    ):
        try:
            cur.execute(ddl)
        except sqlite3.OperationalError:
            pass
    conn.commit()

    print("  patients...")
    _flush(
        cur,
        """
        INSERT OR REPLACE INTO patient_index (
            resource_id, family_name, given_name, identifier, birth_date,
            id_no, birthday_roc, sex, medical_no, phone, address, id_category, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
        """,
        patient_idx,
        "patient_index",
    )
    _flush(
        cur,
        """
        INSERT OR REPLACE INTO resource_cache
        (resource_type, resource_id, payload_json, created_at, updated_at)
        VALUES (?,?,?, datetime('now'), datetime('now'))
        """,
        patient_cache,
        "Patient cache",
    )
    conn.commit()

    print("  encounters...")
    cols = {r[1] for r in cur.execute("PRAGMA table_info(encounter_index)").fetchall()}
    if "chief_complaint" in cols:
        _flush(
            cur,
            """
            INSERT OR REPLACE INTO encounter_index (
                resource_id, patient_id, encounter_date, queue_number, queue_status, fhir_status,
                chief_complaint, shift, slot_time, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))
            """,
            encounter_idx,
            "encounter_index",
        )
    else:
        _flush(
            cur,
            """
            INSERT OR REPLACE INTO encounter_index (
                resource_id, patient_id, encounter_date, queue_number, queue_status, fhir_status, updated_at
            ) VALUES (?,?,?,?,?,?, datetime('now'))
            """,
            [t[:6] for t in encounter_idx],
            "encounter_index",
        )
    _flush(
        cur,
        """
        INSERT OR REPLACE INTO resource_cache
        (resource_type, resource_id, payload_json, created_at, updated_at)
        VALUES (?,?,?, datetime('now'), datetime('now'))
        """,
        encounter_cache,
        "Encounter cache",
    )
    conn.commit()

    print("  conditions...")
    _flush(
        cur,
        """
        INSERT OR REPLACE INTO condition_index (
            resource_id, patient_id, encounter_id, icd10_code, snomed_code, nhi_icd10_code,
            summary_text, clinical_status, updated_at
        ) VALUES (?,?,?,?,?,?,?,?, datetime('now'))
        """,
        condition_idx,
        "condition_index",
    )
    conn.commit()

    print("  clinical notes...")
    _flush(
        cur,
        """
        INSERT OR REPLACE INTO clinical_note_index (
            resource_id, encounter_id, patient_id, chief_complaint, composition_status, updated_at
        ) VALUES (?,?,?,?, 'final', datetime('now'))
        """,
        clinical_notes,
        "clinical_note_index",
    )
    conn.commit()

    print("  medications (index only)...")
    med_cols = {
        r[1] for r in cur.execute("PRAGMA table_info(medication_request_index)").fetchall()
    }
    if "useage" in med_cols and "unit_price" in med_cols:
        _flush(
            cur,
            """
            INSERT OR REPLACE INTO medication_request_index (
                resource_id, patient_id, encounter_id, nhi_code, drug_text, status,
                days_supply, quantity, unit_price, useage, pay_mark, memo_mark, body_site, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
            """,
            med_rows_final,
            "medication_request_index",
        )
    elif "useage" in med_cols:
        _flush(
            cur,
            """
            INSERT OR REPLACE INTO medication_request_index (
                resource_id, patient_id, encounter_id, nhi_code, drug_text, status,
                days_supply, quantity, useage, pay_mark, memo_mark, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
            """,
            [t[:8] + t[9:12] for t in med_rows_final],
            "medication_request_index",
        )
    else:
        _flush(
            cur,
            """
            INSERT OR REPLACE INTO medication_request_index (
                resource_id, patient_id, encounter_id, nhi_code, drug_text, status,
                days_supply, quantity, updated_at
            ) VALUES (?,?,?,?,?,?,?,?, datetime('now'))
            """,
            [t[:8] for t in med_rows_final],
            "medication_request_index",
        )
    conn.commit()

    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    conn.close()

    c2 = sqlite3.connect(args.db_path)

    def cnt(t: str) -> int:
        return int(c2.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0])

    mb = os.path.getsize(args.db_path) / 1024 / 1024
    print("\n" + "=" * 56)
    print("  DONE LEAN")
    print("  patients    ", f"{cnt('patient_index'):,}")
    print("  encounters  ", f"{cnt('encounter_index'):,}")
    print("  conditions  ", f"{cnt('condition_index'):,}")
    print("  medications ", f"{cnt('medication_request_index'):,}")
    print("  notes       ", f"{cnt('clinical_note_index'):,}")
    print("  cache rows  ", f"{cnt('resource_cache'):,}", "(Patient+Encounter thin only)")
    print("  db size     ", f"{mb:.0f} MB")
    print("=" * 56)
    c2.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
