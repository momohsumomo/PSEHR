"""SQLite 影子庫實作（Local-First 預設）。"""

from __future__ import annotations

import contextlib
import json
import re
import sqlite3
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Generator

from src.core.interfaces.shadow_store import ShadowStore
from src.core.context import current_machine_id, current_operator_identity

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "shadow.db"

# 調閱病歷與診療主訴用同一份：先這次就診寫下的主訴，空白才看 SOAP。
# 掛號備註（病人備註、註記）不在這裡。
STORED_CHIEF_COMPLAINT_SQL = """
COALESCE(
  NULLIF(TRIM(ei.chief_complaint), ''),
  (
    SELECT NULLIF(TRIM(cn.chief_complaint), '')
    FROM clinical_note_index cn
    WHERE cn.encounter_id = ei.resource_id
    LIMIT 1
  ),
  ''
)
"""

_SCHEMA = """
CREATE TABLE IF NOT EXISTS resource_cache (
    resource_type TEXT NOT NULL,
    resource_id   TEXT NOT NULL,
    payload_json  TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (resource_type, resource_id)
);

CREATE TABLE IF NOT EXISTS sync_queue (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    operation     TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id   TEXT,
    payload_json  TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    synced_at     TEXT
);

CREATE TABLE IF NOT EXISTS patient_index (
    resource_id   TEXT PRIMARY KEY,
    family_name   TEXT,
    given_name    TEXT,
    identifier    TEXT,
    birth_date    TEXT,
    id_no         TEXT,
    birthday_roc  TEXT,
    sex           TEXT,
    medical_no    TEXT,
    phone         TEXT,
    address       TEXT,
    id_category   TEXT,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_patient_index_name ON patient_index(family_name, given_name);
CREATE INDEX IF NOT EXISTS idx_sync_queue_pending ON sync_queue(synced_at) WHERE synced_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_resource_cache_type_updated ON resource_cache(resource_type, updated_at);
CREATE INDEX IF NOT EXISTS idx_patient_index_medical_no ON patient_index(medical_no);
CREATE INDEX IF NOT EXISTS idx_patient_index_id_no ON patient_index(id_no);


CREATE TABLE IF NOT EXISTS encounter_index (
    resource_id     TEXT PRIMARY KEY,
    patient_id      TEXT NOT NULL,
    encounter_date  TEXT NOT NULL,
    queue_number    INTEGER NOT NULL DEFAULT 0,
    queue_status    TEXT NOT NULL DEFAULT 'waiting',
    fhir_status     TEXT NOT NULL DEFAULT 'arrived',
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_encounter_date_queue
    ON encounter_index(encounter_date, queue_number);
CREATE INDEX IF NOT EXISTS idx_encounter_patient
    ON encounter_index(patient_id);

CREATE TABLE IF NOT EXISTS condition_index (
    resource_id       TEXT PRIMARY KEY,
    patient_id        TEXT NOT NULL,
    encounter_id      TEXT,
    icd10_code        TEXT,
    snomed_code       TEXT,
    nhi_icd10_code    TEXT,
    summary_text      TEXT,
    clinical_status   TEXT NOT NULL DEFAULT 'active',
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_condition_patient ON condition_index(patient_id);
CREATE INDEX IF NOT EXISTS idx_condition_encounter ON condition_index(encounter_id);

CREATE TABLE IF NOT EXISTS medication_request_index (
    resource_id       TEXT PRIMARY KEY,
    patient_id        TEXT NOT NULL,
    encounter_id      TEXT,
    nhi_code          TEXT,
    rxnorm_code       TEXT,
    drug_text         TEXT,
    status            TEXT NOT NULL DEFAULT 'active',
    days_supply       INTEGER,
    quantity          REAL,
    unit_price        REAL,
    pack_version      TEXT,
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_medication_patient ON medication_request_index(patient_id);
CREATE INDEX IF NOT EXISTS idx_medication_encounter ON medication_request_index(encounter_id);

CREATE TABLE IF NOT EXISTS clinical_note_index (
    resource_id       TEXT PRIMARY KEY,
    encounter_id      TEXT NOT NULL UNIQUE,
    patient_id        TEXT NOT NULL,
    chief_complaint   TEXT NOT NULL,
    subjective_preview TEXT,
    objective_preview  TEXT,
    assessment_preview TEXT,
    plan_preview       TEXT,
    composition_status TEXT NOT NULL DEFAULT 'final',
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clinical_note_encounter ON clinical_note_index(encounter_id);

CREATE TABLE IF NOT EXISTS observation_index (
    resource_id        TEXT PRIMARY KEY,
    patient_id         TEXT NOT NULL,
    encounter_id       TEXT,
    category           TEXT NOT NULL DEFAULT 'vital-signs',
    loinc_code         TEXT NOT NULL,
    vital_type         TEXT,
    display_text       TEXT,
    value_num          REAL,
    value_unit         TEXT,
    effective_datetime TEXT,
    status             TEXT NOT NULL DEFAULT 'final',
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_observation_patient ON observation_index(patient_id);
CREATE INDEX IF NOT EXISTS idx_observation_encounter ON observation_index(encounter_id);

CREATE TABLE IF NOT EXISTS allergy_index (
    resource_id            TEXT PRIMARY KEY,
    patient_id             TEXT NOT NULL,
    verification_status    TEXT NOT NULL DEFAULT 'confirmed',
    snomed_code            TEXT NOT NULL,
    rxnorm_substance       TEXT,
    snomed_manifestation   TEXT,
    summary_text           TEXT,
    category               TEXT,
    criticality            TEXT,
    updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_allergy_patient ON allergy_index(patient_id);

CREATE TABLE IF NOT EXISTS media_index (
    resource_id        TEXT PRIMARY KEY,
    patient_id         TEXT NOT NULL,
    encounter_id       TEXT,
    site_label         TEXT NOT NULL,
    body_site_code     TEXT,
    content_type       TEXT NOT NULL,
    captured_datetime  TEXT,
    has_image_data     INTEGER NOT NULL DEFAULT 1,
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_media_patient ON media_index(patient_id);
CREATE INDEX IF NOT EXISTS idx_media_encounter ON media_index(encounter_id);

CREATE TABLE IF NOT EXISTS id_category_settings (
    code TEXT PRIMARY KEY,
    deposit INTEGER NOT NULL DEFAULT 0,
    reg_fee INTEGER NOT NULL DEFAULT 150,
    copay INTEGER NOT NULL DEFAULT 50,
    min_age INTEGER,
    max_age INTEGER,
    is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_modifications (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id          TEXT NOT NULL,
    resource_type      TEXT NOT NULL,
    timestamp          TEXT NOT NULL DEFAULT (datetime('now')),
    machine_id         TEXT NOT NULL,
    changed_fields     TEXT NOT NULL,
    operator_identity  TEXT NOT NULL,
    action             TEXT NOT NULL DEFAULT 'update'
);

CREATE TABLE IF NOT EXISTS clinic_runtime_settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clinic_staff (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    role        TEXT NOT NULL,
    nhi_id      TEXT,
    cert_no     TEXT,
    pin         TEXT NOT NULL UNIQUE,
    status      TEXT NOT NULL DEFAULT '在職'
);
"""

def json_diff(old_val: Any, new_val: Any, path: str = "") -> dict[str, Any]:
    """Compare two JSON objects and return a dictionary of changed fields."""
    diff = {}
    if type(old_val) != type(new_val):
        return {"old": old_val, "new": new_val}
    
    if isinstance(old_val, dict):
        all_keys = set(old_val.keys()).union(set(new_val.keys()))
        for k in all_keys:
            if k in ("meta", "lastUpdated", "updated_at"):
                continue
            k_path = f"{path}.{k}" if path else k
            if k not in old_val:
                diff[k_path] = {"old": None, "new": new_val[k]}
            elif k not in new_val:
                diff[k_path] = {"old": old_val[k], "new": None}
            else:
                sub_diff = json_diff(old_val[k], new_val[k], k_path)
                if sub_diff:
                    if "old" in sub_diff and "new" in sub_diff:
                        diff[k_path] = sub_diff
                    else:
                        diff.update(sub_diff)
    elif isinstance(old_val, list):
        if len(old_val) != len(new_val):
            return {"old": old_val, "new": new_val}
        else:
            for idx, (o_item, n_item) in enumerate(zip(old_val, new_val)):
                sub_diff = json_diff(o_item, n_item, f"{path}[{idx}]")
                if sub_diff:
                    diff.update(sub_diff)
    else:
        if old_val != new_val:
            return {"old": old_val, "new": new_val}
            
    return diff


