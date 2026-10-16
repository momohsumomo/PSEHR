#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fill cash_return display columns from USER + REGISTER. No deletes."""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.import_yisheng_data import parse_dbf_header, parse_roc_date
from src.infrastructure.sqlite_shadow_store import _apply_index_migrations


def _take(buf: bytes, idx: dict, name: str) -> str:
    off, length = idx[name]
    return buf[off : off + length].decode("cp950", errors="ignore").replace("\x00", "").strip()


def _iter(path: Path, names: tuple[str, ...]):
    num, hlen, rlen, fields = parse_dbf_header(str(path))
    idx = {name: (off, length) for name, _typ, length, off in fields}
    with path.open("rb") as handle:
        handle.seek(hlen)
        for _ in range(num):
            buf = handle.read(rlen)
            if len(buf) < rlen:
                break
            if buf[0] == 0x2A:
                continue
            yield {name: _take(buf, idx, name) for name in names}


def main() -> int:
    dat = Path(r"Z:\SC\dat")
    db_path = ROOT / "data" / "shadow.db"
    conn = sqlite3.connect(str(db_path), timeout=180)
    _apply_index_migrations(conn)
    conn.commit()
    wanted = {
        (row[0] or "").strip()
        for row in conn.execute("SELECT keywords FROM cash_return")
        if row[0] and len((row[0] or "").strip()) >= 4
    }
    print("keys", len(wanted))
    people: dict[str, tuple[str, str, str]] = {}
    for row in _iter(dat / "USER.Dat", ("KEYWORD", "NAME", "MEDICAL_NO", "ID")):
        kw = row["KEYWORD"]
        if not kw:
            continue
        people[kw] = (row["MEDICAL_NO"], row["NAME"], row["ID"].upper())
    visits: dict[str, tuple[str, str, str]] = {}
    for row in _iter(dat / "REGISTER.Dat", ("KEYWORD", "TIMESNO", "SLOT", "ICNO", "CASENO")):
        key = f"{row['KEYWORD']}{row['TIMESNO'].zfill(2)}"
        if key not in wanted:
            continue
        slot = row["SLOT"][:1]
        seg = slot if slot in {"1", "2", "3"} else ""
        visits[key] = (seg, row["ICNO"], row["CASENO"])
    updates = []
    missing_user = 0
    for key in wanted:
        chart, name, id_no = people.get(key[:4], ("", "", ""))
        if not chart and not name:
            missing_user += 1
        _seg, treat, case_no = visits.get(key, ("", "", ""))
        updates.append((chart, name, id_no, treat, case_no, key))
    conn.executemany(
        """
        UPDATE cash_return
        SET chart_no=?, patient_name=?, id_no=?, treat_seq=?, case_no=?
        WHERE keywords=?
        """,
        updates,
    )
    seg_rows = []
    for row in _iter(dat / "ACOUNT.Dat", ("KEYWORDS", "R_DATE", "SLOT", "TYPE")):
        if row["TYPE"] != "2":
            continue
        meta = parse_roc_date(row["R_DATE"])
        if not meta:
            continue
        slot = row["SLOT"][:1]
        if slot not in {"1", "2", "3"}:
            continue
        seg_rows.append((slot, meta[1], row["KEYWORDS"]))
    conn.executemany(
        "UPDATE cash_return SET seg=? WHERE encounter_date=? AND keywords=?",
        seg_rows,
    )
    conn.commit()
    day = conn.execute(
        """
        SELECT treat_seq, seg, case_no, amount,
               CASE WHEN chart_no IS NULL OR chart_no='' THEN 0 ELSE 1 END,
               CASE WHEN patient_name IS NULL OR patient_name='' THEN 0 ELSE 1 END
        FROM cash_return WHERE encounter_date='2026-10-02'
        ORDER BY id
        """
    ).fetchall()
    filled = conn.execute(
        "SELECT COUNT(*) FROM cash_return WHERE chart_no IS NOT NULL AND chart_no != ''"
    ).fetchone()[0]
    print("updated", len(updates), "filled_chart", filled, "missing_user", missing_user)
    print("day1002", day)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
