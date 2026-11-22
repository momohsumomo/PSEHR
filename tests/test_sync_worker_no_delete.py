import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.infrastructure import sync_worker
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore


class _Client:
    def __init__(self, *a, **k):
        self.puts = []
        self.deletes = []
        _Client.last = self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def put(self, url, json=None):
        self.puts.append(url)
        return mock.Mock(status_code=200)

    async def delete(self, url):
        self.deletes.append(url)
        return mock.Mock(status_code=204)


class SyncWorkerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.store = SqliteShadowStore(Path(self.tmp.name) / "t.db")
        self.store.initialize()
        self.store.enqueue_sync("update", "Patient", "p1", {"resourceType": "Patient", "id": "p1"})
        self.store.enqueue_sync("delete", "Patient", "p2", {})

    def tearDown(self):
        conn = getattr(self.store._local, "conn", None)
        if conn is not None:
            conn.close()
        self.tmp.cleanup()

    def _queue(self):
        with self.store._connect() as conn:
            return [tuple(r) for r in conn.execute("SELECT operation, synced_at IS NOT NULL, skipped FROM sync_queue ORDER BY id")]

    def _run(self):
        worker = sync_worker.BackgroundSyncWorker(self.store)
        with mock.patch.object(sync_worker.httpx, "AsyncClient", _Client):
            asyncio.run(worker._process_sync_queue())

    def test_no_cloud_marks_nothing_synced(self):
        with mock.patch.object(sync_worker, "CLOUD_FHIR_URL", ""):
            self._run()
        self.assertEqual(self._queue(), [("update", 0, None), ("delete", 0, None)])

    def test_cloud_gets_put_never_delete(self):
        with mock.patch.object(sync_worker, "CLOUD_FHIR_URL", "https://cloud.example/fhir"):
            self._run()
        self.assertEqual(_Client.last.puts, ["https://cloud.example/fhir/Patient/p1"])
        self.assertEqual(_Client.last.deletes, [])
        self.assertEqual(self._queue(), [("update", 1, None), ("delete", 0, "delete is not sent")])
        self.assertEqual(self.store.dequeue_sync_batch(), [])


if __name__ == "__main__":
    unittest.main()
