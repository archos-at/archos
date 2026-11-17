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

POISON_PAYLOAD_ERROR = "The job payload could not be decrypted or parsed and was quarantined."
RETRIES_EXHAUSTED_ERROR = "research worker retries exhausted"

RETIRED_PAYLOAD_KEYS = frozenset({"scheduler_address", "claim_owner"})


def _replay_kwargs(payload: dict) -> dict:
    return {key: value for key, value in payload.items() if key not in RETIRED_PAYLOAD_KEYS}


class PoisonPayloadError(RuntimeError): ...


def decode_payload(stored: str) -> dict:
    payload = payload_crypto.deserialize(stored)
    if not isinstance(payload, dict):
        raise ValueError(f"job payload decoded to {type(payload).__name__}, not a dict")
    return payload


async def run_stored_job(db_url: str, job_id: str, stored: str, attempt: int | None = None) -> bool:
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
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

    try:
        written = await _update_status_if_not_terminal(
            _job_store(db_url), job_id, JobStatus.FAILURE, error=RETRIES_EXHAUSTED_ERROR
        )
        if written:
            logger.error("Job %s marked FAILURE after retry exhaustion", job_id)
            await notify_job_outcome_from_access(
                job_id=job_id, db_url=db_url, status="failure", error=RETRIES_EXHAUSTED_ERROR
            )
        else:
            logger.info("Job %s already terminal; leaving the existing verdict", job_id)
    except Exception:
        logger.exception("Failed to mark exhausted job %s FAILURE", job_id)


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    require_direct_dsns(listen=False)
    assert_no_latent_vendor()
    assert_residency()  # no model call outside the cell's zone (ADR-0167)
    from .research_workflow import run_worker

    run_worker()


if __name__ == "__main__":
    main()
