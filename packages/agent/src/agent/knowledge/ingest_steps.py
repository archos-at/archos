"""The steps of a page-fan-out ``ingest-document`` run, free of the orchestrator's SDK (ADR-0151).

``INGEST_PAGE_FAN_OUT`` chooses the shape the standard pool's ``ingest-document``
is declared in (``ingest_hatchet``). ``off`` (the default) is two steps: ``index``,
then ``settle``. ``on`` is these, kept for one deploy as the comparison and then
the only shape, with the one-step path deleted in the next change:

1. ``extract`` (:func:`extract`): download, text, tables, triage and the screen's
   pre-verdict; stores the parsed document, answers which pages need a model.
2. ``read-pages``: one ``read-page`` task per such page (:func:`read_page`),
   waited for by a durable step.
3. ``assemble-write``: ``ingest_hatchet.execute`` (the ``index`` attempt, with its
   retries, credit waits and supersede) run inside :func:`assembly`.
4. ``enrich-summary``, ``-tags``, ``-topics``, ``-dossier`` (:func:`enrich`), then
   ``enrich-permit`` (:func:`permit`, only when the tags call for it) and
   ``enrich-write`` (:func:`write_rows`).
5. ``settle``, as in the two-step shape.

Every step reads the job from its encrypted payload and returns references and
counts only. The work itself is the ingestor's, through its port
(``page_fan_out_port``, ADR-0072): ``llamaindex.extract``, ``read_page``,
``assembly`` and ``enrich`` for ``LlamaIndexIngestor``.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from collections.abc import Iterator
from contextlib import AbstractContextManager
from contextlib import contextmanager
from typing import Any

from pydantic import BaseModel

from . import ingest_execution
from . import ingest_run_hold
from . import ingest_status_store
from .base import BaseIngestor
from .base import PreparedIngestJob
from .ingest_failures import credits_in_flight
from .ingest_scheduler import per_org_cap_from_env
from .page_fan_out_port import not_fanned_out
from .page_fan_out_port import steps_of

logger = logging.getLogger(__name__)

#: The settings ``INGEST_PAGE_FAN_OUT`` takes for on; anything else is off.
FAN_OUT_ON = ("on", "true", "1")
#: The four enrichment calls, each a step of its own.
ENRICHMENTS = ("summary", "tags", "topics", "dossier")


# @environment_variable INGEST_PAGE_FAN_OUT
# @category Knowledge Layer
# @type string
# @default off
# @required false
# `on` declares the standard pool's `ingest-document` in steps: extract, one
# `read-page` task per page that needs a model, the write, then the enrichment
# as steps of their own (ADR-0151). `off` keeps the two-step `ingest-document`
# (`index`, `settle`). One deploy's comparison: the next change deletes the
# one-step path and this switch with it. Set it alike on every tier, and flip it
# only with no ingest run in flight, since a run needs the steps it was started with.
def page_fan_out() -> bool:
    """``INGEST_PAGE_FAN_OUT``: whether the standard pool's runs read their pages as tasks of their own."""
    return os.environ.get("INGEST_PAGE_FAN_OUT", "").strip().lower() in FAN_OUT_ON


def _runtime() -> tuple[BaseIngestor, Callable[[str], PreparedIngestJob]]:
    from . import ingest_hatchet

    ingestor, decode = ingest_hatchet._runtime.ingestor, ingest_hatchet._runtime.decode
    if ingestor is None or decode is None:
        raise RuntimeError("the ingest-document steps run only in a process that serves them")
    return ingestor, decode


def _job(payload: str) -> tuple[BaseIngestor, PreparedIngestJob | None]:
    ingestor, decode = _runtime()
    try:
        return ingestor, decode(payload)
    except Exception as error:  # noqa: BLE001 - the write step reports an unreadable payload
        logger.error("An ingest-document step could not read its job (%s)", type(error).__name__)
        return ingestor, None


def extract(payload: str) -> dict[str, Any]:
    """Step 1: the ingestor's ``extract_step``, or no fan-out when the job cannot be read."""
    ingestor, prepared = _job(payload)
    if prepared is None:
        return not_fanned_out("unreadable_job")
    return steps_of(ingestor).extract_step(prepared)


