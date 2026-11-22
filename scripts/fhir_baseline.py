"""Record what every reader gets from a chart DB copy, then diff two recordings.

  python scripts/fhir_baseline.py capture --db COPY.db --out DIR [--look LOOK_DIR] [--sample-from DIR]
  python scripts/fhir_baseline.py diff DIR_BEFORE DIR_AFTER

Run capture on a local copy before and after a storage change; diff must be
empty before the change may reach the clinic host. Captures hold patient data:
they are refused inside the repo and the DB must not be on a network drive.
Startup hooks (sync worker, certificate import from Z:) are not run.
"""

from __future__ import annotations

import argparse
import ctypes
import gzip
import json
import os
import subprocess
import sys
import time
import traceback
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# In-memory or clock-driven; differ between runs without any storage change.
VOLATILE_KEYS = {"chartOpen"}

DAYS_RECENT = 10
DAYS_FUTURE = 3
DAYS_SPREAD = 10
PER_DAY = 40
INDEX_ONLY = 300
PATIENTS = 300
IC_DAYS = 5
MONTHS = 4


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


def _stride(items: list[Any], cap: int) -> list[Any]:
    if len(items) <= cap:
        return list(items)
    step = len(items) / cap
    return [items[int(i * step)] for i in range(cap)]


def _strip(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _strip(v) for k, v in value.items() if k not in VOLATILE_KEYS}
    if isinstance(value, list):
        return [_strip(v) for v in value]
    return value


def _open_app(db: Path, look: Path | None):
    if look:
        os.environ["WUNDADI_LOOK_DIR"] = str(look)
    from src.infrastructure import sqlite_shadow_store as sss

    sss.DEFAULT_DB_PATH = db
    from src.spoke import pack_store

    pack_store.DEFAULT_DB_PATH = db
    from src.app import bootstrap

    bootstrap.reset_for_tests()
    store = sss.SqliteShadowStore(db)
    store.initialize()
    bootstrap._store = store
    from fastapi.testclient import TestClient
    from src.api.main import app

    return store, TestClient(app)


def _months(today: date) -> list[str]:
    out = []
    y, m = today.year, today.month
    for _ in range(MONTHS):
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out


def _month_range(month: str) -> tuple[str, str]:
    y, m = int(month[:4]), int(month[5:7])
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    last = (date(ny, nm, 1) - date.resolution).day
    return f"{month}-01", f"{month}-{last:02d}"


def _sample(store, today: date) -> dict[str, Any]:
    iso = today.isoformat()
    with store._connect() as conn:
        days = [
            r[0]
            for r in conn.execute(
                "SELECT DISTINCT encounter_date FROM encounter_index "
                "WHERE length(encounter_date) = 10 ORDER BY encounter_date"
            )
        ]
        past = [d for d in days if d <= iso]
        future = [d for d in days if d > iso][:DAYS_FUTURE]
        recent = past[-DAYS_RECENT:]
        older = [d for d in past if d not in recent]
        sample_days = sorted(set(recent + future + _stride(older, DAYS_SPREAD)))

        encounters: list[str] = []
        for day in sample_days:
            encounters += [
                r[0]
                for r in conn.execute(
                    "SELECT resource_id FROM encounter_index WHERE encounter_date = ? "
                    "ORDER BY resource_id LIMIT ?",
                    (day, PER_DAY),
                )
            ]
        index_only: list[str] = []
        for table, rtype in (
            ("condition_index", "Condition"),
            ("medication_request_index", "MedicationRequest"),
        ):
            ids = [
                r[0]
                for r in conn.execute(
                    f"SELECT DISTINCT ix.encounter_id FROM {table} ix "
                    "LEFT JOIN resource_cache rc ON rc.resource_type = ? AND rc.resource_id = ix.resource_id "
                    "WHERE rc.resource_id IS NULL AND ix.encounter_id IS NOT NULL "
                    "ORDER BY ix.encounter_id",
                    (rtype,),
                )
            ]
            index_only += _stride(ids, INDEX_ONLY)
        all_enc = sorted(set(encounters + index_only))
        patient_of = _patient_of(conn, all_enc)
        patients = _stride(sorted({p for p in patient_of.values() if p}), PATIENTS)
        sample = {
            "days": sample_days,
            "icDays": recent[-IC_DAYS:],
            "months": _months(today),
            "encounters": all_enc,
            "indexOnlyEncounters": sorted(set(index_only)),
            "patients": patients,
        }
        _add_lookups(conn, sample)
    return sample


