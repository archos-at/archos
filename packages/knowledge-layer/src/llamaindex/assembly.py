"""The page fan-out's write: the usual pipeline over the answers the page tasks stored (ADR-0151).

``assemble-write`` runs ``LlamaIndexIngestor._ingest_job`` inside :func:`assembly`:
the parse ``extract`` stored is read back (``parsed_store``), every answer a
``read_page`` task stored is handed to the file's pool
(``page_reads.answers_read_elsewhere``), so no model is called for a page read
there, and the summary, tags, topics and dossier are left to steps of their own
(``ingest_enrichment.deferred``, ``enrich``). Chunking, embedding (cached), the
write with deterministic ids and the retirement of the previous version are the
pipeline's, unchanged. A page whose answer cannot be read back is read here, as
on the one-step path. Free of the orchestrator's SDK.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator
from typing import Any

from . import step_outputs


def stored_answers(prepared: Any, content_hash: str | None, pages: list[dict[str, Any]]) -> tuple[dict[str, Any], int]:
    """Every answer the page tasks stored, by vision-cache key, and how many pages had none to read back."""
    if not content_hash:
        return {}, 0
    store = step_outputs.for_job(prepared, content_hash)
    answers: dict[str, Any] = {}
    missing = 0
    for entry in pages:
        record = store.get(step_outputs.page_part(entry["page"]))
        if not isinstance(record, dict):
            missing += 1
            continue
        answers.update(record.get("answers") or {})
    return answers, missing


@contextlib.contextmanager
def assembly(prepared: Any, extracted: dict[str, Any]) -> Iterator[dict[str, int]]:
    """The scope the write runs in; yields the counts the step returns (references and counts only)."""
    from . import ingest_enrichment
    from . import page_reads

    content_hash = extracted.get("content_hash")
    answers, missing = stored_answers(prepared, content_hash, extracted.get("pages") or [])
    counts = {"answers": len(answers), "pages_read_here": missing, "enrichment_stored": 0}
    if not content_hash:
        # Nowhere to hand the enrichment to (not a PDF, held, no vision key): it runs in the pipeline.
        with page_reads.answers_read_elsewhere(answers):
            yield counts
        return
    store = step_outputs.for_job(prepared, content_hash)

    def sink(inputs: dict[str, Any]) -> bool:
        stored = store.put(step_outputs.ENRICHMENT_PART, inputs)
        counts["enrichment_stored"] = int(stored)
        return stored

    with page_reads.answers_read_elsewhere(answers), ingest_enrichment.deferred(sink):
        yield counts
