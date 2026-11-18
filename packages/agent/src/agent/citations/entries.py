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
    verified_report: str
    removed_citations: list[dict] = field(default_factory=list)
    valid_citations: list[dict] = field(default_factory=list)


DUPLICATE_REASON_PREFIX = "duplicate_of_citation_"


def lost_citations(removed_citations: Sequence[dict]) -> list[dict]:
    return [
        entry
        for entry in removed_citations
        if not (isinstance(entry, dict) and str(entry.get("reason") or "").startswith(DUPLICATE_REASON_PREFIX))
    ]


def merged_citations(removed_citations: Sequence[dict]) -> dict[int, int]:
    merged: dict[int, int] = {}
    for entry in removed_citations:
        reason = str(entry.get("reason") or "") if isinstance(entry, dict) else ""
        canonical = reason.removeprefix(DUPLICATE_REASON_PREFIX)
        if reason.startswith(DUPLICATE_REASON_PREFIX) and canonical.isdigit() and isinstance(entry.get("number"), int):
            merged[entry["number"]] = int(canonical)
    return merged


class EmptySourceRegistryError(Exception):
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
    name = (tool_name or "").lower()
    return name == LOOK_TOOL or name.endswith(f"__{LOOK_TOOL}")


def is_look_place(entry: SourceEntry) -> bool:
    return bool(entry.read) and not entry.chunk_text
