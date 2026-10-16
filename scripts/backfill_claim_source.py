# -*- coding: utf-8 -*-
"""Fill claim fields the lean import left behind.

REGISTER.DOCTOR / ICNO  -> encounter doctor and treat sequence.
STATUS 0 is an owe-card visit that was still seen and claimed. Those rows
keep their doctor and card sequence. STATUS A is only an appointment.
HISTORY.PRICE / CTOTALQTY / USE_TYPE -> the price and total used on that visit.
Self-pay lines stay on the chart; the claim builder skips them.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.backfill_cash_book import _iter_fields
from scripts.import_yisheng_data import md5_id, read_dbf_records
from src.core.encounter_extensions import attach_reg_extension
from src.infrastructure.sqlite_shadow_store import _apply_index_migrations

BATCH = 2000


def _num(value: str) -> float | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _staff_by_serial(dat: Path) -> dict[str, str]:
    people = next(p for p in dat.iterdir() if p.name.upper() == "PEOPLE.DAT")
    out: dict[str, str] = {}
    for row in read_dbf_records(str(people)):
        serial = (row.get("SERIAL") or "").strip()
        username = (row.get("USERNAME") or "").strip()
        if not serial or not username:
            continue
        out[serial.zfill(2)] = f"ys-{username}"
    return out


def main() -> int:
    dat = Path(r"Z:\SC\dat")
    db_path = ROOT / "data" / "shadow.db"
    conn = sqlite3.connect(str(db_path), timeout=180)
    _apply_index_migrations(conn)
    conn.commit()

    profile_raw = conn.execute(
        "SELECT value FROM clinic_runtime_settings WHERE key = ?",
        ("clinic_profile_v1",),
    ).fetchone()
    default_pharm = ""
    if profile_raw and profile_raw[0]:
        bundle = json.loads(profile_raw[0])
        default_pharm = str((bundle.get("profile") or {}).get("defaultPharmacistId") or "")
    serial_staff = _staff_by_serial(dat)
    print("default pharmacist", default_pharm or "(none)", "people", len(serial_staff))

    known = {row[0] for row in conn.execute("SELECT resource_id FROM encounter_index")}
    print("encounters", len(known))

    visit_keys: dict[str, str] = {}
    enc_rows: list[tuple] = []
    for row in _iter_fields(
        dat / "REGISTER.Dat",
        ("KEYWORD", "TIMESNO", "O_DATE", "DOCTOR", "PHARMACY", "ICNO", "STATUS"),
    ):
        if row["STATUS"] == "A":
            continue
        keyword = row["KEYWORD"]
        timesno = row["TIMESNO"]
        o_date = row["O_DATE"]
        eid = "local-encounter-" + md5_id(keyword + "-" + o_date + "-" + timesno)
        if eid not in known:
            continue
        doctor = serial_staff.get(row["DOCTOR"].zfill(2) if row["DOCTOR"].strip() else "", "")
        pharmacist = default_pharm if row["PHARMACY"].strip() == "0" else ""
        seq = row["ICNO"].strip()
        enc_rows.append((doctor, pharmacist, seq, eid))
        visit_keys[keyword + timesno] = eid
    print("matched visits", len(enc_rows))
    conn.executemany(
        """
        UPDATE encounter_index
        SET claim_doctor_id = ?, claim_pharmacist_id = ?, treat_seq = ?
        WHERE resource_id = ?
        """,
        enc_rows,
    )
    conn.commit()

    known_meds = {row[0] for row in conn.execute("SELECT resource_id FROM medication_request_index")}
    print("meds", len(known_meds))
    med_rows: list[tuple] = []
    seen = 0
    for row in _iter_fields(
        dat / "HISTORY.Dat",
        ("KEYWORDS", "DRUG_NO", "PRICE", "USEAGE", "USE_TYPE", "CTOTALQTY", "SORT"),
    ):
        eid = visit_keys.get(row["KEYWORDS"])
        if not eid:
            continue
        sort_seq = row["SORT"].strip() or "1"
        mid = f"local-medicationrequest-{md5_id(f'{eid}-{sort_seq}')}"
        if mid not in known_meds:
            continue
        seen += 1
        med_rows.append(
            (
                _num(row["PRICE"]),
                _num(row["CTOTALQTY"]),
                row["USE_TYPE"].strip(),
                row["USEAGE"].strip(),
                mid,
            )
        )
    print("matched meds", seen)
    conn.executemany(
        """
        UPDATE medication_request_index
        SET unit_price = COALESCE(?, unit_price),
            total_qty = COALESCE(?, total_qty),
            use_type = COALESCE(NULLIF(?, ''), use_type),
            useage = COALESCE(NULLIF(useage, ''), NULLIF(?, ''))
        WHERE resource_id = ?
        """,
        med_rows,
    )
    conn.commit()

    patched = 0
    by_id = {eid: (doctor, pharmacist, seq) for doctor, pharmacist, seq, eid in enc_rows}
    ids = list(by_id)
    for start in range(0, len(ids), 400):
        chunk = ids[start : start + 400]
        marks = ",".join("?" for _ in chunk)
        rows = conn.execute(
            f"""
            SELECT resource_id, payload_json FROM resource_cache
            WHERE resource_type = 'Encounter' AND resource_id IN ({marks})
            """,
            chunk,
        ).fetchall()
        out = []
        for rid, payload in rows:
            if not payload:
                continue
            doctor, pharmacist, seq = by_id[rid]
            data = json.loads(payload)
            data = attach_reg_extension(
                data,
                {
                    "doctorId": doctor or None,
                    "pharmacist": pharmacist or None,
                    "treatSeq": seq or None,
                },
            )
            out.append((json.dumps(data, ensure_ascii=False), rid))
        conn.executemany(
            """
            UPDATE resource_cache SET payload_json = ?
            WHERE resource_type = 'Encounter' AND resource_id = ?
            """,
            out,
        )
        patched += len(out)
        if patched and patched % BATCH == 0:
            conn.commit()
            print("  json", patched)
    conn.commit()
    print("json patched", patched)
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
