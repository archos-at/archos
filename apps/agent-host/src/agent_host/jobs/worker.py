"""The research worker: the run path of one research job, which Hatchet runs (ADR-0021, ADR-0150).

Run as a dedicated container: ``python -m agent_host.jobs.worker`` (the
``agent-worker`` tier). :func:`main` starts the Hatchet worker that registers the
``research-run`` task (``jobs/research_workflow.py``); this module is what that
task does, and imports no orchestrator SDK, so the orchestrator stays
replaceable. Hatchet holds fairness across organizations, priority, retries
after a lost worker and the drain on SIGTERM; nothing here claims, heartbeats
or reclaims.

Cancellation needs nothing special here: the cancel route flips ``job_info`` to
INTERRUPTED, which ``run_agent_job``'s own 1 s ``CancellationMonitor`` honors,
and cancels the Hatchet run.

Config (env):
  NAT_JOB_STORE_DB_URL            jobs DB (Postgres in prod; required)
  RESEARCH_WORKERS                the worker's slots: concurrent jobs per process (default 1)
  RESEARCH_WORKER_MAX_ATTEMPTS    attempts of a run whose worker was lost (default 3)
  MAX_ACTIVE_JOBS_PER_ORG         one organization's concurrent jobs (default 3)
"""

from __future__ import annotations

import asyncio
import logging
import os

from agent.common.data_flow_register import assert_no_latent_vendor
from agent.common.residency import assert_residency
from agent.knowledge.leader_lock import require_direct_dsns

from . import payload_crypto
from . import run_ownership
from .agent_job import run_agent_job
from .outcome_notify import notify_job_outcome_from_access
from .runner import _update_status_if_not_terminal

logger = logging.getLogger(__name__)

# User-safe verdict for a quarantined payload. The stored blob was corrupt
# (bad base64 / torn write), undecryptable (KEK rotation, tampered tag), forged
# plaintext under KEK, or decoded to a non-dict — either way it can never run.
# The full exception stays server-side in the logs; clients get this string via
# job_info.error and the job.error event (same surfaces as runner failures).
POISON_PAYLOAD_ERROR = "The job payload could not be decrypted or parsed and was quarantined."
RETRIES_EXHAUSTED_ERROR = "research worker retries exhausted"

#: Payload keys that ``run_agent_job`` no longer accepts, dropped at replay.
#: A payload written by an earlier release is replayed as it was stored: by the
#: cutover's re-dispatch of the old queue's rows (``jobs/requeue_legacy.py``),
#: and by a Hatchet retry of a run started just before an upgrade. Without this
#: such a job fails with a TypeError. ``scheduler_address`` is the Dask scheduler
#: the release before #887 wrote; ``claim_owner`` is the claim queue's worker id,
#: which the release before ADR-0150 wrote. Delete a name once no installation
#: holds a payload that carries it. Only these names are dropped: an unknown key
#: in a new payload must still fail.
RETIRED_PAYLOAD_KEYS = frozenset({"scheduler_address", "claim_owner"})


def _replay_kwargs(payload: dict) -> dict:
    """The decrypted payload as ``run_agent_job`` kwargs: retired keys dropped."""
    return {key: value for key, value in payload.items() if key not in RETIRED_PAYLOAD_KEYS}


class PoisonPayloadError(RuntimeError):
    """A stored payload that can never run (undecryptable or not a dict); its FAILURE verdict is recorded."""


def decode_payload(stored: str) -> dict:
    """The decrypted ``run_agent_job`` kwargs of a stored payload; raises when it can never run."""
    payload = payload_crypto.deserialize(stored)
    if not isinstance(payload, dict):
        raise ValueError(f"job payload decoded to {type(payload).__name__}, not a dict")
    return payload


