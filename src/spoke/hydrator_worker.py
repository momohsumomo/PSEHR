"""Spoke Hydrator 背景排程（機器可時間觸發；不打擾人）。"""

from __future__ import annotations

import asyncio
import logging
import os

from src.spoke.hydrator import PackHydrator

logger = logging.getLogger("spoke.hydrator_worker")

HYDRATE_INTERVAL_SECS = int(os.environ.get("PACK_HYDRATE_INTERVAL_SECS", "3600"))
HYDRATE_ON_STARTUP = os.environ.get("PACK_HYDRATE_ON_STARTUP", "1").strip() not in (
    "0",
    "false",
    "False",
)


class PackHydratorWorker:
    def __init__(self, hydrator: PackHydrator | None = None) -> None:
        self.hydrator = hydrator or PackHydrator()
        self._running = False
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info(
            "Pack Hydrator worker started (interval=%ss, on_startup=%s)",
            HYDRATE_INTERVAL_SECS,
            HYDRATE_ON_STARTUP,
        )

    def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None
        logger.info("Pack Hydrator worker stopped")

    async def _loop(self) -> None:
        if HYDRATE_ON_STARTUP:
            try:
                await self.hydrator.run_once()
            except Exception as exc:
                logger.error("Startup hydrate failed: %s", exc, exc_info=True)
        while self._running:
            await asyncio.sleep(HYDRATE_INTERVAL_SECS)
            if not self._running:
                break
            try:
                await self.hydrator.run_once()
            except Exception as exc:
                logger.error("Scheduled hydrate failed: %s", exc, exc_info=True)


_worker: PackHydratorWorker | None = None


def start_pack_hydrator_worker() -> PackHydratorWorker:
    global _worker
    if _worker is None:
        _worker = PackHydratorWorker()
        _worker.start()
    return _worker


def stop_pack_hydrator_worker() -> None:
    global _worker
    if _worker is not None:
        _worker.stop()
        _worker = None