def read_page(payload: str, *, page: int, kind: str, content_hash: str, final: bool) -> dict[str, Any]:
    """Step 2, one page. Raises ``PageNotRead`` for a page that may still be read on a retry."""
    ingestor, prepared = _job(payload)
    if prepared is None:
        return {"page": page, "read": False, "reason": "unreadable_job", "stored": False}
    return steps_of(ingestor).read_page_step(prepared, page=page, kind=kind, content_hash=content_hash, final=final)


def summarize_reads(results: list[Any]) -> dict[str, int]:
    """What ``read-pages`` returns of its page tasks: counts only. A task that raised counts as not read."""
    read = sum(1 for result in results if isinstance(result, dict) and result.get("read"))
    stored = sum(1 for result in results if isinstance(result, dict) and result.get("stored"))
    return {"pages": len(results), "read": read, "not_read": len(results) - read, "stored": stored}


def assembly(
    extracted: dict[str, Any], counts: dict[str, int]
) -> Callable[[PreparedIngestJob], AbstractContextManager[dict[str, int]]]:
    """Step 3's scope for ``ingest_hatchet.execute``: the page answers read back, the enrichment deferred.

    ``counts`` gets the assembly's counts when the scope closes, whatever the run raised.
    """

    @contextmanager
    def scope(prepared: PreparedIngestJob) -> Iterator[dict[str, int]]:
        with steps_of(_runtime()[0]).assembly_scope(prepared, extracted) as inner:
            try:
                yield inner
            finally:
                counts.update(inner)

    return scope


def enrich(payload: str, name: str, content_hash: str | None) -> dict[str, Any]:
    """Step 4, one call: ``summary``, ``tags``, ``topics`` or ``dossier``."""
    ingestor, prepared = _job(payload)
    if prepared is None:
        return {"part": name, "found": False, "permit": False}
    return steps_of(ingestor).enrich_step(prepared, name, content_hash)


def permit(payload: str, content_hash: str | None) -> dict[str, Any]:
    """Step 4, after the tags: the permit record of a Bescheid, or its drop for a document typed otherwise."""
    ingestor, prepared = _job(payload)
    if prepared is None:
        return {"permit": False}
    return steps_of(ingestor).permit_step(prepared, content_hash)


def write_rows(payload: str, content_hash: str | None) -> dict[str, Any]:
    """Step 4's join: the answers onto the file's row."""
    ingestor, prepared = _job(payload)
    if prepared is None:
        return {"written": False}
    return steps_of(ingestor).write_rows_step(prepared, content_hash)


# ---------------------------------------------------------------- settings and pure helpers of the workflows


#: Jobs one organisation may run at once, fleet-wide, when ``INGEST_MAX_PER_ORG``
#: is 0. Sixteen is the prod fleet's document slots (8 ingest pods at 2 each), so
#: an office alone may still use the whole fleet, as it could on the claim queue
#: without a cap; round robin hands the next free slot to the next office.
DEFAULT_MAX_RUNS_PER_ORG = 16
#: The original's size from which a job runs on the high-memory pool.
DEFAULT_HEAVY_FILE_BYTES = 40 * 1024 * 1024
#: Page tasks one page-read worker runs at once: two of them fill the default fleet cap (32).
DEFAULT_PAGE_READ_SLOTS = 16
#: The most pages one file fans out: the OCR cap (500) and the render cap (20), with room.
MAX_FANNED_PAGES = 1000


def _int_env(name: str, default: int, floor: int) -> int:
    try:
        value = int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default
    return value if value >= floor else default


# @environment_variable INGEST_MAX_JOB_SECONDS
# @category Knowledge Layer
# @type int
# @default 7200
# @required false
# The longest one attempt of an ingestion job may run: the `execution_timeout` of
# the `index` step of the `ingest-document` workflows. Past it Hatchet cancels the attempt, the job stops at
# its next check, and the next attempt starts (the last one settles `interrupted`).
def max_job_seconds() -> int:
    """``INGEST_MAX_JOB_SECONDS``; unset, not a number or below one is the default."""
    return _int_env("INGEST_MAX_JOB_SECONDS", 7200, floor=1)


