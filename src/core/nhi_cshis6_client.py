"""健保署讀卡機控制軟體 6.0 主控台（HTTPS :5066）官方路徑。

不讀 C:\\NHI；雲端 SAM 用 POST /api/settings/v1/CloudSam 匯入 .SAM 檔。
禁止把 SAM 檔內容寫進 log。
"""

from __future__ import annotations

import json
import socket
import ssl
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_CONSOLE_BASE = "https://localhost:5066"
DEFAULT_HOSPITAL_ID = "3521013662"

STATUS_HINTS: dict[int, str] = {
    0: "成功",
    1000: "控制軟體尚未初始化",
    1001: "控制軟體已初始化",
    1002: "查無指定裝置",
    1003: "正式卡與測試卡不能混用",
    1100: "沒有預設 PCSC 讀卡機",
    1101: "目前沒有使用 PCSC 讀卡機",
    1102: "未置入卡片",
    1103: "切換卡片應用程式失敗（這槽多半不是你要的卡別）",
    1119: "PC/SC 其他錯誤",
    1200: "無法載入 Reader.dll（實體 COM 讀卡機路徑，晶片機可忽略）",
    1201: "開啟 Comport 失敗",
    1302: "醫事機構已超過合約起迄",
    1303: "醫事機構已停權",
    1304: "SAM 已註銷",
    1400: "醫事人員卡進入模式一失敗",
    1403: "醫事人員卡不支援此功能",
    1410: "醫事人員卡驗證 PIN 失敗",
    1500: "健保卡進入模式一失敗",
    1502: "健保卡進入模式三失敗",
    1600: "預設讀卡機名稱在 PC/SC 清單裡找不到",
    1601: "自動偵測預設讀卡機失敗",
    1700: "設定類操作失敗",
    3201: "這張卡超過有效期限",
    3213: "這張卡的就醫可用次數是零",
}


def insecure_https_context() -> ssl.SSLContext:
    """主控台自簽 cshis6.crt，本機探測不驗證鏈。"""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def parse_sam_ids_from_filename(path: Path) -> tuple[str, str]:
    """檔名 機構碼10碼 + SAM編號12碼，例如 0000000000001000000001.SAM。"""
    stem = path.stem.strip()
    if len(stem) < 22:
        raise ValueError(f"SAM 檔名應為 22 碼（機構10+SAM12），實際：{path.name}")
    hospital_id = stem[:10]
    sam_id = stem[10:22]
    if not hospital_id.isdigit() or not sam_id.isdigit():
        raise ValueError(f"SAM 檔名不是數字機構碼+編號：{path.name}")
    return sam_id, hospital_id


def status_hint(code: int | None) -> str:
    if code is None:
        return "無狀態碼"
    return STATUS_HINTS.get(int(code), f"狀態碼 {code}")


def _ssl_context_for(url: str) -> ssl.SSLContext | None:
    return insecure_https_context() if url.lower().startswith("https://") else None


def request_json(
    url: str,
    *,
    method: str = "GET",
    body: dict[str, Any] | None = None,
    timeout_sec: float = 8.0,
) -> tuple[int, Any]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Accept": "application/json", "Content-Type": "application/json"},
    )
    ctx = _ssl_context_for(url)
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec, context=ctx) as resp:
            raw = resp.read().decode("utf-8") or "{}"
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = {"raw": raw}
            return int(resp.status), parsed
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        try:
            parsed = json.loads(raw) if raw else {"detail": str(exc)}
        except json.JSONDecodeError:
            parsed = {"detail": raw or str(exc)}
        return int(exc.code), parsed


