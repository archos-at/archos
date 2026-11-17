"""What a cited source is (``SourceEntry``) and what a verification run reports (``CitationVerificationResult``)."""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from html import unescape
from urllib.parse import parse_qs
from urllib.parse import unquote
from urllib.parse import urlparse
from urllib.parse import urlunparse

from agent.common.grounding_block import SourceRegion

logger = logging.getLogger(__name__)


@dataclass
class SourceEntry:
    """A single source captured from a tool call result."""

    url: str | None = None
    title: str | None = None
    citation_key: str | None = None
    source_type: str = ""
    tool_name: str = ""
    collection: str | None = None
    shelf: str | None = None
    doc_class: str | None = None
    authored_by: str | None = None
    source_format: str | None = None
    chunk_text: str | None = None
    clause: str | None = None
    score: float | None = None
    regions: list[SourceRegion] = field(default_factory=list)
    page_end: int | None = None
    read: str | None = None
    project_id: str | None = None
    project_name: str | None = None
    project_status: str | None = None
    project_federal_state_note: str | None = None
    work_id: str | None = None
    edition_id: str | None = None
    public_url: str | None = None
    retrieved_at: str | None = None
    revision_index: str | None = None
    revision_date: str | None = None


@dataclass
class CitationVerificationResult:
    """Result of running verify_citations()."""

    verified_report: str
    removed_citations: list[dict] = field(default_factory=list)
    valid_citations: list[dict] = field(default_factory=list)


DUPLICATE_REASON_PREFIX = "duplicate_of_citation_"


def lost_citations(removed_citations: Sequence[dict]) -> list[dict]:
    """The removals that cost the answer a citation: every one except a merged duplicate.

    Two Punkte read from one page are one registry entry, so an answer that
    lists "file.pdf, p.4" twice gets the second merged into the first. Counted
    as a failure, that merge bought a full repair rewrite (16 s, measured in
    the September 2026 census) and a "Belege entfernt" note for a citation the
    reader still has. Telemetry keeps the full list; the reader's note reads
    this one (``ledger.citations_removed_summary`` on chat, ``finalize`` in
    deep research).
    """
    return [
        entry
        for entry in removed_citations
        if not (isinstance(entry, dict) and str(entry.get("reason") or "").startswith(DUPLICATE_REASON_PREFIX))
    ]


def merged_citations(removed_citations: Sequence[dict]) -> dict[int, int]:
    """Each merged duplicate's number and the number it was rewritten to, before renumbering.

    The removals :func:`lost_citations` leaves out: ``verify_citations``
    rewrote the prose's ``[N]`` of each to the line it duplicates. Anything
    else that carries the answer's numbers (a surface's ``Text``) takes the
    same rewrite before sanitize's renumbering, or loses the citation.
    """
    merged: dict[int, int] = {}
    for entry in removed_citations:
        reason = str(entry.get("reason") or "") if isinstance(entry, dict) else ""
        canonical = reason.removeprefix(DUPLICATE_REASON_PREFIX)
        if reason.startswith(DUPLICATE_REASON_PREFIX) and canonical.isdigit() and isinstance(entry.get("number"), int):
            merged[entry["number"]] = int(canonical)
    return merged


class EmptySourceRegistryError(Exception):
    """Raised when no sources were captured during research."""

    def __init__(
        self,
        agent_type: str = "research",
        unavailable_tools: list[str] | None = None,
        available_count: int = 0,
    ) -> None:
        self.agent_type = agent_type
        self.unavailable_tools = unavailable_tools or []
        self.available_count = available_count
        super().__init__(
            f"Research failed: no sources were captured during {agent_type}. "
            "All tool calls may have failed or returned no results. "
            "Please try again."
        )


_TRACKING_PARAMS = frozenset(
    {
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "ref",
        "source",
    }
)


def normalize_url(url: str) -> str:
    """Normalize a URL for comparison.

    Lowercases scheme/host, strips trailing slash, removes fragments
    and common tracking parameters.
    """
    url = unescape(url).strip()
    parsed = urlparse(url)
    scheme = parsed.scheme.lower()
    netloc = parsed.netloc.lower()
    path = unquote(parsed.path).rstrip("/") or "/"
    qs = parse_qs(parsed.query, keep_blank_values=True)
    filtered_qs = {k: v for k, v in qs.items() if k.lower() not in _TRACKING_PARAMS}
    query_str = "&".join(f"{k}={v[0]}" for k, v in sorted(filtered_qs.items()) if v)
    return urlunparse((scheme, netloc, path, "", query_str, ""))


UNVERIFIED_QUOTE_MARKER = "[nicht wörtlich in der Quelle belegt]"
DROPPED_CITATION_MARKER = "[Beleg nicht verifiziert]"


LOCUS_MISMATCH_REASON = "locus_not_in_source"


NO_SOURCE_REASON = "no_source_retrieved"


LOOK_TOOL = "look"


def is_look_tool(tool_name: str) -> bool:
    """Whether ``tool_name`` is ``look`` (bare, or as a member of a function group)."""
    name = (tool_name or "").lower()
    return name == LOOK_TOOL or name.endswith(f"__{LOOK_TOOL}")


def is_look_place(entry: SourceEntry) -> bool:
    """Whether the entry is a place a look read and no retrieved passage.

    Such a source is evidence of what Piloti read off a drawing. It is never
    ``citation_grounded`` and never grounds a claim about the law (ADR-0125,
    amendment of 2026-10-22).
    """
    return bool(entry.read) and not entry.chunk_text
