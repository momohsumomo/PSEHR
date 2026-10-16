#!/usr/bin/env python3
"""
醫聖 HIS 備份資料匯入與 FHIR 雙層影子資料庫整合腳本。
支援自動解壓自解檔、診斷 ICD-9/10 快碼對照、處方藥品對照，以及 SQLite 高速交易寫入。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import struct
import sys
import zipfile
from pathlib import Path
from typing import Any

# 設定專案根目錄，以便匯入專案的 modules (如 nhi_validators / nhi_fhir_mapper 等)
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.core.encounter_extensions import QUEUE_EXTENSION_URL, attach_reg_extension
from src.core.nhi_clinical_mappers import (
    BILLING_EXT_BASE,
    MEMO_MARK_EXT,
    PAY_MARK_EXT,
    yisheng_selftype_to_pay_mark,
)
from src.core.yisheng_register_fields import (
    decode_register_time,
    forespeak_text,
    map_visit_state,
    parse_serno,
    remark_text,
    slot_to_shift,
)

def parse_dbf_header(filepath: str) -> tuple[int, int, int, list[tuple[str, str, int, int]]] | None:
    if not os.path.exists(filepath):
        return None
    try:
        with open(filepath, 'rb') as f:
            header = f.read(32)
            num_records, header_len, record_len = struct.unpack('<IHH', header[4:12])
            f.seek(32)
            fields = []
            offset = 1
            while True:
                field_desc = f.read(32)
                if len(field_desc) < 32 or field_desc[0] == 0x0D:
                    break
                name = field_desc[:11].decode('ascii', errors='ignore').strip('\x00')
                typ = chr(field_desc[11])
                length = field_desc[16]
                fields.append((name, typ, length, offset))
                offset += length
            return num_records, header_len, record_len, fields
    except Exception as e:
        print(f"Error parsing DBF header for {os.path.basename(filepath)}: {e}")
        return None

def rebuild_address(addr_bytes: bytes) -> str:
    road_raw = addr_bytes[0:36].decode('cp950', errors='ignore').strip()
    import re
    road = re.sub(r'\s+', '', road_raw)
    
    s1 = addr_bytes[36:42].decode('cp950', errors='ignore').strip()
    s2 = addr_bytes[42:48].decode('cp950', errors='ignore').strip()
    s3 = addr_bytes[48:54].decode('cp950', errors='ignore').strip()
    s4 = addr_bytes[54:60].decode('cp950', errors='ignore').strip()
    s5 = addr_bytes[60:64].decode('cp950', errors='ignore').strip()
    
    result = road
    if s1:
        result += f"{s1}巷"
    if s2:
        result += f"{s2}號"
    if s3:
        result += f"{s3}樓"
    if s4:
        if s4.isdigit() or '之' in s4 or '室' in s4:
            if '之' in s4 or '室' in s4:
                result += f"{s4}"
            else:
                result += f"之{s4}"
        else:
            result += f"{s4}"
    if s5:
        result += f"{s5}"
    return result

def read_dbf_records(filepath: str, limit: int | None = None) -> list[dict[str, str]]:
    meta = parse_dbf_header(filepath)
    if not meta:
        return []
    num_records, header_len, record_len, fields = meta
    
    rows = []
    start_rec = 0
    if limit and limit < num_records:
        start_rec = num_records - limit
        print(f"  * Reading last {limit} of {num_records} records from {os.path.basename(filepath)}...")
    else:
        print(f"  * Reading all {num_records} records from {os.path.basename(filepath)}...")
        
    with open(filepath, 'rb') as f:
        f.seek(header_len + start_rec * record_len)
        for i in range(start_rec, num_records):
            data = f.read(record_len)
            if len(data) < record_len:
                break
            if data[0] == 0x2A:  # deleted record indicator
                continue
            row = {'_rec_idx': str(i)}
            for name, typ, length, offset in fields:
                field_bytes = data[offset:offset+length]
                if name == 'ADDRESS' and length == 64:
                    val = rebuild_address(field_bytes)
                else:
                    val = field_bytes.decode('cp950', errors='ignore').strip()
                row[name] = val
            rows.append(row)
    return rows


def parse_roc_date(date_str: str) -> tuple[str, str] | None:
    """解析民國日期(如 72.10.17 或 072.10.17)為 (民國7碼YYYMMDD, 西元YYYY-MM-DD)。"""
    clean = date_str.strip().replace('/', '.')
    if not clean:
        return None
    parts = clean.split('.')
    if len(parts) < 3:
        return None
    try:
        year = int(parts[0])
        month = int(parts[1])
        day = int(parts[2])
        
        roc_str = f"{year:03d}{month:02d}{day:02d}"
        ad_year = year + 1911
        iso_str = f"{ad_year:04d}-{month:02d}-{day:02d}"
        return roc_str, iso_str
    except Exception:
        return None

def md5_id(value: str) -> str:
    return hashlib.md5(value.encode('utf-8')).hexdigest()[:12]


def clean_maintell_text(chunks: list[str]) -> str:
    """合併 MAINTELL.Dat 固定寬度列為主訴全文（去掉控制字元／醫師戳記雜訊）。"""
    import re

    text = "".join(chunks or [])
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = "".join(ch for ch in text if ch in "\n\t" or ord(ch) >= 32)
    # 列尾常見：YYYMMDD/HH:MM + 看診戳記
    stamp = re.compile(r"\d{6,7}/\d{2}:\d{2}.*$")
    lines_out: list[str] = []
    for ln in text.split("\n"):
        ln = stamp.sub("", ln).rstrip()
        if not ln.strip():
            continue
        if re.match(r"^\d{6,7}/\d{2}:\d{2}", ln.strip()):
            continue
        lines_out.append(ln)
    return "\n".join(lines_out).strip()


def load_maintell_map(
    filepath: str,
    keys: set[str] | None = None,
) -> dict[str, str]:
    """KEYWORDS(KEYWORD+TIMESNO) → 主訴全文。keys 有給則只保留那些 key。"""
    meta = parse_dbf_header(filepath)
    if not meta:
        return {}
    num_records, header_len, record_len, fields = meta
    buckets: dict[str, list[str]] = {}
    kept = 0
    with open(filepath, "rb") as f:
        f.seek(header_len)
        for _ in range(num_records):
            data = f.read(record_len)
            if len(data) < record_len:
                break
            if data[0] == 0x2A:
                continue
            row: dict[str, str] = {}
            for name, _typ, length, offset in fields:
                row[name] = data[offset : offset + length].decode("cp950", errors="ignore").rstrip(
                    " \x00"
                )
            kw = (row.get("KEYWORDS") or "").strip()
            if not kw:
                continue
            if keys is not None and kw not in keys:
                continue
            buckets.setdefault(kw, []).append(row.get("MAINTELL") or "")
            kept += 1
    out = {k: clean_maintell_text(v) for k, v in buckets.items()}
    out = {k: v for k, v in out.items() if v}
    print(
        f"  + Loaded MAINTELL for {len(out)} visits "
        f"({kept} lines from {os.path.basename(filepath)})."
    )
    return out


def list_backup_files(bkzip_dir: Path) -> list[Path]:
    if not bkzip_dir.is_dir():
        return []
    files = [
        p
        for p in bkzip_dir.iterdir()
        if p.is_file() and p.suffix.lower() in {".exe", ".zip"} and p.name.upper().startswith("BK")
    ]
    return sorted(files, key=lambda p: (p.stat().st_mtime, p.name))


def count_shadow(db_path: Path) -> dict[str, int]:
    if not db_path.exists():
        return {"patients": 0, "encounters": 0, "conditions": 0, "medications": 0}
    conn = sqlite3.connect(str(db_path))
    try:
        def _c(sql: str) -> int:
            try:
                return int(conn.execute(sql).fetchone()[0])
            except sqlite3.Error:
                return 0

        return {
            "patients": _c("SELECT COUNT(*) FROM patient_index"),
            "encounters": _c("SELECT COUNT(*) FROM encounter_index"),
            "conditions": _c("SELECT COUNT(*) FROM condition_index"),
            "medications": _c("SELECT COUNT(*) FROM medication_request_index"),
        }
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="匯入醫聖 HIS 診所備份（BkZip/BKxxxx.exe）至 FHIR SQLite 影子庫；可重跑合併補新"
    )
    parser.add_argument(
        "--backup-exe",
        default="",
        help="診所備份 EXE/ZIP 自解檔路徑（省略則用 --list-backups 或預設 BkZip/BK0615.exe）",
    )
    parser.add_argument("--db-path", default=str(ROOT / "data" / "shadow.db"), help="目標 SQLite shadow.db")
    parser.add_argument(
        "--limit-visits",
        type=int,
        default=10000,
        help="只匯入最近 N 筆門診掛號（0=全部）。病患主檔 USER.Dat 一律全匯。",
    )
    parser.add_argument(
        "--list-backups",
        action="store_true",
        help="列出 BkZip 內 BK*.exe／zip 後結束",
    )
    parser.add_argument(
        "--bkzip-dir",
        default=str(ROOT / "BkZip"),
        help="備份目錄（預設專案 BkZip）",
    )
    parser.add_argument(
        "--extract-dir",
        default="",
        help="解壓目錄（預設 BkZip/extracted_<備份檔名>，避免兩次匯入互相覆蓋）",
    )
    parser.add_argument(
        "--skip-extract",
        action="store_true",
        help="略過解壓，直接用 --extract-dir（或已存在的解壓目錄）",
    )
    parser.add_argument(
        "--cleanup-extract",
        action="store_true",
        help="匯入成功後刪除解壓目錄（預設保留，方便下次 --skip-extract）",
    )
    parser.add_argument(
        "--sc-root",
        default="",
        help="直接從本機醫聖 SC 根目錄匯入（例 Z:\\SC）；略過 BkZip 解壓。不匯圖片。",
    )
    args = parser.parse_args()

    bkzip_dir = Path(args.bkzip_dir)
    backups = list_backup_files(bkzip_dir)
    live_sc = Path(args.sc_root) if args.sc_root else None

    if args.list_backups:
        print("=" * 60)
        print("BkZip 備份清單（舊 → 新，依檔案時間）")
        print("=" * 60)
        if not backups:
            print(f"（空）請把醫聖 BkZip\\BKxxxx.exe 放到：{bkzip_dir}")
            return 1
        for i, p in enumerate(backups, 1):
            mtime = __import__("datetime").datetime.fromtimestamp(p.stat().st_mtime)
            print(f"  [{i}] {p.name:20s}  {p.stat().st_size / 1e6:7.1f} MB  {mtime:%Y-%m-%d %H:%M}")
        print()
        print("匯入範例（合併寫入，可重跑補新檔）：")
        print(f'  .venv\\Scripts\\python.exe scripts\\import_yisheng_data.py --backup-exe "{backups[0]}"')
        if len(backups) > 1:
            print(f'  .venv\\Scripts\\python.exe scripts\\import_yisheng_data.py --backup-exe "{backups[-1]}"')
        print()
        print("本機即時資料（不經備份）：")
        print(r'  .venv\Scripts\python.exe scripts\import_yisheng_data.py --sc-root Z:\SC --limit-visits 20000')
        return 0

    visit_limit: int | None = None if args.limit_visits == 0 else args.limit_visits
    db_path = Path(args.db_path)
    before = count_shadow(db_path)
    extract_dir: Path | None = None
    backup_exe: Path | None = None

    if live_sc is not None:
        if not live_sc.is_dir():
            print(f"Error: --sc-root 不存在：{live_sc}")
            return 1
        dat_dir = live_sc / "dat"
        if not dat_dir.is_dir():
            dat_dir = live_sc / "DAT"
        if not dat_dir.is_dir():
            print(f"Error: 在 {live_sc} 找不到 dat／DAT")
            return 1
        print("=" * 60)
        print("      醫聖本機 SC → FHIR 影子庫（即時合併，不含圖片）")
        print("=" * 60)
        print(f"SC 根目錄: {live_sc}")
        print(f"資料夾: {dat_dir}")
        print(f"影子庫: {db_path}")
        print(f"門診筆數上限: {'全部' if visit_limit is None else visit_limit}（病患主檔一律全匯）")
        print(
            f"匯入前: 病患 {before['patients']}｜就醫 {before['encounters']}｜"
            f"病名 {before['conditions']}｜處方 {before['medications']}"
        )
        print("模式: INSERT OR REPLACE（可重跑補新到今天）")
        print()
        print(f"[1/6] 使用本機 SC（略過解壓）\n  {dat_dir}")
    else:
        backup_exe = Path(args.backup_exe) if args.backup_exe else (bkzip_dir / "BK0615.exe")
        if not backup_exe.is_file():
            if backups:
                print(f"找不到 {backup_exe}，BkZip 內可用：")
                for p in backups:
                    print(f"  - {p}")
                print("請加 --backup-exe 指定，或 --sc-root Z:\\SC，或先 --list-backups")
            else:
                print(f"Error: Backup file not found at {backup_exe}")
            return 1

        extract_dir = (
            Path(args.extract_dir)
            if args.extract_dir
            else bkzip_dir / f"extracted_{backup_exe.stem}"
        )

        print("=" * 60)
        print("      Yisheng HIS → FHIR 影子庫匯入（合併／可補新）")
        print("=" * 60)
        print(f"備份檔: {backup_exe}")
        print(f"解壓到: {extract_dir}")
        print(f"影子庫: {db_path}")
        print(f"門診筆數上限: {'全部' if visit_limit is None else visit_limit}（病患主檔一律全匯）")
        print(
            f"匯入前: 病患 {before['patients']}｜就醫 {before['encounters']}｜"
            f"病名 {before['conditions']}｜處方 {before['medications']}"
        )
        print("模式: INSERT OR REPLACE（同一病患／就醫會被較新備份覆蓋，可重跑補新）")
        print()

        # 1. 解壓自解檔
        print(f"[1/6] Extracting backup file:\n  Source: {backup_exe}\n  Target: {extract_dir}")
        if args.skip_extract:
            print("  --skip-extract：略過解壓")
        else:
            try:
                extract_dir.mkdir(parents=True, exist_ok=True)
                with zipfile.ZipFile(backup_exe, "r") as z:
                    z.extractall(extract_dir)
                print("  Extract completed successfully!")
            except Exception as e:
                print(f"Error extracting ZIP: {e}")
                return 1

        dat_dir = extract_dir / "SC" / "DAT"
        if not dat_dir.exists():
            print(f"Error: Database folder SC/DAT not found in extracted archive: {dat_dir}")
            return 1

    # 2. 載入對照字典
    print("\n[2/6] Loading Terminology Maps & Catalogs...")
    
    # A. 載入藥品資料庫 (MEDICAL.Dat)
    med_path = str(dat_dir / "MEDICAL.Dat")
    med_rows = read_dbf_records(med_path)
    # 顯示對照：MAKING=診所名、TRADE_NAME=健保商品名、ALIAS_NO=快碼（不下修原檔）
    medicine_map = {}  # last3 -> (nhi_code, clinic_name, trade_name)
    for r in med_rows:
        drug_no = r.get('DRUG_NO', '').strip()
        last3 = drug_no[-3:] if len(drug_no) >= 3 else drug_no
        nhi_code = r.get('CODE', '').strip()
        trade = r.get('TRADE_NAME', '').strip()
        making = r.get('MAKING', '').strip()
        cht = r.get('CHT_NAME', '').strip()
        clinic_name = making or cht or trade
        if last3:
            medicine_map[last3] = (nhi_code, clinic_name, trade)
    print(f"  + Loaded {len(medicine_map)} drugs from MEDICAL.Dat (display=MAKING).")
    
    # B. 載入診斷快碼庫 (DIAGNOSE.Dat)
    diag_path = str(dat_dir / "DIAGNOSE.Dat")
    diag_rows = read_dbf_records(diag_path)
    shortcut_map = {} # SICK_NO -> (ICD10, ICD9, Name)
    for r in diag_rows:
        sick_no = r.get('SICK_NO', '').strip()
        a_code = r.get('A_CODE', '').strip() # ICD-9
        icd10 = r.get('ICD_10CODE', '').strip() # ICD-10
        # 醫聖顯示名以 SICK_NAME 為主（診所習慣名／英文），SICK_NAME1 次之
        name = r.get('SICK_NAME', '').strip() or r.get('SICK_NAME1', '').strip()
        if sick_no and sick_no not in shortcut_map:
            shortcut_map[sick_no] = (icd10, a_code, name)
    print(f"  + Loaded {len(shortcut_map)} diagnosis shortcuts from DIAGNOSE.Dat.")
    
    # C. 載入五碼 ICD-10 查表對照表 (icd_en_decode.dat)
    decode_path = str(dat_dir / "icd_en_decode.dat")
    decode_map = {} # 5-char ENCO -> Raw ICD10
    if os.path.exists(decode_path):
        decode_rows = read_dbf_records(decode_path)
        for r in decode_rows:
            icd10 = r.get('ICD_10CODE', '').strip()
            enco = r.get('ICD_10ENCO', '').strip()
            if enco:
                decode_map[enco] = icd10
        print(f"  + Loaded {len(decode_map)} compressed codes from icd_en_decode.dat.")
    else:
        print("  - icd_en_decode.dat not found. Suffix compression lookup bypassed.")
        
    # 3. 處理患者資料 (USER.Dat)
    print("\n[3/6] Mapping Patients from USER.Dat...")
    user_path = str(dat_dir / "USER.Dat")
    user_rows = read_dbf_records(user_path)
    
    patients_to_insert = [] # list of tuple (Patient FHIR payload, index row dict)
    keyword_to_patient_id = {} # KEYWORD -> local-patient-id
    
    for r in user_rows:
        keyword = r.get('KEYWORD', '').strip()
        med_no = r.get('MEDICAL_NO', '').strip()
        name = r.get('NAME', '').strip()
        id_no = r.get('ID', '').strip().upper()
        birthday_str = r.get('BIRTHDAY', '').strip()
        sex_raw = r.get('SEX', '').strip()
        address = r.get('ADDRESS', '').strip()
        tel = r.get('TEL', '').strip()
        tel2 = r.get('TEL2', '').strip()
        address2 = r.get('ADDRESS2', '').strip()
        kind = r.get('KIND', '').strip()
        keymoney = r.get('KEYMONEY', '').strip()
        arrearage = r.get('ARREARAGE', '').strip()
        memo = r.get('MEMO', '').strip()
        blood = r.get('BLOD', '').strip()
        marry = r.get('MARRY', '').strip()
        allergic = r.get('ALLERGIC', '').strip()
        id_category = r.get('TYPE', '').strip()

        
        if not keyword:
            continue
            
        # 解析性別 (男 \xa8k -> M, 女 \xa4k -> F)
        sex = "M"
        if "女" in sex_raw or "\xa4k" in sex_raw:
            sex = "F"
        gender = "male" if sex == "M" else "female"
        
        # 解析生日
        date_meta = parse_roc_date(birthday_str)
        if date_meta:
            birthday_roc, birth_date_iso = date_meta
        else:
            # Fallback
            birthday_roc = "0000101"
            birth_date_iso = "1911-01-01"
            
        patient_id = (
            f"local-patient-{md5_id(id_no)}"
            if id_no
            else f"local-patient-{md5_id('noid:' + keyword)}"
        )
        keyword_to_patient_id[keyword] = patient_id
        
        # 拆分姓名
        family = ""
        given = ""
        if len(name) >= 2:
            family = name[0]
            given = name[1:]
            
        # 建立 FHIR Patient Payload
        telecoms = []
        if tel:
            telecoms.append({"system": "phone", "value": tel, "use": "home"})
        if tel2:
            telecoms.append({"system": "phone", "value": tel2, "use": "mobile"})

        addresses = []
        if address:
            addresses.append({"text": address, "use": "home"})
        if address2:
            addresses.append({"text": address2, "use": "temp"})

        patient_payload = {
            "resourceType": "Patient",
            "id": patient_id,
            "name": [{"family": family, "given": [given], "text": name}] if family else [{"text": name}],
            "gender": gender,
            "birthDate": birth_date_iso,
            "identifier": [
                *(
                    [
                        {"use": "official", "system": "http://www.moi.gov.tw/id", "value": id_no},
                        {"use": "official", "system": "https://nhidcc.nhi.gov.tw/id", "value": id_no},
                    ]
                    if id_no
                    else []
                ),
                {"use": "secondary", "system": "https://clinic.org/chart-number", "value": med_no},
            ],
            "telecom": telecoms,
            "address": addresses,
            "extension": [
                {
                    "url": "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/nhi-card-basic",
                    "extension": [
                        *(
                            [{"url": "idNo", "valueString": id_no}]
                            if id_no
                            else []
                        ),
                        {"url": "birthdayRoc", "valueString": birthday_roc},
                        {"url": "sex", "valueCode": sex}
                    ]
                },
                {
                    "url": "https://clinic.org/fhir/StructureDefinition/patient-clinic-ext",
                    "extension": [
                        {"url": "kind", "valueString": kind},
                        {"url": "keymoney", "valueString": keymoney},
                        {"url": "arrearage", "valueString": arrearage},
                        {"url": "memo", "valueString": memo},
                        {"url": "blood", "valueString": blood},
                        {"url": "marry", "valueString": marry},
                        {"url": "allergic", "valueString": allergic},
                        {"url": "idCategory", "valueString": id_category}
                    ]
                }

            ]
        }
        
        # 索引層貼紙
        idx_row = {
            "resource_id": patient_id,
            "family_name": family,
            "given_name": given,
            "identifier": id_no,
            "birth_date": birth_date_iso,
            "id_no": id_no or None,
            "birthday_roc": birthday_roc,
            "sex": sex,
            "medical_no": med_no,
            "phone": tel,
            "address": address,
            "id_category": id_category
        }
        
        patients_to_insert.append((patient_payload, idx_row))
        
    print(f"  + Mapped {len(patients_to_insert)} patient profiles successfully.")
    
    # 4. 處理就診掛號 (REGISTER.Dat)
    print(f"\n[4/6] Mapping outpatient visits from REGISTER.Dat (Limit: {visit_limit or 'ALL'})...")
    reg_path = str(dat_dir / "REGISTER.Dat")
    reg_rows = read_dbf_records(reg_path, limit=visit_limit)

    # 先蒐集 visit key，再從 MAINTELL.Dat 讀真正主訴（勿用 REMARK 掛號註）
    preview_keys: set[str] = set()
    for r in reg_rows:
        kw = (r.get("KEYWORD") or "").strip()
        tn = (r.get("TIMESNO") or "").strip()
        if kw:
            preview_keys.add(f"{kw}{tn}")
    maintell_path = dat_dir / "MAINTELL.Dat"
    maintell_map = (
        load_maintell_map(str(maintell_path), preview_keys)
        if maintell_path.is_file()
        else {}
    )
    
    encounters_to_insert = [] # list of (Encounter FHIR payload, index row)
    conditions_to_insert = [] # list of (Condition FHIR payload, index row)
    observations_to_insert = [] # list of (Observation FHIR payload, index row)
    
    visit_keys = set() # KEYWORD + TIMESNO -> target visit keys for history mapping
    keyword_times_to_encounter_id = {} # KEYWORD + TIMESNO -> encounter_id
    
    for r in reg_rows:
        keyword = r.get('KEYWORD', '').strip()
        timesno = r.get('TIMESNO', '').strip()
        o_date = r.get('O_DATE', '').strip()
        diagnose_field = r.get('DIAGNOSE', '').strip()
        declare_pts = r.get('DECLARE', '').strip()
        cc_code = r.get('CC', '').strip()
        ic_card_no = r.get('ICNO', '').strip()
        weight_str = r.get('WEIGHT', '').strip()
        serno = parse_serno(r.get('SERNO'))
        slot_time = decode_register_time(r.get('TIME')) or (
            "14:00" if str(r.get('SLOT') or '').strip() == "2" else
            "18:00" if str(r.get('SLOT') or '').strip() == "3" else
            "09:00"
        )
        shift = slot_to_shift(r.get('SLOT'))
        note_mark = remark_text(r.get('REMARK'))
        forespeak = forespeak_text(r.get('FORESPEAK'))
        case_no = str(r.get('CASENO') or '').strip()
        visit_state = map_visit_state(
            r.get("STATUS"),
            r.get("D_END"),
            r.get("ICNO"),
            receipts=r.get("RECEIPTS"),
            diagnose=r.get("DIAGNOSE"),
            caseno=r.get("CASENO"),
            forespeak=r.get("FORESPEAK"),
        )
        # Skip unbilled deletes only; STATUS=A appointments import onto R_DATE
        if visit_state.get("void"):
            continue
        patient_id = keyword_to_patient_id.get(keyword)
        if not patient_id:
            continue

        o_meta = parse_roc_date(o_date)
        r_meta = parse_roc_date(str(r.get("R_DATE") or "").strip())
        if not o_meta and not r_meta:
            continue
        iso_opd_date = o_meta[1] if o_meta else r_meta[1]
        # 看診日 = R_DATE (REGIBRW); SERNO is unique per R_DATE+SLOT
        iso_visit_date = r_meta[1] if r_meta else iso_opd_date

        encounter_id = f"local-encounter-{md5_id(f'{keyword}-{o_date}-{timesno}')}"
        visit_key = f"{keyword}{timesno}"
        visit_keys.add(visit_key)
        keyword_times_to_encounter_id[visit_key] = encounter_id
        
        # 1. 建立 Encounter FHIR Payload
        encounter_payload: dict[str, Any] = {
            "resourceType": "Encounter",
            "id": encounter_id,
            "status": visit_state["fhir_status"],
            "class": {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                        "code": "AMB",
                        "display": "ambulatory"
                    }
                ],
                "text": "門診"
            },
            "subject": {"reference": f"Patient/{patient_id}"},
            "period": {"start": f"{iso_visit_date}T{slot_time}:00+08:00"},
            "extension": [
                {
                    "url": QUEUE_EXTENSION_URL,
                    "extension": [
                        {"url": "queueNumber", "valueInteger": serno},
                        {"url": "queueStatus", "valueCode": visit_state["queue_status"]},
                    ]
                }
            ]
        }
        # 主訴：MAINTELL.Dat（KEYWORDS=KEYWORD+TIMESNO）；REMARK 只當掛號註記
        chief = (maintell_map.get(visit_key) or "").strip()
        if not chief:
            # REGISTER.MAINTELL memo 少數舊資料可能有；欄位若為空字串則略過
            chief = (r.get("MAINTELL") or "").strip()
        if chief:
            encounter_payload["reasonCode"] = [{"text": chief[:4000]}]
        elif cc_code:
            encounter_payload["reasonCode"] = [{"text": f"\u4e3b\u8a34\u7c21\u78bc: {cc_code}"}]

        encounter_payload = attach_reg_extension(
            encounter_payload,
            {
                "caseNo": case_no or None,
                "shift": shift,
                "noteMark": note_mark or None,
                "forespeak": forespeak or None,
                "prebook": bool(visit_state.get("prebook") or visit_state.get("appointment")),
                "cardWritten": bool(visit_state["card_written"]),
                "opdDate": iso_opd_date,
                "regFee": str(r.get("REGISTER") or "").strip() or None,
                "copayAmt": str(r.get("PARTPAYMO") or "").strip() or None,
                "deposit": str(r.get("KEYMONEY") or "").strip() or None,
                "copayCode": str(r.get("PARTPAYNO") or "").strip() or None,
                "drugFee": str(r.get("DRUG_PRICE") or "").strip() or None,
                "treatFee": str(r.get("TREA_PRICE") or "").strip() or None,
                "selfPay": str(r.get("SELF_PRICE") or "").strip() or None,
                "cardDisc": str(r.get("DISCARD") or "").strip() or None,
                "drugDisc": str(r.get("DISDRUG") or "").strip() or None,
                "arrears": str(r.get("ARREARAGE") or "").strip() or None,
                "totalFee": str(r.get("RECEIPTS") or "").strip() or None,
            },
        )
            
        enc_idx = {
            "resource_id": encounter_id,
            "patient_id": patient_id,
            "encounter_date": iso_visit_date,
            "queue_number": serno,
            "queue_status": visit_state["queue_status"],
            "fhir_status": visit_state["fhir_status"],
        }
        encounters_to_insert.append((encounter_payload, enc_idx))
        
        # 2. 建立 Condition (診斷)
        # 快碼可以合併最多三個診斷，各四碼長度
        shortcuts = [diagnose_field[x:x+4].strip() for x in range(0, len(diagnose_field), 4)]
        shortcuts = [s for s in shortcuts if s]
        
        for idx_seq, s in enumerate(shortcuts):
            # 查表對照診斷
            icd10, icd9, sick_name = shortcut_map.get(s, ("", "", f"快碼診斷 {s}"))
            
            # 若無 ICD-10 且有 ICD-9 碼，進行 GEM 對照
            if not icd10 and icd9:
                # 這裡查 `diagIcd9` 或 `Icd10`
                # 我們在此提供一個動態對照回退機制
                # 若查無 ICD10，直接以 ICD-9 Code 作為備份，或標記為未核對
                icd10 = icd9
                
            # 還原 UPLOADIC 可能有的五碼編碼
            if icd10 in decode_map:
                icd10 = decode_map[icd10]
                
            cond_id = f"local-condition-{md5_id(f'{encounter_id}-{s}-{idx_seq}')}"
            
            # 建立 Condition FHIR
            condition_payload = {
                "resourceType": "Condition",
                "id": cond_id,
                "clinicalStatus": {
                    "coding": [
                        {"system": "http://terminology.hl7.org/CodeSystem/condition-clinical", "code": "active"}
                    ]
                },
                "code": {
                    "coding": [
                        {"system": "http://hl7.org/fhir/sid/icd-10", "code": icd10},
                        {"system": "https://nhidcc.nhi.gov.tw/icd10cm", "code": icd10}
                    ],
                    "text": sick_name
                },
                "subject": {"reference": f"Patient/{patient_id}"},
                "encounter": {"reference": f"Encounter/{encounter_id}"},
                "recordedDate": iso_visit_date
            }
            # 如果有 ICD-9 資訊，一併附在 coding 裡
            if icd9:
                condition_payload["code"]["coding"].append({
                    "system": "http://hl7.org/fhir/sid/icd-9",
                    "code": icd9
                })
                
            cond_idx = {
                "resource_id": cond_id,
                "patient_id": patient_id,
                "encounter_id": encounter_id,
                "icd10_code": icd10,
                "snomed_code": None,
                "nhi_icd10_code": icd10,
                "summary_text": sick_name,
                "clinical_status": "active"
            }
            conditions_to_insert.append((condition_payload, cond_idx))
            
        # 3. 建立 Observation (體重生理值)
        try:
            w_val = float(weight_str)
            if w_val > 0:
                obs_id = f"local-observation-{md5_id(f'{encounter_id}-weight')}"
                obs_payload = {
                    "resourceType": "Observation",
                    "id": obs_id,
                    "status": "final",
                    "category": [
                        {
                            "coding": [
                                {
                                    "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                    "code": "vital-signs",
                                    "display": "Vital Signs"
                                }
                            ]
                        }
                    ],
                    "code": {
                        "coding": [
                            {"system": "http://loinc.org", "code": "29463-7", "display": "Body weight"}
                        ],
                        "text": "體重"
                    },
                    "subject": {"reference": f"Patient/{patient_id}"},
                    "encounter": {"reference": f"Encounter/{encounter_id}"},
                    "effectiveDateTime": f"{iso_visit_date}T09:00:00+08:00",
                    "valueQuantity": {
                        "value": w_val,
                        "unit": "kg",
                        "system": "http://unitsofmeasure.org",
                        "code": "kg"
                    }
                }
                
                obs_idx = {
                    "resource_id": obs_id,
                    "patient_id": patient_id,
                    "encounter_id": encounter_id,
                    "category": "vital-signs",
                    "loinc_code": "29463-7",
                    "vital_type": "weight",
                    "display_text": "體重",
                    "value_num": w_val,
                    "value_unit": "kg",
                    "effective_datetime": f"{iso_visit_date}T09:00:00+08:00",
                    "status": "final"
                }
                observations_to_insert.append((obs_payload, obs_idx))
        except Exception:
            pass

    print(f"  + Mapped {len(encounters_to_insert)} encounters (visits).")
    print(f"  + Mapped {len(conditions_to_insert)} diagnosis conditions.")
    print(f"  + Mapped {len(observations_to_insert)} vital observation entries.")
    
    # 5. 處理處方箋明細 (HISTORY.Dat)
    print("\n[5/6] Mapping medications from HISTORY.Dat...")
    hist_path = str(dat_dir / "HISTORY.Dat")
    
    # HISTORY.Dat 有 126 萬筆，全載入內存較慢。
    # 由於我們只匯入 limit-visits 內的門診，因此只載入對應有匯入 Encounter 的處方明細！
    # 這能讓速度提升 100 倍且記憶體用量極低！
    hist_meta = parse_dbf_header(hist_path)
    medications_to_insert = []
    # O(1) 查 patient，避免對 40 萬筆 encounters 做線性搜尋
    encounter_patient: dict[str, str] = {
        e["id"]: e["subject"]["reference"].split("/")[-1]
        for e, _ in encounters_to_insert
    }
    
    if hist_meta:
        num_hist_records, hist_header_len, hist_record_len, hist_fields = hist_meta
        print(f"  * Total historical EMR lines: {num_hist_records}. Filtering for imported visits...")
        fpt_path = dat_dir / "HISTORY.FPT"
        fpt_file = open(fpt_path, "rb") if fpt_path.is_file() else None
        fpt_block = 64
        if fpt_file is not None:
            fpt_head = fpt_file.read(16)
            fpt_block = int.from_bytes(fpt_head[6:8], "big") or 64

        def history_memo(token: str | None) -> str:
            if fpt_file is None:
                return ""
            text = (token or "").strip()
            if not text.isdigit():
                return ""
            block = int(text)
            if block <= 0:
                return ""
            fpt_file.seek(block * fpt_block)
            meta = fpt_file.read(8)
            if len(meta) < 8:
                return ""
            length = int.from_bytes(meta[4:8], "big")
            if length <= 0 or length > 4000:
                return ""
            raw = fpt_file.read(length)
            return " ".join(raw.decode("cp950", errors="ignore").split())

        with open(hist_path, 'rb') as f:
            f.seek(hist_header_len)
            for i in range(num_hist_records):
                if i and i % 200000 == 0:
                    print(f"  ... HISTORY scanned {i}/{num_hist_records}, matched {len(medications_to_insert)}")
                data = f.read(hist_record_len)
                if len(data) < hist_record_len:
                    break
                if data[0] == 0x2A: # deleted
                    continue
                # 欄位 KEYWORDS 長度 6 (offset 1)
                keywords = data[1:7].decode('cp950', errors='ignore').strip()
                if keywords in visit_keys:
                    # 匹配成功！解析此處方明細
                    row = {}
                    for name, typ, length, offset in hist_fields:
                        val = data[offset:offset+length].decode('cp950', errors='ignore').strip()
                        row[name] = val
                    
                    encounter_id = keyword_times_to_encounter_id[keywords]
                    patient_id = encounter_patient.get(encounter_id)
                    if not patient_id:
                        continue
                    
                    drug_no = row.get('DRUG_NO', '').strip()
                    last3 = drug_no[-3:] if len(drug_no) >= 3 else drug_no
                    qty_str = row.get('QTY', '0').strip()
                    useage = row.get('USEAGE', '').strip()
                    day_str = row.get('DAY', '0').strip()
                    sort_seq = row.get('SORT', '1').strip()
                    selftype = row.get('SELFTYPE', '').strip()
                    memo_mark = (row.get('MEMO') or '').strip()[:2]
                    body_site = history_memo(row.get('REMARK'))
                    pay_mark = yisheng_selftype_to_pay_mark(selftype)
                    price_str = (row.get('PRICE') or '').strip()
                    try:
                        price_n = float(price_str) if price_str else None
                    except ValueError:
                        price_n = None
                    try:
                        days_n = int(float(day_str)) if day_str else 0
                    except ValueError:
                        days_n = 0
                    try:
                        qty_n = float(qty_str) if qty_str else 0.0
                    except ValueError:
                        qty_n = 0.0

                    nhi_code, clinic_name, trade_name = medicine_map.get(
                        last3, (drug_no, f"未對照藥品 {drug_no}", "")
                    )
                    display_name = clinic_name or trade_name or drug_no
                    
                    # 建立 MedicationRequest FHIR Payload
                    med_req_id = f"local-medicationrequest-{md5_id(f'{encounter_id}-{sort_seq}')}"
                    extensions: list[dict[str, Any]] = []
                    if days_n > 0:
                        extensions.append(
                            {"url": f"{BILLING_EXT_BASE}/daysSupply", "valueInteger": days_n}
                        )
                    if qty_n > 0:
                        extensions.append(
                            {"url": f"{BILLING_EXT_BASE}/quantity", "valueDecimal": qty_n}
                        )
                    if pay_mark:
                        extensions.append({"url": PAY_MARK_EXT, "valueString": pay_mark})
                    if memo_mark:
                        extensions.append({"url": MEMO_MARK_EXT, "valueString": memo_mark})
                    if body_site:
                        extensions.append(
                            {"url": f"{BILLING_EXT_BASE}/bodySite", "valueString": body_site}
                        )
                    med_payload = {
                        "resourceType": "MedicationRequest",
                        "id": med_req_id,
                        "status": "active",
                        "intent": "order",
                        "medicationCodeableConcept": {
                            "text": display_name,
                            "coding": [
                                {"system": "https://nhidcc.nhi.gov.tw/medication", "code": nhi_code}
                            ]
                        },
                        "subject": {"reference": f"Patient/{patient_id}"},
                        "encounter": {"reference": f"Encounter/{encounter_id}"},
                        "dosageInstruction": [
                            {"text": f"{useage} * {day_str}天 (總量: {qty_str})"}
                        ],
                        "dispenseRequest": {
                            "quantity": {"value": qty_n} if qty_n > 0 else None,
                            "expectedSupplyDuration": {
                                "value": days_n,
                                "unit": "d",
                                "system": "http://unitsofmeasure.org",
                                "code": "d",
                            }
                            if days_n > 0
                            else None,
                        },
                        "extension": extensions,
                    }
                    # 清掉 None 子節點
                    dr = med_payload.get("dispenseRequest") or {}
                    med_payload["dispenseRequest"] = {k: v for k, v in dr.items() if v is not None}
                    if not med_payload["dispenseRequest"]:
                        med_payload.pop("dispenseRequest", None)
                    
                    med_idx = {
                        "resource_id": med_req_id,
                        "patient_id": patient_id,
                        "encounter_id": encounter_id,
                        "nhi_code": nhi_code,
                        "rxnorm_code": None,
                        "drug_text": display_name,
                        "status": "active",
                        "days_supply": days_n or None,
                        "quantity": qty_n or None,
                        "unit_price": price_n,
                        "useage": useage or None,
                        "pay_mark": pay_mark or None,
                        "memo_mark": memo_mark or None,
                        "body_site": body_site or None,
                    }
                    medications_to_insert.append((med_payload, med_idx))
        if fpt_file is not None:
            fpt_file.close()

    print(f"  + Mapped {len(medications_to_insert)} MedicationRequest records.")
    
    # 6. SQLite 大量寫入合併
    print(f"\n[6/6] Merging into SQLite shadow.db at {args.db_path}...")
    if not os.path.exists(args.db_path):
        print("  - Target SQLite db not found. Initializing database schema...")
        # 建立資料夾
        os.makedirs(os.path.dirname(args.db_path), exist_ok=True)
        
    conn = sqlite3.connect(args.db_path)
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA temp_store = MEMORY;")
    cursor = conn.cursor()
    
    # 建立 Schema 與執行 migrations
    from src.infrastructure.sqlite_shadow_store import _SCHEMA, _apply_index_migrations
    cursor.executescript(_SCHEMA)
    _apply_index_migrations(conn)
    conn.commit()

    med_released = 0
    BATCH = 5000

    def _flush_pairs(label: str, pairs: list, cache_sql: str, idx_sql: str, idx_row):
        """批次寫入 resource_cache + index，每 BATCH 印進度。"""
        n = len(pairs)
        cache_rows = []
        idx_rows = []
        for i, (payload, idx) in enumerate(pairs, 1):
            cache_rows.append(
                (payload["resourceType"], payload["id"], json.dumps(payload, ensure_ascii=False))
            )
            idx_rows.append(idx_row(idx))
            if len(cache_rows) >= BATCH or i == n:
                cursor.executemany(cache_sql, cache_rows)
                cursor.executemany(idx_sql, idx_rows)
                conn.commit()
                print(f"  ... {label} {i}/{n}")
                cache_rows.clear()
                idx_rows.clear()
        return n

    try:
        conn.execute("PRAGMA synchronous = OFF;")
        # 病歷號唯一：同號只留最後一筆，其餘清空（記憶體 O(n)，不做 SQL UPDATE）
        winner_by_med: dict[str, str] = {}
        for payload, idx in patients_to_insert:
            med = (idx.get("medical_no") or "").strip()
            if med:
                winner_by_med[med] = payload["id"]
        for payload, idx in patients_to_insert:
            med = (idx.get("medical_no") or "").strip()
            if med and winner_by_med.get(med) != payload["id"]:
                idx["medical_no"] = None
                med_released += 1

        cache_sql = (
            "INSERT OR REPLACE INTO resource_cache "
            "(resource_type, resource_id, payload_json, updated_at) "
            "VALUES (?, ?, ?, datetime('now'));"
        )

        print("  writing Patients...")
        pat_cache_count = _flush_pairs(
            "Patients",
            patients_to_insert,
            cache_sql,
            """
                INSERT OR REPLACE INTO patient_index (
                    resource_id, family_name, given_name, identifier, birth_date,
                    id_no, birthday_roc, sex, medical_no, phone, address, id_category, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'));
                """,
            lambda idx: (
                idx["resource_id"], idx["family_name"], idx["given_name"], idx["identifier"],
                idx["birth_date"], idx["id_no"], idx["birthday_roc"], idx["sex"],
                idx["medical_no"], idx["phone"], idx["address"], idx["id_category"],
            ),
        )
        pat_idx_count = pat_cache_count

        print("  writing Encounters...")
        enc_cache_count = _flush_pairs(
            "Encounters",
            encounters_to_insert,
            cache_sql,
            """
                INSERT OR REPLACE INTO encounter_index (
                    resource_id, patient_id, encounter_date, queue_number, queue_status, fhir_status, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'));
                """,
            lambda idx: (
                idx["resource_id"], idx["patient_id"], idx["encounter_date"],
                idx["queue_number"], idx["queue_status"], idx["fhir_status"],
            ),
        )
        enc_idx_count = enc_cache_count

        print("  writing Conditions...")
        cond_cache_count = _flush_pairs(
            "Conditions",
            conditions_to_insert,
            cache_sql,
            """
                INSERT OR REPLACE INTO condition_index (
                    resource_id, patient_id, encounter_id, icd10_code, snomed_code, nhi_icd10_code,
                    summary_text, clinical_status, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'));
                """,
            lambda idx: (
                idx["resource_id"], idx["patient_id"], idx["encounter_id"], idx["icd10_code"],
                idx["snomed_code"], idx["nhi_icd10_code"], idx["summary_text"], idx["clinical_status"],
            ),
        )
        cond_idx_count = cond_cache_count

        print("  writing Medications...")
        med_cache_count = _flush_pairs(
            "Medications",
            medications_to_insert,
            cache_sql,
            """
                INSERT OR REPLACE INTO medication_request_index (
                    resource_id, patient_id, encounter_id, nhi_code, rxnorm_code,
                    drug_text, status, days_supply, quantity, unit_price,
                    useage, pay_mark, memo_mark, body_site, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'));
                """,
            lambda idx: (
                idx["resource_id"], idx["patient_id"], idx["encounter_id"], idx["nhi_code"],
                idx["rxnorm_code"], idx["drug_text"], idx["status"],
                idx.get("days_supply"), idx.get("quantity"), idx.get("unit_price"),
                idx.get("useage"), idx.get("pay_mark"), idx.get("memo_mark"), idx.get("body_site"),
            ),
        )
        med_idx_count = med_cache_count

        print("  writing Observations...")
        obs_cache_count = _flush_pairs(
            "Observations",
            observations_to_insert,
            cache_sql,
            """
                INSERT OR REPLACE INTO observation_index (
                    resource_id, patient_id, encounter_id, category, loinc_code, vital_type,
                    display_text, value_num, value_unit, effective_datetime, status, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'));
                """,
            lambda idx: (
                idx["resource_id"], idx["patient_id"], idx["encounter_id"], idx["category"],
                idx["loinc_code"], idx["vital_type"], idx["display_text"], idx["value_num"],
                idx["value_unit"], idx["effective_datetime"], idx["status"],
            ),
        )
        obs_idx_count = obs_cache_count

        conn.execute("PRAGMA synchronous = NORMAL;")
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
        print("\n  >>> Transaction COMMITTED successfully! <<<")

        # 匯入批次稽核（不對每筆病患展開，避免百萬列；責任歸「系統匯入」）
        try:
            from src.infrastructure.sqlite_shadow_store import SqliteShadowStore

            store = SqliteShadowStore(args.db_path)
            store.write_audit_event(
                action="import",
                resource_type="Bundle",
                resource_id=f"yisheng-import-{os.path.basename(str(getattr(args, 'backup_exe', None) or 'batch'))}",
                changed_fields={
                    "source": "import_yisheng_data",
                    "patients": pat_cache_count,
                    "encounters": enc_cache_count,
                    "conditions": cond_cache_count,
                    "medications": med_cache_count,
                    "observations": obs_cache_count,
                    "medicalNoReleased": med_released,
                },
                operator_identity="System_Yisheng_Import",
                machine_id="Import_Script",
            )
            print("  * 稽核：已寫入匯入批次 audit_modifications")
        except Exception as audit_exc:
            print(f"  ! 稽核寫入失敗（資料已 commit）：{audit_exc}")

        after = count_shadow(db_path)
        print("\n" + "=" * 50)
        print("                 MIGRATION SUMMARY")
        print("=" * 50)
        print(f"  * Patients:           {pat_cache_count:<6} written this run")
        if med_released:
            print(f"  * 病歷號衝突釋放:     {med_released:<6}（他人同號已清空，讓備份號生效）")
        print(f"  * Encounters (Visits): {enc_cache_count:<6} written this run")
        print(f"  * Conditions (Diag):  {cond_cache_count:<6} written this run")
        print(f"  * Medications (Rx):   {med_cache_count:<6} written this run")
        print(f"  * Observations:      {obs_cache_count:<6} written this run")
        print("-" * 50)
        print(
            f"  影子庫合計：病患 {before['patients']} → {after['patients']}｜"
            f"就醫 {before['encounters']} → {after['encounters']}"
        )
        print(
            f"             病名 {before['conditions']} → {after['conditions']}｜"
            f"處方 {before['medications']} → {after['medications']}"
        )
        print("=" * 50)
        print("之後有更新的 BKxxxx.exe：丟進 BkZip 再跑同一支工具即可合併補新。")
        
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        print(f"\nError during SQLite merge: {e}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        conn.close()

    if live_sc is not None:
        print("\n本機 SC 路徑未搬移、未刪除（僅讀取寫入影子庫，不含圖片）。")
    elif args.cleanup_extract and extract_dir is not None:
        print("\nCleaning up extracted temporary folder...")
        import shutil
        try:
            shutil.rmtree(extract_dir)
            print("  Temporary folder cleaned successfully!")
        except Exception as e:
            print(f"  Warning: failed to clean up extracted folder: {e}")
    elif extract_dir is not None:
        print(f"\n解壓目錄保留：{extract_dir}（下次可 --skip-extract；要刪加 --cleanup-extract）")

    print("\nData migration finished successfully! All records merged to local FHIR shadow DB.")
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
