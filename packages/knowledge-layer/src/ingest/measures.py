from __future__ import annotations

import logging
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from agent.knowledge.schema import FileStatus

logger = logging.getLogger(__name__)

INGEST_TRACE_NAME = "ingest-file"

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

STAGE_SECONDS_KEY = "stage_seconds"
COVERAGE_KEY = "coverage"


@contextmanager
def file_trace(file_name: str, config: dict[str, Any], job_id: str):
    from agent.common.licensed_text import licence_from_metadata
    from agent.common.licensed_text import licensed_ingest
    from agent.observability.direct_trace import observed_span

    licence = licence_from_metadata(config)
    with (
        licensed_ingest(licence),
        observed_span(
            INGEST_TRACE_NAME,
            metadata={
                "job_id": job_id,
                "organization_id": config.get("organization_id"),
                "project_id": config.get("project_id"),
                "document_id": config.get("document_id"),
                "file_type": Path(file_name).suffix.lower().lstrip(".") or "none",
                "priority": config.get("priority") or "interactive",
                "licensed": licence is not None and licence.licensed,
            },
        ) as recorder,
    ):
        yield recorder


def _count(value: Any) -> int:
    return value if isinstance(value, int) and value > 0 else 0


def coverage_counts(coverage: dict[str, Any] | None, file_counts: dict[str, Any] | None) -> dict[str, int]:
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
    seconds: dict[str, float] = {}
    reading: dict[str, int] = {}
    for metadata in file_metadata:
        for name, value in (metadata.get(STAGE_SECONDS_KEY) or {}).items():
            seconds[name] = round(seconds.get(name, 0.0) + value, 3)
        for key, value in (metadata.get(COVERAGE_KEY) or {}).items():
            reading[key] = reading.get(key, 0) + value
    return {STAGE_SECONDS_KEY: seconds, COVERAGE_KEY: reading}


def _record_measures(job: Any, detail: Any, stages: dict[str, float], counts: dict[str, int]) -> None:
    if detail is not None:
        detail.metadata[STAGE_SECONDS_KEY] = {name: round(stages[name], 3) for name in STAGES if name in stages}
        detail.metadata[COVERAGE_KEY] = counts
    totals = job_measures([getattr(each, "metadata", None) or {} for each in job.file_details])
    job.metadata = {**(job.metadata or {}), **totals}


def finish_file(
    recorder: Any, job: Any, index: int, stages: dict[str, float], coverage: dict[str, Any] | None = None
) -> None:
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
