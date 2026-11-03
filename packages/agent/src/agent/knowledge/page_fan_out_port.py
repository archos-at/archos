"""The ingestor's port for reading a file in steps (ADR-0151, ADR-0072).

The agent reaches the knowledge layer only through the ingestor and retriever
ports (ADR-0072). The page fan-out's steps (``ingest_steps``) are an ingestor's
work, so they are a port too: an ingestor that can read a file in steps also is
a :class:`PageFanOutPort` (``knowledge_layer.llamaindex.fan_out_steps`` gives
``LlamaIndexIngestor`` one); one that is not runs every job whole, in
``assemble-write``, because :func:`steps_of` hands it the defaults here, which
fan nothing out and defer nothing.

Every method returns references and counts only, never a document's text.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator
from typing import Any

from .base import PreparedIngestJob


class PageNotRead(RuntimeError):
    """A page's read failed and its task has retries left: the orchestrator tries the page again."""


def not_fanned_out(reason: str) -> dict[str, Any]:
    """``extract``'s answer for a file left whole to the assembly."""
    return {"fan_out": False, "reason": reason, "content_hash": None, "pages": []}


class PageFanOutPort:
    """The steps of a file read in steps; the defaults read nothing in steps."""

    def extract_step(self, prepared: PreparedIngestJob) -> dict[str, Any]:
        """Parse, store the parse, list the pages that need a model (``page``, ``kind``)."""
        return not_fanned_out("not_supported")

    def read_page_step(
        self, prepared: PreparedIngestJob, *, page: int, kind: str, content_hash: str, final: bool
    ) -> dict[str, Any]:
        """Read one page and store its answers; raise ``PageNotRead`` while ``final`` is false."""
        raise NotImplementedError("this ingestor does not read pages in tasks of their own")

    @contextlib.contextmanager
    def assembly_scope(self, prepared: PreparedIngestJob, extracted: dict[str, Any]) -> Iterator[dict[str, int]]:
        """Where the write runs: the page answers read back, the enrichment deferred to its steps."""
        yield {"answers": 0, "pages_read_here": 0, "enrichment_stored": 0}

    def enrich_step(self, prepared: PreparedIngestJob, name: str, content_hash: str | None) -> dict[str, Any]:
        """One enrichment call (``summary``, ``tags``, ``topics``, ``dossier``), its answer stored."""
        return {"part": name, "found": False, "permit": False}

    def permit_step(self, prepared: PreparedIngestJob, content_hash: str | None) -> dict[str, Any]:
        """The permit record of a document its tags typed."""
        return {"permit": False}

    def write_rows_step(self, prepared: PreparedIngestJob, content_hash: str | None) -> dict[str, Any]:
        """The stored answers onto the file's row."""
        return {"written": False}


_DEFAULTS = PageFanOutPort()


def steps_of(ingestor: Any) -> PageFanOutPort:
    """The ingestor's steps, or the defaults for one that reads every job whole."""
    return ingestor if isinstance(ingestor, PageFanOutPort) else _DEFAULTS
