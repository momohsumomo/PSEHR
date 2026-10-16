# -*- coding: utf-8 -*-
"""Store raw REGISTER.CC (6 bytes, spaces kept) and REMARK on encounter_index.

Does not change times_no, owe_card, fees, or cash_return.
"""
import sqlite3
from pathlib import Path

from scripts.import_yisheng_data import md5_id, parse_dbf_header, parse_roc_date
from src.core.yisheng_register_fields import is_register_void

NAMES = (
    "KEYWORD", "TIMESNO", "O_DATE", "R_DATE", "STATUS", "CASENO",
    "ICNO", "DIAGNOSE", "RECEIPTS", "CC", "REMARK",
)
db_path = Path(__file__).resolve().parents[1] / "data" / "shadow.db"
dat_path = Path(r"Z:\SC\dat\REGISTER.Dat")
num, hlen, rlen, fields = parse_dbf_header(str(dat_path))
idx = {name: (off, length) for name, _typ, length, off in fields}


def take(buf: bytes, name: str, *, raw: bool = False) -> str:
    off, length = idx[name]
    text = buf[off:off + length].decode("cp950", errors="ignore").replace("\x00", "")
    return text if raw else text.strip()


conn = sqlite3.connect(db_path)
cols = [row[1] for row in conn.execute("PRAGMA table_info(encounter_index)")]
if "reg_cc" not in cols:
    conn.execute("ALTER TABLE encounter_index ADD COLUMN reg_cc TEXT")
if "reg_remark" not in cols:
    conn.execute("ALTER TABLE encounter_index ADD COLUMN reg_remark TEXT")

pending = []
with dat_path.open("rb") as handle:
    handle.seek(hlen)
    for _ in range(num):
        buf = handle.read(rlen)
        if len(buf) < rlen or buf[0:1] == b"*":
            continue
        if not parse_roc_date(take(buf, "R_DATE")) and not parse_roc_date(take(buf, "O_DATE")):
            continue
        if is_register_void(
            take(buf, "STATUS"),
            receipts=take(buf, "RECEIPTS"),
            icno=take(buf, "ICNO"),
            diagnose=take(buf, "DIAGNOSE"),
            caseno=take(buf, "CASENO"),
        ):
            continue
        eid = "local-encounter-" + md5_id(
            take(buf, "KEYWORD") + "-" + take(buf, "O_DATE") + "-" + take(buf, "TIMESNO")
        )
        pending.append((take(buf, "CC", raw=True), take(buf, "REMARK"), eid))

conn.execute("BEGIN")
conn.executemany(
    "UPDATE encounter_index SET reg_cc = ?, reg_remark = ? WHERE resource_id = ?",
    pending,
)
conn.commit()
print("updated candidates", len(pending))
conn.close()
