"""Convert a chart DB copy to the final FHIR format, then rebuild indexes from FHIR.

  python scripts/fhir_convert.py --db COPY.db [--steps encounter,...] [--apply]

Without --apply everything runs inside one transaction that is rolled back,
so the report shows what would change. Each step rewrites resource_cache JSON
so that the store's own index functions reproduce what readers rely on, then
re-derives the index rows from that JSON. The report lists, per index column,
how many rows changed value (expected only where the old index was stale).
Refuses network paths and paths inside the repo: run on a local copy.
The target format is described in the FHIR final-format doc under docs/.
"""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import sqlite3
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.core.encounter_extensions import BOOK_FIELDS, put_book, put_queue_status  # noqa: E402
from src.infrastructure import sqlite_shadow_store as s  # noqa: E402


def _is_remote(path: Path) -> bool:
    text = str(path.resolve())
    if text.startswith("\\\\"):
        return True
    if os.name == "nt":
        drive = os.path.splitdrive(text)[0] + "\\"
        return ctypes.windll.kernel32.GetDriveTypeW(drive) == 4
    return False


def _inside_repo(path: Path) -> bool:
    resolved = path.resolve()
    return resolved == ROOT or ROOT in resolved.parents


class Report:
    def __init__(self, name: str):
        self.name = name
        self.rows = 0
        self.json_changed = 0
        self.notes: Counter[str] = Counter()
        self.index_changed: Counter[str] = Counter()
        self.started = time.time()

    def show(self) -> None:
        print(f"\n== {self.name}: rows {self.rows}, JSON rewritten {self.json_changed}, "
              f"{int(time.time() - self.started)}s")
        for key, n in sorted(self.notes.items()):
            print(f"  note  {key:40s} {n}")
        for key, n in sorted(self.index_changed.items()):
            print(f"  index {key:40s} {n}")
        if not self.index_changed:
            print("  index unchanged")


def _write(conn: sqlite3.Connection, rtype: str, rid: str, payload: dict[str, Any]) -> None:
    conn.execute(
        "UPDATE resource_cache SET payload_json = ? WHERE resource_type = ? AND resource_id = ?",
        (json.dumps(payload, ensure_ascii=False), rtype, rid),
    )


