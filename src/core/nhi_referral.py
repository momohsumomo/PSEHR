"""Referral query (Web API) and reply upload (NHI_DownloadB in Z:\\SC).

Query uses the reader 6.0 signature, service type 20.
The documented test id A000000005 needs no card.
Upload calls the 32-bit dll already in the clinic folder. Paths stay ASCII.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from src.core.nhi_cshis6_client import (
    DEFAULT_HOSPITAL_ID,
    Cshis6Client,
    request_json,
    status_hint,
)

QUERY_URL = "https://medws.nhi.gov.tw/IPI/API/IPIE0001/GetRefData_rc6"
TEST_PATIENT_ID = "A000000005"
OPEN_TYPE_CODE = "10"
REPLY_TYPE_CODE = "04"
_ROW = re.compile(r"(\d{16}),([^,]*),(\d{8}),([1-4]),")
_DELETED = "\u522a\u9664"

DLL_PATH = Path(os.environ.get("NHI_EIIAPI_DLL", r"Z:\SC\nhi_eiiapi.dll"))
READER_DLL = Path(os.environ.get("NHI_EIIAPI_READER", r"Z:\SC\reader_A.dll"))
WORK_DIR = Path(os.environ.get("NHI_REFERRAL_WORKDIR", r"C:\Temp\wundadi-ref"))
POWERSHELL32 = Path(r"C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe")
COM_PORT = int(os.environ.get("NHI_REFERRAL_COM_PORT", "1"))


@dataclass
class ReferralSlip:
    serial: str
    hosp_seq: str
    open_date: str
    kind: str
    summary: str
    deleted: bool


def parse_slips(payload: dict[str, Any] | str | None) -> list[ReferralSlip]:
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            return []
    if not isinstance(payload, dict):
        return []
    rows = payload.get("sub") or []
    if isinstance(rows, str):
        try:
            rows = json.loads(rows)
        except json.JSONDecodeError:
            rows = []
    found: list[ReferralSlip] = []
    if not isinstance(rows, list):
        return found
    for row in rows:
        text = ""
        if isinstance(row, dict):
            text = str(row.get("oEtData") or "")
        elif isinstance(row, str):
            text = row
        match = _ROW.search(text.replace(" ", ""))
        if not match:
            continue
        summary = text[: match.start()]
        found.append(
            ReferralSlip(
                serial=match.group(1),
                hosp_seq=match.group(2),
                open_date=match.group(3),
                kind=match.group(4),
                summary=summary,
                deleted=_DELETED in text,
            )
        )
    return found


def choose_incoming(slips: list[ReferralSlip]) -> ReferralSlip | None:
    """Accept-referral rows first, then any live serial. Deleted rows stay out."""
    live = [row for row in slips if not row.deleted and row.serial]
    incoming = [row for row in live if row.kind == "2"]
    pool = incoming or live
    if not pool:
        return None
    return max(pool, key=lambda row: row.open_date)


def _unwrap(payload: Any) -> Any:
    if isinstance(payload, str):
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            return {"raw": payload[:120]}
    return payload


def _sign(client: Cshis6Client) -> dict[str, Any]:
    readers = client.list_pcsc_readers()
    default = client.get_default_pcsc_reader()
    if readers and default not in readers:
        client.set_default_pcsc_reader(readers[0])
    client.ensure_session()
    signed = client.hc_signature("20")
    code = signed.get("statusCode")
    if code not in (None, 0):
        raise RuntimeError(status_hint(int(code)) if isinstance(code, int) else "sign failed")
    if not signed.get("signature") or not signed.get("hcIdNo"):
        raise RuntimeError("\u7c3d\u7ae0\u56de\u50b3\u4e0d\u5b8c\u6574")
    return signed


def query_referrals(id_no: str, *, console_base: str | None = None) -> dict[str, Any]:
    """Ask the platform which slips this person has at this clinic."""
    patient = (id_no or "").strip().upper()
    if not patient:
        return {"ok": False, "reason": "\u7f3a\u8eab\u5206\u8b49", "slips": []}
    hosp = DEFAULT_HOSPITAL_ID
    verify: dict[str, str]
    try:
        client = Cshis6Client(console_base) if console_base else Cshis6Client()
        signed = _sign(client)
        if signed.get("hcIdNo") and str(signed.get("hcIdNo")).upper() != patient:
            patient = str(signed.get("hcIdNo")).upper()
        hosp = str(signed.get("hospitalId") or hosp)
        verify = {
            "signature": str(signed.get("signature") or ""),
            "clientRandom": str(signed.get("clientRandom") or ""),
            "samId": str(signed.get("samId") or ""),
            "hospitalId": hosp,
            "serviceType": "20",
            "hcId": str(signed.get("hcId") or ""),
            "hcIdNo": patient,
        }
    except Exception as exc:
        if patient != TEST_PATIENT_ID:
            return {
                "ok": False,
                "reason": str(exc),
                "slips": [],
                "retry": True,
            }
        verify = {
            "signature": "",
            "clientRandom": "",
            "samId": "",
            "hospitalId": hosp,
            "serviceType": "20",
            "hcId": "",
            "hcIdNo": patient,
        }
    body = {
        "sHospId": hosp,
        "sPatId": patient,
        "sVerify": verify,
        "sType": "",
        "sRefSeq": "",
        "sHospSeq": "",
    }
    try:
        http, payload = request_json(QUERY_URL, method="POST", body=body, timeout_sec=25.0)
    except Exception as exc:
        return {"ok": False, "reason": str(exc), "slips": [], "retry": True}
    payload = _unwrap(payload)
    if not isinstance(payload, dict):
        return {"ok": False, "reason": "http %s" % http, "slips": [], "retry": True}
    code = str(payload.get("RtnCode") or "")
    slips = parse_slips(payload)
    chosen = choose_incoming(slips)
    if code and code != "00":
        return {"ok": False, "reason": "RtnCode %s" % code, "slips": slips, "retry": True}
    return {
        "ok": True,
        "reason": "" if chosen else "\u6c92\u6709\u5f85\u56de\u5fa9\u7684\u8f49\u8a3a\u55ae",
        "slips": slips,
        "chosen": chosen,
        "rtnCode": code,
        "retry": chosen is None,
    }


def _xml_bytes(root_name: str, hosp: str, tel: str, body_name: str, fields: list[tuple[str, str]]) -> bytes:
    lines = [
        '<?xml version="1.0" encoding="Big5"?>',
        "<%s>" % root_name,
        "  <hospid>%s</hospid>" % hosp,
    ]
    if tel:
        lines.append("  <hosptel>%s</hosptel>" % tel)
    lines.append("  <%s>" % body_name)
    for key, value in fields:
        text = (value or "").replace("&", " ").replace("<", " ").replace(">", " ")
        lines.append("    <%s>%s</%s>" % (key, text, key))
    lines.append("  </%s>" % body_name)
    lines.append("</%s>" % root_name)
    return "\n".join(lines).encode("big5", errors="replace")


def build_reply_xml(
    *,
    serial: str,
    patient_id: str,
    doctor_id: str,
    reply_date: str,
    diagnosis: str,
    purpose: str = "3",
    dept: str = "11",
    tel: str = "06-2882555",
    note: str = "",
    hosp: str = DEFAULT_HOSPITAL_ID,
) -> bytes:
    return _xml_bytes(
        "etbhosp",
        hosp,
        tel,
        "etbdata",
        [
            ("h1", serial),
            ("h2", patient_id),
            ("h3", doctor_id),
            ("h5", reply_date),
            ("h6", purpose),
            ("h7", dept),
            ("h8", diagnosis),
            ("h11", note or "\u9580\u8a3a\u56de\u8986"),
        ],
    )


def build_open_test_xml(*, on: date | None = None, hosp: str = DEFAULT_HOSPITAL_ID) -> bytes:
    """Official sample: patient A000000000, doctor A000000001, same-day open date."""
    day = on or date.today()
    opened = day.strftime("%Y%m%d")
    # three months, clamped to a simple +90 days via timedelta
    from datetime import timedelta

    valid = (day + timedelta(days=90)).strftime("%Y%m%d")
    return _xml_bytes(
        "etahosp",
        hosp,
        "",
        "etadata",
        [
            ("h1", "A000000000"),
            ("h2", "\u6e2c\u8a66\u6c11\u773e"),
            ("h6", "0988888888"),
            ("h9", "J188"),
            ("h18", "2"),
            ("h20", "A000000001"),
            ("h22", "0977777777"),
            ("h23", opened),
            ("h28", hosp),
            ("h29", "11"),
            ("h33", "\u4ea4\u73ed\u6ce8\u610f\u4e8b\u9805"),
            ("h34", valid),
        ],
    )


def upload_file(xml_bytes: bytes, *, type_code: str, name: str, port: int | None = None) -> dict[str, Any]:
    """Hand the file to NHI_DownloadB. Return code 0 means the bureau accepted the file."""
    if not DLL_PATH.exists():
        return {"ok": False, "reason": "\u627e\u4e0d\u5230\u4e0a\u50b3\u7a0b\u5f0f %s" % DLL_PATH}
    if not READER_DLL.exists():
        return {"ok": False, "reason": "\u627e\u4e0d\u5230\u8b80\u5361\u7a0b\u5f0f %s" % READER_DLL}
    if not POWERSHELL32.exists():
        return {"ok": False, "reason": "\u627e\u4e0d\u5230 32 \u4f4d\u5143 PowerShell"}
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    target = WORK_DIR / name
    target.write_bytes(xml_bytes)
    use_port = COM_PORT if port is None else port
    script = WORK_DIR / "call-download.ps1"
    script.write_text(
        "\n".join(
            [
                "$ErrorActionPreference = 'Stop'",
                "Set-Location 'Z:\\SC'",
                "$env:PATH = 'Z:\\SC;' + $env:PATH",
                "Add-Type -TypeDefinition @'",
                "using System.Runtime.InteropServices;",
                "using System.Text;",
                "public class RefUp {",
                '  [DllImport(@"%s", CallingConvention=CallingConvention.StdCall, CharSet=CharSet.Ansi)]' % str(DLL_PATH),
                "  public static extern int NHI_DownloadB(int port, string reader, string file, string typeCode, StringBuilder localId, StringBuilder nhiId);",
                "}",
                "'@",
                "$local = New-Object System.Text.StringBuilder 64",
                "$nhi = New-Object System.Text.StringBuilder 64",
                "$code = [RefUp]::NHI_DownloadB(%s, '%s', '%s', '%s', $local, $nhi)"
                % (use_port, str(READER_DLL), str(target), type_code),
                "Write-Output ('code=' + $code)",
                "Write-Output ('local=' + $local.ToString())",
                "Write-Output ('nhi=' + $nhi.ToString())",
            ]
        ),
        encoding="ascii",
    )
    try:
        proc = subprocess.run(
            [
                str(POWERSHELL32),
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(script),
            ],
            capture_output=True,
            timeout=70,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "reason": "\u4e0a\u50b3\u7b49\u5f85\u8d85\u904e 70 \u79d2", "path": str(target)}
    text = (proc.stdout or b"").decode("utf-8", errors="replace")
    err = (proc.stderr or b"").decode("utf-8", errors="replace").strip()
    code = None
    local_id = ""
    nhi_id = ""
    for line in text.splitlines():
        if line.startswith("code="):
            try:
                code = int(line.split("=", 1)[1].strip())
            except ValueError:
                code = None
        elif line.startswith("local="):
            local_id = line.split("=", 1)[1].strip()
        elif line.startswith("nhi="):
            nhi_id = line.split("=", 1)[1].strip()
    if code == 0:
        return {"ok": True, "code": 0, "localId": local_id, "nhiId": nhi_id, "path": str(target)}
    reason = err or text.strip() or "exit %s" % proc.returncode
    return {
        "ok": False,
        "code": code,
        "reason": reason[:400],
        "localId": local_id,
        "nhiId": nhi_id,
        "path": str(target),
    }
