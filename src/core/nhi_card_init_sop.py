"""讀卡初始化 SOP：不依賴單槽／雙槽／廠牌，由我們逐台分辨卡種。

人只在實體層被叫停（拔卡重插、USB 拔插、開主控台、SAM／VPN）。
讀卡機燈號、有幾台、是不是專用雙卡機，一律忽略。
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from src.core.nhi_cshis6_client import is_initialized, nested_status, status_hint

KIND_DEAD = "dead"
KIND_EMPTY = "empty"
KIND_HC = "hc"
KIND_HPC = "hpc"
KIND_PARTIAL = "partial"
KIND_UNKNOWN = "unknown"

KIND_LABELS = {
    KIND_DEAD: "叫了沒反應",
    KIND_EMPTY: "沒卡",
    KIND_HC: "健保卡（讀得到）",
    KIND_HPC: "醫事卡",
    KIND_PARTIAL: "有卡但接觸不好",
    KIND_UNKNOWN: "有卡但讀不對",
}

# 櫃台只給這三個動作（排錯可以，句子必須能照做）
DESK_NONE = "none"
DESK_RESEAT_CARD = "reseat_card"
DESK_UNPLUG_READER = "unplug_reader"
DESK_START_SOFTWARE = "start_software"
DESK_RESTART_SOFTWARE = "restart_software"

HUMAN_NONE = DESK_NONE
HUMAN_RESEAT = DESK_RESEAT_CARD
HUMAN_USB = DESK_UNPLUG_READER
HUMAN_OPEN_CONSOLE = DESK_RESTART_SOFTWARE
HUMAN_SAM = DESK_RESTART_SOFTWARE

OWNER_LABEL = {
    "wundadi": "Wundadi 本系統",
    "nhi_console": "健保署 6.0 主控台",
    "hardware": "讀卡機／插卡",
    "clinic_setup": "診所環境（SAM／VPN）",
    "card_or_nhi": "卡片或主控台讀卡",
    "ok": "正常",
}

# 主控台有回應、但這次讀不完整／切不到 applet（接觸不良或晶片）
_PARTIAL_CODES = {1500, 1502, 1501, 1400}

WHICH_HC = "健保卡"
WHICH_HPC = "醫事卡"
WHICH_BOTH = "兩台"


def desk_title(action: str, which: str = "", *, card_hint: str = "") -> str:
    """櫃檯看得到的唯一句子。不要寫埠號、狀態碼、廠牌。"""
    if action == DESK_START_SOFTWARE:
        return "請啟動健保讀卡軟體。"
    if action == DESK_RESTART_SOFTWARE:
        return "請把健保讀卡軟體關掉，再重新打開。"
    if action == DESK_UNPLUG_READER:
        if which == WHICH_HC:
            return "請把健保卡那台讀卡機的線拔掉，再插回去。"
        if which == WHICH_HPC:
            return "請把醫事卡那台讀卡機的線拔掉，再插回去。"
        if which == WHICH_BOTH:
            return "請把兩台讀卡機的線都拔掉，再插回去。"
        return "請把讀卡機的線拔掉，再插回去。"
    if action == DESK_RESEAT_CARD:
        if card_hint == "hpc_only":
            return "請把醫事人員卡拔掉，改插病人健保卡。"
        if card_hint == "hpc_and_empty":
            return "請把病人健保卡插進空的那一台，不要插在醫事卡那台。"
        return "請把病人健保卡拔起來，再插回去。"
    return ""


def which_reader_for_dead(dead: list[Any], slots: list[Any]) -> str:
    """用「健保卡／醫事卡那台」稱呼，不丟 PC/SC 型號給櫃台。"""
    if not dead:
        return ""
    if len(dead) > 1 or (slots and len(dead) == len(slots)):
        return WHICH_BOTH if len(slots) > 1 else ""
    dead_names = {s.name for s in dead}
    others = [s for s in slots if s.name not in dead_names]
    if any(getattr(s, "kind", None) == KIND_HPC for s in others):
        return WHICH_HC
    if any(getattr(s, "kind", None) == KIND_HC for s in others):
        return WHICH_HPC
    if len(slots) == 1:
        return WHICH_HC
    return ""


class CardConsole(Protocol):
    def probe(self) -> bool: ...
    def list_pcsc_readers_safe(self, timeout_sec: float = 5.0) -> dict[str, Any]: ...
    def get_default_pcsc_reader(self) -> str: ...
    def set_default_pcsc_reader_safe(self, reader_name: str, timeout_sec: float = 4.0) -> dict[str, Any]: ...
    def set_default_pcsc_reader(self, reader_name: str) -> dict[str, Any]: ...
    def ensure_session(self) -> dict[str, Any]: ...
    def status(self) -> dict[str, Any]: ...
    def hc_basic_safe(self, timeout_sec: float = 5.0) -> dict[str, Any]: ...
    def hpc_basic_safe(self, timeout_sec: float = 5.0) -> dict[str, Any]: ...


def map_hc_basic(data: dict[str, Any]) -> dict[str, str] | None:
    if not isinstance(data, dict) or data.get("timedOut"):
        return None
    inner = data.get("data") if isinstance(data.get("data"), dict) else data
    id_no = str(inner.get("idNo") or "").strip()
    birthday = str(inner.get("birthday") or "").strip()
    sex = str(inner.get("sex") or "").strip()
    name = inner.get("name") or inner.get("patientName")
    if not id_no or not birthday or not sex:
        return None
    return {
        "idNo": id_no.upper(),
        "birthday": birthday,
        "sex": sex.upper()[:1],
        "patientName": str(name).strip() if name else "",
        "cardId": str(inner.get("cardId") or inner.get("cardSn") or "").strip(),
    }


def desk_instruction_for_status(
    *,
    reachable: bool,
    readers: list[str] | None,
    initialized: bool | None,
    sam_s: int | None,
    hc_s: int | None,
    hpc_s: int | None,
    hc_code: int | None = None,
    partial: bool = False,
    process_running: bool | None = None,
    port_listening: bool | None = None,
    for_lobby: bool = False,
) -> tuple[str, str, str]:
    """大廳輕量狀態 → 同樣三個櫃台動作。

    for_lobby=True：主控台 API 有回應即視為正常，不提示拔卡／SAM／重開（那些留到 F9 讀卡再說）。
    """
    readers = readers or []
    if not reachable:
        if process_running is True and port_listening is False:
            return DESK_RESTART_SOFTWARE, "", desk_title(DESK_RESTART_SOFTWARE)
        if process_running is False:
            return DESK_START_SOFTWARE, "", desk_title(DESK_START_SOFTWARE)
        if process_running is True:
            return DESK_RESTART_SOFTWARE, "", desk_title(DESK_RESTART_SOFTWARE)
        return DESK_START_SOFTWARE, "", desk_title(DESK_START_SOFTWARE)
    if for_lobby:
        return DESK_NONE, "", ""
    if not readers:
        return DESK_UNPLUG_READER, "", desk_title(DESK_UNPLUG_READER)
    if not initialized or sam_s in (None, 0, 1):
        return DESK_RESTART_SOFTWARE, "", desk_title(DESK_RESTART_SOFTWARE)
    if hc_s in (None, 0) and hpc_s not in (None, 0):
        return DESK_RESEAT_CARD, WHICH_HC, desk_title(DESK_RESEAT_CARD, card_hint="hpc_only")
    if hc_s in (None, 0) and hpc_s in (None, 0):
        return DESK_RESEAT_CARD, WHICH_HC, desk_title(DESK_RESEAT_CARD)
    if hc_code == 1103 or partial or (hc_s not in (None, 0) and hc_code not in (None, 0)):
        return DESK_RESEAT_CARD, WHICH_HC, desk_title(DESK_RESEAT_CARD)
    return DESK_NONE, "", ""


def _code(payload: dict[str, Any] | None) -> int | None:
    if not isinstance(payload, dict):
        return None
    raw = payload.get("statusCode")
    try:
        return int(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None


def _hpc_present(payload: dict[str, Any] | None) -> bool:
    if not isinstance(payload, dict) or payload.get("timedOut"):
        return False
    code = _code(payload)
    if code == 0:
        return True
    if code is not None:
        return False
    inner = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    return bool(str(inner.get("cardId") or inner.get("cardSn") or inner.get("hpcSn") or "").strip())


def classify_slot(hc: dict[str, Any], hpc: dict[str, Any] | None = None) -> tuple[str, dict[str, str] | None, str]:
    """依單一槽的 HC／HPC 回應分類。1102＝讀卡機有反應且沒卡。"""
    hpc = hpc or {}
    hc_timeout = bool(hc.get("timedOut"))
    hpc_timeout = bool(hpc.get("timedOut")) if hpc else False
    hc_code = _code(hc)
    hpc_code = _code(hpc) if hpc else None
    profile = map_hc_basic(hc)

    if hc_timeout and (not hpc or hpc_timeout):
        return KIND_DEAD, None, "指定這台之後沒有在時限內回應（驅動／USB／主控台卡住）"

    if profile:
        return KIND_HC, profile, "健保卡基本資料完整"

    if not hc_timeout and hc_code in (None, 0) and not profile:
        return KIND_PARTIAL, None, "主控台回成功但身分證／生日／性別缺欄，多半接觸不良"

    if hc_code in _PARTIAL_CODES:
        return KIND_PARTIAL, None, f"健保卡進模式失敗（{status_hint(hc_code)}），多半接觸不良"

    if _hpc_present(hpc) and (hc_timeout or hc_code in (1102, 1103) or hc_code in _PARTIAL_CODES):
        return KIND_HPC, None, "這槽是醫事卡，不是病人健保卡"

    hc_empty = hc_code == 1102 or (hc_timeout and hpc_code == 1102)
    hpc_empty = not hpc or hpc_timeout or hpc_code in (None, 1102)
    if hc_empty and hpc_empty:
        return KIND_EMPTY, None, "讀卡機有反應，槽裡沒卡"

    if hc_code == 1103:
        if hpc_code == 1103:
            return KIND_UNKNOWN, None, "HC／HPC 應用程式都切不過（接觸不良或主控台分不開這張卡）"
        return KIND_UNKNOWN, None, status_hint(1103)

    if hc_code == 1119 and not hc_timeout:
        return KIND_DEAD, None, hc.get("error") or "PC/SC 其他錯誤，當讀卡機沒反應處理"

    hint = status_hint(hc_code) if hc_code is not None else (hc.get("error") or "無狀態碼")
    return KIND_UNKNOWN, None, hint


@dataclass
class SlotProbe:
    name: str
    alive: bool
    kind: str
    detail: str
    hc_code: int | None = None
    hpc_code: int | None = None
    profile: dict[str, str] | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "alive": self.alive,
            "kind": self.kind,
            "kindLabel": KIND_LABELS.get(self.kind, self.kind),
            "detail": self.detail,
            "hcStatusCode": self.hc_code,
            "hpcStatusCode": self.hpc_code,
        }


@dataclass
class InitSopResult:
    ok: bool
    message: str
    owner: str
    human_action: str
    reachable: bool = True
    initialized: bool | None = None
    readers: list[str] = field(default_factory=list)
    default_reader: str = ""
    sam_s: int | None = None
    hc_s: int | None = None
    hpc_s: int | None = None
    profile: dict[str, str] | None = None
    slots: list[SlotProbe] = field(default_factory=list)
    stages: list[dict[str, Any]] = field(default_factory=list)
    auto_fixed: list[str] = field(default_factory=list)
    desk_which: str = ""
    card_hint: str = ""

    def to_diagnose(self) -> dict[str, Any]:
        title = self.message
        return {
            "owner": self.owner,
            "ownerLabel": OWNER_LABEL.get(self.owner, self.owner),
            "headline": title,
            "humanAction": self.human_action,
            "humanActionLabel": title,
            "deskAction": self.human_action,
            "deskTitle": title,
            "deskWhich": self.desk_which,
            "checks": [],
            "stages": self.stages,
            "slots": [s.as_dict() for s in self.slots],
            "autoFixed": list(self.auto_fixed),
            "defaultReader": self.default_reader,
            "hcStatusCode": next((s.hc_code for s in self.slots if s.kind == KIND_HC), None),
        }


def _stop(
    *,
    action: str,
    which: str = "",
    card_hint: str = "",
    owner: str = "hardware",
    reachable: bool = True,
    **kwargs: Any,
) -> InitSopResult:
    return InitSopResult(
        ok=False,
        message=desk_title(action, which, card_hint=card_hint),
        owner=owner,
        human_action=action,
        desk_which=which,
        card_hint=card_hint,
        reachable=reachable,
        **kwargs,
    )


def _stage(cid: str, ok: bool, label: str, detail: str = "", *, stop: bool = False) -> dict[str, Any]:
    return {"id": cid, "ok": ok, "stop": stop, "label": label, "detail": detail}


def _probe_one_slot(client: CardConsole, name: str) -> SlotProbe:
    set_r = client.set_default_pcsc_reader_safe(name, timeout_sec=4.0)
    if set_r.get("timedOut"):
        return SlotProbe(name, False, KIND_DEAD, "指定這台讀卡機時沒有回應", hc_code=1119)

    set_code = _code(set_r)
    if set_code not in (None, 0, 1001) and set_code not in (1100, 1101):
        # 1002 查無裝置、1600 名稱不在清單 → 當沒反應
        if set_code in (1002, 1600, 1119):
            return SlotProbe(name, False, KIND_DEAD, status_hint(set_code), hc_code=set_code)

    hc = client.hc_basic_safe(timeout_sec=5.0)
    if hc.get("timedOut"):
        hc = client.hc_basic_safe(timeout_sec=5.0)

    profile = map_hc_basic(hc)
    hpc: dict[str, Any] = {}
    if not profile:
        hpc = client.hpc_basic_safe(timeout_sec=5.0)

    kind, profile, detail = classify_slot(hc, hpc)
    if kind == KIND_PARTIAL:
        time.sleep(0.35)
        hc = client.hc_basic_safe(timeout_sec=5.0)
        if not hpc:
            hpc = client.hpc_basic_safe(timeout_sec=5.0)
        kind, profile, detail = classify_slot(hc, hpc)

    alive = kind != KIND_DEAD
    return SlotProbe(
        name=name,
        alive=alive,
        kind=kind,
        detail=detail,
        hc_code=_code(hc),
        hpc_code=_code(hpc) if hpc else None,
        profile=profile,
    )


def lock_card_reader(client: CardConsole, kind: str) -> str:
    """Point the console at the reader that currently holds kind (hc or hpc)."""
    if kind not in (KIND_HC, KIND_HPC):
        raise ValueError(kind)
    listed = client.list_pcsc_readers_safe(timeout_sec=5.0)
    readers = [str(name) for name in (listed.get("readers") or [])]
    if not readers:
        raise RuntimeError("\u6c92\u6709\u8b80\u5361\u6a5f\u3002")
    try:
        current = client.get_default_pcsc_reader() or ""
    except Exception:
        current = ""
    order = [current] + [name for name in readers if name != current] if current in readers else list(readers)
    slots: list[SlotProbe] = []
    for name in order:
        slot = _probe_one_slot(client, name)
        slots.append(slot)
        if slot.kind == kind:
            client.set_default_pcsc_reader(name)
            return name
    restore = current if current in readers else readers[0]
    client.set_default_pcsc_reader(restore)
    if kind == KIND_HC and any(slot.kind == KIND_HPC for slot in slots):
        raise RuntimeError("\u8b80\u5361\u6a5f\u4e0a\u662f\u91ab\u4e8b\u4eba\u54e1\u5361\uff0c\u6c92\u6709\u5065\u4fdd\u5361\u3002")
    if kind == KIND_HPC and any(slot.kind == KIND_HC for slot in slots):
        raise RuntimeError("\u8b80\u5361\u6a5f\u4e0a\u662f\u5065\u4fdd\u5361\uff0c\u6c92\u6709\u91ab\u4e8b\u4eba\u54e1\u5361\u3002")
    if kind == KIND_HC:
        raise RuntimeError("\u8b80\u5361\u6a5f\u4e0a\u6c92\u6709\u5065\u4fdd\u5361\u3002")
    raise RuntimeError("\u8b80\u5361\u6a5f\u4e0a\u6c92\u6709\u91ab\u4e8b\u4eba\u54e1\u5361\u3002")


def run_card_init_sop(client: CardConsole) -> InitSopResult:
    """F2／IC讀卡前的硬體無關初始化。成功則帶 profile；失敗則帶該停的那一層。"""
    stages: list[dict[str, Any]] = []
    auto_fixed: list[str] = []

    if not client.probe():
        stages.append(_stage("console", False, "主控台", "連不到", stop=True))
        return _stop(
            action=DESK_RESTART_SOFTWARE,
            owner="nhi_console",
            reachable=False,
            stages=stages,
        )
    stages.append(_stage("console", True, "主控台", "可達"))

    listed = client.list_pcsc_readers_safe(timeout_sec=5.0)
    if listed.get("timedOut"):
        stages.append(_stage("pcsc", False, "讀卡機清單", "沒回應", stop=True))
        return _stop(action=DESK_RESTART_SOFTWARE, owner="nhi_console", stages=stages)

    readers = listed.get("readers") or []
    n = len(readers)
    stages.append(_stage("pcsc", n > 0, f"讀卡機 {n} 台", "", stop=n == 0))
    if n == 0:
        return _stop(action=DESK_UNPLUG_READER, readers=readers, stages=stages)

    try:
        st = client.ensure_session()
    except Exception:
        stages.append(_stage("sam", False, "讀卡軟體", "初始化失敗", stop=True))
        return _stop(
            action=DESK_RESTART_SOFTWARE,
            owner="clinic_setup",
            readers=readers,
            stages=stages,
        )

    initialized = is_initialized(st)
    sam_s = nested_status(st, "sam")
    hc_s = nested_status(st, "hc")
    hpc_s = nested_status(st, "hpc")
    try:
        default_reader = client.get_default_pcsc_reader() or ""
    except Exception:
        default_reader = ""

    sam_ok = initialized and sam_s == 2
    stages.append(_stage("sam", sam_ok, "讀卡軟體", "", stop=not sam_ok))
    if not sam_ok:
        return _stop(
            action=DESK_RESTART_SOFTWARE,
            owner="clinic_setup",
            readers=readers,
            default_reader=default_reader,
            initialized=initialized,
            sam_s=sam_s,
            hc_s=hc_s,
            hpc_s=hpc_s,
            stages=stages,
        )

    slots = [_probe_one_slot(client, name) for name in readers]
    live = [s for s in slots if s.alive]
    dead = [s for s in slots if not s.alive]
    if not live:
        stages.append(_stage("alive", False, "讀卡機有反應", "", stop=True))
        which = which_reader_for_dead(dead, slots)
        return _stop(
            action=DESK_UNPLUG_READER,
            which=which,
            readers=readers,
            default_reader=default_reader,
            initialized=True,
            sam_s=sam_s,
            hc_s=hc_s,
            hpc_s=hpc_s,
            slots=slots,
            stages=stages,
            auto_fixed=auto_fixed,
        )
    dead_note = f"；沒反應：{'、'.join(s.name for s in dead)}" if dead else ""
    stages.append(
        _stage(
            "alive",
            True,
            f"{len(live)}/{n} 台讀卡機有反應",
            "1102 沒卡也算有反應" + dead_note,
        )
    )

    hc_slots = [s for s in slots if s.kind == KIND_HC and s.profile]
    partial_slots = [s for s in slots if s.kind == KIND_PARTIAL]
    hpc_slots = [s for s in slots if s.kind == KIND_HPC]
    empty_slots = [s for s in slots if s.kind == KIND_EMPTY]
    unknown_slots = [s for s in slots if s.kind == KIND_UNKNOWN]

    slot_line = "；".join(f"{s.name}＝{KIND_LABELS.get(s.kind, s.kind)}" for s in slots)
    stages.append(_stage("cards", True, "逐槽看有沒有卡", slot_line))

    if hc_slots:
        chosen = hc_slots[0]
        if chosen.name != default_reader:
            lock = client.set_default_pcsc_reader_safe(chosen.name, timeout_sec=4.0)
            if not lock.get("timedOut"):
                auto_fixed.append("已自動改讀健保卡那一台。")
                default_reader = chosen.name
        stages.append(_stage("type", True, "我們自己分辨卡種", f"健保卡在 {chosen.name}"))
        return InitSopResult(
            ok=True,
            message="健保卡讀取完成。",
            owner="ok",
            human_action=DESK_NONE,
            readers=readers,
            default_reader=default_reader,
            initialized=True,
            sam_s=sam_s,
            hc_s=hc_s,
            hpc_s=hpc_s,
            profile=chosen.profile,
            slots=slots,
            stages=stages,
            auto_fixed=auto_fixed,
        )

    stages.append(_stage("type", False, "卡種", slot_line, stop=True))
    ctx = dict(
        readers=readers,
        default_reader=default_reader,
        initialized=True,
        sam_s=sam_s,
        hc_s=hc_s,
        hpc_s=hpc_s,
        slots=slots,
        stages=stages,
        auto_fixed=auto_fixed,
    )

    # 有一台沒反應、另一台不是健保卡 → 叫櫃台拔插沒反應那台（用健保卡／醫事卡稱呼）
    if dead and not empty_slots and not partial_slots:
        return _stop(
            action=DESK_UNPLUG_READER,
            which=which_reader_for_dead(dead, slots) or WHICH_HC,
            **ctx,
        )

    if partial_slots:
        return _stop(action=DESK_RESEAT_CARD, **ctx)

    if hpc_slots and not empty_slots and not unknown_slots:
        return _stop(action=DESK_RESEAT_CARD, card_hint="hpc_only", **ctx)

    if hpc_slots and empty_slots:
        return _stop(action=DESK_RESEAT_CARD, card_hint="hpc_and_empty", **ctx)

    if all(s.kind == KIND_EMPTY for s in live):
        return _stop(action=DESK_RESEAT_CARD, **ctx)

    return _stop(action=DESK_RESEAT_CARD, owner="card_or_nhi", **ctx)