def _batches(conn: sqlite3.Connection, table: str, rtype: str, size: int = 2000):
    """Index rows joined with their JSON, a chunk at a time (ids fixed up front)."""
    ids = [r[0] for r in conn.execute(
        f"SELECT ix.resource_id FROM {table} ix JOIN resource_cache rc "
        f"ON rc.resource_type = ? AND rc.resource_id = ix.resource_id ORDER BY ix.resource_id",
        (rtype,),
    )]
    for i in range(0, len(ids), size):
        chunk = ids[i : i + size]
        marks = ",".join("?" * len(chunk))
        yield from conn.execute(
            f"SELECT ix.*, rc.payload_json AS _p FROM {table} ix JOIN resource_cache rc "
            f"ON rc.resource_type = ? AND rc.resource_id = ix.resource_id "
            f"WHERE ix.resource_id IN ({marks})",
            (rtype, *chunk),
        ).fetchall()
        if (i // size) % 25 == 0:
            print(f"  {rtype} {i + len(chunk)}/{len(ids)}", flush=True)


def _compare(before: sqlite3.Row, after: sqlite3.Row, rep: Report) -> None:
    for col in before.keys():
        if col == "updated_at":
            continue
        if before[col] != after[col]:
            rep.index_changed[col] += 1


def step_encounter(store: s.SqliteShadowStore, conn: sqlite3.Connection) -> Report:
    rep = Report("Encounter")
    book_cols = [col for col, _key, _kind in BOOK_FIELDS]
    for row in _batches(conn, "encounter_index", "Encounter"):
        rep.rows += 1
        rid = row["resource_id"]
        payload = json.loads(row["_p"])
        original = json.dumps(payload, sort_keys=True, ensure_ascii=False)
        values = {}
        for col in book_cols:
            v = row[col]
            if col == "owe_card" and not v:
                v = None
            if isinstance(v, str) and v == "":
                rep.notes[f"{col} '' -> NULL"] += 1
                v = None
            values[col] = v
        put_book(payload, values)
        derived_qs = s._encounter_index_fields(payload)[3]
        if row["queue_status"] and derived_qs != row["queue_status"]:
            put_queue_status(payload, row["queue_status"])
            rep.notes["queueStatus set from index"] += 1
        if json.dumps(payload, sort_keys=True, ensure_ascii=False) != original:
            _write(conn, "Encounter", rid, payload)
            rep.json_changed += 1
        store._upsert_encounter_index(conn, rid, payload)
        _finish(conn, "encounter_index", row, rep)
    return rep


_TYPE_FOR_TABLE = {table: rtype for rtype, table in s.INDEX_TABLE_FOR.items()}


def _finish(conn: sqlite3.Connection, table: str, row: sqlite3.Row, rep: Report) -> None:
    """Readers sort by index updated_at; it goes into meta.lastUpdated and must not move."""
    rid = row["resource_id"]
    when = row["updated_at"]
    rtype = _TYPE_FOR_TABLE[table]
    stored = conn.execute(
        "SELECT payload_json FROM resource_cache WHERE resource_type = ? AND resource_id = ?", (rtype, rid)
    ).fetchone()
    if stored:
        payload = json.loads(stored[0])
        if s.last_updated_index_time(payload) != when:
            s.put_last_updated(payload, when)
            if s.last_updated_index_time(payload) != when:
                raise RuntimeError(f"{table} updated_at not in datetime('now') form at {rid}")
            _write(conn, rtype, rid, payload)
            rep.notes["meta.lastUpdated from index"] += 1
    conn.execute(f"UPDATE {table} SET updated_at = ? WHERE resource_id = ?", (when, rid))
    after = conn.execute(f"SELECT * FROM {table} WHERE resource_id = ?", (rid,)).fetchone()
    _compare(row_without(row, "_p"), after, rep)


class _RowView:
    def __init__(self, row: sqlite3.Row, drop: str):
        self._row = row
        self._keys = [k for k in row.keys() if k != drop]

    def keys(self):
        return self._keys

    def __getitem__(self, key):
        return self._row[key]


def row_without(row: sqlite3.Row, drop: str) -> _RowView:
    return _RowView(row, drop)


def _new_systems(concept: Any) -> None:
    """Legacy code-system URLs in a CodeableConcept become the current ones."""
    from src.core.fhir_urls import LEGACY_ALIASES

    old_to_new = {old: new for new, olds in LEGACY_ALIASES.items() for old in olds}
    if isinstance(concept, dict):
        for coding in concept.get("coding") or []:
            if isinstance(coding, dict) and coding.get("system") in old_to_new:
                coding["system"] = old_to_new[coding["system"]]


def _blank_to_none(value: Any, col: str, rep: Report) -> Any:
    if isinstance(value, str) and value == "":
        rep.notes[f"{col} '' -> NULL"] += 1
        return None
    return value


def step_medication(store: s.SqliteShadowStore, conn: sqlite3.Connection) -> Report:
    from src.core.medication_billing import BILLING_FIELDS, put_billing, put_useage

    rep = Report("MedicationRequest")
    for row in _batches(conn, "medication_request_index", "MedicationRequest"):
        rep.rows += 1
        rid = row["resource_id"]
        payload = json.loads(row["_p"])
        original = json.dumps(payload, sort_keys=True, ensure_ascii=False)
        put_billing(payload, {col: _blank_to_none(row[col], col, rep) for col, _k, _t in BILLING_FIELDS})
        put_useage(payload, _blank_to_none(row["useage"], "useage", rep))
        if row["status"] is None:
            rep.notes["status NULL -> active"] += 1
        payload["status"] = row["status"] or "active"
        _new_systems(payload.get("medicationCodeableConcept"))
        if json.dumps(payload, sort_keys=True, ensure_ascii=False) != original:
            _write(conn, "MedicationRequest", rid, payload)
            rep.json_changed += 1
        store._upsert_medication_request_index(conn, rid, payload)
        _finish(conn, "medication_request_index", row, rep)
    return rep


def step_condition(store: s.SqliteShadowStore, conn: sqlite3.Connection) -> Report:
    from src.core.condition_status import index_status, normalize, put_index_status
    from src.core.terminology import build_condition_codeable

    rep = Report("Condition")
    for row in _batches(conn, "condition_index", "Condition"):
        rep.rows += 1
        rid = row["resource_id"]
        payload = json.loads(row["_p"])
        original = json.dumps(payload, sort_keys=True, ensure_ascii=False)
        _new_systems(payload.get("code"))
        if row["nhi_icd10_code"] or row["icd10_code"] or row["snomed_code"]:
            payload["code"] = build_condition_codeable(
                icd10_code=row["icd10_code"] or None,
                snomed_code=row["snomed_code"] or None,
                nhi_icd10_code=row["nhi_icd10_code"] or None,
                existing=payload.get("code"),
            )
        if normalize(payload):
            rep.notes["clinicalStatus entered-in-error -> verificationStatus"] += 1
        want = row["clinical_status"] or "active"
        if index_status(payload) != want:
            put_index_status(payload, want)
            rep.notes[f"status set from index: {want}"] += 1
        if json.dumps(payload, sort_keys=True, ensure_ascii=False) != original:
            _write(conn, "Condition", rid, payload)
            rep.json_changed += 1
        store._upsert_condition_index(conn, rid, payload)
        _finish(conn, "condition_index", row, rep)
    return rep


def step_materialize(store: s.SqliteShadowStore, conn: sqlite3.Connection) -> Report:
    """Index-only Condition / MedicationRequest rows get their JSON (materialize_index_only)."""
    sys.path.insert(0, str(ROOT / "scripts"))
    import materialize_index_only as mi

    rep = Report("index-only Condition / MedicationRequest -> JSON")
    for rtype, table, build in (
        ("Condition", "condition_index", mi.condition_payload),
        ("MedicationRequest", "medication_request_index", mi.medication_payload),
    ):
        for row in mi.missing_rows(conn, table, rtype).fetchall():
            rep.rows += 1
            conn.execute(
                "INSERT INTO resource_cache (resource_type, resource_id, payload_json, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (rtype, row["resource_id"], json.dumps(build(row), ensure_ascii=False, separators=(",", ":")),
                 row["updated_at"], row["updated_at"]),
            )
            rep.json_changed += 1
            rep.notes[f"created {rtype}"] += 1
    return rep