def _patient_of(conn, encounters: list[str]) -> dict[str, str]:
    placeholders = ",".join("?" * len(encounters)) or "''"
    pairs = conn.execute(
        f"SELECT resource_id, patient_id FROM encounter_index WHERE resource_id IN ({placeholders})",
        encounters,
    ).fetchall()
    return {r[0]: r[1] for r in pairs}


def _add_lookups(conn, sample: dict[str, Any]) -> None:
    sample["patientOf"] = _patient_of(conn, sample["encounters"])
    med_no: dict[str, str] = {}
    id_no: dict[str, str] = {}
    patients = sample["patients"]
    if patients:
        ph = ",".join("?" * len(patients))
        for rid, med, idn in conn.execute(
            f"SELECT resource_id, medical_no, id_no FROM patient_index WHERE resource_id IN ({ph})",
            patients,
        ):
            med_no[rid] = med
            id_no[rid] = idn
    sample["medicalNo"] = med_no
    sample["idNo"] = id_no


def _reuse_sample(store, prior: Path) -> dict[str, Any]:
    """Same days/encounters/patients as an earlier capture, so the two can be diffed
    even when the storage change alters what _sample would pick."""
    manifest = json.loads((prior / "manifest.json").read_text(encoding="utf-8"))
    sample = dict(manifest["sample"])
    with store._connect() as conn:
        _add_lookups(conn, sample)
    return sample


class Recorder:
    def __init__(self, out: Path):
        self.fh = gzip.open(out / "calls.jsonl.gz", "wt", encoding="utf-8")
        self.count = 0
        self.errors = 0
        self.started = time.time()

    def put(self, key: str, status: int, kind: str, body: Any) -> None:
        if kind == "json":
            body = _strip(body)
        self.fh.write(
            json.dumps({"key": key, "status": status, "kind": kind, "body": body}, ensure_ascii=False, sort_keys=True)
            + "\n"
        )
        self.count += 1
        if self.count % 200 == 0:
            print(f"  {self.count} calls, {int(time.time() - self.started)}s", flush=True)

    def close(self) -> None:
        self.fh.close()


def _get(rec: Recorder, client, key: str, url: str, params: dict[str, Any] | None = None) -> Any:
    try:
        resp = client.get(url, params=params)
    except Exception:
        rec.errors += 1
        rec.put(key, -1, "error", traceback.format_exc(limit=3).splitlines()[-1])
        return None
    ctype = resp.headers.get("content-type", "")
    if "json" in ctype:
        body = resp.json()
        rec.put(key, resp.status_code, "json", body)
        return body if resp.status_code == 200 else None
    rec.put(key, resp.status_code, "text", resp.text)
    return None


def _call(rec: Recorder, key: str, fn: Callable[[], Any], kind: str = "json") -> None:
    try:
        rec.put(key, 200, kind, fn())
    except Exception:
        rec.errors += 1
        rec.put(key, -1, "error", traceback.format_exc(limit=3).splitlines()[-1])


