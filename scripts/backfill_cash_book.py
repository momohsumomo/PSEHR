#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Cash-book gaps vs Yisheng REGISTER / ACOUNT / USER.

- Insert paid visits previously skipped because DIAGNOSE starts with '!'.
- Store TIMESNO (01 = first visit) and STATUS 0 (owe-card) on encounter_index.
- Load ACOUNT.Dat type-2 amounts as cash_return (deposit refund / ???).
- Copy USER.CPARTPAY onto Patient.copayDisc (1/2/3).
"""

from __future__ import annotations

import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.import_yisheng_data import md5_id, parse_dbf_header, parse_roc_date
from src.core.encounter_extensions import QUEUE_EXTENSION_URL, attach_reg_extension
from src.core.yisheng_register_fields import (
    decode_register_time,
    is_register_void,
    map_visit_state,
    parse_serno,
    slot_to_shift,
)
from src.infrastructure.sqlite_shadow_store import _apply_index_migrations

BATCH = 4000


def _clean(value: str | None) -> str:
    return (value or "").replace("\x00", "").strip()


def _num(value: str) -> int:
    try:
        return int(float(value or 0))
    except ValueError:
        return 0


def _iter_fields(path: Path, names: tuple[str, ...]):
    num, hlen, rlen, fields = parse_dbf_header(str(path))
    idx = {name: (off, length) for name, _typ, length, off in fields}

    def take(buf: bytes, name: str) -> str:
        off, length = idx[name]
        return buf[off : off + length].decode("cp950", errors="ignore").strip().replace("\x00", "")

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


def _disc_mode(raw: str) -> str:
    ch = _clean(raw)[:1]
    return ch if ch in {"1", "2", "3"} else "1"


def _set_copay_disc(payload: dict, mode: str) -> bool:
    exts = payload.setdefault("extension", [])
    hit = None
    for ext in exts:
        if "patient-clinic-ext" in str(ext.get("url") or ""):
            hit = ext
            break
    if hit is None:
        hit = {
            "url": "https://clinic.org/fhir/StructureDefinition/patient-clinic-ext",
            "extension": [],
        }
        exts.append(hit)
    subs = hit.setdefault("extension", [])
    for sub in subs:
        if sub.get("url") == "copayDisc":
            if str(sub.get("valueString") or "") == mode:
                return False
            sub["valueString"] = mode
            return True
    subs.append({"url": "copayDisc", "valueString": mode})
    return True


def main() -> int:
    dat = Path(r"Z:\SC\dat")
    db_path = ROOT / "data" / "shadow.db"
    conn = sqlite3.connect(str(db_path), timeout=180)
    _apply_index_migrations(conn)
    conn.commit()

    known = {row[0] for row in conn.execute("select resource_id from encounter_index")}
    patients = {row[0] for row in conn.execute("select resource_id from patient_index")}
    print("encounters", len(known), "patients", len(patients))

    keyword_to_patient: dict[str, str] = {}
    user_disc: list[tuple[str, str]] = []
    for row in _iter_fields(dat / "USER.Dat", ("KEYWORD", "ID", "CPARTPAY")):
        keyword = _clean(row["KEYWORD"])
        id_no = _clean(row["ID"]).upper()
        if keyword and id_no:
            pid = f"local-patient-{md5_id(id_no)}"
            if pid in patients:
                keyword_to_patient[keyword] = pid
                user_disc.append((pid, _disc_mode(row["CPARTPAY"])))
    print("keyword map", len(keyword_to_patient))

    refunds = []
    refund_kws: set[str] = set()
    for row in _iter_fields(dat / "ACOUNT.Dat", ("KEYWORDS", "R_DATE", "TYPE", "MONEY")):
        meta = parse_roc_date(_clean(row["R_DATE"]))
        if not meta:
            continue
        kw = _clean(row["KEYWORDS"])[:4]
        amount = _num(row["MONEY"])
        refunds.append((meta[1], amount, _clean(row["KEYWORDS"]), kw))
        if kw:
            refund_kws.add(kw)
    print("refunds", len(refunds), "keywords", len(refund_kws))

    reg_names = (
        "KEYWORD", "TIMESNO", "O_DATE", "R_DATE", "STATUS", "SLOT", "SERNO", "TIME",
        "CASENO", "PARTPAYNO", "KEYMONEY", "PARTPAYMO", "REGISTER", "SELF_PRICE",
        "RECEIPTS", "ARREARAGE", "DISCARD", "DISDRUG", "DRUG_PRICE", "TREA_PRICE",
        "ICNO", "DIAGNOSE", "FORESPEAK", "D_END",
    )
    updates: dict[str, tuple[int, int]] = {}
    inserts_idx: list[tuple] = []
    inserts_cache: list[tuple] = []
    hist: dict[str, list[tuple[str, str]]] = defaultdict(list)
    skipped_void = 0
    for row in _iter_fields(dat / "REGISTER.Dat", reg_names):
        keyword = _clean(row["KEYWORD"])
        if keyword in refund_kws:
            rmeta = parse_roc_date(_clean(row["R_DATE"]))
            if rmeta:
                hist[keyword].append((rmeta[1], _clean(row["PARTPAYNO"])))
        void = is_register_void(
            row["STATUS"],
            receipts=row["RECEIPTS"],
            icno=row["ICNO"],
            diagnose=row["DIAGNOSE"],
            caseno=row["CASENO"],
        )
        if void:
            skipped_void += 1
            continue
        pid = keyword_to_patient.get(keyword)
        if not pid:
            continue
        o_date = _clean(row["O_DATE"])
        rmeta = parse_roc_date(_clean(row["R_DATE"]))
        ometa = parse_roc_date(o_date)
        if not rmeta and not ometa:
            continue
        iso = (rmeta or ometa)[1]
        timesno = _clean(row["TIMESNO"])
        try:
            times_n = int(timesno)
        except ValueError:
            times_n = 0
        owe = 1 if _clean(row["STATUS"]) == "0" else 0
        eid = f"local-encounter-{md5_id(keyword + '-' + o_date + '-' + timesno)}"
        if eid in known:
            updates[eid] = (times_n, owe)
            continue
        state = map_visit_state(
            row["STATUS"],
            row["D_END"],
            row["ICNO"],
            receipts=row["RECEIPTS"],
            diagnose=row["DIAGNOSE"],
            caseno=row["CASENO"],
            forespeak=row["FORESPEAK"],
        )
        slot_raw = _clean(row["SLOT"])
        slot_time = decode_register_time(row["TIME"]) or (
            "14:00" if slot_raw == "2" else "18:00" if slot_raw == "3" else "09:00"
        )
        shift = slot_to_shift(row["SLOT"])
        serno = parse_serno(row["SERNO"])
        payload = {
            "resourceType": "Encounter",
            "id": eid,
            "status": state["fhir_status"],
            "class": {"text": "OPD"},
            "subject": {"reference": f"Patient/{pid}"},
            "period": {"start": f"{iso}T{slot_time}:00+08:00"},
            "extension": [
                {
                    "url": QUEUE_EXTENSION_URL,
                    "extension": [
                        {"url": "queueNumber", "valueInteger": serno},
                        {"url": "queueStatus", "valueCode": state["queue_status"]},
                    ],
                }
            ],
        }
        payload = attach_reg_extension(
            payload,
            {
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
            },
        )
        inserts_idx.append(
            (
                eid,
                pid,
                iso,
                serno,
                state["queue_status"],
                state["fhir_status"],
                shift or None,
                slot_time,
                times_n,
                owe,
            )
        )
        inserts_cache.append(("Encounter", eid, json.dumps(payload, ensure_ascii=False)))
        known.add(eid)
        updates[eid] = (times_n, owe)

    print("flag updates", len(updates), "insert", len(inserts_idx), "void skipped", skipped_void)

    for rows in hist.values():
        rows.sort()

    cash_rows = []
    for iso, amount, keywords, kw in refunds:
        part = "D12"
        for visit_iso, code in hist.get(kw, []):
            if visit_iso <= iso and code:
                part = code
        cash_rows.append((iso, amount, keywords, part))

    print("patients disc...")
    disc_by_pid: dict[str, str] = {}
    for pid, mode in user_disc:
        disc_by_pid[pid] = mode
    patient_rows = conn.execute(
        "select resource_id, payload_json from resource_cache where resource_type='Patient'"
    ).fetchall()
    patient_updates = []
    for pid, raw in patient_rows:
        mode = disc_by_pid.get(pid)
        if not mode:
            continue
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if _set_copay_disc(payload, mode):
            patient_updates.append((json.dumps(payload, ensure_ascii=False), pid))
    print("patient payloads", len(patient_updates))

    conn.execute("PRAGMA synchronous = OFF;")
    cur = conn.cursor()
    _flush(
        cur,
        "UPDATE encounter_index SET times_no=?, owe_card=? WHERE resource_id=?",
        [(times_n, owe, eid) for eid, (times_n, owe) in updates.items()],
    )
    _flush(
        cur,
        """
        INSERT OR IGNORE INTO encounter_index (
            resource_id, patient_id, encounter_date, queue_number, queue_status, fhir_status,
            shift, slot_time, times_no, owe_card, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'))
        """,
        inserts_idx,
    )
    _flush(
        cur,
        """
        INSERT OR IGNORE INTO resource_cache
        (resource_type, resource_id, payload_json, created_at, updated_at)
        VALUES (?,?,?, datetime('now'), datetime('now'))
        """,
        inserts_cache,
    )
    cur.execute("DELETE FROM cash_return")
    _flush(
        cur,
        "INSERT INTO cash_return (encounter_date, amount, keywords, copay_code) VALUES (?,?,?,?)",
        cash_rows,
    )
    _flush(
        cur,
        """
        UPDATE resource_cache SET payload_json=?, updated_at=datetime('now')
        WHERE resource_type='Patient' AND resource_id=?
        """,
        patient_updates,
    )
    conn.commit()
    conn.execute("PRAGMA synchronous = NORMAL;")
    day = conn.execute(
        """
        select count(*),
               sum(case when times_no=1 then 1 else 0 end),
               sum(case when owe_card=1 then 1 else 0 end)
        from encounter_index
        where encounter_date='2026-10-06'
          and ifnull(queue_status,'')!='cancelled'
        """
    ).fetchone()
    money = conn.execute(
        "select count(*), coalesce(sum(amount),0) from cash_return where encounter_date='2026-10-06'"
    ).fetchone()
    print("2026-10-06 visits", day[0], "first", day[1], "owe", day[2])
    print("2026-10-06 returns", money[0], money[1])
    print("encounters now", conn.execute("select count(*) from encounter_index").fetchone()[0])
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