def step_urls(store: s.SqliteShadowStore, conn: sqlite3.Connection) -> Report:
    """Every stored resource gets the current URLs (same rewrite as each save)."""
    from src.core import fhir_urls

    rep = Report("URLs in all resources")
    chart = s._chart_system(conn)
    if not chart:
        raise RuntimeError("clinic code missing in clinic settings; chart-number system unknown")
    rowids = [r[0] for r in conn.execute("SELECT rowid FROM resource_cache ORDER BY rowid")]
    for i in range(0, len(rowids), 5000):
        chunk = rowids[i : i + 5000]
        marks = ",".join("?" * len(chunk))
        for rowid, rtype, raw in conn.execute(
            f"SELECT rowid, resource_type, payload_json FROM resource_cache WHERE rowid IN ({marks})", chunk
        ).fetchall():
            rep.rows += 1
            payload = json.loads(raw)
            if fhir_urls.modernize(payload, chart):
                conn.execute(
                    "UPDATE resource_cache SET payload_json = ? WHERE rowid = ?",
                    (json.dumps(payload, ensure_ascii=False), rowid),
                )
                rep.json_changed += 1
                rep.notes[f"rewritten {rtype}"] += 1
        if (i // 5000) % 50 == 0:
            print(f"  urls {i + len(chunk)}/{len(rowids)}", flush=True)
    return rep


def step_other(store: s.SqliteShadowStore, conn: sqlite3.Connection) -> Report:
    rep = Report("Observation / AllergyIntolerance / Media")
    for table, rtype, upsert in (
        ("observation_index", "Observation", store._upsert_observation_index),
        ("allergy_index", "AllergyIntolerance", store._upsert_allergy_index),
        ("media_index", "Media", store._upsert_media_index),
    ):
        for row in _batches(conn, table, rtype):
            rep.rows += 1
            upsert(conn, row["resource_id"], json.loads(row["_p"]))
            _finish(conn, table, row, rep)
    return rep


def _put_clinic_sub(payload: dict[str, Any], key: str, value: str) -> None:
    from src.core import fhir_urls

    exts = payload.setdefault("extension", [])
    block = next((e for e in exts if isinstance(e, dict) and e.get("url") == fhir_urls.PATIENT_CLINIC), None)
    if block is None:
        block = {"url": fhir_urls.PATIENT_CLINIC, "extension": []}
        exts.append(block)
    subs = [x for x in block.get("extension") or [] if not (isinstance(x, dict) and x.get("url") == key)]
    subs.append({"url": key, "valueString": value})
    block["extension"] = subs


def step_patient(store: s.SqliteShadowStore, conn: sqlite3.Connection) -> Report:
    """Index re-derived from JSON. A ROC birthday the index holds but birthDate cannot
    give (born before 1912, imported text) is kept as patient-clinic birthdayRoc."""
    rep = Report("Patient")
    for row in _batches(conn, "patient_index", "Patient"):
        rep.rows += 1
        rid = row["resource_id"]
        payload = json.loads(row["_p"])
        roc = row["birthday_roc"]
        if roc and s._patient_index_fields(payload).get("birthday_roc") != roc:
            _put_clinic_sub(payload, "birthdayRoc", str(roc))
            _write(conn, "Patient", rid, payload)
            rep.json_changed += 1
            rep.notes["birthdayRoc kept from index"] += 1
        store._upsert_patient_index(conn, rid, payload, check_keys=False)
        _finish(conn, "patient_index", row, rep)
    return rep


def note_payload(row: sqlite3.Row, visit_day: str | None) -> dict[str, Any]:
    """A chief-complaint-only visit note (what the index held) as a Composition."""
    from src.core.nhi_soap_fhir_mapper import LOINC_CONSULT_NOTE, NHI_SOAP_EXTENSION_URL, _section

    cc = row["chief_complaint"] or ""
    payload: dict[str, Any] = {
        "resourceType": "Composition",
        "id": row["resource_id"],
        "status": row["composition_status"] or "final",
        "type": {"coding": [{"system": "http://loinc.org", "code": LOINC_CONSULT_NOTE, "display": "Consult note"}]},
        "subject": {"reference": f"Patient/{row['patient_id']}"},
        "encounter": {"reference": f"Encounter/{row['encounter_id']}"},
        "date": visit_day or (row["updated_at"] or "")[:10],
        "author": [{"display": "Polaris SEHR"}],
        "title": "Outpatient SOAP Note",
        "section": [_section("Chief Complaint", "10154-3", "Chief complaint", cc)],
        "extension": [{
            "url": NHI_SOAP_EXTENSION_URL,
            "extension": [
                {"url": "encounterId", "valueString": row["encounter_id"]},
                {"url": "chiefComplaint", "valueString": cc},
            ],
        }],
    }
    return payload


def step_note(store: s.SqliteShadowStore, conn: sqlite3.Connection) -> Report:
    rep = Report("Composition (index-only notes)")
    rows = conn.execute(
        "SELECT ci.*, ei.encounter_date AS _day FROM clinical_note_index ci "
        "LEFT JOIN encounter_index ei ON ei.resource_id = ci.encounter_id "
        "WHERE NOT EXISTS (SELECT 1 FROM resource_cache rc "
        "WHERE rc.resource_type = 'Composition' AND rc.resource_id = ci.resource_id)"
    ).fetchall()
    for row in rows:
        rep.rows += 1
        if not row["patient_id"] or not row["encounter_id"]:
            rep.notes["no patient or visit, left as is"] += 1
            continue
        payload = note_payload(row, row["_day"])
        conn.execute(
            "INSERT INTO resource_cache (resource_type, resource_id, payload_json, created_at, updated_at) "
            "VALUES ('Composition', ?, ?, ?, ?)",
            (row["resource_id"], json.dumps(payload, ensure_ascii=False), row["updated_at"], row["updated_at"]),
        )
        rep.json_changed += 1
        store._upsert_clinical_note_index(conn, row["resource_id"], payload)
        _finish(conn, "clinical_note_index", _RowView(row, "_day"), rep)
    for row in _batches(conn, "clinical_note_index", "Composition"):
        store._upsert_clinical_note_index(conn, row["resource_id"], json.loads(row["_p"]))
        _finish(conn, "clinical_note_index", row, rep)
    return rep


def _refund_owner(conn: sqlite3.Connection, row: sqlite3.Row) -> tuple[str | None, str | None, str]:
    """(patient id, encounter id, how) for one refund row. Only used to file it."""
    key = row["keywords"] or ""
    hit = conn.execute("SELECT patient_id FROM encounter_index WHERE resource_id = ?", (key,)).fetchone()
    if hit:
        return hit[0], key, "own encounter"
    chart = row["chart_no"] or ""
    day = row["encounter_date"] or ""
    seq = row["treat_seq"] or ""
    if seq:
        found = conn.execute(
            "SELECT ei.resource_id, ei.patient_id FROM encounter_index ei "
            "JOIN patient_index pi ON pi.resource_id = ei.patient_id "
            "WHERE pi.medical_no = ? AND ei.treat_seq = ? AND ei.encounter_date <= ? "
            "AND ei.encounter_date >= date(?, '-120 day')",
            (chart, seq, day, day),
        ).fetchall()
        if len(found) == 1:
            return found[0][1], found[0][0], "chart and sequence"
    pat = conn.execute("SELECT resource_id FROM patient_index WHERE medical_no = ?", (chart,)).fetchone()
    if pat:
        return pat[0], None, "patient only"
    return None, None, "no patient"


def step_cash_return(store: s.SqliteShadowStore, conn: sqlite3.Connection) -> Report:
    from src.core.cash_return import resource_id_for, to_basic

    rep = Report("cash_return -> Basic")
    rows = conn.execute("SELECT * FROM cash_return WHERE resource_id IS NULL ORDER BY id").fetchall()
    for row in rows:
        rep.rows += 1
        if not (row["keywords"] or "").strip():
            rep.notes["no keywords, left as is"] += 1
            continue
        patient_id, encounter_id, how = _refund_owner(conn, row)
        rep.notes[f"filed by {how}"] += 1
        payload = to_basic(dict(row), patient_id=patient_id, encounter_id=encounter_id)
        rid = payload["id"]
        if rid != resource_id_for(row["keywords"].strip()) or conn.execute(
            "SELECT 1 FROM resource_cache WHERE resource_type = 'Basic' AND resource_id = ?", (rid,)
        ).fetchone():
            raise RuntimeError(f"refund id clash at row {row['id']}")
        conn.execute(
            "INSERT INTO resource_cache (resource_type, resource_id, payload_json, created_at, updated_at) "
            "VALUES ('Basic', ?, ?, datetime('now'), datetime('now'))",
            (rid, json.dumps(payload, ensure_ascii=False)),
        )
        rep.json_changed += 1
        conn.execute("UPDATE cash_return SET resource_id = ? WHERE id = ?", (rid, row["id"]))
        store._upsert_cash_return_index(conn, rid, payload)
        after = conn.execute("SELECT * FROM cash_return WHERE id = ?", (row["id"],)).fetchone()
        for col in row.keys():
            if col != "resource_id" and row[col] != after[col]:
                rep.index_changed[col] += 1
    return rep


def step_side(store: s.SqliteShadowStore, conn: sqlite3.Connection) -> Report:
    from src.core.side_records import EXCLUDED, SPECS, to_resource

    rep = Report("desk tables -> FHIR")
    for table, spec in SPECS.items():
        if not conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)).fetchone():
            rep.notes[f"{table} missing, skipped"] += 1
            continue
        rows = conn.execute(f"SELECT * FROM {table}").fetchall()
        for row in rows:
            rep.rows += 1
            data = dict(row)
            payload = to_resource(table, data, store._side_links(conn, data))
            if conn.execute(
                "SELECT 1 FROM resource_cache WHERE resource_type = ? AND resource_id = ?",
                (spec.rtype, payload["id"]),
            ).fetchone():
                raise RuntimeError(f"{table} id clash at {data[spec.key]}")
            conn.execute(
                "INSERT INTO resource_cache (resource_type, resource_id, payload_json, created_at, updated_at) "
                "VALUES (?, ?, ?, datetime('now'), datetime('now'))",
                (spec.rtype, payload["id"], json.dumps(payload, ensure_ascii=False)),
            )
            rep.json_changed += 1
            rep.notes[f"{table} -> {spec.rtype}"] += 1
            if "subject" not in payload and spec.rtype != "Practitioner":
                rep.notes[f"{table} no patient link"] += 1
            store._local.side_table_only = {c: data[c] for c in EXCLUDED.get(table, ())}
            try:
                store._upsert_side_row(conn, payload)
            finally:
                store._local.side_table_only = None
            after = conn.execute(f"SELECT * FROM {table} WHERE {spec.key} = ?", (data[spec.key],)).fetchone()
            for col in row.keys():
                if after is None or row[col] != after[col]:
                    rep.index_changed[f"{table}.{col}"] += 1
    return rep


