"""The one Hatchet client of this tier, and the switch that says whether a tier uses it.

Background work moves from our own Postgres claim queues to Hatchet, one tier at
a time (ADR-0150). Each tier reads its own flag through :func:`orchestrator`;
the default is the claim queue, so a stack runs exactly as before until its
platform (the Hatchet engine and its Postgres) is applied and the flag is set.

Only the thin layer that registers a tier's tasks imports this module. The
pipeline's step functions never import ``hatchet_sdk``: that keeps the
orchestrator replaceable (Temporal is the documented exit).

The connection is the SDK's own configuration, read from its standard
environment variables (``HATCHET_CLIENT_TOKEN``, ``HATCHET_CLIENT_HOST_PORT``,
``HATCHET_CLIENT_TLS_STRATEGY``, ``HATCHET_CLIENT_NAMESPACE``), so nothing here
re-implements it.
"""

from __future__ import annotations

import os
import threading
from enum import StrEnum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from hatchet_sdk import Hatchet


class Orchestrator(StrEnum):
    """Who runs a tier's background work."""

    CLAIM_QUEUE = "claim_queue"
    HATCHET = "hatchet"


class Tier(StrEnum):
    """A tier that can move to Hatchet, named by its flag's stem."""

    INGEST = "INGEST"
    RESEARCH = "RESEARCH"


# @environment_variable INGEST_ORCHESTRATOR
# @category Knowledge Layer
# @type enum: claim_queue | hatchet
# @default claim_queue
# @required false
# Who runs ingestion jobs: our Postgres claim queue (ADR-0076) or Hatchet
# (ADR-0150). `hatchet` needs the HATCHET_CLIENT_* connection.
#
# @environment_variable RESEARCH_ORCHESTRATOR
# @category Agent Jobs
# @type enum: claim_queue | hatchet
# @default claim_queue
# @required false
# Who runs research runs: our Postgres claim queue (ADR-0021) or Hatchet
# (ADR-0150). `hatchet` needs the HATCHET_CLIENT_* connection.
def orchestrator(tier: Tier) -> Orchestrator:
    """The orchestrator ``tier`` runs on; an unknown value is refused, not guessed."""
    raw = (os.environ.get(f"{tier.value}_ORCHESTRATOR") or Orchestrator.CLAIM_QUEUE.value).strip().lower()
    try:
        return Orchestrator(raw)
    except ValueError:
        allowed = ", ".join(o.value for o in Orchestrator)
        raise ValueError(f"{tier.value}_ORCHESTRATOR must be one of {allowed} (got {raw!r})") from None


_lock = threading.Lock()
_client: Hatchet | None = None


def client() -> Hatchet:
    """The process's Hatchet client, built once from the SDK's environment."""
    global _client
    with _lock:
        if _client is None:
            from hatchet_sdk import Hatchet

            _client = Hatchet()
        return _client


def reset_for_tests(fake: Hatchet | None = None) -> None:
    """Replace (or drop) the process's client. Tests fake Hatchet here, at one place."""
    global _client
    with _lock:
        _client = fake
