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
# serial, self-seq, open date, kind, type name, hosp id, hosp name, status, contact, valid
_FULL = re.compile(
    r"(\d{16}),([^,]*),(\d{8}),([1-4]),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),(\d{0,8})"
)
_SHORT = re.compile(r"(\d{16}),([^,]*),(\d{8}),([1-4]),")
_ACCEPT_KINDS = {"2", "4"}
_DELETED = "\u522a\u9664"

DLL_PATH = Path(os.environ.get("NHI_EIIAPI_DLL", r"Z:\SC\nhi_eiiapi.dll"))
WORK_DIR = Path(os.environ.get("NHI_REFERRAL_WORKDIR", r"C:\Temp\wundadi-ref"))
POWERSHELL32 = Path(r"C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe")
COM_PORT = int(os.environ.get("NHI_REFERRAL_COM_PORT", "0"))
# IPR_ETA_API / IPR_ETB_API: NHI_DownloadB(port, Reader.dll, file, type, localId, nhiId).
# Type 10 opens a referral, type 04 replies. Return 0 means the bureau took the file.
# The second argument is the card-reader Reader.dll, never CsHis.dll.
COMPAT_READER_CANDIDATES = (
    Path(r"C:\Reader.dll"),
    Path(r"C:\Windows\SysWOW64\Reader.dll"),
    Path(r"C:\Windows\System32\Reader.dll"),
    Path(r"Z:\SC\reader_A.dll"),
    Path(r"Z:\SC\reader_B.dll"),
    Path(r"Z:\SC\reader_C.dll"),
    Path(r"Z:\SC\reader_D.dll"),
)
_NEED_READER = (
    "\u56de\u5fa9\u8aaa\u660e\u66f8\u7684\u4e0a\u50b3\u51fd\u5f0f\u662f NHI_DownloadB\uff0c"
    "\u7b2c\u4e8c\u500b\u53c3\u6578\u8981\u8b80\u5361\u6a5f Reader.dll\u3002"
    "\u9019\u53f0\u627e\u4e0d\u5230\u9019\u652f\u8b80\u5361\u6a5f\u51fd\u5f0f\u5eab\uff0c\u6c92\u6709\u9001\u51fa\u3002"
)


def _exports_open_com(path: Path) -> bool:
    try:
        return b"OpenComPort" in path.read_bytes()
    except OSError:
        return False


def compatibility_reader() -> Path | None:
    override = (os.environ.get("NHI_EIIAPI_READER") or "").strip()
    if override:
        path = Path(override)
        return path if path.is_file() else None
    for path in COMPAT_READER_CANDIDATES:
        if path.is_file():
            return path
    return None


@dataclass
class ReferralSlip:
    serial: str
    hosp_seq: str
    open_date: str
    kind: str
    summary: str
    deleted: bool
    hosp_id: str = ""
    hosp_name: str = ""
    status: str = ""
    contact: str = ""
    valid_until: str = ""
    type_name: str = ""


def bureau_already_accepted(slip: ReferralSlip) -> bool:
    """The platform already treats this notice as accepted or answered."""
    status = slip.status or ""
    if "\u5df2\u53d7\u7406" in status or "\u5df2\u56de\u5fa9" in status or "\u5df2\u56de\u590d" in status:
        return True
    return (slip.contact or "") in {"A", "B", "C"}


def needs_accept_prompt(slip: ReferralSlip, accepted: set[str] | None = None) -> bool:
    """Ask only for a referral sent to us that this clinic has not accepted."""
    if slip.deleted or not slip.serial or slip.kind not in _ACCEPT_KINDS:
        return False
    if slip.serial in (accepted or set()):
        return False
    if bureau_already_accepted(slip):
        return False
    return True


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
        flat = re.sub(r"\s+", "", text)
        match = _FULL.search(flat) or _SHORT.search(flat)
        if not match:
            continue
        summary = flat[: match.start()].rstrip(",").rstrip("\u3002")
        groups = match.groups()
        found.append(
            ReferralSlip(
                serial=groups[0],
                hosp_seq=groups[1],
                open_date=groups[2],
                kind=groups[3],
                summary=summary,
                deleted=_DELETED in flat,
                type_name=groups[4] if len(groups) > 4 else "",
                hosp_id=groups[5] if len(groups) > 5 else "",
                hosp_name=groups[6] if len(groups) > 6 else "",
                status=groups[7] if len(groups) > 7 else "",
                contact=groups[8] if len(groups) > 8 else "",
                valid_until=groups[9] if len(groups) > 9 else "",
            )
        )
    return found