class SqliteShadowStore(ShadowStore):
    def __init__(self, db_path: Path | str | None = None) -> None:
        self._db_path = Path(db_path) if db_path else DEFAULT_DB_PATH
        self._local = threading.local()

    @property
    def db_path(self) -> Path:
        return self._db_path

    def initialize(self) -> None:
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.executescript(_SCHEMA)
            _apply_index_migrations(conn)
            self._seed_id_category_settings(conn)

    def _seed_id_category_settings(self, conn: sqlite3.Connection) -> None:
        count = conn.execute("SELECT COUNT(*) FROM id_category_settings").fetchone()[0]
        if count == 0:
            # reg_fee is a discount off the clinic registration fee. copay 1 waives the cash copay.
            defaults = [
                ("老人優", 400, 50, 0, 70, 999, 0),
                ("S", 0, 0, 0, 3, 17, 0),
                ("D", 0, 0, 0, 18, 69, 1),
            ]
            conn.executemany(
                """
                INSERT INTO id_category_settings (code, deposit, reg_fee, copay, min_age, max_age, is_default)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                defaults
            )

    def _auto_fill_patient_id_category(self, conn: sqlite3.Connection, payload: dict[str, Any]) -> None:
        clinic_ext = None
        id_cat_ext = None
        id_cat_val = None
        
        extensions = payload.get("extension") or []
        for ext in extensions:
            if "patient-clinic-ext" in (ext.get("url") or ""):
                clinic_ext = ext
                for sub in ext.get("extension") or []:
                    if sub.get("url") == "idCategory":
                        id_cat_ext = sub
                        id_cat_val = sub.get("valueString")
                        break
                break

        if id_cat_val and id_cat_val.strip():
            return

        birth_date = payload.get("birthDate")
        if not birth_date:
            return

        default_code = get_default_category_by_age(conn, birth_date)
        if not default_code:
            return

        if clinic_ext is None:
            clinic_ext = {
                "url": "https://clinic.org/fhir/StructureDefinition/patient-clinic-ext",
                "extension": []
            }
            if "extension" not in payload:
                payload["extension"] = []
            payload["extension"].append(clinic_ext)

        if id_cat_ext is None:
            id_cat_ext = {"url": "idCategory", "valueString": default_code}
            if "extension" not in clinic_ext:
                clinic_ext["extension"] = []
            clinic_ext["extension"].append(id_cat_ext)
        else:
            id_cat_ext["valueString"] = default_code

    def cache_resource(self, resource_type: str, resource_id: str, payload: dict[str, Any]) -> None:
        if resource_type == "Patient":
            from src.core.plain_text import sanitize_patient_names

            sanitize_patient_names(payload)
        with self._connect() as conn:
            if resource_type == "Patient":
                self._auto_fill_patient_id_category(conn, payload)
            
            cash_touch = None
            if resource_type == "Encounter":
                cash_touch = self._stamp_cash_book_marks(conn, resource_id, payload)

            # Select old payload to detect updates and record changes
            old_row = conn.execute(
                "SELECT payload_json FROM resource_cache WHERE resource_type = ? AND resource_id = ?",
                (resource_type, resource_id)
            ).fetchone()
            
            # Write to resource_cache (maintaining created_at)
            conn.execute(
                """
                INSERT INTO resource_cache (resource_type, resource_id, payload_json, created_at, updated_at)
                VALUES (?, ?, ?, datetime('now'), datetime('now'))
                ON CONFLICT(resource_type, resource_id) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    updated_at = datetime('now')
                """,
                (resource_type, resource_id, json.dumps(payload, ensure_ascii=False)),
            )
            
            # 責任機制：正式上線（audit_recording=1）後，凡寫入必留修改紀錄
            if _is_audit_recording_enabled(conn):
                try:
                    machine = current_machine_id.get() or "Unknown_Machine"
                    operator = current_operator_identity.get() or "System_Collaborative"
                    if old_row:
                        old_payload = json.loads(old_row[0])
                        diff = json_diff(old_payload, payload)
                        if diff:
                            _insert_audit_row(
                                conn,
                                action="update",
                                resource_type=resource_type,
                                resource_id=resource_id,
                                machine_id=machine,
                                operator_identity=operator,
                                changed_fields=diff,
                            )
                    else:
                        _insert_audit_row(
                            conn,
                            action="create",
                            resource_type=resource_type,
                            resource_id=resource_id,
                            machine_id=machine,
                            operator_identity=operator,
                            changed_fields=_audit_create_summary(resource_type, payload),
                        )
                except Exception as e:
                    # 稽核失敗＝交易失敗，不可 silently 改病歷
                    raise RuntimeError(f"稽核寫入失敗，已中止存檔：{e}") from e

            if resource_type == "Patient":
                try:
                    self._upsert_patient_index(conn, resource_id, payload)
                except PatientKeyConflict:
                    raise
                except sqlite3.IntegrityError as exc:
                    msg = str(exc)
                    if "uq_patient_index_id_no" in msg or "id_no" in msg.lower():
                        raise PatientKeyConflict("id_no", "?", resource_id) from exc
                    if "uq_patient_index_medical_no" in msg or "medical_no" in msg.lower():
                        raise PatientKeyConflict("medical_no", "?", resource_id) from exc
                    raise
            elif resource_type == "Encounter":
                self._upsert_encounter_index(conn, resource_id, payload)
                if cash_touch:
                    self._write_cash_book_columns(conn, resource_id, cash_touch)
            elif resource_type == "Condition":
                self._upsert_condition_index(conn, resource_id, payload)
            elif resource_type == "MedicationRequest":
                self._upsert_medication_request_index(conn, resource_id, payload)
            elif resource_type == "Composition":
                self._upsert_clinical_note_index(conn, resource_id, payload)
            elif resource_type == "Observation":
                self._upsert_observation_index(conn, resource_id, payload)
            elif resource_type == "AllergyIntolerance":
                self._upsert_allergy_index(conn, resource_id, payload)
            elif resource_type == "Media":
                self._upsert_media_index(conn, resource_id, payload)

    def verify_pin(self, pin: str) -> str | None:
        with self._connect() as conn:
            row = conn.execute("SELECT name, id FROM clinic_staff WHERE pin = ? AND status = '在職'", (pin,)).fetchone()
            return f"{row[0]} ({row[1]})" if row else None

    def list_audit_modifications(
        self,
        *,
        resource_type: str | None = None,
        resource_id: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        """查詢修改紀錄（責任機制）。"""
        limit = max(1, min(int(limit), 500))
        offset = max(0, int(offset))
        clauses: list[str] = []
        params: list[Any] = []
        if resource_type:
            clauses.append("resource_type = ?")
            params.append(resource_type)
        if resource_id:
            record_id = (
                resource_id
                if "/" in str(resource_id)
                else f"{resource_type}/{resource_id}" if resource_type else str(resource_id)
            )
            clauses.append("record_id = ?")
            params.append(record_id)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.extend([limit, offset])
        with self._connect() as conn:
            cols = {row[1] for row in conn.execute("PRAGMA table_info(audit_modifications)").fetchall()}
            has_action = "action" in cols
            action_sel = "action" if has_action else "'update' AS action"
            rows = conn.execute(
                f"""
                SELECT id, record_id, resource_type, timestamp, machine_id,
                       changed_fields, operator_identity, {action_sel}
                FROM audit_modifications
                {where}
                ORDER BY id DESC
                LIMIT ? OFFSET ?
                """,
                params,
            ).fetchall()
        out: list[dict[str, Any]] = []
        for r in rows:
            try:
                fields = json.loads(r[5]) if r[5] else {}
            except json.JSONDecodeError:
                fields = {"_raw": r[5]}
            out.append(
                {
                    "id": r[0],
                    "recordId": r[1],
                    "resourceType": r[2],
                    "timestamp": r[3],
                    "machineId": r[4],
                    "changedFields": fields,
                    "operatorIdentity": r[6],
                    "action": r[7] or "update",
                }
            )
        return out

    def write_audit_event(
        self,
        *,
        action: str,
        resource_type: str,
        resource_id: str,
        changed_fields: dict[str, Any],
        operator_identity: str | None = None,
        machine_id: str | None = None,
    ) -> None:
        """供匯入／破窗等高階流程寫入稽核列（未正式上線則略過）。"""
        with self._connect() as conn:
            if not _is_audit_recording_enabled(conn):
                return
            _insert_audit_row(
                conn,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                machine_id=machine_id or current_machine_id.get() or "Unknown_Machine",
                operator_identity=operator_identity
                or current_operator_identity.get()
                or "System_Collaborative",
                changed_fields=changed_fields,
            )

    def get_audit_status(self) -> dict[str, Any]:
        """稽核是否已正式啟用、上線時刻、目前筆數。"""
        with self._connect() as conn:
            _ensure_runtime_settings_table(conn)
            enabled = _is_audit_recording_enabled(conn)
            go_live = _get_runtime_setting(conn, "audit_go_live_at")
            count_row = conn.execute("SELECT COUNT(*) FROM audit_modifications").fetchone()
            count = int(count_row[0]) if count_row else 0
        return {
            "recordingEnabled": enabled,
            "goLiveAt": go_live,
            "modificationCount": count,
        }

    def is_audit_recording_enabled(self) -> bool:
        with self._connect() as conn:
            return _is_audit_recording_enabled(conn)

    def enable_audit_go_live(self, *, wipe_existing: bool = True) -> dict[str, Any]:
        """
        正式上線切點：啟用修改稽核寫入。
        預設清空上線前測試／匯入留下的稽核列，避免噪音。
        """
        with self._connect() as conn:
            _ensure_runtime_settings_table(conn)
            wiped = 0
            if wipe_existing:
                cur = conn.execute("DELETE FROM audit_modifications")
                wiped = int(cur.rowcount or 0)
            now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
            _set_runtime_setting(conn, "audit_recording", "1")
            _set_runtime_setting(conn, "audit_go_live_at", now)
            # 記一筆「稽核啟用」本身，之後所有紀錄都在此之後
            _insert_audit_row(
                conn,
                action="go_live",
                resource_type="System",
                resource_id="audit",
                machine_id=current_machine_id.get() or "GoLive_Script",
                operator_identity="System_Migration",
                changed_fields={
                    "wipedRows": wiped,
                    "message": "修改稽核正式啟用；此前測試紀錄已清空" if wipe_existing else "修改稽核正式啟用",
                },
            )
        return self.get_audit_status() | {"wipedRows": wiped}

    def disable_audit_recording(self) -> dict[str, Any]:
        """僅供開發／演練關閉寫入；不清空既有列。"""
        with self._connect() as conn:
            _ensure_runtime_settings_table(conn)
            _set_runtime_setting(conn, "audit_recording", "0")
        return self.get_audit_status()

    def get_resource_created_at(self, resource_type: str, resource_id: str) -> str | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT created_at FROM resource_cache WHERE resource_type = ? AND resource_id = ?",
                (resource_type, resource_id)
            ).fetchone()
            return row[0] if row else None

    def get_json_setting(self, key: str, default: Any = None) -> Any:
        """讀 clinic_runtime_settings 的 JSON 值。"""
        with self._connect() as conn:
            raw = _get_runtime_setting(conn, key)
        if raw is None or not str(raw).strip():
            return default
        try:
            return json.loads(raw)
        except Exception:
            return default

    def set_json_setting(self, key: str, value: Any) -> None:
        with self._connect() as conn:
            _set_runtime_setting(conn, key, json.dumps(value, ensure_ascii=False))

    def get_staff_list(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, name, role, nhi_id, cert_no, pin, status, room FROM clinic_staff"
            ).fetchall()
            return [
                {
                    "id": r[0],
                    "name": r[1],
                    "role": r[2],
                    "nhiId": r[3],
                    "certNo": r[4],
                    "pin": r[5],
                    "status": r[6],
                    "room": r[7] or "1",
                }
                for r in rows
            ]

    def save_staff(self, staff: dict[str, Any]) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO clinic_staff (id, name, role, nhi_id, cert_no, pin, status, room)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    role = excluded.role,
                    nhi_id = excluded.nhi_id,
                    cert_no = excluded.cert_no,
                    pin = excluded.pin,
                    status = excluded.status,
                    room = excluded.room
                """,
                (
                    staff.get("id"),
                    staff.get("name"),
                    staff.get("role"),
                    staff.get("nhiId"),
                    staff.get("certNo"),
                    staff.get("pin"),
                    staff.get("status", "在職"),
                    str(staff.get("room") or "1").strip() or "1",
                )
            )

    def delete_staff(self, staff_id: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM clinic_staff WHERE id = ?", (staff_id,))

    def _upsert_patient_index(
        self, conn: sqlite3.Connection, resource_id: str, payload: dict[str, Any]
    ) -> None:
        fields = _patient_index_fields(payload)
        _assert_patient_keys_unique(
            conn, resource_id, fields.get("id_no"), fields.get("medical_no")
        )
        conn.execute(
            """
            INSERT INTO patient_index (
                resource_id, family_name, given_name, identifier, birth_date,
                id_no, birthday_roc, sex, medical_no, phone, address, id_category, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(resource_id) DO UPDATE SET
                family_name = excluded.family_name,
                given_name = excluded.given_name,
                identifier = excluded.identifier,
                birth_date = excluded.birth_date,
                id_no = excluded.id_no,
                birthday_roc = excluded.birthday_roc,
                sex = excluded.sex,
                medical_no = excluded.medical_no,
                phone = excluded.phone,
                address = excluded.address,
                id_category = excluded.id_category,
                updated_at = datetime('now')
            """,
            (
                resource_id,
                fields["family_name"],
                fields["given_name"],
                fields["identifier"],
                fields["birth_date"],
                fields["id_no"],
                fields["birthday_roc"],
                fields["sex"],
                fields["medical_no"],
                fields["phone"],
                fields["address"],
                fields["id_category"],
            ),
        )

    def _stamp_cash_book_marks(
        self, conn: sqlite3.Connection, resource_id: str, payload: dict[str, Any]
    ) -> dict[str, str] | None:
        """Pair a Polaris save with the cash-book marks.

        Character 4 of the 6-byte CC is $ for a first kept visit and # otherwise.
        A held deposit writes remark U+62BC. Refunding that deposit clears it.
        Imported CC text is left as stored, including spaces.
        """
        from src.core.encounter_extensions import extract_reg_meta, put_reg_string

        prev = conn.execute(
            """
            SELECT patient_id, encounter_date, queue_number, fee_deposit, reg_cc, reg_remark
            FROM encounter_index WHERE resource_id = ?
            """,
            (resource_id,),
        ).fetchone()
        meta = extract_reg_meta(payload)
        touch: dict[str, str] = {}
        patient_id, encounter_date, queue_number, _queue_status, _fhir_status = (
            _encounter_index_fields(payload)
        )
        stored_cc = None if prev is None else prev[4]
        if not meta.get("regCc") and (stored_cc is None or stored_cc == "") and patient_id:
            earlier = conn.execute(
                """
                SELECT 1 FROM encounter_index
                WHERE patient_id = ?
                  AND resource_id != ?
                  AND IFNULL(queue_status, '') != 'cancelled'
                  AND IFNULL(fhir_status, '') != 'cancelled'
                  AND (
                    encounter_date < ?
                    OR (encounter_date = ? AND queue_number < ?)
                  )
                LIMIT 1
                """,
                (patient_id, resource_id, encounter_date, encounter_date, int(queue_number or 0)),
            ).fetchone()
            mark = "#" if earlier else "$"
            cc = "   " + mark + "  "
            put_reg_string(payload, "regCc", cc)
            touch["reg_cc"] = cc

        held = "\u62bc"
        stored_remark = "" if prev is None or prev[5] is None else str(prev[5])
        old_deposit = 0 if prev is None else int(prev[3] or 0)
        if "deposit" in meta:
            new_deposit = _fee_int(meta.get("deposit"))
        else:
            new_deposit = old_deposit
        note = str(meta.get("noteMark") or "")
        card_read = bool(str(meta.get("treatSeq") or "").strip())
        if card_read and new_deposit == 0 and (note.strip() == held or stored_remark.strip() == held):
            put_reg_string(payload, "noteMark", "")
            touch["reg_remark"] = ""
        elif new_deposit > 0 and not card_read and not stored_remark.strip() and not note.strip():
            put_reg_string(payload, "noteMark", held)
            touch["reg_remark"] = held
        elif (
            "deposit" in meta
            and new_deposit == 0
            and old_deposit > 0
            and (stored_remark.strip() == held or note.strip() == held)
        ):
            put_reg_string(payload, "noteMark", "")
            touch["reg_remark"] = ""
        return touch or None

    def _write_cash_book_columns(
        self, conn: sqlite3.Connection, resource_id: str, touch: dict[str, str]
    ) -> None:
        if "reg_cc" in touch and "reg_remark" in touch:
            conn.execute(
                "UPDATE encounter_index SET reg_cc = ?, reg_remark = ? WHERE resource_id = ?",
                (touch["reg_cc"], touch["reg_remark"], resource_id),
            )
        elif "reg_cc" in touch:
            conn.execute(
                "UPDATE encounter_index SET reg_cc = ? WHERE resource_id = ?",
                (touch["reg_cc"], resource_id),
            )
        elif "reg_remark" in touch:
            conn.execute(
                "UPDATE encounter_index SET reg_remark = ? WHERE resource_id = ?",
                (touch["reg_remark"], resource_id),
            )

    def _upsert_encounter_index(
        self, conn: sqlite3.Connection, resource_id: str, payload: dict[str, Any]
    ) -> None:
        patient_id, encounter_date, queue_number, queue_status, fhir_status = (
            _encounter_index_fields(payload)
        )
        fees = _encounter_fee_fields(payload)
        conn.execute(
            """
            INSERT INTO encounter_index (
                resource_id, patient_id, encounter_date, queue_number, queue_status, fhir_status,
                copay_code, case_no, fee_deposit, fee_copay, fee_card_disc, fee_drug_disc,
                fee_reg, fee_self, fee_total, fee_arrears, ic_upload_date, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(resource_id) DO UPDATE SET
                patient_id = excluded.patient_id,
                encounter_date = excluded.encounter_date,
                queue_number = excluded.queue_number,
                queue_status = excluded.queue_status,
                fhir_status = excluded.fhir_status,
                copay_code = excluded.copay_code,
                case_no = excluded.case_no,
                fee_deposit = excluded.fee_deposit,
                fee_copay = excluded.fee_copay,
                fee_card_disc = excluded.fee_card_disc,
                fee_drug_disc = excluded.fee_drug_disc,
                fee_reg = excluded.fee_reg,
                fee_self = excluded.fee_self,
                fee_total = excluded.fee_total,
                fee_arrears = excluded.fee_arrears,
                ic_upload_date = excluded.ic_upload_date,
                updated_at = datetime('now')
            """,
            (
                resource_id,
                patient_id,
                encounter_date,
                queue_number,
                queue_status,
                fhir_status,
                fees["copay_code"],
                fees["case_no"],
                fees["fee_deposit"],
                fees["fee_copay"],
                fees["fee_card_disc"],
                fees["fee_drug_disc"],
                fees["fee_reg"],
                fees["fee_self"],
                fees["fee_total"],
                fees["fee_arrears"],
                fees["ic_upload_date"],
            ),
        )

    def _upsert_condition_index(
        self, conn: sqlite3.Connection, resource_id: str, payload: dict[str, Any]
    ) -> None:
        fields = _condition_index_fields(payload)
        conn.execute(
            """
            INSERT INTO condition_index (
                resource_id, patient_id, encounter_id,
                icd10_code, snomed_code, nhi_icd10_code,
                summary_text, clinical_status, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(resource_id) DO UPDATE SET
                patient_id = excluded.patient_id,
                encounter_id = excluded.encounter_id,
                icd10_code = excluded.icd10_code,
                snomed_code = excluded.snomed_code,
                nhi_icd10_code = excluded.nhi_icd10_code,
                summary_text = excluded.summary_text,
                clinical_status = excluded.clinical_status,
                updated_at = datetime('now')
            """,
            (
                resource_id,
                fields["patient_id"],
                fields["encounter_id"],
                fields["icd10_code"],
                fields["snomed_code"],
                fields["nhi_icd10_code"],
                fields["summary_text"],
                fields["clinical_status"],
            ),
        )

    def _upsert_medication_request_index(
        self, conn: sqlite3.Connection, resource_id: str, payload: dict[str, Any]
    ) -> None:
        fields = _medication_request_index_fields(payload)
        conn.execute(
            """
            INSERT INTO medication_request_index (
                resource_id, patient_id, encounter_id,
                nhi_code, rxnorm_code, drug_text, status,
                days_supply, quantity, unit_price, pack_version, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(resource_id) DO UPDATE SET
                patient_id = excluded.patient_id,
                encounter_id = excluded.encounter_id,
                nhi_code = excluded.nhi_code,
                rxnorm_code = excluded.rxnorm_code,
                drug_text = excluded.drug_text,
                status = excluded.status,
                days_supply = COALESCE(excluded.days_supply, medication_request_index.days_supply),
                quantity = COALESCE(excluded.quantity, medication_request_index.quantity),
                unit_price = COALESCE(excluded.unit_price, medication_request_index.unit_price),
                pack_version = COALESCE(excluded.pack_version, medication_request_index.pack_version),
                updated_at = datetime('now')
            """,
            (
                resource_id,
                fields["patient_id"],
                fields["encounter_id"],
                fields["nhi_code"],
                fields["rxnorm_code"],
                fields["drug_text"],
                fields["status"],
                fields["days_supply"],
                fields["quantity"],
                fields["unit_price"],
                fields["pack_version"],
            ),
        )
        if "body_site" in fields:
            conn.execute(
                "UPDATE medication_request_index SET body_site = ? WHERE resource_id = ?",
                (fields.get("body_site") or None, resource_id),
            )
        if "pay_mark" in fields:
            conn.execute(
                "UPDATE medication_request_index SET pay_mark = ? WHERE resource_id = ?",
                (fields.get("pay_mark") or None, resource_id),
            )
        if "memo_mark" in fields:
            conn.execute(
                "UPDATE medication_request_index SET memo_mark = ? WHERE resource_id = ?",
                (fields.get("memo_mark") or None, resource_id),
            )
        if "useage" in fields:
            conn.execute(
                "UPDATE medication_request_index SET useage = ? WHERE resource_id = ?",
                (fields.get("useage") or None, resource_id),
            )

    def get_cached_resource(
        self, resource_type: str, resource_id: str
    ) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT payload_json FROM resource_cache
                WHERE resource_type = ? AND resource_id = ?
                """,
                (resource_type, resource_id),
            ).fetchone()
        if row is None:
            return None
        return json.loads(row[0])

    def enqueue_sync(
        self,
        operation: str,
        resource_type: str,
        resource_id: str | None,
        payload: dict[str, Any],
    ) -> int:
        with self._connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO sync_queue (operation, resource_type, resource_id, payload_json)
                VALUES (?, ?, ?, ?)
                """,
                (operation, resource_type, resource_id, json.dumps(payload, ensure_ascii=False)),
            )
            return int(cursor.lastrowid)

    def dequeue_sync_batch(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, operation, resource_type, resource_id, payload_json, created_at
                FROM sync_queue
                WHERE synced_at IS NULL
                ORDER BY id
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [
            {
                "id": row[0],
                "operation": row[1],
                "resource_type": row[2],
                "resource_id": row[3],
                "payload": json.loads(row[4]),
                "created_at": row[5],
            }
            for row in rows
        ]

    def mark_sync_done(self, queue_id: int) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE sync_queue SET synced_at = datetime('now') WHERE id = ?",
                (queue_id,),
            )

    def update_encounter_queue_status(self, resource_id: str, queue_status: str, fhir_status: str) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE encounter_index
                SET queue_status = ?, fhir_status = ?, updated_at = datetime('now')
                WHERE resource_id = ?
                """,
                (queue_status, fhir_status, resource_id),
            )
            row = conn.execute(
                "SELECT payload_json FROM resource_cache WHERE resource_type = 'Encounter' AND resource_id = ?",
                (resource_id,),
            ).fetchone()
            if row:
                payload = json.loads(row[0])
                payload["status"] = fhir_status
                conn.execute(
                    """
                    UPDATE resource_cache SET payload_json = ?, updated_at = datetime('now')
                    WHERE resource_type = 'Encounter' AND resource_id = ?
                    """,
                    (json.dumps(payload, ensure_ascii=False), resource_id),
                )

    def list_visit_summaries_for_patient(
        self,
        patient_id: str,
        *,
        exclude_encounter_id: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        """歷史清單快路徑：一條 SQL，不載完整處方 JSON。"""
        pid = patient_id.split("/")[-1]
        exclude = (exclude_encounter_id or "").split("/")[-1] or ""
        lim = max(1, min(int(limit), 500))
        sql = """
            SELECT
              ei.resource_id AS encounter_id,
              ei.encounter_date AS visit_date,
              ei.queue_number AS queue_number,
              """ + STORED_CHIEF_COMPLAINT_SQL + """ AS chief_complaint,
              (
                SELECT ci.summary_text FROM condition_index ci
                WHERE ci.encounter_id = ei.resource_id
                ORDER BY ci.updated_at DESC LIMIT 1
              ) AS disease_name,
              (
                SELECT MAX(mi.days_supply) FROM medication_request_index mi
                WHERE mi.encounter_id = ei.resource_id
              ) AS rx_days
            FROM encounter_index ei
            WHERE ei.patient_id = ?
              AND (? = '' OR ei.resource_id != ?)
              AND IFNULL(ei.queue_status, '') != 'cancelled'
              AND IFNULL(ei.fhir_status, '') != 'cancelled'
            ORDER BY ei.encounter_date DESC, ei.queue_number DESC
            LIMIT ?
            """
        with self._connect() as conn:
            rows = conn.execute(sql, (pid, exclude, exclude, lim)).fetchall()
        out: list[dict[str, Any]] = []
        for row in rows:
            rx_days = row["rx_days"]
            out.append(
                {
                    "encounterId": row["encounter_id"],
                    "visitDate": str(row["visit_date"] or "")[:10],
                    "slotDept": f"門診/{row['queue_number'] or '—'}",
                    "caseNo": "—",
                    "rxDays": str(rx_days) if rx_days else "—",
                    "cardNo": "—",
                    "aCode": "—",
                    "diseaseName": row["disease_name"] or "—",
                    "doctor": "—",
                    "dispense": "—",
                    "chiefComplaint": row["chief_complaint"] or "",
                    "diagnoses": [],
                    "medications": [],
                }
            )
        return out

    def lookup_chief_complaint(self, encounter_id: str) -> str:
        """跟調閱病歷同一份主訴。沒有這筆就診時回空字串。"""
        eid = (encounter_id or "").split("/")[-1]
        if not eid:
            return ""
        with self._connect() as conn:
            row = conn.execute(
                f"SELECT {STORED_CHIEF_COMPLAINT_SQL} FROM encounter_index ei WHERE ei.resource_id = ?",
                (eid,),
            ).fetchone()
        if row is None:
            return ""
        return str(row[0] or "")

    def set_encounter_chief_complaint(self, encounter_id: str, text: str) -> None:
        """醫師存主訴時，讓調閱病歷讀到的那一欄跟著更新。"""
        eid = (encounter_id or "").split("/")[-1]
        if not eid:
            return
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE encounter_index
                SET chief_complaint = ?, updated_at = datetime('now')
                WHERE resource_id = ?
                """,
                (str(text or "").strip(), eid),
            )

    def list_encounters_for_patient(
        self, patient_id: str, *, limit: int | None = None
    ) -> list[dict[str, Any]]:
        """列出特定病人的歷史掛號紀錄（可限筆數，預設不限）。"""
        pid = patient_id.split("/")[-1]
        sql = """
                SELECT
                    ei.resource_id,
                    ei.patient_id,
                    ei.encounter_date,
                    ei.queue_number,
                    ei.queue_status,
                    ei.fhir_status,
                    rc.payload_json
                FROM encounter_index ei
                JOIN resource_cache rc
                  ON rc.resource_type = 'Encounter' AND rc.resource_id = ei.resource_id
                WHERE ei.patient_id = ?
                  AND IFNULL(ei.queue_status, '') != 'cancelled'
                  AND IFNULL(ei.fhir_status, '') != 'cancelled'
                ORDER BY ei.encounter_date DESC, ei.queue_number DESC
                """
        params: list[Any] = [pid]
        if limit is not None and limit > 0:
            sql += " LIMIT ?"
            # 多抓幾筆供呼叫端排除當次 encounter
            params.append(int(limit) + 8)
        with self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        
        result = []
        for row in rows:
            resource = json.loads(row[6])
            result.append({
                "resource": resource,
                "queueMeta": {
                    "queueNumber": row[3],
                    "queueStatus": row[4],
                    "fhirStatus": row[5],
                    "encounterDate": row[2],
                    "patientId": row[1],
                }
            })
        return result

    def emr_text_match_ids(
        self,
        date_from: str,
        date_to: str,
        *,
        cc: str = "",
        dx: str = "",
        drug: str = "",
    ) -> set[str] | None:
        """Encounter ids whose chief complaint, diagnosis, or drug contains the text. None = no text filter."""

        def like(text: str) -> str:
            safe = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            return f"%{safe}%"

        cc_text = cc.strip()
        dx_text = dx.strip()
        drug_text = drug.strip()
        if not cc_text and not dx_text and not drug_text:
            return None
        where = [
            "ei.queue_status != 'cancelled'",
            "IFNULL(ei.fhir_status, '') != 'cancelled'",
            "ei.encounter_date >= ? AND ei.encounter_date <= ?",
        ]
        params: list[Any] = [date_from[:10], date_to[:10]]
        if cc_text:
            where.append(
                "("
                "IFNULL(ei.chief_complaint, '') LIKE ? ESCAPE '\\' "
                "OR IFNULL(ei.reg_cc, '') LIKE ? ESCAPE '\\' "
                "OR EXISTS (SELECT 1 FROM clinical_note_index cn "
                "WHERE cn.encounter_id = ei.resource_id "
                "AND IFNULL(cn.chief_complaint, '') LIKE ? ESCAPE '\\')"
                ")"
            )
            token = like(cc_text)
            params.extend([token, token, token])
        if dx_text:
            parts: list[str] = []
            for token in [piece.strip() for piece in dx_text.split("|") if piece.strip()][:12]:
                parts.append(
                    "(IFNULL(ci.summary_text, '') LIKE ? ESCAPE '\\' "
                    "OR IFNULL(ci.icd10_code, '') LIKE ? ESCAPE '\\' "
                    "OR REPLACE(IFNULL(ci.icd10_code, ''), '.', '') LIKE ? ESCAPE '\\' "
                    "OR IFNULL(ci.nhi_icd10_code, '') LIKE ? ESCAPE '\\' "
                    "OR REPLACE(IFNULL(ci.nhi_icd10_code, ''), '.', '') LIKE ? ESCAPE '\\')"
                )
                plain = like(token)
                compact = like(token.replace(".", ""))
                params.extend([plain, plain, compact, plain, compact])
            if parts:
                where.append(
                    "EXISTS (SELECT 1 FROM condition_index ci WHERE ci.encounter_id = ei.resource_id AND ("
                    + " OR ".join(parts)
                    + "))"
                )
        if drug_text:
            parts = []
            for token in [piece.strip() for piece in drug_text.split("|") if piece.strip()][:12]:
                parts.append(
                    "(IFNULL(mi.drug_text, '') LIKE ? ESCAPE '\\' "
                    "OR IFNULL(mi.nhi_code, '') LIKE ? ESCAPE '\\')"
                )
                plain = like(token)
                params.extend([plain, plain])
            if parts:
                where.append(
                    "EXISTS (SELECT 1 FROM medication_request_index mi WHERE mi.encounter_id = ei.resource_id AND ("
                    + " OR ".join(parts)
                    + "))"
                )
        sql = f"SELECT ei.resource_id FROM encounter_index ei WHERE {' AND '.join(where)}"
        with self._connect() as conn:
            return {str(row[0]) for row in conn.execute(sql, tuple(params)) if row[0]}

    def charts_with_media(self, date_from: str, date_to: str) -> set[str]:
        """Six-digit chart numbers that have an image on a visit in the range."""
        found: set[str] = set()
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT DISTINCT trim(pi.medical_no)
                FROM media_index mi
                JOIN encounter_index ei ON ei.resource_id = mi.encounter_id
                JOIN patient_index pi ON pi.resource_id = mi.patient_id
                WHERE ei.encounter_date >= ? AND ei.encounter_date <= ?
                  AND IFNULL(mi.has_image_data, 1) != 0
                """,
                (date_from[:10], date_to[:10]),
            ).fetchall()
        for (raw,) in rows:
            digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
            if digits:
                found.add(digits[:6].zfill(6))
        return found

    def note_look_files(self) -> dict[str, Any]:
        """Remember photo filenames that are already in the image folder.

        Does not copy image bytes and does not delete a name or a file.
        """
        from src.core.look_images import iter_chart_photos, look_root

        root = look_root()
        if not root.is_dir():
            return {
                "ok": False,
                "reachable": False,
                "root": str(root),
                "scanned": 0,
                "added": 0,
                "known": 0,
            }
        added = 0
        scanned = 0
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS look_file (
                    rel         TEXT PRIMARY KEY,
                    chart_no    TEXT NOT NULL,
                    file_name   TEXT NOT NULL,
                    modified    TEXT,
                    size_bytes  INTEGER,
                    noted_at    TEXT NOT NULL DEFAULT (datetime('now'))
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_look_file_chart ON look_file(chart_no)"
            )
            known = {str(row[0]) for row in conn.execute("SELECT rel FROM look_file")}
            pending: list[tuple[Any, ...]] = []

            def flush() -> None:
                nonlocal added
                if not pending:
                    return
                conn.executemany(
                    """
                    INSERT OR IGNORE INTO look_file
                        (rel, chart_no, file_name, modified, size_bytes)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    pending,
                )
                added += len(pending)
                pending.clear()

            for item in iter_chart_photos(root):
                scanned += 1
                rel = item["rel"]
                if rel in known:
                    continue
                known.add(rel)
                pending.append((rel, item["chart"], item["name"], item["modified"], item["size"]))
                if len(pending) >= 400:
                    flush()
            flush()
        return {
            "ok": True,
            "reachable": True,
            "root": str(root),
            "scanned": scanned,
            "added": added,
            "known": scanned - added,
        }

    def list_encounters_for_date(
        self,
        encounter_date: str,
        *,
        date_to: str | None = None,
        patient_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """診間掛號清單。date_to 有值時改查起迄（含），可再限一位病患。"""
        result: list[dict[str, Any]] = []
        from src.core.encounter_extensions import extract_reg_meta, previsit_completed, previsit_visit_kind

        where = [
            "ei.queue_status != 'cancelled'",
            "IFNULL(ei.fhir_status, '') != 'cancelled'",
        ]
        params: list[Any] = []
        if date_to:
            where.append("ei.encounter_date >= ? AND ei.encounter_date <= ?")
            params.extend([encounter_date[:10], date_to[:10]])
        else:
            where.append("ei.encounter_date = ?")
            params.append(encounter_date)
        if patient_id:
            where.append("ei.patient_id = ?")
            params.append(patient_id.split("/")[-1])
        where_sql = " AND ".join(where)

        with self._connect() as conn:
            # CROSS JOIN: keep the date index as the driver. A plain JOIN walks every Encounter payload.
            rows = conn.execute(
                f"""
                SELECT
                    ei.resource_id,
                    ei.patient_id,
                    ei.encounter_date,
                    ei.queue_number,
                    ei.queue_status,
                    ei.fhir_status,
                    rc.payload_json,
                    pi.family_name,
                    pi.given_name,
                    pi.birth_date,
                    pi.identifier,
                    pi.sex,
                    pi.medical_no,
                    pi.phone,
                    pi.address,
                    pi.id_no,
                    ei.times_no,
                    ei.owe_card,
                    ei.reg_cc,
                    ei.reg_remark,
                    {STORED_CHIEF_COMPLAINT_SQL}
                FROM encounter_index ei
                CROSS JOIN resource_cache rc
                  ON rc.resource_type = 'Encounter' AND rc.resource_id = ei.resource_id
                LEFT JOIN patient_index pi ON pi.resource_id = ei.patient_id
                WHERE {where_sql}
                ORDER BY ei.encounter_date ASC, ei.queue_number ASC, ei.updated_at ASC
                """,
                tuple(params),
            ).fetchall()

            enc_ids = [row[0] for row in rows]
            pid_ids = list({row[1] for row in rows if row[1]})
            cond_first: dict[str, tuple] = {}
            med_days_map: dict[str, Any] = {}
            weight_map: dict[str, Any] = {}
            allergy_pids: set[str] = set()
            clinic_by_pid: dict[str, dict[str, str]] = {}

            def _chunks(items: list[str], size: int = 400):
                for i in range(0, len(items), size):
                    yield items[i : i + size]

            referred_out: set[str] = set()
            for chunk in _chunks(enc_ids):
                marks = ",".join("?" * len(chunk))
                for er, icd, nhi, summary in conn.execute(
                    "SELECT encounter_id, icd10_code, nhi_icd10_code, summary_text "
                    f"FROM condition_index WHERE encounter_id IN ({marks}) "
                    "ORDER BY updated_at ASC, resource_id ASC",
                    chunk,
                ):
                    cond_first.setdefault(er, (icd, nhi, summary))
                for er, days in conn.execute(
                    "SELECT encounter_id, MAX(days_supply) FROM medication_request_index "
                    f"WHERE encounter_id IN ({marks}) GROUP BY encounter_id",
                    chunk,
                ):
                    if days is not None:
                        med_days_map[er] = days
                for er, val in conn.execute(
                    "SELECT encounter_id, value_num FROM observation_index "
                    f"WHERE vital_type = 'weight' AND value_num IS NOT NULL AND encounter_id IN ({marks})",
                    chunk,
                ):
                    weight_map.setdefault(er, val)
            try:
                slip_rows = conn.execute(
                    "SELECT opened_on, encounter_id, medical_no FROM referral_slip WHERE kind = 'out'"
                ).fetchall()
            except sqlite3.OperationalError:
                slip_rows = []
            ids_by_day: dict[str, set[str]] = {}
            charts_by_day: dict[tuple[str, str], set[str]] = {}
            for row in rows:
                day = str(row[2] or "")[:10]
                rid = str(row[0] or "")
                if not rid:
                    continue
                ids_by_day.setdefault(day, set()).add(rid)
                chart_key = str(row[12] or "").strip().lstrip("0")
                if chart_key:
                    charts_by_day.setdefault((day, chart_key), set()).add(rid)
            for opened_on, slip_enc, medical_no in slip_rows:
                day = str(opened_on or "")[:10]
                slip_enc = str(slip_enc or "").strip()
                if slip_enc and slip_enc in ids_by_day.get(day, ()):
                    referred_out.add(slip_enc)
                    continue
                if slip_enc:
                    continue
                chart_key = str(medical_no or "").strip().lstrip("0")
                if chart_key:
                    referred_out.update(charts_by_day.get((day, chart_key), ()))
            for chunk in _chunks(pid_ids):
                marks = ",".join("?" * len(chunk))
                for (apid,) in conn.execute(
                    "SELECT DISTINCT ai.patient_id FROM allergy_index ai "
                    "JOIN resource_cache rc ON rc.resource_type = 'AllergyIntolerance' "
                    "AND rc.resource_id = ai.resource_id "
                    "WHERE ai.verification_status = 'confirmed' "
                    f"AND ai.patient_id IN ({marks})",
                    chunk,
                ):
                    allergy_pids.add(apid)
                for ppid, raw in conn.execute(
                    "SELECT resource_id, payload_json FROM resource_cache "
                    f"WHERE resource_type = 'Patient' AND resource_id IN ({marks})",
                    chunk,
                ):
                    clinic_by_pid[ppid] = _clinic_fields_from_payload(raw)

            for row in rows:
                resource = json.loads(row[6])
                family = row[7] or ""
                given = row[8] or ""
                birth_date = row[9] or ""
                identifier = row[10] or ""
                sex = row[11] or ""
                medical_no = row[12] or ""
                phone = row[13] or ""
                address = row[14] or ""
                patient_id_no = str(row[15] or "").strip().upper()
                
                display = f"{family}{given}".strip() or row[2]
                pid = row[1]
                reason_text = ""
                reg_meta = extract_reg_meta(resource)
                note_mark = str(reg_meta.get("noteMark") or "")
                forespeak = str(reg_meta.get("forespeak") or "")
                # Zhu: REMARK only (Ya/Huan/Zi…). Yu belongs in Yu column while still prebook.
                note_display = note_mark
                # Bei-zhu: patient USER.MEMO / keymoney / kind from Patient extension
                patient_clinic = clinic_by_pid.get(pid) or {
                    "memo": "",
                    "keymoney": "",
                    "kind": "",
                    "idCategory": "",
                    "idNo": "",
                    "arrearage": "",
                }
                reason_text = patient_clinic.get("memo") or ""
                if not patient_id_no:
                    patient_id_no = patient_clinic.get("idNo") or ""
                period = resource.get("period") or {}
                slot_time = ""
                start = period.get("start")
                if start and "T" in str(start):
                    slot_time = str(start).split("T")[1][:8]
                enc_date = str(row[2] or "")[:10]
                age = _age_from_birth_date(birth_date, as_of=enc_date or None)
                age_sex = f"{age}{sex}" if age and sex else (age or sex or "")
                resource_id = row[0]
                card_written = bool(reg_meta.get("cardWritten"))
                # Yu only while still appointment (waiting+prebook); gone after check-in/start
                prebook = bool(reg_meta.get("prebook")) or forespeak == "\u9810"
                show_pre = prebook and str(row[4] or "") == "waiting"
                shift = str(reg_meta.get("shift") or "")
                if not shift and slot_time:
                    try:
                        hour = int(slot_time.split(":")[0])
                        shift = (
                            "\u4e0a\u5348"
                            if hour < 12
                            else ("\u4e0b\u5348" if hour < 18 else "\u665a\u4e0a")
                        )
                    except ValueError:
                        shift = ""
                
                icd_code = "—"
                disease_name = "—"
                rx_days = "—"
                weight = "—"
                cond_hit = cond_first.get(resource_id)
                if cond_hit:
                    icd_code = cond_hit[0] or cond_hit[1] or "—"
                    disease_name = cond_hit[2] or "—"
                if resource_id in med_days_map:
                    rx_days = str(int(med_days_map[resource_id]))
                if resource_id in weight_map:
                    weight = f"{weight_map[resource_id]} kg"
                has_allergy = pid in allergy_pids
                
                queue_meta = {
                    "queueNumber": row[3],
                    "queueStatus": row[4],
                    "queueStatusLabel": _queue_label(row[4]),
                    "fhirStatus": row[5],
                    "encounterDate": row[2],
                    "patientId": pid,
                    "patientDisplay": display,
                    "preVisitCompleted": previsit_completed(resource),
                    "visitKind": previsit_visit_kind(resource),
                    "hasAllergyAlert": has_allergy,
                    "reasonText": reason_text,
                    "slotTime": slot_time,
                    "medicalNo": medical_no or identifier or "—",
                    "phone": phone or "—",
                    "address": address or "—",
                    "age": age,
                    "sex": sex,
                    "ageSex": age_sex,
                    "birthday": birth_date,
                    "icdCode": icd_code,
                    "diseaseName": disease_name,
                    "rxDays": rx_days,
                    "weight": weight,
                    "note": note_display or "—",
                    "noteMark": note_display,
                    "forespeak": forespeak if show_pre else "",
                    # Display Yu only while still waiting appointment
                    "prebook": show_pre,
                    "cardWritten": card_written,
                    "shift": shift or None,
                    "timesNo": int(row[16] or 0),
                    "oweCard": bool(row[17]),
                    "regCc": row[18] or "",
                    "regRemark": row[19] or "",
                    "visitCc": row[20] or "",
                    "referredOut": resource_id in referred_out,
                    **{
                        k: v
                        for k, v in reg_meta.items()
                        if k
                        not in {
                            "noteMark",
                            "forespeak",
                            "remarkText",
                            "prebook",
                            "cardWritten",
                            "shift",
                        }
                    },
                }
                _apply_patient_fallbacks_to_queue_meta(queue_meta, patient_id_no, patient_clinic)
                result.append({"resource": resource, "queueMeta": queue_meta})
        # Default order: queue number, then slot time (AM/PM may reuse numbers)
        result.sort(
            key=lambda e: (
                int((e.get("queueMeta") or {}).get("queueNumber") or 0),
                str((e.get("queueMeta") or {}).get("slotTime") or "99:99"),
            )
        )
        return result

    def cash_book_summary(
        self,
        date_from: str,
        date_to: str,
        *,
        shift: str | None = None,
        finished_only: bool = False,
    ) -> dict[str, Any]:
        """現金帳總計。只加總欄位，不讀病歷 JSON。"""
        d0 = date_from[:10]
        d1 = date_to[:10]
        where = [
            "encounter_date >= ?",
            "encounter_date <= ?",
            "IFNULL(queue_status, '') != 'cancelled'",
            "IFNULL(fhir_status, '') != 'cancelled'",
        ]
        params: list[Any] = [d0, d1]
        if shift:
            where.append("shift = ?")
            params.append(shift)
        if finished_only:
            where.append("(queue_status = 'finished' OR fhir_status = 'finished')")
        where_sql = " AND ".join(where)
        # Self-pay is the visit case (9X / 自), not a blank copay and not a self-pay drug.
        # A blank or 0 copay on an insurance visit is ordinary outpatient.
        # First visit is CC character 4 (1-based), the mark $, not times==1.
        # Missing card: deposit still held, or remark exactly U+62BC.
        bucket_sql = (
            "CASE "
            "WHEN UPPER(TRIM(IFNULL(case_no, ''))) IN ('9X', '\u81ea', '\u81ea\u8cbb') THEN '\u81ea\u8cbb' "
            "WHEN TRIM(IFNULL(copay_code, '')) IN ('', '0') THEN '\u4e00\u822c' "
            "ELSE copay_code END"
        )
        first_sql = "SUBSTR(IFNULL(reg_cc, ''), 4, 1) = '$'"
        owe_sql = "IFNULL(fee_deposit, 0) > 0 OR IFNULL(reg_remark, '') = '\u62bc'"
        with self._connect() as conn:
            day_rows = conn.execute(
                f"""
                SELECT encounter_date,
                       COUNT(*),
                       COALESCE(SUM(fee_deposit), 0),
                       COALESCE(SUM(fee_copay), 0),
                       COALESCE(SUM(fee_card_disc), 0),
                       COALESCE(SUM(fee_drug_disc), 0),
                       COALESCE(SUM(fee_reg), 0),
                       COALESCE(SUM(fee_self), 0),
                       COALESCE(SUM(fee_total), 0),
                       COALESCE(SUM(fee_arrears), 0)
                FROM encounter_index
                WHERE {where_sql}
                GROUP BY encounter_date
                ORDER BY encounter_date
                """,
                tuple(params),
            ).fetchall()
            bucket_rows = conn.execute(
                f"""
                SELECT {bucket_sql},
                       SUM(CASE WHEN {first_sql} THEN 1 ELSE 0 END),
                       SUM(CASE WHEN {first_sql} THEN 0 ELSE 1 END),
                       SUM(CASE WHEN {owe_sql} THEN 1 ELSE 0 END)
                FROM encounter_index
                WHERE {where_sql}
                GROUP BY {bucket_sql}
                ORDER BY 1
                """,
                tuple(params),
            ).fetchall()
            returns = conn.execute(
                """
                SELECT encounter_date,
                       CASE WHEN UPPER(TRIM(IFNULL(case_no, ''))) IN ('9X', '\u81ea', '\u81ea\u8cbb') THEN '\u81ea\u8cbb'
                            WHEN TRIM(IFNULL(copay_code, '')) IN ('', '0') THEN '\u4e00\u822c'
                            ELSE copay_code END,
                       COUNT(*), COALESCE(SUM(amount), 0)
                FROM cash_return
                WHERE encounter_date >= ? AND encounter_date <= ?
                GROUP BY encounter_date,
                         CASE WHEN UPPER(TRIM(IFNULL(case_no, ''))) IN ('9X', '\u81ea', '\u81ea\u8cbb') THEN '\u81ea\u8cbb'
                              WHEN TRIM(IFNULL(copay_code, '')) IN ('', '0') THEN '\u4e00\u822c'
                              ELSE copay_code END
                """,
                (d0, d1),
            ).fetchall()
        by_day: dict[str, dict[str, Any]] = {}
        for row in day_rows:
            received = int(row[8] or 0)
            arrears = int(row[9] or 0)
            by_day[str(row[0])] = {
                "date": str(row[0]),
                "people": int(row[1] or 0),
                "deposit": int(row[2] or 0),
                "copayAmt": int(row[3] or 0),
                "cardDisc": int(row[4] or 0),
                "drugDisc": int(row[5] or 0),
                "regFee": int(row[6] or 0),
                "selfPay": int(row[7] or 0),
                "received": received,
                "arrears": arrears,
                "returnSlip": 0,
                "total": received + arrears,
            }
        buckets: dict[str, dict[str, Any]] = {}
        for row in bucket_rows:
            code = str(row[0])
            buckets[code] = {
                "code": code,
                "firstVisit": int(row[1] or 0),
                "revisit": int(row[2] or 0),
                "missingCard": int(row[3] or 0),
                "returnCard": 0,
            }
        if not shift:
            for row in returns:
                day = str(row[0])
                code = str(row[1])
                amount = int(row[3] or 0)
                slot = by_day.get(day)
                if slot is None:
                    slot = {
                        "date": day,
                        "people": 0,
                        "deposit": 0,
                        "copayAmt": 0,
                        "cardDisc": 0,
                        "drugDisc": 0,
                        "regFee": 0,
                        "selfPay": 0,
                        "received": 0,
                        "arrears": 0,
                        "returnSlip": 0,
                        "total": 0,
                    }
                    by_day[day] = slot
                slot["returnSlip"] += amount
                slot["total"] = slot["received"] - slot["returnSlip"] + slot["arrears"]
                bucket = buckets.setdefault(
                    code,
                    {
                        "code": code,
                        "firstVisit": 0,
                        "revisit": 0,
                        "missingCard": 0,
                        "returnCard": 0,
                    },
                )
                bucket["returnCard"] += int(row[2] or 0)
        return {
            "dateFrom": d0,
            "dateTo": d1,
            "days": [by_day[k] for k in sorted(by_day)],
            "buckets": [buckets[k] for k in sorted(buckets)],
        }

    def list_cash_returns(self, date_from: str, date_to: str) -> list[dict[str, Any]]:
        """ACOUNT.Dat refunds (還單) in the visit-date range."""
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT encounter_date, amount, copay_code,
                       chart_no, patient_name, id_no, seg, treat_seq, case_no
                FROM cash_return
                WHERE encounter_date >= ? AND encounter_date <= ?
                ORDER BY encounter_date, id
                """,
                (date_from[:10], date_to[:10]),
            ).fetchall()
        return [
            {
                "date": row[0],
                "amount": int(row[1] or 0),
                "copayCode": row[2] or "",
                "chart": row[3] or "",
                "patientName": row[4] or "",
                "idNo": row[5] or "",
                "seg": row[6] or "",
                "treatSeq": row[7] or "",
                "caseNo": row[8] or "",
            }
            for row in rows
        ]

    def insert_cash_return(
        self,
        *,
        encounter_date: str,
        amount: int,
        keywords: str,
        chart_no: str = "",
        patient_name: str = "",
        id_no: str = "",
        treat_seq: str = "",
        case_no: str = "",
    ) -> None:
        """One cash refund row. Same keywords (encounter id) is not inserted twice."""
        key = (keywords or "").strip()
        if not key or amount <= 0:
            return
        with self._connect() as conn:
            exists = conn.execute(
                "SELECT 1 FROM cash_return WHERE keywords = ?",
                (key,),
            ).fetchone()
            if exists:
                return
            conn.execute(
                """
                INSERT INTO cash_return (
                    encounter_date, amount, keywords, chart_no, patient_name, id_no, treat_seq, case_no
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    encounter_date[:10],
                    int(amount),
                    key,
                    chart_no,
                    patient_name,
                    id_no,
                    treat_seq,
                    case_no,
                ),
            )

    def encounter_date_span(self) -> dict[str, Any]:
        """Date range and a recent busy clinic day. Uses the date index, not a full-history group."""
        open_filter = (
            "queue_status != 'cancelled' AND IFNULL(fhir_status, '') != 'cancelled'"
        )
        with self._connect() as conn:
            first = conn.execute(
                f"""
                SELECT encounter_date FROM encounter_index
                WHERE {open_filter}
                ORDER BY encounter_date ASC
                LIMIT 1
                """
            ).fetchone()
            last = conn.execute(
                f"""
                SELECT encounter_date FROM encounter_index
                WHERE {open_filter}
                ORDER BY encounter_date DESC
                LIMIT 1
                """
            ).fetchone()
            date_min = str(first[0]) if first else None
            date_max = str(last[0]) if last else None
            suggested = None
            suggested_count = 0
            if date_max:
                start = (datetime.strptime(date_max[:10], "%Y-%m-%d") - timedelta(days=400)).date().isoformat()
                rows = conn.execute(
                    f"""
                    SELECT encounter_date, COUNT(*) AS c
                    FROM encounter_index
                    WHERE {open_filter}
                      AND encounter_date >= ?
                    GROUP BY encounter_date
                    """,
                    (start,),
                ).fetchall()
                best_tier = 99
                best_date = ""
                for day, count in rows:
                    n = int(count or 0)
                    tier = 0 if n >= 30 else 1 if n >= 10 else 2 if n >= 5 else 3
                    day_s = str(day)
                    if tier < best_tier or (tier == best_tier and day_s > best_date):
                        best_tier = tier
                        best_date = day_s
                        suggested_count = n
                if best_date:
                    suggested = best_date
        return {
            "dateMin": date_min,
            "dateMax": date_max,
            "total": 0,
            "suggestedDate": suggested,
            "suggestedCount": suggested_count,
        }

    def nearest_encounter_dates(self, encounter_date: str) -> dict[str, Any]:
        """指定日期前後最近有掛號的診日（含人數）。"""
        d = encounter_date[:10]
        open_filter = (
            "queue_status != 'cancelled' AND IFNULL(fhir_status, '') != 'cancelled'"
        )

        def _edge(conn: sqlite3.Connection, cmp_sql: str, order: str) -> dict[str, Any] | None:
            row = conn.execute(
                f"""
                SELECT encounter_date FROM encounter_index
                WHERE encounter_date {cmp_sql} ?
                  AND {open_filter}
                ORDER BY encounter_date {order}
                LIMIT 1
                """,
                (d,),
            ).fetchone()
            if not row:
                return None
            day = str(row[0])
            cnt = conn.execute(
                f"""
                SELECT COUNT(*) FROM encounter_index
                WHERE encounter_date = ? AND {open_filter}
                """,
                (day,),
            ).fetchone()
            return {"date": day, "count": int(cnt[0] or 0) if cnt else 0}

        with self._connect() as conn:
            before = _edge(conn, "<", "DESC")
            after = _edge(conn, ">", "ASC")
            same = conn.execute(
                f"""
                SELECT COUNT(*) FROM encounter_index
                WHERE encounter_date = ? AND {open_filter}
                """,
                (d,),
            ).fetchone()
        return {
            "requestedDate": d,
            "count": int(same[0] or 0) if same else 0,
            "nearestBefore": before,
            "nearestAfter": after,
        }

    def get_encounter_queue_meta(self, encounter_id: str) -> dict[str, Any] | None:
        """取得單一掛號的詳細資料與 queueMeta。"""
        from src.core.encounter_extensions import extract_reg_meta, previsit_completed, previsit_visit_kind
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT
                    ei.resource_id,
                    ei.patient_id,
                    ei.encounter_date,
                    ei.queue_number,
                    ei.queue_status,
                    ei.fhir_status,
                    rc.payload_json,
                    pi.family_name,
                    pi.given_name,
                    pi.birth_date,
                    pi.identifier,
                    pi.sex,
                    pi.medical_no,
                    pi.phone,
                    pi.address,
                    pi.id_no,
                    """ + STORED_CHIEF_COMPLAINT_SQL + """
                FROM encounter_index ei
                JOIN resource_cache rc
                  ON rc.resource_type = 'Encounter' AND rc.resource_id = ei.resource_id
                LEFT JOIN patient_index pi ON pi.resource_id = ei.patient_id
                WHERE ei.resource_id = ?
                """,
                (encounter_id,),
            ).fetchone()
            if not row:
                return None

            resource = json.loads(row[6])
            family = row[7] or ""
            given = row[8] or ""
            birth_date = row[9] or ""
            identifier = row[10] or ""
            sex = row[11] or ""
            medical_no = row[12] or ""
            phone = row[13] or ""
            address = row[14] or ""
            patient_id_no = str(row[15] or "").strip().upper()
            
            display = f"{family}{given}".strip() or row[2]
            pid = row[1]
            reg_meta = extract_reg_meta(resource)
            note_mark = str(reg_meta.get("noteMark") or "")
            forespeak = str(reg_meta.get("forespeak") or "")
            note_display = note_mark
            patient_clinic = _load_patient_clinic_fields(conn, pid)
            reason_text = patient_clinic.get("memo") or ""
            if not patient_id_no:
                patient_id_no = patient_clinic.get("idNo") or ""
            period = resource.get("period") or {}
            slot_time = ""
            start = period.get("start")
            if start and "T" in str(start):
                slot_time = str(start).split("T")[1][:8]
            enc_date = str(row[2] or "")[:10]
            age = _age_from_birth_date(birth_date, as_of=enc_date or None)
            age_sex = f"{age}{sex}" if age and sex else (age or sex or "")
            card_written = bool(reg_meta.get("cardWritten"))
            prebook_raw = bool(reg_meta.get("prebook")) or forespeak == "\u9810"
            show_pre = prebook_raw and str(row[4] or "") == "waiting"
            shift = str(reg_meta.get("shift") or "") or None

            icd_code = "—"
            disease_name = "—"
            rx_days = "—"
            weight = "—"

            cond_rows = conn.execute(
                "SELECT icd10_code, nhi_icd10_code, summary_text FROM condition_index "
                "WHERE encounter_id = ? ORDER BY updated_at ASC, resource_id ASC LIMIT 1",
                (encounter_id,),
            ).fetchall()
            if cond_rows:
                icd_code = cond_rows[0][0] or cond_rows[0][1] or "—"
                disease_name = cond_rows[0][2] or "—"

            med_rows = conn.execute(
                "SELECT payload_json FROM resource_cache "
                "WHERE resource_type = 'MedicationRequest' "
                "  AND resource_id = (SELECT resource_id FROM medication_request_index WHERE encounter_id = ? LIMIT 1)",
                (encounter_id,),
            ).fetchall()
            if med_rows:
                try:
                    med_payload = json.loads(med_rows[0][0])
                    dosage_text = med_payload.get("dosageInstruction", [{}])[0].get("text", "")
                    import re

                    m = re.search(r"(\d+)\s*(天|日)", dosage_text)
                    if m:
                        rx_days = m.group(1)
                    else:
                        rx_days = "3"
                except Exception:
                    rx_days = "3"

            obs_weight = conn.execute(
                "SELECT value_num FROM observation_index WHERE encounter_id = ? AND vital_type = 'weight' LIMIT 1",
                (encounter_id,),
            ).fetchone()
            if obs_weight and obs_weight[0] is not None:
                weight = f"{obs_weight[0]} kg"

            allergy_row = conn.execute(
                """
                SELECT 1 FROM allergy_index ai
                JOIN resource_cache rc
                  ON rc.resource_type = 'AllergyIntolerance' AND rc.resource_id = ai.resource_id
                WHERE ai.patient_id = ?
                  AND ai.verification_status = 'confirmed'
                LIMIT 1
                """,
                (pid,),
            ).fetchone()
            has_allergy = allergy_row is not None

            queue_meta = {
                "queueNumber": row[3],
                "queueStatus": row[4],
                "queueStatusLabel": _queue_label(row[4]),
                "fhirStatus": row[5],
                "encounterDate": row[2],
                "patientId": pid,
                "patientDisplay": display,
                "preVisitCompleted": previsit_completed(resource),
                "visitKind": previsit_visit_kind(resource),
                "hasAllergyAlert": has_allergy,
                "reasonText": reason_text,
                "visitCc": row[16] or "",
                "slotTime": slot_time,
                "medicalNo": medical_no or identifier or "—",
                "phone": phone or "—",
                "address": address or "—",
                "age": age,
                "sex": sex,
                "ageSex": age_sex,
                "birthday": birth_date,
                "icdCode": icd_code,
                "diseaseName": disease_name,
                "rxDays": rx_days,
                "weight": weight,
                "note": note_display or "—",
                "noteMark": note_display,
                "forespeak": forespeak if show_pre else "",
                "prebook": show_pre,
                "cardWritten": card_written,
                "shift": shift,
                **{
                    k: v
                    for k, v in reg_meta.items()
                    if k
                    not in {
                        "noteMark",
                        "forespeak",
                        "remarkText",
                        "prebook",
                        "cardWritten",
                        "shift",
                    }
                },
            }
            _apply_patient_fallbacks_to_queue_meta(queue_meta, patient_id_no, patient_clinic)
            return {"resource": resource, "queueMeta": queue_meta}

    def patient_has_confirmed_allergy(self, patient_id: str) -> bool:
        pid = patient_id.split("/")[-1]
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT 1 FROM allergy_index ai
                JOIN resource_cache rc
                  ON rc.resource_type = 'AllergyIntolerance' AND rc.resource_id = ai.resource_id
                WHERE ai.patient_id = ?
                  AND ai.verification_status = 'confirmed'
                LIMIT 1
                """,
                (pid,),
            ).fetchone()
        return row is not None

    def find_last_finished_encounter_id(
        self, patient_id: str, *, exclude_encounter_id: str | None = None
    ) -> str | None:
        pid = patient_id.split("/")[-1]
        query = """
            SELECT resource_id FROM encounter_index
            WHERE patient_id = ? AND queue_status = 'finished'
        """
        params: list[Any] = [pid]
        if exclude_encounter_id:
            query += " AND resource_id != ?"
            params.append(exclude_encounter_id.split("/")[-1])
        query += " ORDER BY updated_at DESC LIMIT 1"
        with self._connect() as conn:
            row = conn.execute(query, params).fetchone()
        return str(row[0]) if row else None

    def next_queue_number(self, encounter_date: str) -> int:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT COALESCE(MAX(queue_number), 0) + 1 FROM encounter_index "
                "WHERE encounter_date = ? AND IFNULL(queue_status, '') != 'cancelled'",
                (encounter_date,),
            ).fetchone()
        return int(row[0])

    def store_fido2_challenge(self, patient_id: str, challenge: str) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO fido2_challenges (patient_id, challenge, created_at)
                VALUES (?, ?, datetime('now'))
                """,
                (patient_id, challenge),
            )

    def get_fido2_challenge(self, patient_id: str) -> str | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT challenge FROM fido2_challenges WHERE patient_id = ?",
                (patient_id,),
            ).fetchone()
        return str(row[0]) if row else None

    def delete_fido2_challenge(self, patient_id: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM fido2_challenges WHERE patient_id = ?",
                (patient_id,),
            )

    def get_dual_layer(self, resource_type: str, resource_id: str) -> dict[str, Any] | None:
        """沙盒 2 診斷：同時回傳 resource_cache 與 index 貼紙。"""
        cache = self.get_cached_resource(resource_type, resource_id)
        if cache is None:
            return None
        index_row: dict[str, Any] | None = None
        with self._connect() as conn:
            if resource_type == "Encounter":
                row = conn.execute(
                    "SELECT * FROM encounter_index WHERE resource_id = ?",
                    (resource_id,),
                ).fetchone()
                if row:
                    index_row = dict(row)
            elif resource_type == "Condition":
                row = conn.execute(
                    "SELECT * FROM condition_index WHERE resource_id = ?",
                    (resource_id,),
                ).fetchone()
                if row:
                    index_row = dict(row)
            elif resource_type == "MedicationRequest":
                row = conn.execute(
                    "SELECT * FROM medication_request_index WHERE resource_id = ?",
                    (resource_id,),
                ).fetchone()
                if row:
                    index_row = dict(row)
            elif resource_type == "Patient":
                row = conn.execute(
                    "SELECT * FROM patient_index WHERE resource_id = ?",
                    (resource_id,),
                ).fetchone()
                if row:
                    index_row = dict(row)
            elif resource_type == "Composition":
                row = conn.execute(
                    "SELECT * FROM clinical_note_index WHERE resource_id = ?",
                    (resource_id,),
                ).fetchone()
                if row:
                    index_row = dict(row)
            elif resource_type == "Observation":
                row = conn.execute(
                    "SELECT * FROM observation_index WHERE resource_id = ?",
                    (resource_id,),
                ).fetchone()
                if row:
                    index_row = dict(row)
            elif resource_type == "AllergyIntolerance":
                row = conn.execute(
                    "SELECT * FROM allergy_index WHERE resource_id = ?",
                    (resource_id,),
                ).fetchone()
                if row:
                    index_row = dict(row)
            elif resource_type == "Media":
                row = conn.execute(
                    "SELECT * FROM media_index WHERE resource_id = ?",
                    (resource_id,),
                ).fetchone()
                if row:
                    index_row = dict(row)
        index_camel = _index_row_to_api(resource_type, index_row) if index_row else None
        stickers = _terminology_stickers_from_cache(resource_type, cache)
        return {
            "resourceType": resource_type,
            "resourceId": resource_id,
            "cacheLayer": cache,
            "indexLayer": index_camel,
            "terminologyStickers": stickers,
            "indexPresent": index_row is not None,
        }

    def list_media(
        self, patient_id: str | None = None, encounter_id: str | None = None
    ) -> list[dict[str, Any]]:
        query = """
            SELECT mi.*, rc.payload_json
            FROM media_index mi
            JOIN resource_cache rc
              ON rc.resource_type = 'Media' AND rc.resource_id = mi.resource_id
            WHERE 1=1
        """
        params: list[Any] = []
        if patient_id:
            query += " AND mi.patient_id = ?"
            params.append(patient_id.split("/")[-1])
        if encounter_id:
            query += " AND mi.encounter_id = ?"
            params.append(encounter_id.split("/")[-1])
        query += " ORDER BY mi.captured_datetime DESC, mi.updated_at DESC"
        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
        result: list[dict[str, Any]] = []
        for row in rows:
            resource = json.loads(row["payload_json"])
            content = resource.get("content") or {}
            if isinstance(content, dict) and content.get("data"):
                content = {
                    "contentType": content.get("contentType"),
                    "data": "[stored]",
                }
                resource = {**resource, "content": content}
            result.append(
                {
                    "resource": resource,
                    "indexMeta": {
                        "patientId": row["patient_id"],
                        "encounterId": row["encounter_id"],
                        "siteLabel": row["site_label"],
                        "bodySiteCode": row["body_site_code"],
                        "contentType": row["content_type"],
                        "capturedDateTime": row["captured_datetime"],
                        "hasImageData": bool(row["has_image_data"]),
                    },
                }
            )
        return result

    def list_allergy_resource_ids(self, patient_id: str) -> list[str]:
        pid = patient_id.split("/")[-1]
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT resource_id FROM allergy_index
                WHERE patient_id = ?
                ORDER BY updated_at DESC
                """,
                (pid,),
            ).fetchall()
        return [str(r[0]) for r in rows]

    def list_allergy_payloads(self, patient_id: str) -> list[dict[str, Any]]:
        """一次撈齊過敏資源（避免 N 次 get_cached_resource）。"""
        pid = patient_id.split("/")[-1]
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT rc.payload_json
                FROM allergy_index ai
                JOIN resource_cache rc
                  ON rc.resource_type = 'AllergyIntolerance'
                 AND rc.resource_id = ai.resource_id
                WHERE ai.patient_id = ?
                ORDER BY ai.updated_at DESC
                """,
                (pid,),
            ).fetchall()
        return [json.loads(r[0]) for r in rows]

    def condition_encounter_id(self, condition_id: str) -> str | None:
        cid = (condition_id or "").split("/")[-1]
        if not cid:
            return None
        with self._connect() as conn:
            row = conn.execute(
                "SELECT encounter_id FROM condition_index WHERE resource_id = ?",
                (cid,),
            ).fetchone()
        if row is None:
            return None
        home = str(row[0] or "").strip()
        return home or None

    def list_conditions(
        self,
        patient_id: str | None = None,
        encounter_id: str | None = None,
        encounter_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        # Index-first: lean import may have no Condition JSON in resource_cache
        query = """
            SELECT ci.* FROM condition_index ci
            LEFT JOIN encounter_index ei ON ei.resource_id = ci.encounter_id
            WHERE (
              ci.encounter_id IS NULL OR TRIM(IFNULL(ci.encounter_id, '')) = ''
              OR ei.resource_id IS NULL
              OR (
                IFNULL(ei.queue_status, '') != 'cancelled'
                AND IFNULL(ei.fhir_status, '') != 'cancelled'
              )
            )
            AND IFNULL(ci.clinical_status, 'active') NOT IN ('entered-in-error', 'inactive')
        """
        params: list[Any] = []
        if patient_id:
            query += " AND ci.patient_id = ?"
            params.append(patient_id.split("/")[-1])
        if encounter_id:
            query += " AND ci.encounter_id = ?"
            params.append(encounter_id.split("/")[-1])
        if encounter_ids:
            eids = [e.split("/")[-1] for e in encounter_ids if e]
            if not eids:
                return []
            placeholders = ",".join("?" for _ in eids)
            query += f" AND ci.encounter_id IN ({placeholders})"
            params.extend(eids)
        query += " ORDER BY ci.updated_at DESC"
        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
        out: list[dict[str, Any]] = []
        for row in rows:
            rid = row["resource_id"]
            icd = row["icd10_code"] or row["nhi_icd10_code"] or ""
            text = row["summary_text"] or icd
            out.append(
                {
                    "resource": {
                        "resourceType": "Condition",
                        "id": rid,
                        "subject": {"reference": f"Patient/{row['patient_id']}"},
                        "encounter": {"reference": f"Encounter/{row['encounter_id']}"}
                        if row["encounter_id"]
                        else None,
                        "code": {
                            "text": text,
                            "coding": [{"code": icd, "display": text}] if icd else [],
                        },
                        "clinicalStatus": {
                            "coding": [{"code": row["clinical_status"] or "active"}]
                        },
                    },
                    "indexMeta": {
                        "patientId": row["patient_id"],
                        "encounterId": row["encounter_id"],
                        "icd10Code": row["icd10_code"],
                        "snomedCode": row["snomed_code"]
                        if "snomed_code" in row.keys()
                        else None,
                        "nhiIcd10Code": row["nhi_icd10_code"]
                        if "nhi_icd10_code" in row.keys()
                        else None,
                        "summaryText": row["summary_text"],
                        "clinicalStatus": row["clinical_status"],
                    },
                }
            )
        return out

    def retain_encounter_chart(
        self,
        encounter_id: str,
        *,
        medication_ids: list[str] | None = None,
        condition_ids: list[str] | None = None,
    ) -> None:
        """Last save wins. Rows left off that save stay stored but drop out of the chart and claims."""
        eid = (encounter_id or "").split("/")[-1]
        if not eid:
            return

        def _keep(ids: list[str] | None) -> list[str]:
            return [item.split("/")[-1] for item in (ids or []) if item]

        with self._connect() as conn:
            if medication_ids is not None:
                keep = _keep(medication_ids)
                sql = """
                    UPDATE medication_request_index
                    SET status = 'cancelled', updated_at = datetime('now')
                    WHERE encounter_id = ?
                      AND IFNULL(status, 'active') NOT IN ('cancelled', 'entered-in-error', 'stopped')
                """
                params: list[Any] = [eid]
                if keep:
                    sql += f" AND resource_id NOT IN ({','.join('?' for _ in keep)})"
                    params.extend(keep)
                conn.execute(sql, params)
            if condition_ids is not None:
                keep = _keep(condition_ids)
                sql = """
                    UPDATE condition_index
                    SET clinical_status = 'entered-in-error', updated_at = datetime('now')
                    WHERE encounter_id = ?
                      AND IFNULL(clinical_status, 'active') NOT IN ('entered-in-error', 'inactive')
                """
                params = [eid]
                if keep:
                    sql += f" AND resource_id NOT IN ({','.join('?' for _ in keep)})"
                    params.extend(keep)
                conn.execute(sql, params)

    def list_medication_requests(
        self,
        patient_id: str | None = None,
        encounter_id: str | None = None,
        encounter_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        # Index-first: lean import stores meds only in medication_request_index
        query = """
            SELECT mi.* FROM medication_request_index mi
            LEFT JOIN encounter_index ei ON ei.resource_id = mi.encounter_id
            WHERE (
              mi.encounter_id IS NULL OR TRIM(IFNULL(mi.encounter_id, '')) = ''
              OR ei.resource_id IS NULL
              OR (
                IFNULL(ei.queue_status, '') != 'cancelled'
                AND IFNULL(ei.fhir_status, '') != 'cancelled'
              )
            )
            AND IFNULL(mi.status, 'active') NOT IN ('cancelled', 'entered-in-error', 'stopped')
        """
        params: list[Any] = []
        if patient_id:
            query += " AND mi.patient_id = ?"
            params.append(patient_id.split("/")[-1])
        if encounter_id:
            query += " AND mi.encounter_id = ?"
            params.append(encounter_id.split("/")[-1])
        if encounter_ids:
            eids = [e.split("/")[-1] for e in encounter_ids if e]
            if not eids:
                return []
            placeholders = ",".join("?" for _ in eids)
            query += f" AND mi.encounter_id IN ({placeholders})"
            params.extend(eids)
        query += " ORDER BY mi.updated_at DESC"
        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
        out: list[dict[str, Any]] = []
        for row in rows:
            rid = row["resource_id"]
            nhi = row["nhi_code"] or ""
            text = row["drug_text"] or nhi
            days = row["days_supply"] if "days_supply" in row.keys() else None
            qty = row["quantity"] if "quantity" in row.keys() else None
            useage = row["useage"] if "useage" in row.keys() else None
            pay_mark = row["pay_mark"] if "pay_mark" in row.keys() else None
            unit_price = row["unit_price"] if "unit_price" in row.keys() else None
            total_qty = row["total_qty"] if "total_qty" in row.keys() else None
            use_type = row["use_type"] if "use_type" in row.keys() else None
            line_sort = row["line_sort"] if "line_sort" in row.keys() else None
            memo_mark = row["memo_mark"] if "memo_mark" in row.keys() else None
            # Keep dosageInstruction as short USEAGE only (QD/BID); days/qty live in indexMeta
            dosage = (useage or "").strip()
            extensions: list[dict[str, Any]] = []
            if pay_mark:
                extensions.append(
                    {
                        "url": "https://clinic.org/fhir/StructureDefinition/billing/payMark",
                        "valueString": pay_mark,
                    }
                )
            if memo_mark:
                extensions.append(
                    {
                        "url": "https://clinic.org/fhir/StructureDefinition/billing/memoMark",
                        "valueString": memo_mark,
                    }
                )
            body_site = row["body_site"] if "body_site" in row.keys() else None
            if body_site:
                extensions.append(
                    {
                        "url": "https://clinic.org/fhir/StructureDefinition/billing/bodySite",
                        "valueString": body_site,
                    }
                )
            out.append(
                {
                    "resource": {
                        "resourceType": "MedicationRequest",
                        "id": rid,
                        "status": row["status"] or "active",
                        "intent": "order",
                        "subject": {"reference": f"Patient/{row['patient_id']}"},
                        "encounter": {"reference": f"Encounter/{row['encounter_id']}"}
                        if row["encounter_id"]
                        else None,
                        "medicationCodeableConcept": {
                            "text": text,
                            "coding": [{"code": nhi, "display": text}] if nhi else [],
                        },
                        "dosageInstruction": [{"text": dosage}] if dosage else [],
                        "extension": extensions,
                    },
                    "indexMeta": {
                        "patientId": row["patient_id"],
                        "encounterId": row["encounter_id"],
                        "nhiCode": nhi,
                        "rxnormCode": row["rxnorm_code"]
                        if "rxnorm_code" in row.keys()
                        else None,
                        "drugText": text,
                        "status": row["status"],
                        "daysSupply": days,
                        "quantity": qty,
                        "unitPrice": unit_price,
                        "totalQty": total_qty,
                        "useType": use_type,
                        "lineSort": line_sort,
                        "useage": useage,
                        "payMark": pay_mark,
                        "memo": memo_mark,
                    },
                }
            )
        return out

    def find_soap_composition_id_by_encounter(self, encounter_id: str) -> str | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT resource_id FROM clinical_note_index WHERE encounter_id = ? LIMIT 1",
                (encounter_id,),
            ).fetchone()
        return str(row[0]) if row else None

    def get_patient_id_no(self, patient_id: str) -> str | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id_no FROM patient_index WHERE resource_id = ? LIMIT 1",
                (patient_id,),
            ).fetchone()
        return str(row[0]) if row and row[0] else None

    def find_patient_id_by_id_no(self, id_no: str) -> str | None:
        key = (id_no or "").strip().upper()
        if not key:
            return None
        with self._connect() as conn:
            row = conn.execute(
                "SELECT resource_id FROM patient_index WHERE upper(trim(id_no)) = ? LIMIT 1",
                (key,),
            ).fetchone()
        return str(row[0]) if row else None

    def find_patient_ids_by_exact_name_birth(self, compact_name: str, birth_iso: str) -> list[str]:
        """姓名去空白後完全相同，且生日同一天。超過一筆就全部回傳，呼叫端不要挑。"""
        from src.core.patient_match import roc7_from_iso

        name = (compact_name or "").strip()
        iso = (birth_iso or "").strip()[:10]
        roc = roc7_from_iso(iso) or ""
        roc_keys = [roc]
        if roc.isdigit():
            roc_keys.append(str(int(roc)))
        roc_keys = [k for k in roc_keys if k]
        if not name or len(iso) != 10:
            return []
        marks = ",".join("?" for _ in roc_keys) or "?"
        params: list[str] = [iso, *roc_keys]
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT resource_id, family_name, given_name
                FROM patient_index
                WHERE substr(COALESCE(birth_date, ''), 1, 10) = ?
                   OR REPLACE(REPLACE(COALESCE(birthday_roc, ''), '.', ''), '/', '') IN ({marks})
                """,
                params,
            ).fetchall()
        hits: list[str] = []
        for row in rows:
            stored = "".join(f"{row[1] or ''}{row[2] or ''}".split())
            if stored != name:
                continue
            hits.append(str(row[0]))
            if len(hits) > 2:
                break
        return hits

    def find_patient_id_by_medical_no(self, medical_no: str) -> str | None:
        key = (medical_no or "").strip()
        if not key:
            return None
        with self._connect() as conn:
            row = conn.execute(
                "SELECT resource_id FROM patient_index WHERE trim(medical_no) = ? LIMIT 1",
                (key,),
            ).fetchone()
        return str(row[0]) if row else None

    def next_medical_no(self) -> str:
        """全庫最大病歷號加 1（數字流水、六碼）。空號不補。"""
        with self._connect() as conn:
            return _next_medical_no(conn)

    def assert_patient_keys_unique(
        self,
        resource_id: str,
        id_no: str | None,
        medical_no: str | None,
    ) -> None:
        """身分證／病歷號全庫唯一；衝突拋 PatientKeyConflict。"""
        with self._connect() as conn:
            _assert_patient_keys_unique(conn, resource_id, id_no, medical_no)

    def release_medical_no_from_others(self, keep_resource_id: str, medical_no: str) -> int:
        """匯入覆蓋用：清掉其他人身上相同病歷號，回傳清除筆數。"""
        key = (medical_no or "").strip()
        if not key:
            return 0
        with self._connect() as conn:
            cur = conn.execute(
                """
                UPDATE patient_index
                SET medical_no = NULL, updated_at = datetime('now')
                WHERE trim(medical_no) = ? AND resource_id != ?
                """,
                (key, keep_resource_id),
            )
            # 同步清掉 resource_cache identifier 太重，索引為準；下次 PUT 會對齊
            return int(cur.rowcount or 0)

    def list_cached_resources(
        self, resource_type: str, limit: int = 100, offset: int = 0
    ) -> list[dict[str, Any]]:
        if resource_type == "Patient":
            return self.search_patients({"_count": str(limit), "_offset": str(offset)})
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT payload_json FROM resource_cache
                WHERE resource_type = ?
                ORDER BY updated_at DESC
                LIMIT ? OFFSET ?
                """,
                (resource_type, limit, offset),
            ).fetchall()
        return [json.loads(row[0]) for row in rows]

    def count_resources(self, resource_type: str) -> int:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) FROM resource_cache WHERE resource_type = ?",
                (resource_type,),
            ).fetchone()
        return int(row[0]) if row else 0

    def delete_cached_resource(self, resource_type: str, resource_id: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM resource_cache WHERE resource_type = ? AND resource_id = ?",
                (resource_type, resource_id),
            )
            if resource_type == "Patient":
                conn.execute(
                    "DELETE FROM patient_index WHERE resource_id = ?",
                    (resource_id,),
                )
            elif resource_type == "Encounter":
                conn.execute(
                    "DELETE FROM encounter_index WHERE resource_id = ?",
                    (resource_id,),
                )
            elif resource_type == "Condition":
                conn.execute(
                    "DELETE FROM condition_index WHERE resource_id = ?",
                    (resource_id,),
                )
            elif resource_type == "MedicationRequest":
                conn.execute(
                    "DELETE FROM medication_request_index WHERE resource_id = ?",
                    (resource_id,),
                )

    def get_id_category_settings(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT code, deposit, reg_fee, copay, min_age, max_age, is_default
                FROM id_category_settings
                ORDER BY code
                """
            ).fetchall()
        return [
            {
                "code": r[0],
                "deposit": r[1],
                "reg_fee": r[2],
                "copay": r[3],
                "min_age": r[4],
                "max_age": r[5],
                "is_default": r[6],
            }
            for r in rows
        ]

    def save_id_category_settings(self, settings: list[dict[str, Any]]) -> None:
        with self._connect() as conn:
            cur_rows = conn.execute("SELECT code FROM id_category_settings").fetchall()
            current_codes = {r[0] for r in cur_rows}
            new_codes = {s["code"] for s in settings if s.get("code")}
            deleted_codes = current_codes - new_codes
            
            for s in settings:
                code = s.get("code")
                if not code:
                    continue
                deposit = int(s.get("deposit", 0))
                reg_fee = int(s.get("reg_fee", 150))
                copay = int(s.get("copay", 50))
                min_age = s.get("min_age")
                if min_age is not None and str(min_age).strip():
                    min_age = int(min_age)
                else:
                    min_age = None
                max_age = s.get("max_age")
                if max_age is not None and str(max_age).strip():
                    max_age = int(max_age)
                else:
                    max_age = None
                is_default = int(s.get("is_default", 0))
                    
                conn.execute(
                    """
                    INSERT INTO id_category_settings (code, deposit, reg_fee, copay, min_age, max_age, is_default)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(code) DO UPDATE SET
                        deposit = excluded.deposit,
                        reg_fee = excluded.reg_fee,
                        copay = excluded.copay,
                        min_age = excluded.min_age,
                        max_age = excluded.max_age,
                        is_default = excluded.is_default
                    """,
                    (code, deposit, reg_fee, copay, min_age, max_age, is_default)
                )
            
            for deleted_code in deleted_codes:
                conn.execute("DELETE FROM id_category_settings WHERE code = ?", (deleted_code,))
                p_rows = conn.execute(
                    "SELECT resource_id FROM patient_index WHERE id_category = ?",
                    (deleted_code,)
                ).fetchall()
                for p_row in p_rows:
                    pid = p_row[0]
                    self.reevaluate_patient_id_category(conn, pid)

    def delete_id_category_setting(self, code: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM id_category_settings WHERE code = ?", (code,))
            p_rows = conn.execute(
                "SELECT resource_id FROM patient_index WHERE id_category = ?",
                (code,)
            ).fetchall()
            for p_row in p_rows:
                pid = p_row[0]
                self.reevaluate_patient_id_category(conn, pid)

    def reevaluate_patient_id_category(self, conn: sqlite3.Connection, patient_id: str) -> None:
        row = conn.execute(
            "SELECT payload_json FROM resource_cache WHERE resource_type = 'Patient' AND resource_id = ?",
            (patient_id,)
        ).fetchone()
        if not row:
            return
        
        payload = json.loads(row[0])
        found_clinic_ext = False
        for ext in payload.get("extension") or []:
            if "patient-clinic-ext" in (ext.get("url") or ""):
                found_clinic_ext = True
                found_id_cat = False
                for sub in ext.get("extension") or []:
                    if sub.get("url") == "idCategory":
                        sub["valueString"] = ""
                        found_id_cat = True
                        break
                if not found_id_cat:
                    if "extension" not in ext:
                        ext["extension"] = []
                    ext["extension"].append({"url": "idCategory", "valueString": ""})
                break
        
        self._auto_fill_patient_id_category(conn, payload)
        
        conn.execute(
            "UPDATE resource_cache SET payload_json = ?, updated_at = datetime('now') WHERE resource_type = 'Patient' AND resource_id = ?",
            (json.dumps(payload, ensure_ascii=False), patient_id)
        )
        
        fields = _patient_index_fields(payload)
        conn.execute(
            """
            UPDATE patient_index SET
                id_category = ?,
                updated_at = datetime('now')
            WHERE resource_id = ?
            """,
            (fields.get("id_category"), patient_id)
        )


    def count_patient_encounters(self, patient_id: str) -> int:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) FROM encounter_index WHERE patient_id = ?",
                (patient_id,),
            ).fetchone()
        return int(row[0] or 0) if row else 0

    def address_for_home_phone(self, phone: str, except_id: str = "") -> dict[str, str]:
        digits = "".join(ch for ch in (phone or "") if ch.isdigit())
        if len(digits) < 7:
            return {"address": "", "postalCode": ""}
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT address FROM patient_index
                WHERE resource_id != ?
                  AND trim(COALESCE(address, '')) != ''
                  AND instr(
                        '/' || replace(replace(replace(replace(COALESCE(phone, ''), '-', ''), ' ', ''), '(', ''), ')', '') || '/',
                        '/' || ? || '/'
                      ) > 0
                LIMIT 1
                """,
                (except_id or "", digits),
            ).fetchone()
        if not row or not row[0]:
            return {"address": "", "postalCode": ""}
        return {"address": str(row[0]), "postalCode": ""}

    def patient_index_mark(self) -> str:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*), COALESCE(MAX(updated_at), '') FROM patient_index"
            ).fetchone()
        if not row:
            return "0:"
        return f"{row[0]}:{row[1]}"

    def list_patient_roster(self) -> list[dict[str, str]]:
        """病患名單只用索引欄，不含整份 JSON。"""
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT resource_id,
                       COALESCE(medical_no, ''),
                       COALESCE(family_name, ''),
                       COALESCE(given_name, ''),
                       COALESCE(id_no, ''),
                       COALESCE(birthday_roc, ''),
                       COALESCE(phone, ''),
                       COALESCE(id_category, '')
                FROM patient_index
                ORDER BY medical_no
                """
            ).fetchall()
        return [
            {
                "id": str(row[0]),
                "medicalNo": str(row[1]),
                "name": f"{row[2]}{row[3]}",
                "idNo": str(row[4]),
                "birthdayRoc": str(row[5]),
                "phone": str(row[6]),
                "idCategory": str(row[7]),
            }
            for row in rows
        ]

    def search_patients(self, params: dict[str, str]) -> list[dict[str, Any]]:
        # If no search filters are provided, force using the medical_no index to avoid slow filesorts.
        has_filter = bool(
            params.get("name")
            or params.get("identifier")
            or params.get("q")
            or params.get("phone")
            or params.get("birthday")
        )
        indexed_by = " INDEXED BY idx_patient_index_medical_no" if not has_filter else ""
        
        # Pick the ids on the small index first. Joining the chart JSON first
        # makes SQLite open every patient in the 4GB file, which is fast only
        # while that file is still in memory.
        query = f"""
            SELECT rc.payload_json
            FROM (
              SELECT pi.resource_id
              FROM patient_index pi{indexed_by}
              WHERE 1=1
        """
        sql_params = []
        if "name" in params and params["name"]:
            name_q = f"%{params['name']}%"
            query += " AND (pi.family_name || pi.given_name LIKE ? OR pi.resource_id LIKE ?)"
            sql_params.extend([name_q, name_q])
        if "identifier" in params and params["identifier"]:
            id_q = f"%{params['identifier']}%"
            query += " AND (pi.id_no LIKE ? OR pi.identifier LIKE ? OR pi.medical_no LIKE ?)"
            sql_params.extend([id_q, id_q, id_q])
        if params.get("phone"):
            phone_digits = re.sub(r"\D", "", params["phone"])
            phone_like = f"%{phone_digits or params['phone']}%"
            query += (
                " AND (pi.phone LIKE ? OR COALESCE(pi.phone2,'') LIKE ?"
                " OR REPLACE(REPLACE(REPLACE(COALESCE(pi.phone,''), '-', ''), ' ', ''), '+', '') LIKE ?"
                " OR REPLACE(REPLACE(REPLACE(COALESCE(pi.phone2,''), '-', ''), ' ', ''), '+', '') LIKE ?)"
            )
            sql_params.extend([f"%{params['phone']}%", f"%{params['phone']}%", phone_like, phone_like])
        if params.get("birthday"):
            roc = _roc_birthday_from_query(params["birthday"])
            if roc:
                clause, clause_params = _birthday_lookup_sql(roc)
                query += clause
                sql_params.extend(clause_params)
            else:
                query += " AND pi.birthday_roc = ?"
                sql_params.append(params["birthday"])
        if params.get("q"):
            clause, clause_params = patient_lookup_sql(params["q"])
            query += clause
            sql_params.extend(clause_params)

        limit = 100
        offset = 0
        if "_count" in params:
            try:
                limit = int(params["_count"])
            except ValueError:
                pass
        if "_offset" in params:
            try:
                offset = int(params["_offset"])
            except ValueError:
                pass

        query += """
              ORDER BY pi.medical_no DESC, pi.updated_at DESC
              LIMIT ? OFFSET ?
            ) hit
            JOIN resource_cache rc
              ON rc.resource_type = 'Patient' AND rc.resource_id = hit.resource_id
        """
        sql_params.extend([limit, offset])
        
        with self._connect() as conn:
            rows = conn.execute(query, sql_params).fetchall()
        return [json.loads(row[0]) for row in rows]

    def list_observations(
        self, patient_id: str | None = None, encounter_id: str | None = None
    ) -> list[dict[str, Any]]:
        query = """
            SELECT oi.*, rc.payload_json
            FROM observation_index oi
            JOIN resource_cache rc
              ON rc.resource_type = 'Observation' AND rc.resource_id = oi.resource_id
            WHERE 1=1
        """
        params: list[Any] = []
        if patient_id:
            query += " AND oi.patient_id = ?"
            params.append(patient_id.split("/")[-1])
        if encounter_id:
            query += " AND oi.encounter_id = ?"
            params.append(encounter_id.split("/")[-1])
        query += " ORDER BY oi.effective_datetime DESC, oi.updated_at DESC"
        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [
            {
                "resource": json.loads(row["payload_json"]),
                "indexMeta": {
                    "patientId": row["patient_id"],
                    "encounterId": row["encounter_id"],
                    "category": row["category"],
                    "loincCode": row["loinc_code"],
                    "vitalType": row["vital_type"],
                    "displayText": row["display_text"],
                    "value": row["value_num"],
                    "unit": row["value_unit"],
                    "effectiveDateTime": row["effective_datetime"],
                    "status": row["status"],
                },
            }
            for row in rows
        ]

    def _upsert_observation_index(
        self, conn: sqlite3.Connection, resource_id: str, payload: dict[str, Any]
    ) -> None:
        fields = _observation_index_fields(payload)
        conn.execute(
            """
            INSERT INTO observation_index (
                resource_id, patient_id, encounter_id, category, loinc_code,
                vital_type, display_text, value_num, value_unit,
                effective_datetime, status, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(resource_id) DO UPDATE SET
                patient_id = excluded.patient_id,
                encounter_id = excluded.encounter_id,
                category = excluded.category,
                loinc_code = excluded.loinc_code,
                vital_type = excluded.vital_type,
                display_text = excluded.display_text,
                value_num = excluded.value_num,
                value_unit = excluded.value_unit,
                effective_datetime = excluded.effective_datetime,
                status = excluded.status,
                updated_at = datetime('now')
            """,
            (
                resource_id,
                fields["patient_id"],
                fields["encounter_id"],
                fields["category"],
                fields["loinc_code"],
                fields["vital_type"],
                fields["display_text"],
                fields["value_num"],
                fields["value_unit"],
                fields["effective_datetime"],
                fields["status"],
            ),
        )

    def _upsert_allergy_index(
        self, conn: sqlite3.Connection, resource_id: str, payload: dict[str, Any]
    ) -> None:
        fields = _allergy_index_fields(payload)
        conn.execute(
            """
            INSERT INTO allergy_index (
                resource_id, patient_id, verification_status, snomed_code,
                rxnorm_substance, snomed_manifestation, summary_text,
                category, criticality, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(resource_id) DO UPDATE SET
                patient_id = excluded.patient_id,
                verification_status = excluded.verification_status,
                snomed_code = excluded.snomed_code,
                rxnorm_substance = excluded.rxnorm_substance,
                snomed_manifestation = excluded.snomed_manifestation,
                summary_text = excluded.summary_text,
                category = excluded.category,
                criticality = excluded.criticality,
                updated_at = datetime('now')
            """,
            (
                resource_id,
                fields["patient_id"],
                fields["verification_status"],
                fields["snomed_code"],
                fields["rxnorm_substance"],
                fields["snomed_manifestation"],
                fields["summary_text"],
                fields["category"],
                fields["criticality"],
            ),
        )

    def _upsert_media_index(
        self, conn: sqlite3.Connection, resource_id: str, payload: dict[str, Any]
    ) -> None:
        fields = _media_index_fields(payload)
        conn.execute(
            """
            INSERT INTO media_index (
                resource_id, patient_id, encounter_id, site_label, body_site_code,
                content_type, captured_datetime, has_image_data, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(resource_id) DO UPDATE SET
                patient_id = excluded.patient_id,
                encounter_id = excluded.encounter_id,
                site_label = excluded.site_label,
                body_site_code = excluded.body_site_code,
                content_type = excluded.content_type,
                captured_datetime = excluded.captured_datetime,
                has_image_data = excluded.has_image_data,
                updated_at = datetime('now')
            """,
            (
                resource_id,
                fields["patient_id"],
                fields["encounter_id"],
                fields["site_label"],
                fields["body_site_code"],
                fields["content_type"],
                fields["captured_datetime"],
                fields["has_image_data"],
            ),
        )

    def _upsert_clinical_note_index(
        self, conn: sqlite3.Connection, resource_id: str, payload: dict[str, Any]
    ) -> None:
        fields = _clinical_note_index_fields(payload)
        conn.execute(
            """
            INSERT INTO clinical_note_index (
                resource_id, encounter_id, patient_id, chief_complaint,
                subjective_preview, objective_preview, assessment_preview, plan_preview,
                composition_status, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(resource_id) DO UPDATE SET
                encounter_id = excluded.encounter_id,
                patient_id = excluded.patient_id,
                chief_complaint = excluded.chief_complaint,
                subjective_preview = excluded.subjective_preview,
                objective_preview = excluded.objective_preview,
                assessment_preview = excluded.assessment_preview,
                plan_preview = excluded.plan_preview,
                composition_status = excluded.composition_status,
                updated_at = datetime('now')
            """,
            (
                resource_id,
                fields["encounter_id"],
                fields["patient_id"],
                fields["chief_complaint"],
                fields["subjective_preview"],
                fields["objective_preview"],
                fields["assessment_preview"],
                fields["plan_preview"],
                fields["composition_status"],
            ),
        )

    def list_family_members(self, patient_id: str, limit: int = 40) -> list[dict[str, Any]]:
        """同電話／手機（連續 7 碼以上）或同住址的其他病患。醫聖家族清單。"""
        pid = (patient_id or "").split("/")[-1].strip()
        if not pid:
            return []
        with self._connect() as conn:
            me = conn.execute(
                "SELECT phone, address FROM patient_index WHERE resource_id = ?",
                (pid,),
            ).fetchone()
            if me is None:
                return []
            phone_tokens = []
            seen_tok: set[str] = set()
            for tok in re.findall(r"\d{7,}", str(me["phone"] or "")):
                if tok not in seen_tok:
                    seen_tok.add(tok)
                    phone_tokens.append(tok)
                if len(phone_tokens) >= 4:
                    break
            addr = re.sub(r"\s+", "", str(me["address"] or ""))
            if addr in {"—", "-", "無", "无"} or len(addr) < 8:
                addr = ""
            clauses: list[str] = []
            params: list[Any] = []
            for tok in phone_tokens:
                clauses.append(
                    "REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''),'-',''),' ',''),'(',''),')','') LIKE ?"
                )
                params.append(f"%{tok}%")
            if addr:
                clauses.append("REPLACE(REPLACE(COALESCE(address,''),' ',''),'　','') = ?")
                params.append(addr)
            if not clauses:
                return []
            params.append(pid)
            params.append(int(limit))
            rows = conn.execute(
                f"""
                SELECT resource_id, family_name, given_name, birth_date, sex, medical_no
                FROM patient_index
                WHERE ({' OR '.join(clauses)})
                  AND resource_id != ?
                LIMIT ?
                """,
                params,
            ).fetchall()
            out: list[dict[str, Any]] = []
            for row in rows:
                rid = str(row["resource_id"])
                last = conn.execute(
                    """
                    SELECT encounter_date FROM encounter_index
                    WHERE patient_id = ?
                      AND queue_status NOT IN ('cancelled', 'entered-in-error')
                    ORDER BY encounter_date DESC, queue_number DESC
                    LIMIT 1
                    """,
                    (rid,),
                ).fetchone()
                dx = conn.execute(
                    """
                    SELECT summary_text FROM condition_index
                    WHERE patient_id = ? AND COALESCE(summary_text, '') != ''
                    ORDER BY updated_at DESC
                    LIMIT 1
                    """,
                    (rid,),
                ).fetchone()
                sex_raw = str(row["sex"] or "").strip().upper()
                if sex_raw in {"M", "男", "MALE"}:
                    sex = "男"
                elif sex_raw in {"F", "女", "FEMALE"}:
                    sex = "女"
                else:
                    sex = str(row["sex"] or "")
                name = f"{row['family_name'] or ''}{row['given_name'] or ''}".strip() or "—"
                visit = str(last["encounter_date"])[:10] if last else ""
                out.append(
                    {
                        "patientId": rid,
                        "name": name,
                        "age": _age_from_birth_date(str(row["birth_date"] or "")) or "",
                        "sex": sex,
                        "medicalNo": str(row["medical_no"] or ""),
                        "lastVisit": visit,
                        "disease": str(dx["summary_text"]) if dx else "",
                    }
                )
            out.sort(key=lambda r: r.get("lastVisit") or "", reverse=True)
            return out

    @contextlib.contextmanager
    def _connect(self) -> Generator[sqlite3.Connection, None, None]:
        """執行緒內重用連線（避免 Windows 每次 open/close 拖慢選病人）。"""
        conn: sqlite3.Connection | None = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(str(self._db_path), check_same_thread=False, timeout=30)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA busy_timeout=5000")
            conn.execute("PRAGMA temp_store=MEMORY")
            conn.execute("PRAGMA cache_size=-65536")
            self._local.conn = conn
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def _birthday_forms(roc7: str) -> list[str]:
    """Exact birthday strings already stored. No function on the column, so the index can be used.

    102.1.1、102.01.01、102.01.1、102.1.01 都是同一天。斜線也收。
    """
    year = int(roc7[:3])
    month = int(roc7[3:5])
    day = int(roc7[5:7])
    pads = (
        (f"{month:02d}", f"{day:02d}"),
        (str(month), str(day)),
        (f"{month:02d}", str(day)),
        (str(month), f"{day:02d}"),
    )
    forms = {
        roc7,
        roc7.lstrip("0") or roc7,
        f"{roc7[:3]}.{roc7[3:5]}.{roc7[5:7]}",
        f"{roc7[:3]}/{roc7[3:5]}/{roc7[5:7]}",
    }
    for mm, dd in pads:
        forms.add(f"{year}.{mm}.{dd}")
        forms.add(f"{year}/{mm}/{dd}")
    return list(forms)


