"""沙盒 3 → 2 橋接：讀卡／寫卡（健保署 6.0 主控台官方 HTTPS）。

正式路徑禁止默默改走 Mock。讀不完整就立刻失敗。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from src.core.nhi_card_init_sop import (
    DESK_RESTART_SOFTWARE,
    DESK_START_SOFTWARE,
    desk_instruction_for_status,
    map_hc_basic,
    run_card_init_sop,
)
from src.core.nhi_cshis6_client import (
    Cshis6Client,
    DEFAULT_CONSOLE_BASE,
    is_initialized,
    nested_status,
    nested_type,
    status_hint,
)
from src.core.nhi_validators import NhiPatientIntake, NhiValidationError

MOCK_CARD_PROFILE: dict[str, str] = {
    "idNo": "A123456789",
    "birthday": "0740315",
    "sex": "M",
    "patientName": "讀卡Mock病患",
    "cardId": "900000000711",
}


@dataclass
class CardReadResult:
    source: str
    profile: dict[str, str]
    consoleReachable: bool
    consoleError: str | None = None
    partial: bool = False
    diagnose: dict[str, Any] | None = None
    autoFixed: list[str] | None = None


@dataclass
class CardWriteResult:
    written: bool
    reason: str
    consoleReachable: bool
    source: str


SAM_STATUS = {0: "未置入", 1: "已置入未驗證", 2: "已與中心端驗證"}
SAM_TYPE = {0: "無", 1: "雲端 SAM", 2: "實體 SAM"}
HC_STATUS = {0: "未置入", 1: "已置入", 2: "已與 SAM 驗證", 3: "已與醫事卡驗證"}
HC_TYPE = {0: "無", 1: "實體健保卡", 2: "虛擬健保卡"}
HPC_STATUS = {0: "未置入", 1: "已置入", 2: "已驗證", 3: "已驗 PIN"}
HPC_TYPE = {0: "無", 1: "醫師卡", 2: "醫事人員卡", 3: "行動醫事人員憑證"}


def _label(table: dict[int, str], value: int | None) -> str:
    if value is None:
        return "—"
    return table.get(value, f"未知({value})")


def _mask_id(value: str) -> str:
    raw = (value or "").strip()
    if len(raw) < 4:
        return "****" if raw else ""
    return raw[:2] + "****" + raw[-2:]


def _card_probe(payload: dict[str, Any]) -> dict[str, Any]:
    code = payload.get("statusCode")
    inner = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    id_no = str(inner.get("idNo") or inner.get("hcIdNo") or inner.get("ssn") or "").strip()
    name = str(inner.get("name") or inner.get("patientName") or "").strip()
    card_id = str(inner.get("cardId") or inner.get("cardSn") or inner.get("hpcSn") or "").strip()
    ok = code in (None, 0)
    masked_card = ""
    if ok and len(card_id) >= 4:
        masked_card = card_id[:2] + "****" + card_id[-2:]
    elif ok:
        masked_card = card_id
    return {
        "ok": ok,
        "statusCode": code,
        "statusHint": status_hint(int(code) if isinstance(code, int) else None),
        "idNoMasked": _mask_id(id_no) if ok else "",
        "nameLen": len(name) if ok else 0,
        "cardIdMasked": masked_card,
    }


def console_diagnose(*, console_base: str = DEFAULT_CONSOLE_BASE, light: bool = False) -> dict[str, Any]:
    """只讀主控台三卡狀態。不取號、不寫卡、不把 SAM 檔內容放進回傳。

    light=True：只看 Status 裡現成的 sam/hc/hpc 欄位，不去打 Basic（大廳輪詢用）。
    SAM 是否已驗證也在 Status 裡，不必向中心再認證一次。
    """
    client = Cshis6Client(console_base)
    if not client.probe():
        from src.core.nhi_console_repair import console_runtime_snapshot

        runtime = console_runtime_snapshot(console_base=console_base)
        fault = build_fault_report(
            reachable=False,
            process_running=runtime["processRunning"],
            port_listening=runtime["portListening"],
        )
        advice = [fault.get("deskTitle") or "請啟動健保讀卡軟體。"]
        if runtime.get("portExcluded") and not runtime.get("portListening"):
            advice.append(
                "Windows 可能保留 5066 埠；若除錯後仍連不到，請以系統管理員執行 fix-nhi-cshis6-port-5066.bat。"
            )
        return {
            "reachable": False,
            "consoleBase": console_base,
            "advice": advice,
            "fault": fault,
            "runtime": runtime,
            "consoleFixable": fault.get("deskAction") in (DESK_START_SOFTWARE, DESK_RESTART_SOFTWARE),
        }

    try:
        st = client.status()
    except Exception as exc:
        return {
            "reachable": True,
            "consoleBase": console_base,
            "advice": [f"GET /api/common/v1/Status 失敗：{exc}"],
        }

    readers: list[str] = []
    default_reader = ""
    try:
        readers = client.list_pcsc_readers()
        default_reader = client.get_default_pcsc_reader()
    except Exception:
        pass

    sam_s = nested_status(st, "sam")
    hc_s = nested_status(st, "hc")
    hpc_s = nested_status(st, "hpc")
    snapshot: dict[str, Any] = {
        "reachable": True,
        "consoleBase": console_base,
        "initialized": is_initialized(st),
        "deviceName": st.get("name") or "",
        "readerName": st.get("readerName") or default_reader,
        "defaultReader": default_reader,
        "readers": readers,
        "sam": {
            "status": sam_s,
            "type": nested_type(st, "sam"),
            "statusLabel": _label(SAM_STATUS, sam_s),
            "typeLabel": _label(SAM_TYPE, nested_type(st, "sam")),
        },
        "hc": {
            "status": hc_s,
            "type": nested_type(st, "hc"),
            "statusLabel": _label(HC_STATUS, hc_s),
            "typeLabel": _label(HC_TYPE, nested_type(st, "hc")),
        },
        "hpc": {
            "status": hpc_s,
            "type": nested_type(st, "hpc"),
            "statusLabel": _label(HPC_STATUS, hpc_s),
            "typeLabel": _label(HPC_TYPE, nested_type(st, "hpc")),
        },
        "hcRead": None,
        "hpcRead": None,
        "advice": [],
    }

    if not light:
        if hc_s not in (None, 0):
            try:
                snapshot["hcRead"] = _card_probe(client.hc_basic())
            except Exception as exc:
                snapshot["hcRead"] = {"ok": False, "statusHint": str(exc)}
        if hpc_s not in (None, 0):
            try:
                snapshot["hpcRead"] = _card_probe(client.hpc_basic())
            except Exception as exc:
                snapshot["hpcRead"] = {"ok": False, "statusHint": str(exc)}

    hc_read = snapshot.get("hcRead") or {}
    snapshot["fault"] = build_fault_report(
        reachable=True,
        initialized=bool(snapshot.get("initialized")),
        readers=readers,
        default_reader=default_reader,
        sam_s=sam_s,
        hc_s=hc_s,
        hpc_s=hpc_s,
        hc_code=int(hc_read["statusCode"]) if isinstance(hc_read.get("statusCode"), int) else None,
        extra="",
        for_lobby=light,
    )
    title = (snapshot["fault"] or {}).get("deskTitle") or ""
    snapshot["advice"] = [title] if title else []
    desk_action = (snapshot["fault"] or {}).get("deskAction")
    snapshot["consoleFixable"] = not snapshot["reachable"] and desk_action in (
        DESK_START_SOFTWARE,
        DESK_RESTART_SOFTWARE,
    )
    return snapshot


def _map_hc_basic(data: dict[str, Any]) -> dict[str, str] | None:
    return map_hc_basic(data)


def _explain_not_ready(status_body: dict[str, Any]) -> str:
    code = status_body.get("statusCode")
    sam = nested_status(status_body, "sam")
    parts = []
    if not is_initialized(status_body):
        parts.append("主控台尚未初始化（雲端 SAM 未匯入或 Initial 未成功）")
    if sam in (None, 0):
        parts.append("SAM 未就緒：請匯入診所 .SAM（scripts\\import_nhi_cloud_sam.py）")
    elif sam == 1:
        parts.append("SAM 已置入但尚未與中心端驗證（需要診所 VPN／route 到 10.x）")
    if code not in (None, 0):
        parts.append(status_hint(int(code)))
    return "；".join(parts) if parts else "主控台可達但讀不到基本資料。未改用假卡。"


OWNER_LABEL = {
    "wundadi": "Wundadi 本系統",
    "nhi_console": "健保署 6.0 主控台",
    "hardware": "讀卡機／插卡",
    "clinic_setup": "診所環境（SAM／VPN）",
    "card_or_nhi": "卡片或主控台讀卡（路徑已通，無法再切）",
    "ok": "正常",
}


def build_fault_report(
    *,
    reachable: bool,
    initialized: bool | None = None,
    readers: list[str] | None = None,
    default_reader: str = "",
    sam_s: int | None = None,
    hc_s: int | None = None,
    hpc_s: int | None = None,
    hc_code: int | None = None,
    partial: bool = False,
    auto_fixed: list[str] | None = None,
    extra: str = "",
    process_running: bool | None = None,
    port_listening: bool | None = None,
    for_lobby: bool = False,
) -> dict[str, Any]:
    """櫃台只看 deskTitle。技術細節不進畫面。"""
    readers = readers or []
    auto_fixed = auto_fixed or []
    if not reachable:
        owner = "nhi_console"
    elif not readers:
        owner = "hardware"
    elif not initialized or sam_s in (None, 0, 1):
        owner = "clinic_setup"
    elif hc_s in (None, 0):
        owner = "hardware"
    else:
        owner = "card_or_nhi"

    desk_action, desk_which, desk_title_text = desk_instruction_for_status(
        reachable=reachable,
        readers=readers,
        initialized=initialized,
        sam_s=sam_s,
        hc_s=hc_s,
        hpc_s=hpc_s,
        hc_code=hc_code,
        partial=partial,
        process_running=process_running,
        port_listening=port_listening,
        for_lobby=for_lobby,
    )
    headline = desk_title_text or extra or ""

    return {
        "owner": owner,
        "ownerLabel": OWNER_LABEL[owner],
        "headline": headline,
        "humanAction": desk_action,
        "humanActionLabel": headline,
        "deskAction": desk_action,
        "deskTitle": headline,
        "deskWhich": desk_which,
        "checks": [],
        "autoFixed": auto_fixed,
        "defaultReader": default_reader,
        "hcStatusCode": hc_code,
    }


def _fail(
    message: str,
    *,
    reachable: bool,
    diagnose: dict[str, Any],
    auto_fixed: list[str] | None = None,
    partial: bool = False,
) -> CardReadResult:
    return CardReadResult(
        source="partial" if partial else "none",
        profile={},
        consoleReachable=reachable,
        consoleError=message,
        partial=partial,
        diagnose=diagnose,
        autoFixed=auto_fixed or diagnose.get("autoFixed") or [],
    )


def read_card_profile(*, use_mock: bool = False, console_base: str = DEFAULT_CONSOLE_BASE) -> CardReadResult:
    """正式讀卡：跑硬體無關 Init SOP。人只被叫去做拔卡／USB；卡種由我們逐台分辨。"""
    if use_mock:
        return CardReadResult(
            source="mock",
            profile=dict(MOCK_CARD_PROFILE),
            consoleReachable=True,
            consoleError=None,
        )

    client = Cshis6Client(console_base)
    sop = run_card_init_sop(client)
    if sop.ok and sop.profile:
        note = " ".join(sop.auto_fixed) if sop.auto_fixed else None
        return CardReadResult(
            source="console",
            profile=sop.profile,
            consoleReachable=True,
            consoleError=note,
            autoFixed=sop.auto_fixed,
            diagnose=sop.to_diagnose() if sop.auto_fixed else None,
        )

    return _fail(
        sop.message,
        reachable=sop.reachable,
        diagnose=sop.to_diagnose(),
        auto_fixed=sop.auto_fixed,
        partial=any(s.kind == "partial" for s in sop.slots),
    )


def read_virtual_card_profile(token: str, *, console_base: str = DEFAULT_CONSOLE_BASE) -> CardReadResult:
    """Verify a virtual-card QR, then read basic data from the same console session."""
    text = (token or "").strip()
    if len(text) < 8:
        return _fail("\u8b80\u4e0d\u5230 QR \u5167\u5bb9", reachable=True)
    client = Cshis6Client(console_base)
    if not client.probe():
        return _fail("\u8b80\u5361\u4e3b\u63a7\u53f0\u7121\u6cd5\u9023\u7dda", reachable=False)
    try:
        verified = client.verify_virtual_hc(text)
    except Exception as exc:
        return _fail(str(exc), reachable=True)
    code = verified.get("statusCode")
    if code is not None and str(code) not in {"0", "0.0"}:
        try:
            hint = status_hint(int(code))
        except (TypeError, ValueError):
            hint = ""
        return _fail(hint or "\u865b\u64ec\u5065\u4fdd\u5361\u9a57\u8b49\u5931\u6557", reachable=True)
    try:
        basic = client.hc_basic()
    except Exception as exc:
        return _fail(str(exc), reachable=True)
    profile = map_hc_basic(basic) or map_hc_basic(verified)
    if not profile:
        return _fail("\u9a57\u8b49\u5f8c\u8b80\u4e0d\u5230\u57fa\u672c\u8cc7\u6599", reachable=True)
    return CardReadResult(
        source="virtual",
        profile=profile,
        consoleReachable=True,
        consoleError=None,
    )


def profile_to_patient_intake(profile: dict[str, str]) -> NhiPatientIntake:
    try:
        return NhiPatientIntake(
            idNo=profile["idNo"],
            birthday=profile["birthday"],
            sex=profile["sex"],  # type: ignore[arg-type]
            patientName=profile.get("patientName") or None,
        )
    except (KeyError, ValueError) as exc:
        raise NhiValidationError(f"讀卡資料不完整：{exc}") from exc


def write_visit_to_card(
    *,
    console_base: str = DEFAULT_CONSOLE_BASE,
    payload: dict[str, Any] | None = None,
) -> CardWriteResult:
    """6.0 cloud write via Treatment/WriteCodeFee + Prescription/Write (not 5.x chip)."""
    from src.app.bootstrap import get_shadow_store
    from src.core.encounter_extensions import extract_reg_meta
    from src.core.nhi_treatment_bridge import (
        build_prescription_items,
        write_visit_to_cloud,
        _fee_int,
    )
    import json

    data = payload or {}
    encounter_id = str(data.get("encounterId") or "").strip()
    write_dx = bool(data.get("writeDx", True))
    write_orders = bool(data.get("writeOrders", True))

    if not encounter_id:
        return CardWriteResult(
            written=False,
            reason="\u7f3a encounterId\uff0c\u7121\u6cd5\u7d44\u96f2\u7aef\u5beb\u5165\u3002",
            consoleReachable=True,
            source="console",
        )

    store = get_shadow_store()
    enc = None
    try:
        with store._connect() as conn:
            row = conn.execute(
                "SELECT payload_json FROM resource_cache WHERE resource_type=? AND resource_id=?",
                ("Encounter", encounter_id),
            ).fetchone()
            if row and row[0]:
                enc = json.loads(row[0]) if isinstance(row[0], str) else row[0]
    except Exception:
        enc = None
    reg = extract_reg_meta(enc or {})

    ic_exc = str(reg.get("icException") or "ic").strip()
    pay_type = str(reg.get("payType") or "").strip()
    if ic_exc == "selfPay" or pay_type in {"1"}:
        return CardWriteResult(
            written=True,
            reason="\u81ea\u8cbb\u6848\u4ef6\uff1a\u7565\u904e\u5065\u4fdd\u96f2\u7aef\u5beb\u5165\uff1b\u672c\u6a5f\u75c5\u6b77\u53ef\u5b8c\u8a3a\u5b58\u6a94\u3002",
            consoleReachable=True,
            source="skipped-selfpay",
        )
    if ic_exc in {"deposit", "noCard", "childNoCard", "pregnantNoCard", "badCard", "paper"}:
        return CardWriteResult(
            written=True,
            reason=(
                "\u7121\u5361\uff0f\u58de\u5361\uff0f\u7d19\u5361\uff1a\u7121\u6cd5\u7528\u5065\u4fdd\u5361\u7c3d\u7ae0\u5beb\u96f2\u7aef\uff1b"
                "\u672c\u6a5f\u75c5\u6b77\u5df2\u5141\u8a31\u5b8c\u8a3a\u3002\u8acb\u4f9d\u7f72\u65b9\u898f\u5247\u88dc\u8fa6\u65e5\u4e0a\u50b3\uff0f\u7533\u5831\u3002"
            ),
            consoleReachable=True,
            source="skipped-nocard",
        )

    dx_codes: list[str] = []
    try:
        for c in store.list_conditions(encounter_id=encounter_id):
            meta = c.get("indexMeta") or {}
            code = meta.get("icd10Code") or meta.get("nhiIcd10Code")
            if code:
                dx_codes.append(str(code))
    except Exception:
        pass

    meds: list[dict] = []
    try:
        for m in store.list_medication_requests(encounter_id=encounter_id):
            meta = m.get("indexMeta") or {}
            resource = m.get("resource") or {}
            item = {
                "nhiCode": meta.get("nhiCode") or "",
                "days": meta.get("daysSupply") or 1,
                "qty": meta.get("quantity") or 1,
                "sig": meta.get("dosageText") or "QD",
            }
            dosage = resource.get("dosageInstruction") or []
            if dosage and isinstance(dosage[0], dict) and dosage[0].get("text"):
                item["sig"] = str(dosage[0]["text"])
            meds.append(item)
    except Exception:
        pass

    desk_sign = data.get("deskSign") if isinstance(data.get("deskSign"), dict) else None
    desk_sign_rx = data.get("deskSignRx") if isinstance(data.get("deskSignRx"), dict) else None
    hc_id = str(reg.get("hcId") or "").strip()
    hc_id_no = str(reg.get("hcIdNo") or "").strip()
    if desk_sign:
        hc_id = hc_id or str(desk_sign.get("hcId") or "")
        hc_id_no = hc_id_no or str(desk_sign.get("hcIdNo") or "")

    consult = _fee_int(reg.get("consultFee"))
    drug = _fee_int(reg.get("drugFee"))
    material = _fee_int(reg.get("materialFee"))
    reg_fee = _fee_int(reg.get("regFee"))
    outpatient_fee = consult + drug + material + reg_fee
    cost_fee = _fee_int(reg.get("copayAmt") or reg.get("burdenFee"))

    dt = reg.get("treatDateTime") or reg.get("opdDate")
    after = str(reg.get("afterCheck") or "1")[:1]
    rx_items = build_prescription_items(meds, treatment_date_time=str(dt or "")) if write_orders else []
    needs_rx = write_orders and bool(rx_items)
    has_sign = bool(desk_sign and str(desk_sign.get("signature") or "").strip() and str(desk_sign.get("clientRandom") or "").strip())
    has_rx_sign = bool(desk_sign_rx and str(desk_sign_rx.get("signature") or "").strip() and str(desk_sign_rx.get("clientRandom") or "").strip())
    if (write_dx or needs_rx) and not has_sign:
        return CardWriteResult(written=False, reason="NEED_DESK_SIGN", consoleReachable=True, source="need-desk-sign")
    if needs_rx and not has_rx_sign:
        return CardWriteResult(written=False, reason="NEED_DESK_SIGN_RX", consoleReachable=True, source="need-desk-sign")

    result = write_visit_to_cloud(
        console_base=console_base,
        hc_id=hc_id,
        hc_id_no=hc_id_no,
        treatment_date_time=str(dt) if dt else None,
        after_check=after,
        diagnosis_codes=dx_codes,
        outpatient_fee=outpatient_fee,
        cost_fee=cost_fee,
        write_dx=write_dx,
        write_orders=write_orders and bool(rx_items),
        prescriptions=rx_items if write_orders else None,
        desk_sign=desk_sign,
        desk_sign_rx=desk_sign_rx,
    )
    return CardWriteResult(
        written=bool(result.ok),
        reason=result.reason,
        consoleReachable=True,
        source="cloud" if result.ok and not result.skipped else ("skipped" if result.skipped else "cloud-fail"),
    )