def capture(args) -> None:
    db = Path(args.db)
    out = Path(args.out)
    look = Path(args.look) if args.look else None
    if not db.is_file():
        sys.exit(f"no such DB: {db}")
    if _is_remote(db):
        sys.exit("refused: the DB is on a network drive. Copy it to this PC and point --db at the copy.")
    if _inside_repo(out):
        sys.exit("refused: captures contain patient data. Put --out outside the repo.")
    out.mkdir(parents=True, exist_ok=True)
    if (out / "calls.jsonl.gz").exists():
        sys.exit(f"refused: {out} already holds a capture")

    import logging

    logging.getLogger("httpx").setLevel(logging.WARNING)
    today = date.today()
    store, client = _open_app(db, look)
    sample = _reuse_sample(store, Path(args.sample_from)) if args.sample_from else _sample(store, today)
    print(
        f"sample: {len(sample['days'])} days, {len(sample['encounters'])} encounters "
        f"({len(sample['indexOnlyEncounters'])} index-only), {len(sample['patients'])} patients",
        flush=True,
    )
    rec = Recorder(out)

    for key, url in (
        ("dateSpan", "/fhir/Encounter/date-span"),
        ("profile", "/clinic/settings/profile"),
        ("catalogOverrides", "/clinic/settings/catalog-overrides"),
        ("caseRules", "/clinic/settings/case-rules"),
        ("staff", "/fhir/staff"),
        ("idCategories", "/fhir/Patient/idCategorySettings"),
        ("roster", "/fhir/Patient/roster"),
        ("referralSlips", "/nhi/v1/referral/slips"),
        ("referralDownloads", "/nhi/v1/referral/downloads"),
        ("qualityLabPending", "/nhi/v1/quality-lab/pending"),
    ):
        _get(rec, client, key, url)

    for day in sample["days"]:
        _get(rec, client, f"queue|{day}", "/fhir/Encounter", {"date": day})

    from src.api.routers import claims as claims_router
    from src.api.routers import ic_upload as ic_router
    from src.claims import build_claims_summary
    from src.claims.engine import clinic_dept_code, clinic_dispense_code
    from src.claims.ic_daily_upload import collect_ic_day
    from src.claims.xml_export_nhi import DEFAULT_CONSULT_FEE_CODE, render_nhi_outpatient_xml

    for day in sample["icDays"]:
        _get(rec, client, f"icPreview|{day}", "/ic-upload/preview", {"date": day})
        _call(
            rec,
            f"icXml|{day}",
            lambda d=day: str(collect_ic_day(store, d, ic_router._institution_code(store)).get("xml") or ""),
            "text",
        )

    kinds = ("disease", "opdCount", "drug", "treatment", "claim", "claimSheet", "claimAnalysis", "pharmacist", "regDiscount")
    for month in sample["months"]:
        d0, d1 = _month_range(month)
        rng = {"dateFrom": d0, "dateTo": d1}
        _get(rec, client, f"cashBook|{month}", "/fhir/Encounter/cash-book", rng)
        _get(rec, client, f"emrLookup|{month}", "/fhir/Encounter/emr-lookup", rng)
        if look:
            _get(rec, client, f"emrLookupImage|{month}", "/fhir/Encounter/emr-lookup", {**rng, "hasImage": "true"})
        for kind in kinds:
            _get(rec, client, f"report.{kind}|{month}", f"/maintenance/reports/{kind}", rng)
        _get(rec, client, f"claimsPreview|{month}", "/claims/preview", {"date_month": month})
        _get(rec, client, f"claimsStats|{month}", "/claims/statistics", {"date_month": month})

        def _xml(m=month) -> str:
            summary = build_claims_summary(store, m)
            return render_nhi_outpatient_xml(
                summary,
                institution_code=claims_router._institution_code(),
                submit_type="songhe",
                dept_code=clinic_dept_code(store),
                consult_fee_code=DEFAULT_CONSULT_FEE_CODE,
                default_dispense=clinic_dispense_code(store),
                encoding_decl="UTF-8",
            )

        _call(rec, f"claimsXml|{month}", _xml, "text")

    for enc in sample["encounters"]:
        _get(rec, client, f"workspace|{enc}", f"/nhi/v1/outpatient/workspace/{enc}")
        _get(rec, client, f"encounter|{enc}", f"/fhir/Encounter/{enc}")
        _get(rec, client, f"conditions|{enc}", "/fhir/Condition", {"encounter": enc})
        _get(rec, client, f"medications|{enc}", "/fhir/MedicationRequest", {"encounter": enc})
        _get(rec, client, f"certificate|{enc}", "/clinic/certificate", {"encounterId": enc})
        _get(rec, client, f"referralOut|{enc}", "/nhi/v1/referral/out-for", {"encounterId": enc})
        _get(rec, client, f"referralReply|{enc}", "/nhi/v1/referral/reply-for", {"encounterId": enc})
        _get(rec, client, f"mediaByEncounter|{enc}", f"/nhi/v1/media/by-encounter/{enc}")
        pid = sample["patientOf"].get(enc)
        if pid:
            _get(rec, client, f"visitDetail|{enc}", f"/fhir/Patient/{pid}/visits/{enc}")

    for pid in sample["patients"]:
        _get(rec, client, f"patient|{pid}", f"/fhir/Patient/{pid}")
        _get(rec, client, f"visits|{pid}", f"/fhir/Patient/{pid}/visits", {"limit": 200, "light": "true"})
        _get(rec, client, f"family|{pid}", f"/fhir/Patient/{pid}/family")
        _get(rec, client, f"allergy|{pid}", f"/nhi/v1/allergy/by-patient/{pid}")
        _get(rec, client, f"previousRx|{pid}", "/fhir/MedicationRequest/previous", {"patient": pid})
        _get(rec, client, f"media|{pid}", "/fhir/Media", {"patient": pid})
        _get(rec, client, f"patientEncounters|{pid}", "/fhir/Encounter", {"patient": pid})
        idn = str(sample["idNo"].get(pid) or "")
        if len(idn) == 10:
            _get(rec, client, f"depositsOpen|{pid}", "/nhi/v1/deposits/open", {"idNo": idn})
        med = sample["medicalNo"].get(pid)
        if look and med:
            _get(rec, client, f"lookFolder|{pid}", "/fhir/Media/look-folder", {"medicalNo": med})

    rec.close()
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True
        ).stdout.strip()
    except OSError:
        commit = ""
    manifest = {
        "capturedOn": today.isoformat(),
        "capturedAt": datetime.now().isoformat(timespec="seconds"),
        "db": str(db.resolve()),
        "look": str(look) if look else "",
        "commit": commit,
        "calls": rec.count,
        "errors": rec.errors,
        "seconds": int(time.time() - rec.started),
        "sample": {k: v for k, v in sample.items() if k not in {"patientOf", "medicalNo", "idNo"}},
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"done: {rec.count} calls, {rec.errors} errors, {manifest['seconds']}s -> {out}")


