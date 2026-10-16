# -*- coding: utf-8 -*-
"""Copy UPLOADIC fields onto encounters that do not have them yet.

Only fills blanks. Does not delete charts.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import struct
import time
from pathlib import Path

from src.core.encounter_extensions import attach_reg_extension

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "shadow.db"
DAT = Path(r"Z:\SC\dat")


def _dbf(path: Path):
    data = path.read_bytes()
    nrec, hlen, rec = struct.unpack_from("<IHH", data, 4)
    pos = 32
    fields = []
    while pos + 32 <= hlen and data[pos] != 0x0D:
        name = data[pos : pos + 11].split(b"\x00", 1)[0].decode("ascii", "replace")
        flen = data[pos + 16]
        fields.append((name, flen))
        pos += 32
    off = 1
    offsets = {}
    for name, flen in fields:
        offsets[name] = (off, flen)
        off += flen
    return data[hlen:], nrec, rec, offsets


def _cell(row: bytes, offsets: dict, name: str) -> str:
    if name not in offsets:
        return ""
    a, ln = offsets[name]
    return row[a : a + ln].decode("cp950", "ignore").strip()


def main() -> None:
    started = time.time()
    body, nrec, rec, offsets = _dbf(DAT / "UPLOADIC.Dat")
    upload: dict[str, dict[str, str]] = {}
    for i in range(nrec):
        row = body[i * rec : (i + 1) * rec]
        if not row or row[0:1] == b"*":
            continue
        key = _cell(row, offsets, "KEYWORDS")
        if not key:
            continue
        upload[key] = {
            "hcId": _cell(row, offsets, "CARDNO"),
            "samId": _cell(row, offsets, "SAMID"),
            "treatDateTime": _cell(row, offsets, "ICDATE"),
            "treatmentNumber": _cell(row, offsets, "IC20NOCARD"),
            "icUploadFee": _cell(row, offsets, "DECLARE").lstrip("0") or "0",
            "icCopay": _cell(row, offsets, "PARTPAYMO").lstrip("0") or "0",
            "icCaseNo": _cell(row, offsets, "ICCASENO"),
            "icRemark": _cell(row, offsets, "ICREMARK"),
        }
    print(f"upload rows {len(upload)} {time.time() - started:.1f}s", flush=True)

    reg_body, reg_n, reg_rec, reg_off = _dbf(DAT / "REGISTER.Dat")
    by_eid: dict[str, dict[str, str]] = {}
    for i in range(reg_n):
        row = reg_body[i * reg_rec : (i + 1) * reg_rec]
        if not row or row[0:1] == b"*":
            continue
        kw = _cell(row, reg_off, "KEYWORD")
        tn = _cell(row, reg_off, "TIMESNO")
        od = _cell(row, reg_off, "O_DATE")
        fields = upload.get(f"{kw}{tn}")
        if not fields or not kw:
            continue
        eid = "local-encounter-" + hashlib.md5(f"{kw}-{od}-{tn}".encode()).hexdigest()[:12]
        by_eid[eid] = fields
    print(f"matched keys {len(by_eid)} {time.time() - started:.1f}s", flush=True)

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    ids = list(by_eid)
    updated = 0
    for offset in range(0, len(ids), 400):
        chunk = ids[offset : offset + 400]
        q = ",".join("?" for _ in chunk)
        rows = conn.execute(
            f"SELECT resource_id, payload_json FROM resource_cache "
            f"WHERE resource_type='Encounter' AND resource_id IN ({q})",
            chunk,
        ).fetchall()
        writing = []
        for row in rows:
            fields = by_eid[row["resource_id"]]
            try:
                payload = json.loads(row["payload_json"])
            except json.JSONDecodeError:
                continue
            from src.core.encounter_extensions import extract_reg_meta

            current = extract_reg_meta(payload)
            patch = {}
            for key, value in fields.items():
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
            writing.append((json.dumps(merged, ensure_ascii=False), row["resource_id"]))
        if writing:
            conn.executemany(
                "UPDATE resource_cache SET payload_json=?, updated_at=datetime('now') "
                "WHERE resource_type='Encounter' AND resource_id=?",
                writing,
            )
            conn.commit()
            updated += len(writing)
        if offset and offset % 20000 == 0:
            print(f"updated {updated} scanned {offset} {time.time() - started:.1f}s", flush=True)
    print(f"finished updated {updated} {time.time() - started:.1f}s", flush=True)
    conn.close()


if __name__ == "__main__":
    main()
