import os
import sys

workspace = r"c:\Users\Michael\Desktop\FHIR完整專案開發"
sys.path.insert(0, workspace)

from scripts.import_yisheng_data import parse_dbf_header, read_dbf_records

dat_dir = os.path.join(workspace, "BkZip", "extracted", "SC", "DAT")
if not os.path.exists(dat_dir):
    # If not extracted yet, let's extract it or use the backup path
    import zipfile
    backup_exe = os.path.join(workspace, "BkZip", "BK0615.exe")
    extract_dir = os.path.join(workspace, "BkZip", "extracted")
    print("Extracting...")
    with zipfile.ZipFile(backup_exe, 'r') as z:
        z.extractall(extract_dir)

user_path = os.path.join(dat_dir, "USER.Dat")
meta = parse_dbf_header(user_path)
if meta:
    num_records, header_len, record_len, fields = meta
    print(f"USER.Dat meta: records={num_records}, record_len={record_len}")
    print("Fields:")
    for field in fields:
        print(f"  {field[0]} ({field[1]}, len={field[2]}, offset={field[3]})")
    
    records = read_dbf_records(user_path, limit=5)
    print("\nSamples:")
    for r in records:
        print(r)
else:
    print("Failed to parse USER.Dat")
