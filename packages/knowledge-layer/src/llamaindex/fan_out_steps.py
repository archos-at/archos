"""``LlamaIndexIngestor``'s side of the page fan-out port (``agent.knowledge.page_fan_out_port``, ADR-0151).

The agent reaches the knowledge layer through the ingestor (ADR-0072), so the
fan-out's steps are methods of the ingestor, each a call into the module that
does the work: ``extract``, ``read_page``, ``assembly``, ``enrich``.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator
from typing import Any

from agent.knowledge.page_fan_out_port import PageFanOutPort


class PageFanOutSteps(PageFanOutPort):
    """Mixed into ``LlamaIndexIngestor``: the port's methods over the knowledge layer's steps."""

    def extract_step(self, prepared: Any) -> dict[str, Any]:
        from . import extract

        return extract.extract(self, prepared)

    def read_page_step(self, prepared: Any, *, page: int, kind: str, content_hash: str, final: bool) -> dict[str, Any]:
        from . import read_page

        return read_page.read_page(self, prepared, page=page, kind=kind, content_hash=content_hash, final=final)

    @contextlib.contextmanager
    def assembly_scope(self, prepared: Any, extracted: dict[str, Any]) -> Iterator[dict[str, int]]:
        from . import assembly

        with assembly.assembly(prepared, extracted) as counts:
            yield counts

    def enrich_step(self, prepared: Any, name: str, content_hash: str | None) -> dict[str, Any]:
        from . import enrich

        return enrich.enrich_part(self, prepared, name, content_hash)

    def permit_step(self, prepared: Any, content_hash: str | None) -> dict[str, Any]:
        from . import enrich

        return enrich.remember_permit(self, prepared, content_hash)

    def write_rows_step(self, prepared: Any, content_hash: str | None) -> dict[str, Any]:
        from . import enrich

        return enrich.write_rows(self, prepared, content_hash)
