# @module: 雙層SQLite資料庫
from __future__ import annotations


import os
import asyncio
import logging
import httpx
from typing import Any
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore

logger = logging.getLogger("sync_worker")
logging.basicConfig(level=logging.INFO)

# Configuration from environment variables
CLOUD_FHIR_URL = os.environ.get("CLOUD_FHIR_URL", "")
SYNC_INTERVAL_SECS = int(os.environ.get("SYNC_INTERVAL_SECS", "5"))


class BackgroundSyncWorker:
    def __init__(self, store: SqliteShadowStore) -> None:
        self.store = store
        self._running = False
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        if not self._running:
            self._running = True
            self._task = asyncio.create_task(self._sync_loop())
            logger.info("Local-First Background Sync Worker started.")
            if CLOUD_FHIR_URL:
                logger.info(f"Syncing to Cloud FHIR Server: {CLOUD_FHIR_URL}")
            else:
                logger.info("CLOUD_FHIR_URL not configured. The sync queue waits; nothing is marked synced.")

    def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            logger.info("Local-First Background Sync Worker stopped.")

    async def _sync_loop(self) -> None:
        while self._running:
            try:
                await self._process_sync_queue()
            except Exception as e:
                logger.error(f"Error in sync loop: {e}", exc_info=True)
            await asyncio.sleep(SYNC_INTERVAL_SECS)

    async def _process_sync_queue(self) -> None:
        # No cloud: the queue waits. Nothing is marked synced that was not sent.
        if not CLOUD_FHIR_URL:
            return
        # SQLite may wait up to busy_timeout here; keep that off the event loop.
        batch = await asyncio.to_thread(self.store.dequeue_sync_batch, limit=20)
        if not batch:
            return

        async with httpx.AsyncClient(timeout=10.0) as client:
            for item in batch:
                queue_id = item["id"]
                op = item["operation"]
                res_type = item.get("resource_type") or item.get("resourceType")
                res_id = item.get("resource_id") or item.get("resourceId")
                payload = item["payload"]

                if op not in ("create", "update"):
                    # Chart data is never deleted in the cloud (POST/PUT only).
                    await asyncio.to_thread(self.store.mark_sync_skipped, queue_id, f"{op} is not sent")
                    logger.info(f"sync_queue ID {queue_id}: {op} {res_type}/{res_id} not sent")
                    continue

                success = False
                url = f"{CLOUD_FHIR_URL.rstrip('/')}/{res_type}/{res_id}"
                try:
                    r = await client.put(url, json=payload)
                    if r.status_code in (200, 201):
                        success = True
                    else:
                        logger.error(
                            f"Failed to sync {res_type}/{res_id} to cloud. Status code: {r.status_code}"
                        )
                except Exception as e:
                    logger.error(f"Network error syncing {res_type}/{res_id}: {e}")

                if success:
                    await asyncio.to_thread(self.store.mark_sync_done, queue_id)
                    logger.info(f"Successfully synchronized sync_queue ID {queue_id} ({op} {res_type}/{res_id})")
                else:
                    # If sync failed, halt this batch to preserve order (Strict FIFO sync queue)
                    logger.warning("Sync failed. Halting current batch retry in next loop.")
                    break


_sync_worker: BackgroundSyncWorker | None = None


def start_sync_worker(store: SqliteShadowStore) -> BackgroundSyncWorker:
    global _sync_worker
    if _sync_worker is None:
        _sync_worker = BackgroundSyncWorker(store)
        _sync_worker.start()
    return _sync_worker


def stop_sync_worker() -> None:
    global _sync_worker
    if _sync_worker is not None:
        _sync_worker.stop()
        _sync_worker = None