def _load(path: Path) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
    rows: dict[str, dict[str, Any]] = {}
    with gzip.open(path / "calls.jsonl.gz", "rt", encoding="utf-8") as fh:
        for line in fh:
            row = json.loads(line)
            rows[row["key"]] = row
    return manifest, rows


def _diff_paths(a: Any, b: Any, path: str, out: list[tuple[str, Any, Any]], limit: int) -> None:
    if len(out) >= limit:
        return
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                out.append((f"{path}.{k}", a.get(k, "<missing>"), b.get(k, "<missing>")))
            else:
                _diff_paths(a[k], b[k], f"{path}.{k}", out, limit)
        return
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append((f"{path}[len]", len(a), len(b)))
        for i, (x, y) in enumerate(zip(a, b)):
            _diff_paths(x, y, f"{path}[{i}]", out, limit)
        return
    if a != b:
        out.append((path, a, b))


def diff(args) -> None:
    da, db_ = Path(args.before), Path(args.after)
    ma, ra = _load(da)
    mb, rb = _load(db_)
    if ma["capturedOn"] != mb["capturedOn"]:
        print(f"WARNING: captured on different days ({ma['capturedOn']} vs {mb['capturedOn']}); ages and today-based fields may differ")
    if ma["sample"] != mb["sample"]:
        print("WARNING: the two captures sampled different days/encounters/patients")
    groups: dict[str, list[int]] = {}
    details: list[str] = []
    for key in sorted(set(ra) | set(rb)):
        group = key.split("|")[0]
        stat = groups.setdefault(group, [0, 0, 0])
        a, b = ra.get(key), rb.get(key)
        if a is None or b is None:
            stat[2] += 1
            details.append(f"## {key}\n  only in {'after' if a is None else 'before'}")
            continue
        if a["status"] == b["status"] and a["body"] == b["body"]:
            stat[0] += 1
            continue
        stat[1] += 1
        lines = [f"## {key}"]
        if a["status"] != b["status"]:
            lines.append(f"  status {a['status']} -> {b['status']}")
        if a["kind"] == "json" and b["kind"] == "json":
            found: list[tuple[str, Any, Any]] = []
            _diff_paths(a["body"], b["body"], "$", found, 20)
            for p, x, y in found:
                lines.append(f"  {p}: {json.dumps(x, ensure_ascii=False)[:200]} -> {json.dumps(y, ensure_ascii=False)[:200]}")
        else:
            xa, xb = str(a["body"]).splitlines(), str(b["body"]).splitlines()
            for i, (x, y) in enumerate(zip(xa, xb)):
                if x != y:
                    lines.append(f"  line {i + 1}: {x[:200]} -> {y[:200]}")
                    break
            if len(xa) != len(xb):
                lines.append(f"  lines {len(xa)} -> {len(xb)}")
        details.append("\n".join(lines))

    report = db_ / f"diff-vs-{da.name}.txt"
    report.write_text("\n".join(details) + "\n", encoding="utf-8")
    total_bad = 0
    print(f"{'group':24} {'same':>7} {'differ':>7} {'missing':>7}")
    for group, (same, bad, missing) in sorted(groups.items()):
        total_bad += bad + missing
        flag = "" if bad + missing == 0 else "  <--"
        print(f"{group:24} {same:7} {bad:7} {missing:7}{flag}")
    print(f"errors: before {ma['errors']}, after {mb['errors']}")
    print("IDENTICAL" if total_bad == 0 else f"DIFFERENT: {total_bad} calls; details (contain patient data) in {report}")
    sys.exit(0 if total_bad == 0 else 1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    cap = sub.add_parser("capture")
    cap.add_argument("--db", required=True)
    cap.add_argument("--out", required=True)
    cap.add_argument("--look", default="")
    cap.add_argument("--sample-from", default="", help="reuse the sample of an earlier capture DIR")
    dif = sub.add_parser("diff")
    dif.add_argument("before")
    dif.add_argument("after")
    args = parser.parse_args()
    capture(args) if args.cmd == "capture" else diff(args)


if __name__ == "__main__":
    main()