def step_org(store: s.SqliteShadowStore, conn: sqlite3.Connection) -> Report:
    from src.core.clinic_org import organization_for, put_service_provider

    rep = Report("clinic Organization, Encounter.serviceProvider")
    raw = s._get_runtime_setting(conn, s.CLINIC_PROFILE_KEY)
    org = organization_for(json.loads(raw) if raw else None)
    if org is None:
        raise RuntimeError("clinic code missing in the clinic profile; save it before converting")
    conn.execute(
        "INSERT INTO resource_cache (resource_type, resource_id, payload_json, created_at, updated_at) "
        "VALUES ('Organization', ?, ?, datetime('now'), datetime('now')) "
        "ON CONFLICT(resource_type, resource_id) DO UPDATE SET payload_json = excluded.payload_json",
        (org["id"], json.dumps(org, ensure_ascii=False)),
    )
    code = org["identifier"][0]["value"]
    ids = [r[0] for r in conn.execute("SELECT resource_id FROM resource_cache WHERE resource_type = 'Encounter'")]
    for i in range(0, len(ids), 2000):
        chunk = ids[i : i + 2000]
        marks = ",".join("?" * len(chunk))
        for rid, text in conn.execute(
            f"SELECT resource_id, payload_json FROM resource_cache "
            f"WHERE resource_type = 'Encounter' AND resource_id IN ({marks})",
            chunk,
        ).fetchall():
            rep.rows += 1
            payload = json.loads(text)
            if put_service_provider(payload, code):
                _write(conn, "Encounter", rid, payload)
                rep.json_changed += 1
    return rep


