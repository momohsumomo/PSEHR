import unittest
from unittest import mock

from src.api.routers import encounter as enc
from src.api.schemas.encounter import QueueStatusTransition


def _row(eid: str, status: str) -> dict:
    return {
        "resource": {"resourceType": "Encounter", "id": eid},
        "queueMeta": {"queueStatus": status, "encounterDate": "2026-11-03"},
    }


class KeepClosedTests(unittest.TestCase):
    def _run(self, current: str, target: str, keep_closed: bool):
        rows = [_row("e1", current), _row("e2", "in_progress")]
        store = mock.Mock()
        store.list_encounters_for_date.return_value = rows
        repo = mock.Mock()
        repo.read_resource.side_effect = lambda _t, rid: {"resourceType": "Encounter", "id": rid}
        apply = mock.Mock(return_value={"id": "e1"})
        with mock.patch.object(enc, "get_fhir_repository", return_value=repo), mock.patch.object(
            enc, "_store", return_value=store
        ), mock.patch.object(enc, "_apply_queue_transition", apply):
            out = enc.transition_queue_status(
                "e1", QueueStatusTransition(queue_status=target, keep_closed=keep_closed)
            )
        return out, apply

    def test_finished_visit_is_not_reopened(self):
        out, apply = self._run("finished", "in_progress", True)
        apply.assert_not_called()
        self.assertEqual(out["queueMeta"]["queueStatus"], "finished")

    def test_finished_visit_is_not_sent_back_to_waiting(self):
        _, apply = self._run("finished", "waiting", True)
        apply.assert_not_called()

    def test_open_visit_still_moves(self):
        _, apply = self._run("waiting", "in_progress", True)
        self.assertTrue(apply.called)

    def test_without_flag_behaves_as_before(self):
        _, apply = self._run("finished", "in_progress", False)
        self.assertTrue(apply.called)

    def test_finishing_is_never_blocked(self):
        _, apply = self._run("finished", "finished", True)
        self.assertTrue(apply.called)


if __name__ == "__main__":
    unittest.main()
