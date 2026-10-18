"""
沙盒 2 — 後端 FHIR API（Local-First，僅 Swagger 驗證，不連前端）。

啟動：
  python scripts/init_shadow_db.py
  python -m uvicorn src.api.main:app --reload --host 127.0.0.1 --port 5000
  開啟 http://127.0.0.1:5000/docs
  （本機若 8800 無法綁定：Windows 常保留 8734-8833，請勿用該區段埠號）
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from src.core.context import current_machine_id, current_operator_identity, current_pin_code
from src.api.routers import (
    address_book,
    auth,
    allergy_intolerance,
    claims,
    clinic_settings,
    condition,
    encounter,
    ic_upload,
    kiosk,
    maintenance,
    media,
    medication_request,
    nhi,
    observation,
    outpatient,
    packages,
    patient,
    referral,
    same_day,
    sandbox,
    staff,
)
from src.app.bootstrap import get_shadow_store
from src.core.local_print_server import start_local_print_server
from src.infrastructure.sync_worker import start_sync_worker, stop_sync_worker
from src.spoke.hydrator_worker import start_pack_hydrator_worker, stop_pack_hydrator_worker
from src.spoke.pack_store import PackStore

class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        machine_id = request.headers.get("x-machine-id", "Unknown_Machine")
        pin_code = request.headers.get("x-pin-code")

        token_machine = current_machine_id.set(machine_id)
        token_pin = current_pin_code.set(pin_code)
        # 預設匿名；有合法 PIN 則實名（責任機制）
        operator = "System_Collaborative"
        if pin_code:
            try:
                store = get_shadow_store()
                identity = store.verify_pin(pin_code) if hasattr(store, "verify_pin") else None
                if identity:
                    operator = identity
            except Exception:
                pass
        token_operator = current_operator_identity.set(operator)

        try:
            response = await call_next(request)
            return response
        finally:
            current_machine_id.reset(token_machine)
            current_pin_code.reset(token_pin)
            current_operator_identity.reset(token_operator)

app = FastAPI(
    title="Teammomo FHIR API（沙盒 2）",
    description=(
        "Local-First SQLite 雙層貼紙：resource_cache + *_index。"
        "請用 Swagger 獨立驗收；前端沙盒1已解耦。"
    ),
    version="0.12.0-spoke-pack-hydrator",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(RequestContextMiddleware)

app.include_router(auth.router)
app.include_router(nhi.router)
app.include_router(kiosk.router)
app.include_router(referral.router)
app.include_router(patient.router)
app.include_router(allergy_intolerance.router)
app.include_router(encounter.router)
app.include_router(condition.router)
app.include_router(media.router)
app.include_router(medication_request.router)
app.include_router(observation.router)
app.include_router(outpatient.router)
app.include_router(sandbox.router)
app.include_router(staff.router)
app.include_router(clinic_settings.router)
app.include_router(address_book.router)
app.include_router(claims.router)
app.include_router(ic_upload.router)
app.include_router(same_day.router)
app.include_router(packages.router)
app.include_router(maintenance.router)


@app.on_event("startup")
def on_startup() -> None:
    store = get_shadow_store()
    store.initialize()
    PackStore(store.db_path).initialize()
    start_sync_worker(store)
    start_pack_hydrator_worker()
    start_local_print_server()
    from src.core.cc_learn import start_cc_learner

    start_cc_learner(store.db_path)


@app.on_event("shutdown")
def on_shutdown() -> None:
    stop_sync_worker()
    stop_pack_hydrator_worker()


@app.get("/health")
def health() -> dict[str, Any]:
    store = get_shadow_store()
    pending = len(store.dequeue_sync_batch(limit=1000))
    pack_store = PackStore(store.db_path)
    pack_store.initialize()
    last_hydrate = pack_store.last_run()
    return {
        "status": "ok",
        "architecture": "local-first",
        "db_path": str(store.db_path),
        "pending_sync_count": pending,
        "packages": {
            "latestActiveVersion": pack_store.latest_active_version(),
            "lastHydrateStatus": (last_hydrate or {}).get("status"),
            "lastHydrateFailedNode": (last_hydrate or {}).get("failed_node"),
            "lastHydrateDiagnosis": (last_hydrate or {}).get("diagnosis"),
        },
        "syncLanes": {
            "clinicalOutbound": "/sync/queue",
            "rulesInbound": "/sync/packages",
        },
    }


@app.get("/sync/queue")
def list_sync_queue() -> list[dict[str, Any]]:
    return get_shadow_store().dequeue_sync_batch(limit=100)


@app.post("/sync/queue/{queue_id}/mark-synced")
def mark_sync_queue_item(queue_id: int) -> dict[str, Any]:
    """GCP 上雲 PoC：標記單筆 sync_queue 已同步（Local-First 出站）。"""
    store = get_shadow_store()
    pending = {row["id"] for row in store.dequeue_sync_batch(limit=5000)}
    if queue_id not in pending:
        raise HTTPException(status_code=404, detail=f"sync_queue/{queue_id} 不存在或已同步")
    store.mark_sync_done(queue_id)
    return {"queueId": queue_id, "marked": True}
