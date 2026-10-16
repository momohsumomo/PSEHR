"""診間候診狀態 ↔ FHIR Encounter.status 對照。"""

from __future__ import annotations

from typing import Literal

QueueStatus = Literal["waiting", "in_progress", "no_show", "finished", "cancelled"]
FhirStatus = Literal["planned", "arrived", "in-progress", "onleave", "finished", "cancelled"]

QUEUE_TO_FHIR: dict[str, FhirStatus] = {
    "waiting": "arrived",
    "in_progress": "in-progress",
    "no_show": "onleave",
    "finished": "finished",
    "cancelled": "cancelled",
}

FHIR_TO_QUEUE: dict[str, QueueStatus] = {
    "planned": "waiting",
    "arrived": "waiting",
    "triaged": "waiting",
    "in-progress": "in_progress",
    "onleave": "no_show",
    "finished": "finished",
    "cancelled": "cancelled",
}


def queue_status_from_fhir(status: str) -> QueueStatus:
    return FHIR_TO_QUEUE.get(status, "waiting")


def fhir_status_from_queue(queue_status: str) -> FhirStatus:
    return QUEUE_TO_FHIR[queue_status]