def heavy_file_bytes() -> int:
    """``INGEST_HEAVY_FILE_BYTES``: the original's size from which a job runs heavy; 0 is never."""
    return _int_env("INGEST_HEAVY_FILE_BYTES", DEFAULT_HEAVY_FILE_BYTES, floor=0)


def heavy_worker_slots() -> int:
    """``INGEST_HEAVY_WORKER_SLOTS``: a high-memory worker's slots, all of which its ``index`` takes."""
    return _int_env("INGEST_HEAVY_WORKER_SLOTS", 1, floor=1)


def max_runs_per_org() -> int:
    """The per-organisation ``max_runs``: ``INGEST_MAX_PER_ORG``, or ``DEFAULT_MAX_RUNS_PER_ORG``."""
    return per_org_cap_from_env() or DEFAULT_MAX_RUNS_PER_ORG


class ReadPageInput(BaseModel):
    """One page's task: ids, the page, the version its answers are stored under, the job's encrypted payload."""

    job_id: str
    organization_id: str
    document_id: str | None = None
    page: int
    kind: str
    content_hash: str
    payload: str


def fleet_vision_cap() -> int:
    """The page tasks' fleet cap: ``VLM_FLEET_CONCURRENCY`` as the knowledge layer's lease pool reads it (else 32).

    Read here rather than imported, since the agent reaches the knowledge layer only
    through its ports (ADR-0072); ``test_ingest_page_fan_out.py`` holds the two equal.
    """
    return _int_env("VLM_FLEET_CONCURRENCY", 32, floor=1)


def page_read_slots() -> int:
    """``INGEST_PAGE_READ_SLOTS``: the page tasks one page-read worker runs at once."""
    return _int_env("INGEST_PAGE_READ_SLOTS", DEFAULT_PAGE_READ_SLOTS, floor=1)


def page_runs(run: Any, extracted: dict[str, Any]) -> list[ReadPageInput]:
    """One task input per page ``extract`` listed, at most ``MAX_FANNED_PAGES``."""
    return [
        ReadPageInput(
            job_id=run.job_id,
            organization_id=run.organization_id,
            document_id=run.document_id,
            page=int(entry["page"]),
            kind=str(entry["kind"]),
            content_hash=str(extracted["content_hash"]),
            payload=run.payload,
        )
        for entry in (extracted.get("pages") or [])[:MAX_FANNED_PAGES]
    ]


def workflow_for(byte_size: int | None) -> bool:
    """Whether a job whose original is ``byte_size`` bytes runs heavy; an unknown size does not."""
    threshold = heavy_file_bytes()
    return bool(threshold) and byte_size is not None and byte_size >= threshold


def _stopped(job_id: str, elapsed: float, final: bool) -> dict[str, Any]:
    """The run was cancelled: by its timeout, by a person (``ingest_dispatch.cancel``), or by a newer upload."""
    if elapsed >= max_job_seconds() - 1:
        logger.error("Ingestion job %s ran past %ds and was stopped", job_id, max_job_seconds())
        if final:
            ingest_execution.settle_timed_out(job_id)
        return {"job_id": job_id, "status": "timed_out"}
    if not ingest_run_hold.stopped_by_person(job_id):
        # The engine cancelled it for a newer run of the same document (``SUPERSEDE_LIMIT``).
        ingest_execution.settle_superseded(job_id)
        return {"job_id": job_id, "status": "superseded"}
    # A person stopped it. The cancel settled the row; the run may have written
    # it live again before it saw the cancel, so settle it once more.
    ingest_status_store.settle_cancelled(job_id)
    return {"job_id": job_id, "status": "cancelled"}


def _credits_in_flight(status) -> bool:
    """Whether the job's failure is the provider's in-flight credit 402, on a failed file or the job."""
    messages = [d.error_message for d in status.file_details if d.retryable] or [status.error_message]
    return any(credits_in_flight(message) for message in messages)
