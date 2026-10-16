# -*- coding: utf-8 -*-
"""Insert every REGISTER row whose diagnosis is !07Y and receipts are 0.

All years. Fees stay at the amounts on the row (these rows are zero).
Does not touch cash_return or existing encounters.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.import_yisheng_data import md5_id, parse_dbf_header, parse_roc_date
from src.core.encounter_extensions import QUEUE_EXTENSION_URL, attach_reg_extension, put_reg_string
from src.core.yisheng_register_fields import (
    decode_register_time,
    map_visit_state,
    parse_serno,
    remark_text,
    slot_to_shift,
)

NAMES = (
    "KEYWORD", "TIMESNO", "O_DATE", "R_DATE", "STATUS", "D_END", "ICNO",
    "DIAGNOSE", "RECEIPTS", "CC", "REMARK", "CASENO", "PARTPAYNO", "FORESPEAK",
    "TIME", "SLOT", "SERNO", "REGISTER", "PARTPAYMO", "KEYMONEY", "DRUG_PRICE",
    "TREA_PRICE", "SELF_PRICE", "DISCARD", "DISDRUG", "ARREARAGE",
)


def _money(text: str) -> int:
    try:
        return int(float((text or "0").replace(",", "") or "0"))
    except ValueError:
        return 0


def main() -> int:
    dat_path = Path(r"Z:\SC\dat\REGISTER.Dat")
    user_path = Path(r"Z:\SC\dat\USER.Dat")
    db_path = ROOT / "data" / "shadow.db"
    num, hlen, rlen, fields = parse_dbf_header(str(dat_path))
    idx = {name: (off, length) for name, _typ, length, off in fields}
    missing = [name for name in NAMES if name not in idx]
    if missing:
        print("missing fields", ",".join(missing))
        return 1

    def take(buf: bytes, name: str, *, raw: bool = False) -> str:
        off, length = idx[name]
        text = buf[off:off + length].decode("cp950", errors="ignore").replace("\x00", "")
        return text if raw else text.strip()

    unum, uhlen, urlen, ufields = parse_dbf_header(str(user_path))
    uidx = {name: (off, length) for name, _typ, length, off in ufields}

    def utake(buf: bytes, name: str) -> str:
        off, length = uidx[name]
        return buf[off:off + length].decode("cp950", errors="ignore").replace("\x00", "").strip()

    conn = sqlite3.connect(db_path)
    known_patients = {row[0] for row in conn.execute("SELECT resource_id FROM patient_index")}
    known_enc = {row[0] for row in conn.execute("SELECT resource_id FROM encounter_index")}
    keyword_pid: dict[str, str] = {}
    with user_path.open("rb") as handle:
        handle.seek(uhlen)
        for _ in range(unum):
            buf = handle.read(urlen)
            if len(buf) < urlen or buf[0:1] == b"*":
                continue
            keyword = utake(buf, "KEYWORD")
            id_no = utake(buf, "ID").upper()
            if not keyword:
                continue
            pid = ""
            if id_no:
                candidate = "local-patient-" + md5_id(id_no)
                if candidate in known_patients:
                    pid = candidate
            if not pid:
                candidate = "local-patient-" + md5_id("noid:" + keyword)
                if candidate in known_patients:
                    pid = candidate
            if pid:
                keyword_pid[keyword] = pid

    fee_before = conn.execute("SELECT COALESCE(SUM(fee_total), 0) FROM encounter_index").fetchone()[0]
    found: Counter[str] = Counter()
    added: Counter[str] = Counter()
    already: Counter[str] = Counter()
    skipped: Counter[str] = Counter()
    marks: Counter[str] = Counter()
    enc_rows: list[tuple] = []
    cache_rows: list[tuple] = []
    cond_rows: list[tuple] = []

    with dat_path.open("rb") as handle:
        handle.seek(hlen)
        for _ in range(num):
            buf = handle.read(rlen)
            if len(buf) < rlen or buf[0:1] == b"*":
                continue
            diag = take(buf, "DIAGNOSE")
            rec = take(buf, "RECEIPTS")
            if not (diag.startswith("!07Y") and rec in {"", "0"}):
                continue
            clinic = parse_roc_date(take(buf, "R_DATE")) or parse_roc_date(take(buf, "O_DATE"))
            year = clinic[1][:4] if clinic else "????"
            found[year] += 1
            cc = take(buf, "CC", raw=True)
            if len(cc) < 6:
                cc = cc.ljust(6)
            cc = cc[:6]
            extra = "".join(ch for i, ch in enumerate(cc) if i != 3 and ch not in " ")
            if extra:
                marks[extra] += 1
            keyword = take(buf, "KEYWORD")
            eid = "local-encounter-" + md5_id(
                keyword + "-" + take(buf, "O_DATE") + "-" + take(buf, "TIMESNO")
            )
            if eid in known_enc:
                already[year] += 1
                continue
            pid = keyword_pid.get(keyword, "")
            if not pid or not clinic:
                skipped[year] += 1
                continue
            state = map_visit_state(
                take(buf, "STATUS"),
                take(buf, "D_END"),
                take(buf, "ICNO"),
                receipts=rec,
                diagnose=diag,
                caseno=take(buf, "CASENO"),
                forespeak=take(buf, "FORESPEAK"),
            )
            iso = clinic[1]
            slot_raw = take(buf, "SLOT")
            slot_time = decode_register_time(take(buf, "TIME")) or (
                "14:00" if slot_raw == "2" else "18:00" if slot_raw == "3" else "09:00"
            )
            serno = parse_serno(take(buf, "SERNO"))
            shift = slot_to_shift(slot_raw)
            remark = remark_text(take(buf, "REMARK"))
            case_no = take(buf, "CASENO")
            copay = take(buf, "PARTPAYNO")
            fees = (
                _money(take(buf, "KEYMONEY")),
                _money(take(buf, "PARTPAYMO")),
                _money(take(buf, "DISCARD")),
                _money(take(buf, "DISDRUG")),
                _money(take(buf, "REGISTER")),
                _money(take(buf, "SELF_PRICE")),
                _money(rec),
                _money(take(buf, "ARREARAGE")),
            )
            enc_rows.append(
                (
                    eid, pid, iso, serno, state["queue_status"], state["fhir_status"],
                    copay, case_no, *fees, cc, remark, shift, slot_time,
                )
            )
            payload = {
                "resourceType": "Encounter",
                "id": eid,
                "status": state["fhir_status"],
                "class": {"text": "OPD"},
                "subject": {"reference": "Patient/" + pid},
                "period": {"start": iso + "T" + slot_time + ":00+08:00"},
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
                    "caseNo": case_no or None,
                    "copayCode": copay or None,
                    "noteMark": remark or None,
                    "shift": shift,
                    "deposit": str(fees[0]),
                    "copayAmt": str(fees[1]),
                    "cardDisc": str(fees[2]),
                    "drugDisc": str(fees[3]),
                    "regFee": str(fees[4]),
                    "selfPay": str(fees[5]),
                    "totalFee": str(fees[6]),
                    "arrears": str(fees[7]),
                },
            )
            put_reg_string(payload, "regCc", cc)
            cache_rows.append((eid, json.dumps(payload, ensure_ascii=False)))
            cond_rows.append(
                (
                    "local-condition-" + md5_id(eid + "-07Y"),
                    pid,
                    eid,
                    diag[:12],
                    "active",
                )
            )
            known_enc.add(eid)
            added[year] += 1

    conn.execute("BEGIN")
    conn.executemany(
        """
        INSERT OR IGNORE INTO encounter_index (
            resource_id, patient_id, encounter_date, queue_number, queue_status, fhir_status,
            copay_code, case_no, fee_deposit, fee_copay, fee_card_disc, fee_drug_disc,
            fee_reg, fee_self, fee_total, fee_arrears, reg_cc, reg_remark, shift, slot_time,
            updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
        """,
        enc_rows,
    )
    conn.executemany(
        """
        INSERT OR IGNORE INTO resource_cache
        (resource_type, resource_id, payload_json, created_at, updated_at)
        VALUES ('Encounter', ?, ?, datetime('now'), datetime('now'))
        """,
        cache_rows,
    )
    conn.executemany(
        """
        INSERT OR IGNORE INTO condition_index (
            resource_id, patient_id, encounter_id, summary_text, clinical_status, updated_at
        ) VALUES (?,?,?,?,?, datetime('now'))
        """,
        cond_rows,
    )
    conn.commit()
    fee_after = conn.execute("SELECT COALESCE(SUM(fee_total), 0) FROM encounter_index").fetchone()[0]
    conn.close()
    print("found", dict(sorted(found.items())))
    print("already", dict(sorted(already.items())))
    print("added", dict(sorted(added.items())))
    print("skipped", dict(sorted(skipped.items())))
    print("extra_marks", dict(marks))
    print("fee_total", fee_before, fee_after, "delta", int(fee_after) - int(fee_before))
    print("rows", len(enc_rows))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
