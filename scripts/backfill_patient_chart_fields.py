"""Copy USER.Dat deposit, memo, and long notes onto Patient JSON."""
from __future__ import annotations

import json
import sqlite3
import struct
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.import_yisheng_data import parse_dbf_header  # noqa: E402
from src.infrastructure.sqlite_shadow_store import DEFAULT_DB_PATH  # noqa: E402

USER = Path(r"Z:\SC\dat\USER.Dat")
FPT = Path(r"Z:\SC\dat\USER.FPT")
EXT_URL = "https://clinic.org/fhir/StructureDefinition/patient-clinic-ext"


def memo_reader(fpt: bytes):
    block_size = struct.unpack(">H", fpt[6:8])[0] or 64

    def read(raw: str) -> str:
        raw = (raw or "").strip()
        if not raw or set(raw) <= {"0"}:
            return ""
        try:
            block = int(raw)
        except ValueError:
            return ""
        pos = block * block_size
        if pos + 8 > len(fpt):
            return ""
        _kind, length = struct.unpack(">II", fpt[pos : pos + 8])
        if length <= 0 or length > 20000 or pos + 8 + length > len(fpt):
            return ""
        text = fpt[pos + 8 : pos + 8 + length].decode("cp950", errors="ignore")
        return text.replace("\x00", "").strip()

    return read


def grab(data: bytes, fields: dict, name: str) -> str:
    _typ, length, offset = fields[name]
    return data[offset : offset + length].decode("cp950", errors="ignore").strip()


def set_sub(exts: list, key: str, value: str) -> None:
    text = (value or "").strip()
    if not text or text == "0":
        return
    for sub in exts:
        if sub.get("url") == key:
            if not str(sub.get("valueString") or "").strip():
                sub["valueString"] = text
            return
    exts.append({"url": key, "valueString": text})


def main() -> None:
    meta = parse_dbf_header(str(USER))
    if not meta:
        raise SystemExit("USER.Dat header missing")
    num, header_len, record_len, field_list = meta
    fields = {name: (typ, length, offset) for name, typ, length, offset in field_list}
    read_memo = memo_reader(FPT.read_bytes())

    conn = sqlite3.connect(str(DEFAULT_DB_PATH), timeout=120)
    conn.execute("PRAGMA busy_timeout=120000")
    id_map = {
        str(row[0] or "").strip().upper(): str(row[1])
        for row in conn.execute(
            "SELECT id_no, resource_id FROM patient_index WHERE COALESCE(id_no,'') != ''"
        )
    }
    print(f"index {len(id_map)}", flush=True)

    updates: list[tuple[str, str]] = []
    started = time.time()
    seen = 0
    with USER.open("rb") as handle:
        handle.seek(header_len)
        for _i in range(num):
            data = handle.read(record_len)
            if len(data) < record_len or data[0] == 0x2A:
                continue
            id_no = grab(data, fields, "ID").upper()
            pid = id_map.get(id_no)
            if not pid:
                continue
            seen += 1
            keymoney = grab(data, fields, "KEYMONEY").lstrip("0")
            memo = grab(data, fields, "MEMO")
            history = read_memo(grab(data, fields, "EXTRA"))
            kind = grab(data, fields, "KIND")
            arrears = grab(data, fields, "ARREARAGE").lstrip("0")
            blood = grab(data, fields, "BLOD")
            marry = grab(data, fields, "MARRY")
            parent = grab(data, fields, "MONTHERID")
            order = grab(data, fields, "BSERIAL")
            card = grab(data, fields, "CARD_NO")
            if not any((keymoney, memo, history, kind, arrears, blood, marry, parent, order, card)):
                continue
            updates.append(
                (
                    pid,
                    json.dumps(
                        {
                            "keymoney": keymoney,
                            "memo": memo,
                            "medicalHistory": history,
                            "kind": kind,
                            "arrearage": arrears,
                            "blood": blood,
                            "marry": marry,
                            "parentId": parent,
                            "birthOrder": order,
                            "nhiCardNo": card,
                        },
                        ensure_ascii=False,
                    ),
                )
            )
    print(f"pending {len(updates)} matched {seen} {time.time() - started:.1f}s", flush=True)

    done = 0
    for offset in range(0, len(updates), 300):
        chunk = updates[offset : offset + 300]
        ids = [item[0] for item in chunk]
        marks = ",".join("?" * len(ids))
        rows = {
            row[0]: row[1]
            for row in conn.execute(
                "SELECT resource_id, payload_json FROM resource_cache "
                f"WHERE resource_type = 'Patient' AND resource_id IN ({marks})",
                ids,
            )
        }
        writing = []
        for pid, packed in chunk:
            raw = rows.get(pid)
            if not raw:
                continue
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                continue
            incoming = json.loads(packed)
            exts = payload.setdefault("extension", [])
            clinic = None
            for ext in exts:
                if EXT_URL in str(ext.get("url") or "") or "patient-clinic-ext" in str(ext.get("url") or ""):
                    clinic = ext
                    break
            if clinic is None:
                clinic = {"url": EXT_URL, "extension": []}
                exts.append(clinic)
            subs = clinic.setdefault("extension", [])
            for key, value in incoming.items():
                set_sub(subs, key, value)
            writing.append((json.dumps(payload, ensure_ascii=False), pid))
        if writing:
            conn.executemany(
                "UPDATE resource_cache SET payload_json = ?, updated_at = datetime('now') "
                "WHERE resource_type = 'Patient' AND resource_id = ?",
                writing,
            )
            conn.commit()
            done += len(writing)
        if done and done % 20000 < 300:
            print(f"done {done} {time.time() - started:.1f}s", flush=True)
    print(f"finished {done} {time.time() - started:.1f}s", flush=True)


if __name__ == "__main__":
    main()
