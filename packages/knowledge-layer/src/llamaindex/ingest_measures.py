"""What one file's ingest took and what of it was read, on its trace and on its job's status.

The ``[ingest-perf]`` line (``adapter._log_ingest_perf``) is logged at INFO, and
only WARN and above reaches PostHog, so where an ingest's time went was visible
only to someone reading a pod's log. The same seconds and the reading coverage
now go onto the job's status ``metadata`` (``stage_seconds``, ``coverage``),
which the BFF reads when it settles the row and puts on
``document_ingest_finished`` (``apps/workspace/bff/analytics/ingest-events.ts``).
Counts and seconds only: never a file name or anything read from the file.

Each file's measures are kept on its own record (``file_details[i].metadata``)
and the job's are their sum, so a one-file job (every upload the BFF
dispatches) reports that file.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from agent.knowledge.schema import FileStatus

logger = logging.getLogger(__name__)

#: The Langfuse trace one file's ingest is recorded under (:func:`file_trace`).
INGEST_TRACE_NAME = "ingest-file"

#: Every stage a file's seconds are reported in, in pipeline order.
STAGES = (
    "text",
    "tables",
    "screen",
    "ocr",
    "renders",
    "rasters",
    "vision",
    "summary",
    "dossier",
    "embedding",
    "write",
)

#: The job-status ``metadata`` keys this module writes.
STAGE_SECONDS_KEY = "stage_seconds"
COVERAGE_KEY = "coverage"


def file_trace(file_name: str, config: dict[str, Any], job_id: str):
    """The Langfuse trace one file's ingest runs under: ids and the file type, never its text."""
    from agent.observability.direct_trace import observed_span

    return observed_span(
        INGEST_TRACE_NAME,
        metadata={
            "job_id": job_id,
            "organization_id": config.get("organization_id"),
            "project_id": config.get("project_id"),
            "document_id": config.get("document_id"),
            "file_type": Path(file_name).suffix.lower().lstrip(".") or "none",
            "priority": config.get("priority") or "interactive",
        },
    )


def _count(value: Any) -> int:
    return value if isinstance(value, int) and value > 0 else 0


def coverage_counts(coverage: dict[str, Any] | None, file_counts: dict[str, Any] | None) -> dict[str, int]:
    """The reading counts of one file. Pure.

    ``coverage`` is ``knowledge_layer.coverage``'s record (``None`` for a file
    without pages, such as a text file); ``file_counts`` is the file's job-status
    ``metadata``, where the caps were counted (``drawing_pages_over_cap``,
    ``images_over_cap``).
    """
    counts = file_counts or {}
    out = {
        "pages_over_render_cap": _count(counts.get("drawing_pages_over_cap")),
        "rasters_over_cap": _count(counts.get("images_over_cap")),
    }
    if coverage:
        pages, not_read = _count(coverage.get("pages")), _count(coverage.get("not_read"))
        out |= {"pages": pages, "pages_fully_read": max(0, pages - not_read), "pages_not_read": not_read}
    return out


def job_measures(file_metadata: list[dict[str, Any]]) -> dict[str, Any]:
    """The job's ``stage_seconds`` and ``coverage``: its files' measures summed. Pure.

    Summed from every file's own record each time rather than added onto the
    job's, so a job that runs again (a retry) reports its last run, not both.
    """
    seconds: dict[str, float] = {}
    reading: dict[str, int] = {}
    for metadata in file_metadata:
        for name, value in (metadata.get(STAGE_SECONDS_KEY) or {}).items():
            seconds[name] = round(seconds.get(name, 0.0) + value, 3)
        for key, value in (metadata.get(COVERAGE_KEY) or {}).items():
            reading[key] = reading.get(key, 0) + value
    return {STAGE_SECONDS_KEY: seconds, COVERAGE_KEY: reading}


def _record_measures(job: Any, detail: Any, stages: dict[str, float], counts: dict[str, int]) -> None:
    """Put one file's measures on its own record, then the job's totals on the job's ``metadata``."""
    if detail is not None:
        detail.metadata[STAGE_SECONDS_KEY] = {name: round(stages[name], 3) for name in STAGES if name in stages}
        detail.metadata[COVERAGE_KEY] = counts
    totals = job_measures([getattr(each, "metadata", None) or {} for each in job.file_details])
    job.metadata = {**(job.metadata or {}), **totals}


def finish_file(
    recorder: Any, job: Any, index: int, stages: dict[str, float], coverage: dict[str, Any] | None = None
) -> None:
    """Write the file's outcome on its trace and its measures on the job's status. Never raises."""
    try:
        detail = job.file_details[index] if index < len(job.file_details) else None
        _record_measures(job, detail, stages, coverage_counts(coverage, getattr(detail, "metadata", None)))
        status = getattr(getattr(detail, "status", None), "value", None)
        error = getattr(detail, "error_message", None)
        output: dict[str, Any] = {
            "status": status,
            **{f"seconds_{name}": round(value, 3) for name, value in stages.items()},
        }
        output["seconds_total"] = round(sum(stages.values()), 3)
        for key in ("pages", "drawings", "drawings_read", "transcribed", "not_read"):
            if coverage and key in coverage:
                output[f"pages_{key}" if key != "pages" else "pages"] = coverage[key]
        recorder.finish(output, failed=error if status == FileStatus.FAILED.value else None)
    except Exception:  # noqa: BLE001 - telemetry never fails an ingest
        logger.debug("Could not finish the ingest trace", exc_info=True)