@dataclass
class Cshis6Client:
    base_url: str = DEFAULT_CONSOLE_BASE

    @property
    def base(self) -> str:
        return self.base_url.rstrip("/")

    def call(
        self,
        path: str,
        *,
        method: str = "GET",
        body: dict[str, Any] | None = None,
        timeout_sec: float = 8.0,
    ) -> tuple[int, Any]:
        return request_json(
            f"{self.base}{path}",
            method=method,
            body=body,
            timeout_sec=timeout_sec,
        )

    def call_safe(
        self,
        path: str,
        *,
        method: str = "GET",
        body: dict[str, Any] | None = None,
        timeout_sec: float = 8.0,
    ) -> dict[str, Any]:
        """初始化 SOP 用：逾時／斷線不丟例外。1102 也算讀卡機有反應。"""
        try:
            http, data = self.call(path, method=method, body=body, timeout_sec=timeout_sec)
            payload = data if isinstance(data, dict) else {"value": data}
            return {
                "timedOut": False,
                "httpStatus": http,
                "data": payload,
                "error": None,
            }
        except (TimeoutError, socket.timeout) as exc:
            return {
                "timedOut": True,
                "httpStatus": None,
                "data": {},
                "error": f"逾時：{exc}",
            }
        except urllib.error.URLError as exc:
            reason = exc.reason if getattr(exc, "reason", None) is not None else exc
            timed = isinstance(reason, (TimeoutError, socket.timeout)) or "timed out" in str(reason).lower()
            return {
                "timedOut": timed,
                "httpStatus": None,
                "data": {},
                "error": str(reason),
            }
        except OSError as exc:
            timed = "timed out" in str(exc).lower()
            return {
                "timedOut": timed,
                "httpStatus": None,
                "data": {},
                "error": str(exc),
            }
        except Exception as exc:
            return {
                "timedOut": False,
                "httpStatus": None,
                "data": {},
                "error": str(exc),
            }

    def _card_api_safe(self, path: str, timeout_sec: float) -> dict[str, Any]:
        result = self.call_safe(path, timeout_sec=timeout_sec)
        if result["timedOut"]:
            return {"timedOut": True, "statusCode": 1119, "error": result["error"] or "逾時無回應"}
        data = result["data"] if isinstance(result["data"], dict) else {}
        if result["error"] and not data:
            return {"timedOut": False, "statusCode": 1119, "error": result["error"]}
        data = dict(data)
        data["timedOut"] = False
        return data

    def hc_basic_safe(self, timeout_sec: float = 5.0) -> dict[str, Any]:
        return self._card_api_safe("/api/hc/v1/Basic", timeout_sec)

    def hpc_basic_safe(self, timeout_sec: float = 5.0) -> dict[str, Any]:
        return self._card_api_safe("/api/hpc/v1/Basic", timeout_sec)

    def set_default_pcsc_reader_safe(self, reader_name: str, timeout_sec: float = 4.0) -> dict[str, Any]:
        result = self.call_safe(
            "/api/settings/v1/PcscReader/Default",
            method="POST",
            body={"readerName": reader_name},
            timeout_sec=timeout_sec,
        )
        if result["timedOut"]:
            return {"timedOut": True, "statusCode": 1119, "error": result["error"] or "指定讀卡機逾時"}
        data = result["data"] if isinstance(result["data"], dict) else {}
        data = dict(data)
        data["timedOut"] = False
        if result["error"] and data.get("statusCode") is None:
            data["statusCode"] = 1119
            data["error"] = result["error"]
        return data

    def list_pcsc_readers_safe(self, timeout_sec: float = 5.0) -> dict[str, Any]:
        result = self.call_safe("/api/settings/v1/PcscReader/Readers", timeout_sec=timeout_sec)
        if result["timedOut"]:
            return {"timedOut": True, "readers": [], "error": result["error"] or "PC/SC 清單逾時"}
        data = result["data"] if isinstance(result["data"], dict) else {}
        raw = data.get("readers") or data.get("Readers") or []
        readers = [str(x) for x in raw] if isinstance(raw, list) else []
        return {"timedOut": False, "readers": readers, "error": result["error"], "statusCode": data.get("statusCode")}

    def probe(self) -> bool:
        try:
            status, _ = self.call("/api/common/v1/Version", timeout_sec=2.0)
            return status < 500
        except Exception:
            return False

    def status(self) -> dict[str, Any]:
        _, data = self.call("/api/common/v1/Status", timeout_sec=3.0)
        return data if isinstance(data, dict) else {}

    def list_cloud_sam(self) -> list[dict[str, Any]]:
        _, data = self.call("/api/settings/v1/CloudSam", timeout_sec=5.0)
        if not isinstance(data, dict):
            return []
        sams = data.get("sams") or []
        return sams if isinstance(sams, list) else []

    def import_cloud_sam_file(self, sam_path: Path) -> dict[str, Any]:
        sam_id, hospital_id = parse_sam_ids_from_filename(sam_path)
        raw = sam_path.read_bytes()
        if not raw:
            raise ValueError("SAM 檔是空的")
        import base64

        payload = {
            "samId": sam_id,
            "hospitalId": hospital_id,
            "cloudSamContext": base64.b64encode(raw).decode("ascii"),
        }
        _http, data = self.call(
            "/api/settings/v1/CloudSam",
            method="POST",
            body=payload,
            timeout_sec=25.0,
        )
        if not isinstance(data, dict):
            raise RuntimeError("匯入雲端 SAM 回傳不是 JSON")
        return data

    def initial(self, name: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if name:
            body["name"] = name
        _, data = self.call(
            "/api/common/v1/Initial",
            method="POST",
            body=body or None,
            timeout_sec=20.0,
        )
        return data if isinstance(data, dict) else {}

    def verify_sam(self) -> dict[str, Any]:
        _, data = self.call("/api/sam/v1/Verification", method="POST", timeout_sec=20.0)
        return data if isinstance(data, dict) else {}

    def hc_basic(self) -> dict[str, Any]:
        _, data = self.call("/api/hc/v1/Basic", timeout_sec=12.0)
        return data if isinstance(data, dict) else {}

    def verify_virtual_hc(self, token: str) -> dict[str, Any]:
        _, data = self.call(
            "/api/hc/v1/Verification/VirtualHc",
            method="POST",
            body={"token": token},
            timeout_sec=20.0,
        )
        return data if isinstance(data, dict) else {}

    def hpc_basic(self) -> dict[str, Any]:
        _, data = self.call("/api/hpc/v1/Basic", timeout_sec=12.0)
        return data if isinstance(data, dict) else {}

    def sam_basic(self) -> dict[str, Any]:
        _, data = self.call("/api/sam/v1/Basic", timeout_sec=8.0)
        return data if isinstance(data, dict) else {}

    def ensure_session(self) -> dict[str, Any]:
        """匯入過的雲端 SAM：未初始化就 Initial，SAM=1 就向中心驗證。不需要醫事人員卡。"""
        st = self.status()
        if is_initialized(st) and nested_status(st, "sam") == 2:
            return st
        readers = self.list_pcsc_readers()
        default = self.get_default_pcsc_reader()
        if readers and default not in readers:
            # Saved name can point at a slot index that Windows renumbered.
            # Any live reader is enough to initialize cloud SAM.
            self.set_default_pcsc_reader(readers[0])
        sams = self.list_cloud_sam()
        sam_id = None
        if sams and isinstance(sams[0], dict):
            sam_id = str(sams[0].get("samId") or "") or None
        if not is_initialized(st):
            self.initial(sam_id)
            st = self.status()
        if nested_status(st, "sam") == 1:
            self.verify_sam()
            st = self.status()
        return st

    def list_pcsc_readers(self) -> list[str]:
        _, data = self.call("/api/settings/v1/PcscReader/Readers", timeout_sec=5.0)
        if not isinstance(data, dict):
            return []
        readers = data.get("readers") or data.get("Readers") or []
        return [str(x) for x in readers] if isinstance(readers, list) else []

    def get_default_pcsc_reader(self) -> str:
        _, data = self.call("/api/settings/v1/PcscReader/Default", timeout_sec=5.0)
        if not isinstance(data, dict):
            return ""
        return str(data.get("readerName") or "").strip()

    def set_default_pcsc_reader(self, reader_name: str) -> dict[str, Any]:
        _, data = self.call(
            "/api/settings/v1/PcscReader/Default",
            method="POST",
            body={"readerName": reader_name},
            timeout_sec=8.0,
        )
        return data if isinstance(data, dict) else {}

    def auto_detect_pcsc_reader(self) -> dict[str, Any]:
        """請先只插一張要當預設的卡（門診＝健保卡），再呼叫。兩張都插時署方可能認到醫事卡槽。"""
        _, data = self.call(
            "/api/settings/v1/PcscReader/AutoDetected",
            method="POST",
            timeout_sec=20.0,
        )
        return data if isinstance(data, dict) else {}

    def hc_signature(self, service_type: str) -> dict[str, Any]:
        """安全模組＋健保卡簽章。取號／退掛用 serviceType=03。"""
        _, data = self.call(
            "/api/hc/v1/Signature/Hc",
            method="POST",
            body={"serviceType": service_type},
            timeout_sec=20.0,
        )
        return data if isinstance(data, dict) else {}

    def sam_signature(self, service_type: str) -> dict[str, Any]:
        """僅安全模組簽章。無卡／卡片不良取就醫識別碼用 serviceType=03。"""
        _, data = self.call(
            "/api/sam/v1/Signature",
            method="POST",
            body={"serviceType": service_type},
            timeout_sec=20.0,
        )
        return data if isinstance(data, dict) else {}


def _status_object(data: dict[str, Any]) -> dict[str, Any]:
    inner = data.get("status")
    return inner if isinstance(inner, dict) else {}


def is_initialized(data: dict[str, Any]) -> bool:
    if data.get("initialized") is True:
        return True
    return _status_object(data).get("initialized") is True


def nested_status(data: dict[str, Any], key: str) -> int | None:
    block = _status_object(data).get(key)
    if not isinstance(block, dict):
        return None
    try:
        return int(block.get("status"))
    except (TypeError, ValueError):
        return None


def nested_type(data: dict[str, Any], key: str) -> int | None:
    block = _status_object(data).get(key)
    if not isinstance(block, dict):
        return None
    try:
        return int(block.get("type"))
    except (TypeError, ValueError):
        return None


def nested_block(data: dict[str, Any], key: str) -> dict[str, Any]:
    block = _status_object(data).get(key)
    return block if isinstance(block, dict) else {}