def _roc_birthday_from_query(raw: str) -> str | None:
    """把 82.1.17／82/01/17／0820117 收成 7 碼民國生日。"""
    text = (raw or "").strip()
    if not text:
        return None
    m = re.match(r"^(\d{1,3})[./](\d{1,2})[./](\d{1,2})$", text)
    if m:
        year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= month <= 12 and 1 <= day <= 31:
            return f"{year:03d}{month:02d}{day:02d}"
        return None
    digits = re.sub(r"\D", "", text)
    if re.search(r"[A-Za-z]", text):
        return None
    if len(digits) == 7:
        return digits
    if len(digits) == 6:
        return f"0{digits}"
    return None


def _like_prefix(text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return escaped + "%"


def _birthday_lookup_sql(roc: str) -> tuple[str, list]:
    forms = _birthday_forms(roc)
    marks = ",".join("?" * len(forms))
    iso_year = int(roc[:3]) + 1911
    iso = f"{iso_year:04d}-{roc[3:5]}-{roc[5:7]}"
    sql = (
        " AND pi.resource_id IN ("
        f"SELECT resource_id FROM patient_index WHERE birthday_roc IN ({marks}) "
        "UNION SELECT resource_id FROM patient_index WHERE birth_date = ?)"
    )
    return sql, [*forms, iso]


def patient_lookup_sql(raw: str) -> tuple[str, list]:
    """Classify a typed patient search so each format hits one indexed column.

    Dotted or slashed dates are birthdays. Seven digits with a real month and
    day are birthdays. A leading 0 and 9–11 digits is a phone. Any other
    digits are a chart number only. A letter plus digits is an ID. Everything
    else is a name prefix.
    """
    q = (raw or "").strip()
    if not q:
        return "", []
    compact = re.sub(r"\s+", "", q)
    if re.search(r"\d", compact) and re.search(r"[./]", compact):
        roc = _roc_birthday_from_query(compact)
        if not roc:
            return " AND 0", []
        return _birthday_lookup_sql(roc)
    if re.fullmatch(r"\d{7}", q):
        month = int(q[3:5])
        day = int(q[5:7])
        if 1 <= month <= 12 and 1 <= day <= 31:
            return _birthday_lookup_sql(q)
    if re.fullmatch(r"[A-Za-z][A-Za-z0-9]?\d+", q):
        if re.fullmatch(r"[A-Za-z][A-Za-z0-9]\d{8}", q):
            keys = list({q, q.upper(), q.lower()})
            marks = ",".join("?" * len(keys))
            return f" AND pi.id_no IN ({marks})", keys
        return " AND pi.id_no LIKE ? ESCAPE '\\'", [_like_prefix(q.upper())]
    digits = re.sub(r"\D", "", q)
    if re.fullmatch(r"[0-9+\- ]+", q) and digits.startswith("0") and re.fullmatch(r"0\d{8,10}", digits):
        like_prefix = digits + "%"
        like_any = "%" + digits + "%"
        return (
            " AND (pi.phone = ? OR COALESCE(pi.phone2,'') = ?"
            " OR pi.phone LIKE ? OR COALESCE(pi.phone2,'') LIKE ?"
            " OR pi.phone LIKE ? OR COALESCE(pi.phone2,'') LIKE ?)",
            [digits, digits, like_prefix, like_prefix, like_any, like_any],
        )
    if re.fullmatch(r"\d+", q):
        bare = q.lstrip("0") or "0"
        values = {q, bare}
        # 103396 就是這六碼，不要再補成 0103396 去對到另一本。
        # 較短的號碼才補 6 碼、7 碼，對上前面補零的病歷號。
        if len(bare) < 6:
            values.add(bare.zfill(6))
            values.add(bare.zfill(7))
        keys = list(values)
        marks = ",".join("?" * len(keys))
        return f" AND pi.medical_no IN ({marks})", keys
    clauses = [
        "pi.family_name LIKE ? ESCAPE '\\'",
        "pi.given_name LIKE ? ESCAPE '\\'",
    ]
    params: list = [_like_prefix(q), _like_prefix(q)]
    if len(q) >= 2:
        clauses.append("(pi.family_name = ? AND pi.given_name LIKE ? ESCAPE '\\')")
        params.extend([q[0], _like_prefix(q[1:])])
    if len(q) >= 3:
        clauses.append("(pi.family_name = ? AND pi.given_name LIKE ? ESCAPE '\\')")
        params.extend([q[:2], _like_prefix(q[2:])])
    return " AND (" + " OR ".join(clauses) + ")", params


def _age_from_birth_date(birth_date: str, as_of: str | None = None) -> str | None:
    """Age as YYY.MM.DD (e.g. 046.06.00), relative to as_of or today."""
    if not birth_date:
        return None
    from datetime import date, timedelta

    try:
        bd = date.fromisoformat(str(birth_date)[:10])
    except ValueError:
        return None
    try:
        ref = date.fromisoformat(str(as_of)[:10]) if as_of else date.today()
    except ValueError:
        ref = date.today()
    if ref < bd:
        return "000.00.00"
    years = ref.year - bd.year
    months = ref.month - bd.month
    days = ref.day - bd.day
    if days < 0:
        months -= 1
        prev_last = ref.replace(day=1) - timedelta(days=1)
        days += prev_last.day
    if months < 0:
        years -= 1
        months += 12
    if years < 0:
        return "000.00.00"
    return f"{years:03d}.{months:02d}.{days:02d}"


def get_default_category_by_age(conn: sqlite3.Connection, birth_date: str | None) -> str | None:
    if not birth_date:
        row = conn.execute("SELECT code FROM id_category_settings WHERE is_default = 1 LIMIT 1").fetchone()
        return str(row[0]) if row else None
    age_str = _age_from_birth_date(birth_date)
    if not age_str:
        row = conn.execute("SELECT code FROM id_category_settings WHERE is_default = 1 LIMIT 1").fetchone()
        return str(row[0]) if row else None
    try:
        age = int(str(age_str).split(".")[0])
    except ValueError:
        row = conn.execute("SELECT code FROM id_category_settings WHERE is_default = 1 LIMIT 1").fetchone()
        return str(row[0]) if row else None
    row = conn.execute(
        """
        SELECT code FROM id_category_settings
        WHERE (min_age IS NULL OR ? >= min_age)
          AND (max_age IS NULL OR ? <= max_age)
          AND (min_age IS NOT NULL OR max_age IS NOT NULL)
        LIMIT 1
        """,
        (age, age),
    ).fetchone()
    if row:
        return str(row[0])
    row_default = conn.execute("SELECT code FROM id_category_settings WHERE is_default = 1 LIMIT 1").fetchone()
    return str(row_default[0]) if row_default else None


def _queue_label(queue_status: str) -> str:
    labels = {
        "waiting": "候診中",
        "in_progress": "看診中",
        "no_show": "已過號",
        "finished": "已看診",
        "cancelled": "已刪除掛號",
    }
    return labels.get(queue_status, queue_status)


def _encounter_index_fields(
    payload: dict[str, Any],
) -> tuple[str, str, int, str, str]:
    from datetime import date as date_cls

    subject = payload.get("subject") or {}
    ref = subject.get("reference", "")
    patient_id = ref.split("/")[-1] if ref else ""
    encounter_date = date_cls.today().isoformat()
    period = payload.get("period") or {}
    if period.get("start"):
        encounter_date = str(period["start"])[:10]

    queue_number = 0
    queue_status = "waiting"
    for ext in payload.get("extension") or []:
        if ext.get("url") != "https://wundadi.tw/fhir/StructureDefinition/encounter-queue":
            continue
        for sub in ext.get("extension") or []:
            if sub.get("url") == "queueNumber":
                queue_number = int(sub.get("valueInteger", 0))
            if sub.get("url") == "queueStatus":
                queue_status = str(sub.get("valueCode", "waiting"))

    fhir_status = payload.get("status", "arrived")
    return patient_id, encounter_date, queue_number, queue_status, fhir_status


def _fee_int(value: Any) -> int:
    try:
        return int(float(str(value or "0").replace(",", "")))
    except (TypeError, ValueError):
        return 0


def _encounter_fee_fields(payload: dict[str, Any]) -> dict[str, Any]:
    from src.core.encounter_extensions import extract_reg_meta

    meta = extract_reg_meta(payload if isinstance(payload, dict) else {})
    return {
        "copay_code": str(meta.get("copayCode") or "").strip(),
        "case_no": str(meta.get("caseNo") or "").strip(),
        "fee_deposit": _fee_int(meta.get("deposit")),
        "fee_copay": _fee_int(meta.get("copayAmt")),
        "fee_card_disc": _fee_int(meta.get("cardDisc")),
        "fee_drug_disc": _fee_int(meta.get("drugDisc")),
        "fee_reg": _fee_int(meta.get("regFee")),
        "fee_self": _fee_int(meta.get("selfPay")),
        "fee_total": _fee_int(meta.get("totalFee")),
        "fee_arrears": _fee_int(meta.get("arrears")),
        "ic_upload_date": str(meta.get("icUploadDate") or "").strip()[:10],
    }


_INDEX_MIGRATIONS: list[tuple[str, str, str]] = [
    ("patient_index", "id_no", "TEXT"),
    ("patient_index", "birthday_roc", "TEXT"),
    ("patient_index", "sex", "TEXT"),
    ("patient_index", "medical_no", "TEXT"),
    ("patient_index", "phone", "TEXT"),
    ("patient_index", "address", "TEXT"),
    ("patient_index", "id_category", "TEXT"),
    ("patient_index", "phone2", "TEXT"),
    ("condition_index", "snomed_code", "TEXT"),
    ("condition_index", "nhi_icd10_code", "TEXT"),
    ("medication_request_index", "rxnorm_code", "TEXT"),
    ("medication_request_index", "days_supply", "INTEGER"),
    ("medication_request_index", "quantity", "REAL"),
    ("medication_request_index", "unit_price", "REAL"),
    ("medication_request_index", "pack_version", "TEXT"),
    ("medication_request_index", "useage", "TEXT"),
    ("medication_request_index", "pay_mark", "TEXT"),
    ("medication_request_index", "total_qty", "REAL"),
    ("medication_request_index", "use_type", "TEXT"),
    ("medication_request_index", "line_sort", "INTEGER"),
    ("medication_request_index", "memo_mark", "TEXT"),
    ("medication_request_index", "body_site", "TEXT"),
    ("encounter_index", "chief_complaint", "TEXT"),
    ("encounter_index", "shift", "TEXT"),
    ("encounter_index", "slot_time", "TEXT"),
    ("encounter_index", "times_no", "INTEGER"),
    ("encounter_index", "owe_card", "INTEGER NOT NULL DEFAULT 0"),
    ("encounter_index", "copay_code", "TEXT"),
    ("encounter_index", "case_no", "TEXT"),
    ("encounter_index", "fee_deposit", "INTEGER NOT NULL DEFAULT 0"),
    ("encounter_index", "fee_copay", "INTEGER NOT NULL DEFAULT 0"),
    ("encounter_index", "fee_card_disc", "INTEGER NOT NULL DEFAULT 0"),
    ("encounter_index", "fee_drug_disc", "INTEGER NOT NULL DEFAULT 0"),
    ("encounter_index", "fee_reg", "INTEGER NOT NULL DEFAULT 0"),
    ("encounter_index", "fee_self", "INTEGER NOT NULL DEFAULT 0"),
    ("encounter_index", "fee_total", "INTEGER NOT NULL DEFAULT 0"),
    ("encounter_index", "fee_arrears", "INTEGER NOT NULL DEFAULT 0"),
    ("encounter_index", "claim_doctor_id", "TEXT"),
    ("encounter_index", "claim_pharmacist_id", "TEXT"),
    ("encounter_index", "treat_seq", "TEXT"),
    ("encounter_index", "ic_upload_date", "TEXT"),
    ("encounter_index", "reg_cc", "TEXT"),
    ("encounter_index", "reg_remark", "TEXT"),
    ("id_category_settings", "is_default", "INTEGER NOT NULL DEFAULT 0"),
]


class PatientKeyConflict(ValueError):
    """身分證或病歷號與其他病患衝突。"""

    def __init__(self, field: str, value: str, other_id: str):
        self.field = field
        self.value = value
        self.other_id = other_id
        label = "身分證" if field == "id_no" else "病歷號"
        super().__init__(f"{label}「{value}」已存在（病患 {other_id}），不可重複")


def _ensure_runtime_settings_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS clinic_runtime_settings (
            key    TEXT PRIMARY KEY,
            value  TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )


def _get_runtime_setting(conn: sqlite3.Connection, key: str) -> str | None:
    _ensure_runtime_settings_table(conn)
    row = conn.execute(
        "SELECT value FROM clinic_runtime_settings WHERE key = ? LIMIT 1",
        (key,),
    ).fetchone()
    return str(row[0]) if row and row[0] is not None else None


def _set_runtime_setting(conn: sqlite3.Connection, key: str, value: str) -> None:
    _ensure_runtime_settings_table(conn)
    conn.execute(
        """
        INSERT INTO clinic_runtime_settings (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = datetime('now')
        """,
        (key, value),
    )


def _is_audit_recording_enabled(conn: sqlite3.Connection) -> bool:
    """預設關閉：匯入／演練不堆積稽核；正式上線後才為 1。"""
    return (_get_runtime_setting(conn, "audit_recording") or "0").strip() == "1"


def _audit_create_summary(resource_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    """建檔稽核摘要（不全量存 FHIR，避免稽核表膨脹）。"""
    summary: dict[str, Any] = {"_action": "create", "resourceType": resource_type}
    if resource_type == "Patient":
        fields = _patient_index_fields(payload)
        summary.update(
            {
                "idNo": fields.get("id_no"),
                "medicalNo": fields.get("medical_no"),
                "name": " ".join(
                    x for x in [fields.get("family_name"), fields.get("given_name")] if x
                ).strip()
                or None,
            }
        )
    else:
        summary["id"] = payload.get("id")
    return summary


def _insert_audit_row(
    conn: sqlite3.Connection,
    *,
    action: str,
    resource_type: str,
    resource_id: str,
    machine_id: str,
    operator_identity: str,
    changed_fields: dict[str, Any],
) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(audit_modifications)").fetchall()}
    if "action" in cols:
        conn.execute(
            """
            INSERT INTO audit_modifications (
                record_id, resource_type, timestamp, machine_id,
                changed_fields, operator_identity, action
            ) VALUES (?, ?, datetime('now'), ?, ?, ?, ?)
            """,
            (
                f"{resource_type}/{resource_id}",
                resource_type,
                machine_id,
                json.dumps(changed_fields, ensure_ascii=False),
                operator_identity,
                action,
            ),
        )
    else:
        conn.execute(
            """
            INSERT INTO audit_modifications (
                record_id, resource_type, timestamp, machine_id,
                changed_fields, operator_identity
            ) VALUES (?, ?, datetime('now'), ?, ?, ?)
            """,
            (
                f"{resource_type}/{resource_id}",
                resource_type,
                machine_id,
                json.dumps(changed_fields, ensure_ascii=False),
                operator_identity,
            ),
        )


def _normalize_id_no(id_no: str | None) -> str | None:
    key = (id_no or "").strip().upper()
    return key or None


def _normalize_medical_no(medical_no: str | None) -> str | None:
    key = (medical_no or "").strip()
    return key or None


def _assert_patient_keys_unique(
    conn: sqlite3.Connection,
    resource_id: str,
    id_no: str | None,
    medical_no: str | None,
) -> None:
    id_key = _normalize_id_no(id_no)
    if id_key:
        row = conn.execute(
            """
            SELECT resource_id FROM patient_index
            WHERE upper(trim(id_no)) = ? AND resource_id != ?
            LIMIT 1
            """,
            (id_key, resource_id),
        ).fetchone()
        if row:
            raise PatientKeyConflict("id_no", id_key, str(row[0]))

    med_key = _normalize_medical_no(medical_no)
    if med_key:
        row = conn.execute(
            """
            SELECT resource_id FROM patient_index
            WHERE trim(medical_no) = ? AND resource_id != ?
            LIMIT 1
            """,
            (med_key, resource_id),
        ).fetchone()
        if row:
            raise PatientKeyConflict("medical_no", med_key, str(row[0]))


def _next_medical_no(conn: sqlite3.Connection) -> str:
    """全庫最大病歷號 + 1。中間空號不補。"""
    rows = conn.execute(
        """
        SELECT medical_no FROM patient_index
        WHERE medical_no IS NOT NULL AND trim(medical_no) != ''
        """
    ).fetchall()
    max_n = 0
    for (raw,) in rows:
        digits = re.sub(r"\D", "", str(raw or ""))
        if not digits:
            continue
        try:
            max_n = max(max_n, int(digits))
        except ValueError:
            continue
    return f"{max_n + 1:06d}"


def _ensure_patient_unique_keys(conn: sqlite3.Connection) -> None:
    """清既有重複後建立 UNIQUE INDEX（空字串／NULL 可多筆）。"""
    # 身分證重複：保留最新 updated_at，其餘清空 id_no（避免建索引失敗）
    id_dupes = conn.execute(
        """
        SELECT upper(trim(id_no)) AS k, COUNT(*) AS c
        FROM patient_index
        WHERE id_no IS NOT NULL AND trim(id_no) != ''
        GROUP BY upper(trim(id_no))
        HAVING c > 1
        """
    ).fetchall()
    for key, _count in id_dupes:
        keep = conn.execute(
            """
            SELECT resource_id FROM patient_index
            WHERE upper(trim(id_no)) = ?
            ORDER BY updated_at DESC, resource_id DESC
            LIMIT 1
            """,
            (key,),
        ).fetchone()
        if not keep:
            continue
        conn.execute(
            """
            UPDATE patient_index
            SET id_no = NULL, updated_at = datetime('now')
            WHERE upper(trim(id_no)) = ? AND resource_id != ?
            """,
            (key, keep[0]),
        )

    # 病歷號重複：保留最新，其餘改派新號
    med_dupes = conn.execute(
        """
        SELECT trim(medical_no) AS k, COUNT(*) AS c
        FROM patient_index
        WHERE medical_no IS NOT NULL AND trim(medical_no) != ''
        GROUP BY trim(medical_no)
        HAVING c > 1
        """
    ).fetchall()
    for key, _count in med_dupes:
        rows = conn.execute(
            """
            SELECT resource_id FROM patient_index
            WHERE trim(medical_no) = ?
            ORDER BY updated_at DESC, resource_id DESC
            """,
            (key,),
        ).fetchall()
        for (rid,) in rows[1:]:
            new_no = _next_medical_no(conn)
            conn.execute(
                """
                UPDATE patient_index
                SET medical_no = ?, updated_at = datetime('now')
                WHERE resource_id = ?
                """,
                (new_no, rid),
            )

    conn.execute("DROP INDEX IF EXISTS uq_patient_index_id_no")
    conn.execute("DROP INDEX IF EXISTS uq_patient_index_medical_no")
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_index_id_no
        ON patient_index(id_no)
        WHERE id_no IS NOT NULL AND trim(id_no) != ''
        """
    )
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_index_medical_no
        ON patient_index(medical_no)
        WHERE medical_no IS NOT NULL AND trim(medical_no) != ''
        """
    )


def _apply_index_migrations(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cash_return (
            id INTEGER PRIMARY KEY,
            encounter_date TEXT NOT NULL,
            amount INTEGER NOT NULL,
            keywords TEXT,
            copay_code TEXT
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cash_return_date ON cash_return(encounter_date)"
    )
    cash_cols = {row[1] for row in conn.execute("PRAGMA table_info(cash_return)").fetchall()}
    for column, col_type in (
        ("chart_no", "TEXT"),
        ("patient_name", "TEXT"),
        ("id_no", "TEXT"),
        ("seg", "TEXT"),
        ("treat_seq", "TEXT"),
        ("case_no", "TEXT"),
    ):
        if column not in cash_cols:
            conn.execute(f"ALTER TABLE cash_return ADD COLUMN {column} {col_type}")
    for table, column, col_type in _INDEX_MIGRATIONS:
        cols = {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        if column not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
    patient_cols = {row[1] for row in conn.execute("PRAGMA table_info(patient_index)").fetchall()}
    if "id_no" in patient_cols:
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_patient_index_id_no ON patient_index(id_no)"
        )
    if "id_category" in patient_cols:
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_patient_index_id_category ON patient_index(id_category)"
        )
    if "birthday_roc" in patient_cols:
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_patient_birthday_roc ON patient_index(birthday_roc)"
        )
    if "given_name" in patient_cols:
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_patient_index_given ON patient_index(given_name)"
        )
    if "birth_date" in patient_cols:
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_patient_birth_date ON patient_index(birth_date)"
        )
    if "id_no" in patient_cols and "medical_no" in patient_cols:
        _ensure_patient_unique_keys(conn)
    _ensure_runtime_settings_table(conn)
    # 稽核表：補 action 欄（舊庫相容）
    audit_cols = {row[1] for row in conn.execute("PRAGMA table_info(audit_modifications)").fetchall()}
    if audit_cols and "action" not in audit_cols:
        conn.execute(
            "ALTER TABLE audit_modifications ADD COLUMN action TEXT NOT NULL DEFAULT 'update'"
        )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_audit_record_id
        ON audit_modifications(record_id)
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_audit_timestamp
        ON audit_modifications(timestamp)
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS clinical_note_index (
            resource_id       TEXT PRIMARY KEY,
            encounter_id      TEXT NOT NULL UNIQUE,
            patient_id        TEXT NOT NULL,
            chief_complaint   TEXT NOT NULL,
            subjective_preview TEXT,
            objective_preview  TEXT,
            assessment_preview TEXT,
            plan_preview       TEXT,
            composition_status TEXT NOT NULL DEFAULT 'final',
            updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_clinical_note_encounter ON clinical_note_index(encounter_id)"
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS observation_index (
            resource_id        TEXT PRIMARY KEY,
            patient_id         TEXT NOT NULL,
            encounter_id       TEXT,
            category           TEXT NOT NULL DEFAULT 'vital-signs',
            loinc_code         TEXT NOT NULL,
            vital_type         TEXT,
            display_text       TEXT,
            value_num          REAL,
            value_unit         TEXT,
            effective_datetime TEXT,
            status             TEXT NOT NULL DEFAULT 'final',
            updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_observation_patient ON observation_index(patient_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_observation_encounter ON observation_index(encounter_id)"
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS allergy_index (
            resource_id            TEXT PRIMARY KEY,
            patient_id             TEXT NOT NULL,
            verification_status    TEXT NOT NULL DEFAULT 'confirmed',
            snomed_code            TEXT NOT NULL,
            rxnorm_substance       TEXT,
            snomed_manifestation   TEXT,
            summary_text           TEXT,
            category               TEXT,
            criticality            TEXT,
            updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_allergy_patient ON allergy_index(patient_id)"
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS media_index (
            resource_id        TEXT PRIMARY KEY,
            patient_id         TEXT NOT NULL,
            encounter_id       TEXT,
            site_label         TEXT NOT NULL,
            body_site_code     TEXT,
            content_type       TEXT NOT NULL,
            captured_datetime  TEXT,
            has_image_data     INTEGER NOT NULL DEFAULT 1,
            updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_media_patient ON media_index(patient_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_media_encounter ON media_index(encounter_id)"
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS look_file (
            rel         TEXT PRIMARY KEY,
            chart_no    TEXT NOT NULL,
            file_name   TEXT NOT NULL,
            modified    TEXT,
            size_bytes  INTEGER,
            noted_at    TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_look_file_chart ON look_file(chart_no)")

    # Migrate resource_cache to add created_at
    cache_cols = {row[1] for row in conn.execute("PRAGMA table_info(resource_cache)").fetchall()}
    if "created_at" not in cache_cols:
        conn.execute("ALTER TABLE resource_cache ADD COLUMN created_at TEXT")
        conn.execute("UPDATE resource_cache SET created_at = updated_at")

    # Create tables and seed clinic staff if empty
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS clinic_staff (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            role        TEXT NOT NULL,
            nhi_id      TEXT,
            cert_no     TEXT,
            pin         TEXT NOT NULL UNIQUE,
            status      TEXT NOT NULL DEFAULT '在職'
        )
        """
    )
    staff_cols = {row[1] for row in conn.execute("PRAGMA table_info(clinic_staff)").fetchall()}
    if "room" not in staff_cols:
        conn.execute("ALTER TABLE clinic_staff ADD COLUMN room TEXT NOT NULL DEFAULT '1'")
    staff_count = conn.execute("SELECT COUNT(*) FROM clinic_staff").fetchone()[0]
    if staff_count == 0:
        conn.executemany(
            """
            INSERT INTO clinic_staff (id, name, role, nhi_id, cert_no, pin, status)
            VALUES (?, ?, ?, ?, ?, ?, '在職')
            """,
            [
                ("dr-01", "許明隆", "院長 / 主治醫師", "A110275958", "醫字第024652號", "1234"),
                ("ph-01", "張麗玉", "主任藥師", "T220194825", "藥字第012845號", "5678"),
                ("nu-01", "陳小芬", "護理長", "D223595821", "護字第034685號", "9999"),
                ("nu-02", "李阿珠", "門診護理師", "E220194852", "護字第046523號", "1111")
            ]
        )

    # Create fido2_challenges table
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS fido2_challenges (
            patient_id  TEXT PRIMARY KEY,
            challenge   TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )


def _condition_index_fields(payload: dict[str, Any]) -> dict[str, Any]:
    from src.core.terminology import extract_terminology_stickers

    subject = payload.get("subject") or {}
    patient_id = (subject.get("reference") or "").split("/")[-1]
    encounter_id: str | None = None
    enc = payload.get("encounter")
    if isinstance(enc, dict) and enc.get("reference"):
        encounter_id = str(enc["reference"]).split("/")[-1]

    stickers = extract_terminology_stickers(payload.get("code"))
    status = "active"
    cs = payload.get("clinicalStatus") or {}
    for c in cs.get("coding") or []:
        if c.get("code"):
            status = str(c["code"])
            break

    return {
        "patient_id": patient_id,
        "encounter_id": encounter_id,
        "icd10_code": stickers["icd10Code"],
        "snomed_code": stickers["snomedCode"],
        "nhi_icd10_code": stickers["nhiIcd10Code"],
        "summary_text": stickers["summaryText"],
        "clinical_status": status,
    }


def _medication_request_index_fields(payload: dict[str, Any]) -> dict[str, Any]:
    from src.core.terminology import extract_terminology_stickers

    subject = payload.get("subject") or {}
    patient_id = (subject.get("reference") or "").split("/")[-1]
    encounter_id: str | None = None
    enc = payload.get("encounter") or {}
    if isinstance(enc, dict) and enc.get("reference"):
        encounter_id = str(enc["reference"]).split("/")[-1]

    stickers = extract_terminology_stickers(payload.get("medicationCodeableConcept"))

    days_supply: int | None = None
    quantity: float | None = None
    unit_price: float | None = None
    pack_version: str | None = None
    body_site: str | None = None
    pay_mark: str | None = None
    memo_mark: str | None = None
    saw_pay = False
    saw_memo = False

    dispense = payload.get("dispenseRequest") or {}
    if isinstance(dispense, dict):
        q = dispense.get("quantity") or {}
        if isinstance(q, dict) and q.get("value") is not None:
            try:
                quantity = float(q["value"])
            except (TypeError, ValueError):
                quantity = None
        dur = dispense.get("expectedSupplyDuration") or {}
        if isinstance(dur, dict) and dur.get("value") is not None:
            try:
                days_supply = int(float(dur["value"]))
            except (TypeError, ValueError):
                days_supply = None

    for ext in payload.get("extension") or []:
        if not isinstance(ext, dict):
            continue
        url = str(ext.get("url") or "")
        if url.endswith("/daysSupply") and ext.get("valueInteger") is not None:
            days_supply = int(ext["valueInteger"])
        elif url.endswith("/quantity") and ext.get("valueDecimal") is not None:
            quantity = float(ext["valueDecimal"])
        elif url.endswith("/unitPrice") and ext.get("valueDecimal") is not None:
            unit_price = float(ext["valueDecimal"])
        elif url.endswith("/packVersion") and ext.get("valueString"):
            pack_version = str(ext["valueString"])
        elif url.endswith("/bodySite"):
            body_site = str(ext.get("valueString") or "").strip()
        elif url.endswith("/payMark"):
            saw_pay = True
            pay_mark = str(ext.get("valueString") or "").strip()
        elif url.endswith("/memoMark"):
            saw_memo = True
            memo_mark = str(ext.get("valueString") or "").strip()

    out: dict[str, Any] = {
        "patient_id": patient_id,
        "encounter_id": encounter_id,
        "nhi_code": stickers["nhiMedCode"],
        "rxnorm_code": stickers["rxnormCode"],
        "drug_text": stickers["summaryText"],
        "status": str(payload.get("status") or "active"),
        "days_supply": days_supply,
        "quantity": quantity,
        "unit_price": unit_price,
        "pack_version": pack_version,
        "body_site": body_site,
    }
    if saw_pay:
        out["pay_mark"] = pay_mark
    if saw_memo:
        out["memo_mark"] = memo_mark
    if "dosageInstruction" in payload:
        doses = payload.get("dosageInstruction") or []
        text = ""
        if isinstance(doses, list) and doses and isinstance(doses[0], dict):
            text = str(doses[0].get("text") or "").strip()
        out["useage"] = text or None
    return out


def _index_row_to_api(resource_type: str, row: dict[str, Any]) -> dict[str, Any]:
    if resource_type == "Condition":
        return {
            "resourceId": row.get("resource_id"),
            "patientId": row.get("patient_id"),
            "encounterId": row.get("encounter_id"),
            "icd10Code": row.get("icd10_code"),
            "snomedCode": row.get("snomed_code"),
            "nhiIcd10Code": row.get("nhi_icd10_code"),
            "summaryText": row.get("summary_text"),
            "clinicalStatus": row.get("clinical_status"),
            "updatedAt": row.get("updated_at"),
        }
    if resource_type == "MedicationRequest":
        return {
            "resourceId": row.get("resource_id"),
            "patientId": row.get("patient_id"),
            "encounterId": row.get("encounter_id"),
            "nhiCode": row.get("nhi_code"),
            "rxnormCode": row.get("rxnorm_code"),
            "drugText": row.get("drug_text"),
            "status": row.get("status"),
            "daysSupply": row.get("days_supply"),
            "quantity": row.get("quantity"),
            "unitPrice": row.get("unit_price"),
            "packVersion": row.get("pack_version"),
            "updatedAt": row.get("updated_at"),
        }
    if resource_type == "Patient":
        return {
            "resourceId": row.get("resource_id"),
            "familyName": row.get("family_name"),
            "givenName": row.get("given_name"),
            "identifier": row.get("identifier"),
            "birthDate": row.get("birth_date"),
            "idNo": row.get("id_no"),
            "birthdayRoc": row.get("birthday_roc"),
            "sex": row.get("sex"),
            "medicalNo": row.get("medical_no"),
            "phone": row.get("phone"),
            "address": row.get("address"),
            "idCategory": row.get("id_category"),
            "updatedAt": row.get("updated_at"),
        }
    if resource_type == "Composition":
        return {
            "resourceId": row.get("resource_id"),
            "encounterId": row.get("encounter_id"),
            "patientId": row.get("patient_id"),
            "chiefComplaint": row.get("chief_complaint"),
            "subjectivePreview": row.get("subjective_preview"),
            "objectivePreview": row.get("objective_preview"),
            "assessmentPreview": row.get("assessment_preview"),
            "planPreview": row.get("plan_preview"),
            "compositionStatus": row.get("composition_status"),
            "updatedAt": row.get("updated_at"),
        }
    if resource_type == "Observation":
        return {
            "resourceId": row.get("resource_id"),
            "patientId": row.get("patient_id"),
            "encounterId": row.get("encounter_id"),
            "category": row.get("category"),
            "loincCode": row.get("loinc_code"),
            "vitalType": row.get("vital_type"),
            "displayText": row.get("display_text"),
            "value": row.get("value_num"),
            "unit": row.get("value_unit"),
            "effectiveDateTime": row.get("effective_datetime"),
            "status": row.get("status"),
            "updatedAt": row.get("updated_at"),
        }
    if resource_type == "AllergyIntolerance":
        return {
            "resourceId": row.get("resource_id"),
            "patientId": row.get("patient_id"),
            "verificationStatus": row.get("verification_status"),
            "snomedCode": row.get("snomed_code"),
            "rxnormSubstance": row.get("rxnorm_substance"),
            "snomedManifestation": row.get("snomed_manifestation"),
            "summaryText": row.get("summary_text"),
            "category": row.get("category"),
            "criticality": row.get("criticality"),
            "updatedAt": row.get("updated_at"),
        }
    if resource_type == "Media":
        return {
            "resourceId": row.get("resource_id"),
            "patientId": row.get("patient_id"),
            "encounterId": row.get("encounter_id"),
            "siteLabel": row.get("site_label"),
            "bodySiteCode": row.get("body_site_code"),
            "contentType": row.get("content_type"),
            "capturedDateTime": row.get("captured_datetime"),
            "hasImageData": bool(row.get("has_image_data")),
            "updatedAt": row.get("updated_at"),
        }
    return dict(row)


def _media_index_fields(payload: dict[str, Any]) -> dict[str, Any]:
    from src.core.nhi_media_fhir_mapper import extract_media_stickers

    stickers = extract_media_stickers(payload)
    patient_id = stickers.get("patientId") or ""
    if not patient_id:
        patient = payload.get("subject") or {}
        patient_id = (patient.get("reference") or "").split("/")[-1]
    return {
        "patient_id": patient_id,
        "encounter_id": stickers.get("encounterId"),
        "site_label": stickers.get("siteLabel") or "未標部位",
        "body_site_code": stickers.get("bodySiteCode"),
        "content_type": stickers.get("contentType") or "image/jpeg",
        "captured_datetime": stickers.get("capturedDateTime"),
        "has_image_data": 1 if stickers.get("hasImageData") else 0,
    }


def _allergy_index_fields(payload: dict[str, Any]) -> dict[str, Any]:
    from src.core.nhi_allergy_fhir_mapper import extract_allergy_stickers

    patient = payload.get("patient") or {}
    patient_id = (patient.get("reference") or "").split("/")[-1]
    stickers = extract_allergy_stickers(payload)
    categories = payload.get("category") or []
    category = categories[0] if categories else None
    return {
        "patient_id": patient_id,
        "verification_status": stickers.get("verificationStatus") or "confirmed",
        "snomed_code": stickers.get("snomedCode") or "",
        "rxnorm_substance": stickers.get("rxnormSubstance"),
        "snomed_manifestation": stickers.get("snomedManifestation"),
        "summary_text": stickers.get("summaryText"),
        "category": category,
        "criticality": stickers.get("criticality"),
    }


def _observation_index_fields(payload: dict[str, Any]) -> dict[str, Any]:
    from src.core.nhi_observation_fhir_mapper import extract_observation_stickers

    stickers = extract_observation_stickers(payload)
    subject = payload.get("subject") or {}
    patient_id = (subject.get("reference") or "").split("/")[-1]
    encounter_id = stickers.get("encounterId")
    value = stickers.get("value")
    return {
        "patient_id": patient_id,
        "encounter_id": encounter_id,
        "category": stickers.get("category") or "vital-signs",
        "loinc_code": stickers.get("loincCode") or "",
        "vital_type": stickers.get("vitalType"),
        "display_text": stickers.get("displayText"),
        "value_num": float(value) if value is not None else None,
        "value_unit": stickers.get("unit"),
        "effective_datetime": stickers.get("effectiveDateTime"),
        "status": str(payload.get("status") or "final"),
    }


def _clinical_note_index_fields(payload: dict[str, Any]) -> dict[str, Any]:
    from src.core.nhi_soap_fhir_mapper import extract_soap_stickers_from_composition, preview_text

    stickers = extract_soap_stickers_from_composition(payload)
    subject = payload.get("subject") or {}
    patient_id = (subject.get("reference") or "").split("/")[-1]
    encounter_id = stickers.get("encounterId") or ""
    if not encounter_id:
        enc = payload.get("encounter") or {}
        if isinstance(enc, dict) and enc.get("reference"):
            encounter_id = str(enc["reference"]).split("/")[-1]

    return {
        "encounter_id": encounter_id,
        "patient_id": patient_id,
        "chief_complaint": stickers.get("chiefComplaint") or "",
        "subjective_preview": preview_text(
            stickers.get("subjective") or stickers.get("chiefComplaint")
        ),
        "objective_preview": preview_text(stickers.get("objective")),
        "assessment_preview": preview_text(stickers.get("assessment")),
        "plan_preview": preview_text(stickers.get("plan")),
        "composition_status": str(payload.get("status") or "final"),
    }


def _terminology_stickers_from_cache(
    resource_type: str, cache: dict[str, Any]
) -> dict[str, str | None]:
    from src.core.terminology import extract_terminology_stickers

    if resource_type == "Condition":
        return extract_terminology_stickers(cache.get("code"))
    if resource_type == "MedicationRequest":
        return extract_terminology_stickers(cache.get("medicationCodeableConcept"))
    if resource_type == "AllergyIntolerance":
        from src.core.nhi_allergy_fhir_mapper import extract_allergy_stickers

        return extract_allergy_stickers(cache)
    if resource_type == "Media":
        from src.core.nhi_media_fhir_mapper import extract_media_stickers

        return extract_media_stickers(cache)
    return {}


def _clinic_fields_from_payload(raw: str | dict[str, Any]) -> dict[str, str]:
    """從 Patient JSON 抽出主檔備註／押金／身份／身分證。"""
    out = {"memo": "", "keymoney": "", "kind": "", "idCategory": "", "idNo": "", "arrearage": ""}
    try:
        pp = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(pp, dict):
            return out
        for ident in pp.get("identifier") or []:
            if not isinstance(ident, dict) or not ident.get("value"):
                continue
            system = str(ident.get("system") or "").lower()
            if (
                ident.get("use") == "official"
                or "moi.gov" in system
                or "nhidcc" in system
                or system.endswith("/id")
            ):
                out["idNo"] = str(ident["value"]).strip().upper()
                break
        if not out["idNo"]:
            for ident in pp.get("identifier") or []:
                if isinstance(ident, dict) and ident.get("value"):
                    use = ident.get("use")
                    system = str(ident.get("system") or "").lower()
                    if use == "secondary" or "chart" in system:
                        continue
                    out["idNo"] = str(ident["value"]).strip().upper()
                    break
        for ext in pp.get("extension") or []:
            url = str(ext.get("url") or "")
            if "patient-clinic-ext" not in url:
                continue
            for sub in ext.get("extension") or []:
                key = str(sub.get("url") or "")
                val = str(sub.get("valueString") or "").strip()
                if key == "memo":
                    out["memo"] = val
                elif key == "keymoney":
                    out["keymoney"] = val
                elif key == "kind":
                    out["kind"] = val
                elif key == "idCategory":
                    out["idCategory"] = val
                elif key == "arrearage":
                    out["arrearage"] = val
            break
    except Exception:
        return out
    return out


def _load_patient_clinic_fields(conn: sqlite3.Connection, patient_id: str) -> dict[str, str]:
    """從 Patient 資源抽出主檔備註／押金／身份／身分證（供掛號清單 fallback）。"""
    empty = {"memo": "", "keymoney": "", "kind": "", "idCategory": "", "idNo": "", "arrearage": ""}
    if not patient_id:
        return empty
    try:
        prow = conn.execute(
            "SELECT payload_json FROM resource_cache "
            "WHERE resource_type='Patient' AND resource_id=? LIMIT 1",
            (patient_id,),
        ).fetchone()
        if not prow:
            return empty
        return _clinic_fields_from_payload(prow[0])
    except Exception:
        return empty


def _apply_patient_fallbacks_to_queue_meta(
    queue_meta: dict[str, Any],
    patient_id_no: str,
    patient_clinic: dict[str, str],
) -> None:
    """Fill a missing ID from the patient master. Visit deposit stays on this encounter."""
    hc_id_no = str(queue_meta.get("hcIdNo") or "").strip().upper()
    resolved_id = hc_id_no or (patient_id_no or "").strip().upper() or patient_clinic.get("idNo") or ""
    if resolved_id:
        queue_meta["hcIdNo"] = resolved_id
        queue_meta["idNo"] = resolved_id
    if patient_clinic.get("idCategory") and not queue_meta.get("idCategory"):
        queue_meta["idCategory"] = patient_clinic["idCategory"]
    if patient_clinic.get("kind") and not queue_meta.get("kind"):
        queue_meta["kind"] = patient_clinic["kind"]
    queue_meta["patientArrearage"] = str(patient_clinic.get("arrearage") or "").strip()


def _patient_index_fields(payload: dict[str, Any]) -> dict[str, str | None]:
    """從 FHIR Patient 抽出索引欄位（含健保貼紙與連絡資訊）。"""
    from src.core.nhi_fhir_mapper import extract_nhi_stickers_from_patient

    family: str | None = None
    given: str | None = None
    names = payload.get("name") or []
    if names and isinstance(names[0], dict):
        family = names[0].get("family")
        given_parts = names[0].get("given") or []
        given = " ".join(given_parts) if given_parts else None

    identifier: str | None = None
    for ident in payload.get("identifier") or []:
        if isinstance(ident, dict) and ident.get("value"):
            identifier = str(ident["value"])
            break

    # 提取醫聖病歷號碼（secondary 或 chart-number）
    medical_no: str | None = None
    for ident in payload.get("identifier") or []:
        if not isinstance(ident, dict) or not ident.get("value"):
            continue
        system = str(ident.get("system") or "")
        if ident.get("use") == "secondary" or "chart" in system:
            medical_no = str(ident["value"]).strip() or None
            break

    # 市話與手機都留下，家族清單用同一串比對
    phone_bits: list[str] = []
    for tel in payload.get("telecom") or []:
        if isinstance(tel, dict) and tel.get("system") == "phone" and tel.get("value") is not None:
            bit = str(tel["value"]).strip()
            if bit and bit not in phone_bits:
                phone_bits.append(bit)
    phone: str | None = " / ".join(phone_bits) if phone_bits else None

    # 提取地址
    address: str | None = None
    addrs = payload.get("address") or []
    if addrs and isinstance(addrs[0], dict):
        address = addrs[0].get("text")

    stickers = extract_nhi_stickers_from_patient(payload)
    id_no = stickers.get("idNo")
    # 貼紙缺身分證時，從 MOI／健保／通用 id 系統補
    if not id_no:
        for ident in payload.get("identifier") or []:
            if not isinstance(ident, dict) or not ident.get("value"):
                continue
            system = str(ident.get("system") or "").lower()
            if (
                "moi.gov" in system
                or "nhidcc" in system
                or system.endswith("/id")
                or "id-no" in system
                or ident.get("use") == "official"
            ):
                id_no = str(ident["value"]).strip().upper() or None
                break

    id_category: str | None = None
    for ext in payload.get("extension") or []:
        if "patient-clinic-ext" in (ext.get("url") or ""):
            for sub in ext.get("extension") or []:
                if sub.get("url") == "idCategory":
                    id_category = sub.get("valueString")
                    break
            break

    return {
        "family_name": family,
        "given_name": given,
        "identifier": identifier,
        "birth_date": payload.get("birthDate"),
        "id_no": id_no,
        "birthday_roc": stickers.get("birthdayRoc"),
        "sex": stickers.get("sex"),
        "medical_no": medical_no,
        "phone": phone,
        "address": address,
        "id_category": id_category,
    }