def step_twcore(store: s.SqliteShadowStore, conn: sqlite3.Connection) -> Report:
    """Every resource through twcore_shape; its index or desk row must come out the same."""
    from src.core import twcore_shape
    from src.core.side_records import from_resource

    rep = Report("TW Core shape")
    tables = {**s.INDEX_TABLE_FOR, "Basic": "cash_return"}
    for rtype in [r[0] for r in conn.execute("SELECT DISTINCT resource_type FROM resource_cache")]:
        table = tables.get(rtype)
        ids = [r[0] for r in conn.execute(
            "SELECT resource_id FROM resource_cache WHERE resource_type = ? ORDER BY resource_id", (rtype,)
        )]
        for i in range(0, len(ids), 2000):
            chunk = ids[i : i + 2000]
            marks = ",".join("?" * len(chunk))
            for rid, text in conn.execute(
                f"SELECT resource_id, payload_json FROM resource_cache "
                f"WHERE resource_type = ? AND resource_id IN ({marks})",
                (rtype, *chunk),
            ).fetchall():
                rep.rows += 1
                payload = json.loads(text)
                if not twcore_shape.normalize(rtype, payload):
                    continue
                rep.json_changed += 1
                rep.notes[f"rewritten {rtype}"] += 1
                _write(conn, rtype, rid, payload)
                side = from_resource(payload)
                if side is not None:
                    spec, row, _retired = side
                    key = row.get(spec.key)
                    before = conn.execute(f"SELECT * FROM {spec.table} WHERE {spec.key} = ?", (key,)).fetchone()
                    store._upsert_side_row(conn, payload)
                    after = conn.execute(f"SELECT * FROM {spec.table} WHERE {spec.key} = ?", (key,)).fetchone()
                    for col in (before.keys() if before else []):
                        if after is None or before[col] != after[col]:
                            rep.index_changed[f"{spec.table}.{col}"] += 1
                    continue
                if table is None:
                    continue
                before = conn.execute(f"SELECT * FROM {table} WHERE resource_id = ?", (rid,)).fetchone()
                store._derive_index(conn, rtype, rid, payload, check_keys=False)
                if before is not None:
                    if "updated_at" in before.keys():
                        conn.execute(f"UPDATE {table} SET updated_at = ? WHERE resource_id = ?",
                                     (before["updated_at"], rid))
                    after = conn.execute(f"SELECT * FROM {table} WHERE resource_id = ?", (rid,)).fetchone()
                    _compare(before, after, rep)
            if (i // 2000) % 50 == 0:
                print(f"  {rtype} {i + len(chunk)}/{len(ids)}", flush=True)
    return rep


STEPS = {
    "materialize": step_materialize,
    "urls": step_urls,
    "encounter": step_encounter,
    "cash_return": step_cash_return,
    "medication": step_medication,
    "condition": step_condition,
    "patient": step_patient,
    "note": step_note,
    "other": step_other,
    "side": step_side,
    "org": step_org,
    "twcore": step_twcore,
}


def run(db: Path, steps: list[str], apply: bool) -> int:
    store = s.SqliteShadowStore(db)
    raw = sqlite3.connect(str(db), isolation_level=None)
    raw.row_factory = sqlite3.Row
    store._connect = _bound(raw)  # every store helper uses this one transaction
    raw.execute("BEGIN")
    try:
        s._apply_index_migrations(raw)
        was = s._get_runtime_setting(raw, s.FHIR_FORMAT_KEY)
        for name in steps:
            STEPS[name](store, raw).show()
        if set(steps) == set(STEPS) or (was == s.FHIR_FORMAT_PREVIOUS and steps == ["twcore"]):
            s._set_runtime_setting(raw, s.FHIR_FORMAT_KEY, s.FHIR_FORMAT)
            print(f"\nmarked {s.FHIR_FORMAT_KEY} = {s.FHIR_FORMAT}")
        if apply:
            raw.execute("COMMIT")
            print("\nwritten")
        else:
            raw.execute("ROLLBACK")
            print("\ncheck only; rolled back")
        return 0
    except Exception:
        raw.execute("ROLLBACK")
        raise
    finally:
        raw.close()


def _bound(conn: sqlite3.Connection):
    import contextlib

    @contextlib.contextmanager
    def _ctx():
        yield conn

    return _ctx


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", required=True, type=Path)
    ap.add_argument("--steps", default=",".join(STEPS))
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    db: Path = args.db
    if not db.is_file():
        sys.exit(f"not found: {db}")
    if _is_remote(db):
        sys.exit("refused: DB is on a network path; copy it locally first")
    if _inside_repo(db):
        sys.exit("refused: DB is inside the repo")
    steps = [x.strip() for x in args.steps.split(",") if x.strip()]
    for name in steps:
        if name not in STEPS:
            sys.exit(f"unknown step {name}; have {', '.join(STEPS)}")
    sys.exit(run(db, steps, args.apply))


if __name__ == "__main__":
    main()