async def run_stored_job(db_url: str, job_id: str, stored: str, attempt: int | None = None) -> bool:
    """Decrypt a stored payload and run it: the ``research-run`` task's whole body. Whether it ran.

    Raises :class:`PoisonPayloadError` once the verdict is recorded, and lets any
    other failure of the run path propagate. Both are deterministic: running the
    same payload again fails the same way. A copy that does not own the job
    (``run_ownership``: another copy runs it, or it is over) returns False
    without running the agent. ``run_agent_job`` owns its own ``job_info``
    transitions, telemetry, the envelope renewal at its start (ADR-0108) and the
    purge of its durable checkpoint once terminal.
    """
    try:
        payload = decode_payload(stored)
    except Exception as exc:
        detail = f"{type(exc).__name__}: job payload undecryptable or unparsable"
        logger.error("Job %s payload unreadable (%s); not run", job_id, type(exc).__name__, exc_info=True)
        await record_poison_verdict(db_url, job_id, detail)
        raise PoisonPayloadError(detail) from exc
    if not await run_ownership.take_ownership(db_url, job_id, attempt):
        return False
    await run_agent_job(**_replay_kwargs(payload))
    return True


def _job_store(db_url: str):
    from nat.front_ends.fastapi.async_jobs.job_store import JobStore

    return JobStore(scheduler_address="", db_url=db_url)


async def record_poison_verdict(db_url: str, job_id: str, detail: str | None = None) -> None:
    """Record the FAILURE verdict for a payload that can never run.

    Flips the durable record (``job_info``, via the sticky-terminal conditional
    so a concurrent cancel/reaper verdict wins) and emits the ``job.error``
    event both surfaces stream. Best-effort throughout: a poison verdict must
    never itself kill a worker. There is no conversation notice here — the
    payload was undecryptable, so the run's conversation/usage context is
    unrecoverable by construction. The outcome IS reported: its tenant is on the
    ``job_access`` row, not in the payload, and without the report the BFF's run
    row stays ``running`` forever.
    """
    logger.error("Job %s payload quarantined (%s); marking FAILURE", job_id, detail or "undecryptable payload")
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

    try:
        store = _job_store(db_url)
        written = await _update_status_if_not_terminal(store, job_id, JobStatus.FAILURE, error=POISON_PAYLOAD_ERROR)
        if written:
            logger.error("Job %s marked FAILURE after payload quarantine", job_id)
            await notify_job_outcome_from_access(
                job_id=job_id, db_url=db_url, status="failure", error=POISON_PAYLOAD_ERROR
            )
        else:
            logger.info("Job %s already terminal; leaving the existing verdict", job_id)
    except Exception:
        logger.exception("Failed to mark quarantined job %s FAILURE", job_id)
    try:
        from .event_store import EventStore

        def _store_poison_event() -> None:
            EventStore(db_url, job_id).store(
                {
                    "type": "job.error",
                    "data": {"error": POISON_PAYLOAD_ERROR, "error_type": "PoisonPayloadError"},
                }
            )

        await asyncio.to_thread(_store_poison_event)
    except Exception:
        logger.warning("Failed to store job.error event for quarantined job %s (non-fatal)", job_id, exc_info=True)


async def record_exhausted_verdict(db_url: str, job_id: str) -> None:
    """Flip a job whose every attempt was lost to FAILURE and report it; a standing verdict wins."""
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

    try:
        # Conditional: the run may have finalized itself (same sticky-terminal
        # contract as the runner and the ghost-job reaper). Spelled as the enum:
        # the agent runtime's JobStatus lookup is by value ("failure").
        written = await _update_status_if_not_terminal(
            _job_store(db_url), job_id, JobStatus.FAILURE, error=RETRIES_EXHAUSTED_ERROR
        )
        if written:
            logger.error("Job %s marked FAILURE after retry exhaustion", job_id)
            # No run is left to report it: the BFF's run row closes here or never.
            await notify_job_outcome_from_access(
                job_id=job_id, db_url=db_url, status="failure", error=RETRIES_EXHAUSTED_ERROR
            )
        else:
            logger.info("Job %s already terminal; leaving the existing verdict", job_id)
    except Exception:
        logger.exception("Failed to mark exhausted job %s FAILURE", job_id)


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    # Its knowledge layer takes session advisory locks, which need the direct DSN
    # (ADR-0083). It never LISTENs. Fail the boot, not the first lock.
    require_direct_dsns(listen=False)
    assert_no_latent_vendor()
    assert_residency()  # no model call outside the cell's zone (ADR-0167)
    from .research_workflow import run_worker

    run_worker()


if __name__ == "__main__":
    main()
