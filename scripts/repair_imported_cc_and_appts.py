# -*- coding: utf-8 -*-
"""Put REGISTER.CC back onto each visit, and cancel deleted appointments.

Does not delete charts. Does not change fees.
A waiting visit is cancelled only when its key is in REGIDELE and gone from REGISTER.
Finished visits are left as they are.
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
from src.core.encounter_extensions import put_reg_string
from src.core.yisheng_register_fields import is_register_void

DAT = Path(r"Z:\SC\dat")
DB = ROOT / "data" / "shadow.db"


def _open(name: str):
    meta = parse_dbf_header(str(DAT / name))
    if not meta:
        raise SystemExit(name + " missing")
    num, hlen, rlen, fields = meta
    idx = {n: (off, length) for n, _t, length, off in fields}
    return num, hlen, rlen, idx


def _cell(buf: bytes, idx: dict, name: str, *, raw: bool = False) -> str:
    off, length = idx[name]
    text = buf[off : off + length].decode("cp950", errors="ignore").replace("\x00", "")
    return text if raw else text.strip()


def _eid(buf: bytes, idx: dict) -> str:
    return "local-encounter-" + md5_id(
        _cell(buf, idx, "KEYWORD") + "-" + _cell(buf, idx, "O_DATE") + "-" + _cell(buf, idx, "TIMESNO")
    )


def main() -> int:
    rnum, rhlen, rrlen, ridx = _open("REGISTER.Dat")
    dnum, dhlen, drlen, didx = _open("REGIDELE.Dat")
    cc_by_eid: dict[str, str] = {}
    live: set[str] = set()
    src_first: Counter[str] = Counter()
    src_active: Counter[str] = Counter()
    with (DAT / "REGISTER.Dat").open("rb") as handle:
        handle.seek(rhlen)
        for _ in range(rnum):
            buf = handle.read(rrlen)
            if len(buf) < rrlen or buf[:1] == b"*":
                continue
            eid = _eid(buf, ridx)
            live.add(eid)
            cc_by_eid[eid] = _cell(buf, ridx, "CC", raw=True)
            meta = parse_roc_date(_cell(buf, ridx, "R_DATE"))
            iso = meta[1] if meta else ""
            void = is_register_void(
                _cell(buf, ridx, "STATUS"),
                receipts=_cell(buf, ridx, "RECEIPTS"),
                icno=_cell(buf, ridx, "ICNO"),
                diagnose=_cell(buf, ridx, "DIAGNOSE"),
                caseno=_cell(buf, ridx, "CASENO"),
            )
            if void or not iso.startswith("2026-"):
                continue
            src_active[iso[:7]] += 1
            cc = cc_by_eid[eid]
            if len(cc) >= 4 and cc[3] == "$":
                src_first[iso[:7]] += 1

    dele: set[str] = set()
    with (DAT / "REGIDELE.Dat").open("rb") as handle:
        handle.seek(dhlen)
        for _ in range(dnum):
            buf = handle.read(drlen)
            if len(buf) < drlen or buf[:1] == b"*":
                continue
            dele.add(_eid(buf, didx))

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    changed = 0
    pending_cc: list[tuple[str, str]] = []
    for row in conn.execute("SELECT resource_id, reg_cc FROM encounter_index"):
        eid = row["resource_id"]
        if eid not in cc_by_eid:
            continue
        cc = cc_by_eid[eid]
        if (row["reg_cc"] or "") == cc:
            continue
        pending_cc.append((cc, eid))
    conn.executemany(
        "UPDATE encounter_index SET reg_cc = ? WHERE resource_id = ?",
        pending_cc,
    )
    changed = len(pending_cc)
    payload_cc = 0
    for cc, eid in pending_cc:
        cached = conn.execute(
            "SELECT payload_json FROM resource_cache WHERE resource_type='Encounter' AND resource_id=?",
            (eid,),
        ).fetchone()
        if not cached or not cached["payload_json"]:
            continue
        payload = json.loads(cached["payload_json"])
        put_reg_string(payload, "regCc", cc)
        conn.execute(
            """
            UPDATE resource_cache SET payload_json = ?, updated_at = datetime('now')
            WHERE resource_type='Encounter' AND resource_id = ?
            """,
            (json.dumps(payload, ensure_ascii=False), eid),
        )
        payload_cc += 1

    cancel_ids: list[str] = []
    for row in conn.execute(
        """
        SELECT resource_id FROM encounter_index
        WHERE IFNULL(queue_status, '') = 'waiting'
          AND IFNULL(fhir_status, '') != 'cancelled'
        """
    ):
        eid = row["resource_id"]
        if eid in dele and eid not in live:
            cancel_ids.append(eid)
    for eid in cancel_ids:
        conn.execute(
            """
            UPDATE encounter_index
            SET queue_status = 'cancelled', fhir_status = 'cancelled', updated_at = datetime('now')
            WHERE resource_id = ?
            """,
            (eid,),
        )
        cached = conn.execute(
            "SELECT payload_json FROM resource_cache WHERE resource_type='Encounter' AND resource_id=?",
            (eid,),
        ).fetchone()
        if not cached or not cached["payload_json"]:
            continue
        payload = json.loads(cached["payload_json"])
        payload["status"] = "cancelled"
        put_reg_string(payload, "regCc", cc_by_eid.get(eid, ""))
        exts = payload.setdefault("extension", [])
        for ext in exts:
            url = str(ext.get("url") or "")
            if url.endswith("/queue"):
                for sub in ext.get("extension") or []:
                    if sub.get("url") == "queueStatus":
                        sub["valueCode"] = "cancelled"
        conn.execute(
            """
            UPDATE resource_cache SET payload_json = ?, updated_at = datetime('now')
            WHERE resource_type='Encounter' AND resource_id = ?
            """,
            (json.dumps(payload, ensure_ascii=False), eid),
        )
    conn.commit()
    print("cc_rows_rewritten", changed, "payloads", payload_cc, "appts_cancelled", len(cancel_ids))

    print("month source_first shadow_first source_active shadow_active")
    for month in [f"2026-{m:02d}" for m in range(1, 11)]:
        shadow_first, shadow_active = conn.execute(
            """
            SELECT SUM(CASE WHEN SUBSTR(IFNULL(reg_cc, ''), 4, 1) = '$' THEN 1 ELSE 0 END),
                   COUNT(*)
            FROM encounter_index
            WHERE encounter_date >= ? AND encounter_date < ?
              AND IFNULL(queue_status, '') != 'cancelled'
              AND IFNULL(fhir_status, '') != 'cancelled'
            """,
            (month + "-01", "2026-11-01" if month == "2026-10" else f"2026-{int(month[5:7]) + 1:02d}-01"),
        ).fetchone()
        print(
            month,
            "src_first", src_first[month],
            "shadow_first", shadow_first or 0,
            "src_active", src_active[month],
            "shadow_active", shadow_active or 0,
        )
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