def choose_incoming(slips: list[ReferralSlip], accepted: set[str] | None = None) -> ReferralSlip | None:
    """The newest referral sent to us that this clinic has not accepted yet."""
    pool = [row for row in slips if needs_accept_prompt(row, accepted)]
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
    """Desk 6.0 signs. This server does not open a reader."""
    del client
    raise RuntimeError("NEED_DESK_SIGN")


def query_referrals(id_no: str, *, desk_sign: dict[str, Any] | None = None, console_base: str | None = None) -> dict[str, Any]:
    """Ask the platform which slips this person has. The desk PC signs; this server does not touch a reader."""
    del console_base
    patient = (id_no or "").strip().upper()
    if not patient:
        return {"ok": False, "reason": "\u7f3a\u8eab\u5206\u8b49", "slips": []}
    from src.core.nhi_seq_bridge import posted_sign

    try:
        signed = posted_sign(desk_sign)
    except RuntimeError:
        return {"ok": False, "reason": "NEED_DESK_SIGN", "slips": [], "retry": True}
    card_id = str(signed.get("hcIdNo") or "").strip().upper()
    if card_id:
        patient = card_id
    hosp = str(signed.get("hospitalId") or "").strip()
    verify = {
        "signature": str(signed.get("signature") or ""),
        "clientRandom": str(signed.get("clientRandom") or ""),
        "samId": str(signed.get("samId") or ""),
        "hospitalId": hosp,
        "serviceType": "20",
        "hcId": str(signed.get("hcId") or ""),
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


def _xml_text(value: str) -> str:
    from src.core.plain_text import plain_text

    return (
        plain_text(value or "")
        .replace("&", "\uff06")
        .replace("<", "\uff1c")
        .replace(">", "\uff1e")
        .replace("'", "\u2019")
        .replace('"', "\u201d")
    )


def _xml_bytes(
    root_name: str,
    hosp: str,
    tel: str,
    body_name: str,
    fields: list[tuple[str, str]],
    header: list[tuple[str, str]] | None = None,
) -> bytes:
    lines = [
        '<?xml version="1.0" encoding="Big5"?>',
        "<%s>" % root_name,
        "  <hospid>%s</hospid>" % hosp,
    ]
    if tel:
        lines.append("  <hosptel>%s</hosptel>" % _xml_text(tel))
    for key, value in header or []:
        if value:
            lines.append("  <%s>%s</%s>" % (key, _xml_text(value), key))
    lines.append("  <%s>" % body_name)
    for key, value in fields:
        if not value:
            continue
        lines.append("    <%s>%s</%s>" % (key, _xml_text(value), key))
    lines.append("  </%s>" % body_name)
    lines.append("</%s>" % root_name)
    return "\n".join(lines).encode("big5", errors="replace")


def _icd_code(text: str) -> str:
    token = (text or "").strip().split()
    raw = token[0] if token else ""
    code = raw.replace(".", "").replace(" ", "").upper()[:9]
    if len(code) < 3 or not code[0].isalpha() or not code[1].isdigit():
        return ""
    return code


def _ymd(text: str, fallback: date | None = None) -> str:
    raw = (text or "").strip()
    if re.fullmatch(r"\d{8}", raw):
        return raw
    iso = re.match(r"(\d{4})-(\d{2})-(\d{2})", raw)
    if iso:
        return "%s%s%s" % (iso.group(1), iso.group(2), iso.group(3))
    roc = re.match(r"(\d{1,3})[./](\d{1,2})[./](\d{1,2})", raw)
    if roc:
        year = int(roc.group(1))
        if year < 1911:
            year += 1911
        return "%04d%02d%02d" % (year, int(roc.group(2)), int(roc.group(3)))
    day = fallback or date.today()
    return day.strftime("%Y%m%d")


def build_reply_xml(
    *,
    serial: str,
    patient_id: str,
    doctor_id: str,
    reply_date: str,
    diagnosis: str,
    purpose: str = "4",
    dept: str = "11",
    tel: str = "",
    email: str = "",
    drugs: str = "",
    aux: str = "",
    note: str = "",
    hosp: str = DEFAULT_HOSPITAL_ID,
) -> bytes:
    """ETB reply. One record is one etbdata. h8/h9/h10 stay even when blank."""
    situation = (purpose or "4").strip()[:1] or "4"
    remark = dept if situation in {"2", "3", "4", "9"} else ""
    filled = "\u7121"
    return _xml_bytes(
        "etbhosp",
        hosp,
        tel,
        "etbdata",
        [
            ("h1", serial),
            ("h2", patient_id),
            ("h3", doctor_id),
            ("h4", dept),
            ("h5", _ymd(reply_date)),
            ("h6", situation),
            ("h7", remark),
            ("h8", _icd_code(diagnosis)),
            ("h9", (drugs or "").strip() or filled),
            ("h10", (aux or "").strip() or filled),
            ("h11", note),
        ],
        header=[("hospemail", email)],
    )


def build_open_xml(
    *,
    patient_id: str,
    patient_name: str,
    phone: str,
    summary: str,
    diagnosis: str,
    purpose: str,
    doctor_id: str,
    doctor_phone: str,
    opened_on: str,
    dest_code: str,
    dest_dept: str,
    valid_until: str,
    hosp: str = DEFAULT_HOSPITAL_ID,
    address: str = "",
    sex: str = "",
    birth: str = "",
    contact: str = "",
    patient_address: str = "",
    exam: str = "",
    allergy: str = "",
    treat: str = "",
    purpose_note: str = "",
    dest_doctor: str = "",
    dest_address: str = "",
    dest_phone: str = "",
    handoff: str = "",
    our_dept: str = "11",
    fax: str = "",
    email: str = "",
) -> bytes:
    """ETA open slip. Required tags follow the 2025/8/5 batch format."""
    sex_code = "1" if sex.strip() in {"1", "M", "\u7537"} else "2" if sex.strip() in {"2", "F", "\u5973"} else ""
    return _xml_bytes(
        "etahosp",
        hosp,
        "",
        "etadata",
        [
            ("h1", patient_id),
            ("h2", patient_name),
            ("h3", sex_code),
            ("h4", _ymd(birth) if birth else ""),
            ("h5", contact),
            ("h6", phone),
            ("h7", patient_address),
            ("h8", summary),
            ("h9", _icd_code(diagnosis)),
            ("h13", exam),
            ("h15", treat),
            ("h17", allergy),
            ("h18", (purpose or "4").strip()[:1] or "4"),
            ("h19", purpose_note if (purpose or "").strip()[:1] == "6" else ""),
            ("h20", doctor_id),
            ("h21", our_dept),
            ("h22", doctor_phone),
            ("h23", _ymd(opened_on)),
            ("h28", dest_code),
            ("h29", dest_dept),
            ("h30", dest_doctor),
            ("h31", dest_address),
            ("h32", dest_phone),
            ("h33", handoff),
            ("h34", _ymd(valid_until)),
        ],
        header=[("hospaddr", address), ("hospfax", fax), ("hospemail", email)],
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
    """NHI_DownloadB, as written in the referral batch-upload API note."""
    if not DLL_PATH.exists():
        return {"ok": False, "reason": "\u627e\u4e0d\u5230\u4e0a\u50b3\u7a0b\u5f0f %s" % DLL_PATH}
    reader = compatibility_reader()
    if reader is None or not _exports_open_com(reader):
        return {"ok": False, "reason": _NEED_READER}
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
                % (use_port, str(reader), str(target), type_code),
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
    if code == 5010:
        reason = (
            "\u4e0a\u50b3\u51fd\u5f0f\u56de 5010\u3002XML \u5df2\u7167\u6279\u6b21\u683c\u5f0f\u7d44\u597d\u4e26\u4ea4\u7d66 NHI_DownloadB\uff0c"
            "\u9019\u6b21\u6c92\u6709\u88ab\u6536\u4e0b\u3002"
        )
    elif code is not None:
        reason = "\u4e0a\u50b3\u51fd\u5f0f\u56de %s\u3002\u4f5c\u696d\u8fa8\u8b58\u78bc\u662f\u7a7a\u7684\uff0c\u6a94\u6848\u6c92\u6709\u4ea4\u51fa\u53bb\u3002" % code
    else:
        reason = err or text.strip() or "exit %s" % proc.returncode
    return {
        "ok": False,
        "code": code,
        "reason": reason[:400],
        "localId": local_id,
        "nhiId": nhi_id,
        "path": str(target),
    }
