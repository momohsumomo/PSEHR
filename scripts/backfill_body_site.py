# -*- coding: utf-8 -*-
"""Fill medication_request_index.body_site from HISTORY.FPT.

Does not insert or delete rows. Only fills a blank body_site.
The live ids were created before body site joined the duplicate signature,
so the signature used here does not include the site text.
"""
from __future__ import annotations

import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.import_yisheng_data import md5_id, parse_dbf_header
from scripts.import_yisheng_lean import _clean
from src.core.nhi_clinical_mappers import yisheng_selftype_to_pay_mark

DAT = Path(r"Z:\SC\dat")
DB = ROOT / "data" / "shadow.db"


def memo_reader(path: Path):
    blob = path.read_bytes()
    block = int.from_bytes(blob[6:8], "big") or 64

    def read(token: str) -> str:
        text = (token or "").strip()
        if not text or not text.isdigit():
            return ""
        pos = int(text) * block
        if pos <= 0 or pos + 8 > len(blob):
            return ""
        length = int.from_bytes(blob[pos + 4 : pos + 8], "big")
        if length <= 0 or length > 4000 or pos + 8 + length > len(blob):
            return ""
        return " ".join(blob[pos + 8 : pos + 8 + length].decode("cp950", errors="ignore").split())

    return read


def medicine_map() -> dict[str, str]:
    out: dict[str, str] = {}
    meta = parse_dbf_header(str(DAT / "MEDICAL.Dat"))
    if not meta:
        return out
    n, header, rec, fields = meta
    with (DAT / "MEDICAL.Dat").open("rb") as handle:
        handle.seek(header)
        for _i in range(n):
            data = handle.read(rec)
            if len(data) < rec or data[0] == 0x2A:
                continue
            row = {
                name: data[off : off + length].decode("cp950", errors="ignore").strip()
                for name, _typ, length, off in fields
            }
            drug_no = _clean(row.get("DRUG_NO"))
            last3 = drug_no[-3:] if len(drug_no) >= 3 else drug_no
            if last3:
                out[last3] = _clean(row.get("CODE"))
    return out


def main() -> int:
    started = time.time()
    read_site = memo_reader(DAT / "HISTORY.FPT")
    drugs = medicine_map()
    print(f"drugs {len(drugs)} fpt {time.time() - started:.1f}s", flush=True)

    conn = sqlite3.connect(str(DB), timeout=180)
    conn.execute("PRAGMA busy_timeout=180000")
    known_enc = {row[0] for row in conn.execute("SELECT resource_id FROM encounter_index")}
    known_meds = {row[0] for row in conn.execute("SELECT resource_id FROM medication_request_index")}
    print(f"enc {len(known_enc)} med {len(known_meds)}", flush=True)

    reg = parse_dbf_header(str(DAT / "REGISTER.Dat"))
    if not reg:
        print("REGISTER missing")
        return 1
    n, header, rec, fields = reg
    visit_keys: dict[str, str] = {}
    with (DAT / "REGISTER.Dat").open("rb") as handle:
        handle.seek(header)
        for _i in range(n):
            data = handle.read(rec)
            if len(data) < rec or data[0] == 0x2A:
                continue
            row = {
                name: data[off : off + length].decode("cp950", errors="ignore").strip()
                for name, _typ, length, off in fields
            }
            if row.get("STATUS") == "A":
                continue
            keyword = row.get("KEYWORD") or ""
            timesno = row.get("TIMESNO") or ""
            o_date = row.get("O_DATE") or ""
            eid = "local-encounter-" + md5_id(f"{keyword}-{o_date}-{timesno}")
            if eid not in known_enc:
                continue
            visit_keys[keyword + timesno] = eid
    print(f"visits {len(visit_keys)} {time.time() - started:.1f}s", flush=True)

    hist = parse_dbf_header(str(DAT / "HISTORY.Dat"))
    if not hist:
        print("HISTORY missing")
        return 1
    hn, hheader, hrec, hfields = hist
    simple_hits = 0
    lean_hits = 0
    simple_rows: dict[str, str] = {}
    lean_rows: dict[str, str] = {}
    sort_seen: dict[str, int] = {}
    sort_seen_sig: set[tuple] = set()
    with (DAT / "HISTORY.Dat").open("rb") as handle:
        handle.seek(hheader)
        for i in range(hn):
            if i and i % 200000 == 0:
                print(f"  history {i}/{hn} {time.time() - started:.1f}s", flush=True)
            data = handle.read(hrec)
            if len(data) < hrec or data[0] == 0x2A:
                continue
            row = {
                name: data[off : off + length].decode("cp950", errors="ignore").strip()
                for name, _typ, length, off in hfields
            }
            eid = visit_keys.get(row.get("KEYWORDS") or "")
            if not eid:
                continue
            drug_no = _clean(row.get("DRUG_NO"))
            last3 = drug_no[-3:] if len(drug_no) >= 3 else drug_no
            nhi = drugs.get(last3, drug_no)
            useage = _clean(row.get("USEAGE"))
            sort_seq = _clean(row.get("SORT")) or "1"
            pay_mark = yisheng_selftype_to_pay_mark(_clean(row.get("SELFTYPE")))
            site = read_site(row.get("REMARK") or "")
            try:
                days_n = int(float(_clean(row.get("DAY")))) if _clean(row.get("DAY")) else None
            except ValueError:
                days_n = None
            try:
                qty_n = float(_clean(row.get("QTY"))) if _clean(row.get("QTY")) else None
            except ValueError:
                qty_n = None
            simple_id = f"local-medicationrequest-{md5_id(eid + '-' + sort_seq)}"
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
            )
            if signature in sort_seen_sig:
                lean_id = ""
            else:
                sort_seen_sig.add(signature)
                lean_id = f"local-medicationrequest-{md5_id(token)}"
            if not site:
                continue
            if simple_id in known_meds:
                simple_hits += 1
                simple_rows.setdefault(simple_id, site)
            if lean_id and lean_id in known_meds:
                lean_hits += 1
                lean_rows.setdefault(lean_id, site)
    print(f"simple hits {simple_hits} rows {len(simple_rows)}", flush=True)
    print(f"lean hits {lean_hits} rows {len(lean_rows)}", flush=True)
    chosen = simple_rows if simple_hits >= lean_hits else lean_rows
    label = "simple" if chosen is simple_rows else "lean"
    print(f"using {label}", flush=True)
    payload = [(site, mid) for mid, site in chosen.items()]
    done = 0
    for start in range(0, len(payload), 2000):
        chunk = payload[start : start + 2000]
        conn.executemany(
            """
            UPDATE medication_request_index
            SET body_site = ?
            WHERE resource_id = ?
              AND (body_site IS NULL OR trim(body_site) = '')
            """,
            chunk,
        )
        done += len(chunk)
        if done % 20000 < 2000:
            conn.commit()
            print(f"wrote {done} {time.time() - started:.1f}s", flush=True)
    conn.commit()
    filled = conn.execute(
        "SELECT COUNT(*) FROM medication_request_index WHERE body_site IS NOT NULL AND trim(body_site) != ''"
    ).fetchone()[0]
    print(f"filled {filled} {time.time() - started:.1f}s", flush=True)
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
