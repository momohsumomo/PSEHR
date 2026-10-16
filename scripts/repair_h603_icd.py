# -*- coding: utf-8 -*-
"""Point shortcut H603 at the ICD the clinic upload already uses.

DIAGNOSE.Dat has two H603 rows, both marked in use. The first is L11.1.
A later row is L98.8, and the importer kept that later row.
The other shortcut that is really L98.8 is left alone.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.import_yisheng_data import parse_dbf_header

DB = ROOT / "data" / "shadow.db"


def _label() -> str:
    path = Path(r"Z:\SC\dat\DIAGNOSE.Dat")
    num, hlen, rlen, fields = parse_dbf_header(str(path))
    idx = {name: (off, length) for name, _t, length, off in fields}

    def cell(buf: bytes, name: str) -> str:
        off, length = idx[name]
        return buf[off:off + length].decode("cp950", errors="ignore").replace("\x00", "").strip()

    with path.open("rb") as handle:
        handle.seek(hlen)
        for _ in range(num):
            buf = handle.read(rlen)
            if len(buf) < rlen or buf[:1] == b"*":
                continue
            if cell(buf, "SICK_NO") != "H603":
                continue
            icd = cell(buf, "ICD_10CODE").replace(".", "").upper()
            if icd == "L988":
                return cell(buf, "SICK_NAME") or cell(buf, "SICK_NAME1")
    return ""


def main() -> int:
    label = _label()
    if not label:
        print("label missing")
        return 1
    conn = sqlite3.connect(DB)
    sample = conn.execute(
        """
        SELECT icd10_code FROM condition_index
        WHERE summary_text = ?
          AND REPLACE(UPPER(IFNULL(icd10_code, '')), '.', '') = 'L988'
        LIMIT 1
        """,
        (label,),
    ).fetchone()
    if not sample:
        print("nothing to repair")
        conn.close()
        return 0
    dotted = "." in str(sample[0] or "")
    new_code = "L11.1" if dotted else "L111"
    ids = [
        row[0]
        for row in conn.execute(
            """
            SELECT resource_id FROM condition_index
            WHERE summary_text = ?
              AND REPLACE(UPPER(IFNULL(icd10_code, '')), '.', '') = 'L988'
            """,
            (label,),
        )
    ]
    conn.execute("BEGIN")
    conn.execute(
        """
        UPDATE condition_index
        SET icd10_code = ?, nhi_icd10_code = ?
        WHERE summary_text = ?
          AND REPLACE(UPPER(IFNULL(icd10_code, '')), '.', '') = 'L988'
        """,
        (new_code, new_code, label),
    )
    changed_payload = 0
    for rid in ids:
        row = conn.execute(
            "SELECT payload_json FROM resource_cache WHERE resource_type='Condition' AND resource_id=?",
            (rid,),
        ).fetchone()
        if not row or not row[0]:
            continue
        try:
            payload = json.loads(row[0])
        except json.JSONDecodeError:
            continue
        touched = False
        for coding in ((payload.get("code") or {}).get("coding") or []):
            raw = str(coding.get("code") or "")
            if raw.replace(".", "").upper() == "L988":
                coding["code"] = new_code
                touched = True
        if touched:
            conn.execute(
                "UPDATE resource_cache SET payload_json=?, updated_at=datetime('now') WHERE resource_type='Condition' AND resource_id=?",
                (json.dumps(payload, ensure_ascii=False), rid),
            )
            changed_payload += 1
    conn.commit()
    left = conn.execute(
        """
        SELECT COUNT(*) FROM condition_index
        WHERE summary_text = ?
          AND REPLACE(UPPER(IFNULL(icd10_code, '')), '.', '') = 'L988'
        """,
        (label,),
    ).fetchone()[0]
    conn.close()
    print("updated", len(ids), "payload", changed_payload, "left", left, "code", new_code)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
