"""What the turn records about a lookup: the ledger and the span.

* the per-round LEDGER (``turn_status.record_lane_hit``): one entry per
  RETURNED passage, not per hit scanned;
* the ``retrieve.<tool>`` SPAN: the same fields ``knowledge_search`` emits,
  because the loop eval's columns read the same spans for both tools.

Fail-open by contract: telemetry is worth strictly less than the answer it
describes and must never take a turn down.
"""

from __future__ import annotations

import logging
import re
from types import SimpleNamespace

from agent.knowledge.law_lookup.address import Address
from agent.knowledge.law_lookup.extract import MAX_PASSAGES
from agent.knowledge.law_lookup.passages import Passage
from agent.knowledge.law_lookup.trace import LookupTrace

logger = logging.getLogger(__name__)


def capture_passages(passages: list[Passage]) -> None:
    """One ledger entry per RETURNED passage: the document, titled, with its provision."""
    try:
        from agent.common.turn_status import record_lane_hit
    except ImportError:
        return
    for passage in passages:
        record_lane_hit(passage.url or "", title=passage.title or None, detail=passage.clause_label or None)


def emit_lookup_span(question: str, address: Address, trace: LookupTrace, passages: list[Passage], tool: str) -> None:
    """One ``retrieve.<tool>`` observation, mirroring ``knowledge_search``."""
    try:
        from agent.observability.retrieval_trace import build_retrieval_input
        from agent.observability.retrieval_trace import emit_retrieval_span

        search_input = build_retrieval_input(
            query=question,
            retrieval_query=trace.searched or None,
            collections=[SimpleNamespace(collection=p.collection, shelf="base") for p in passages],
            candidate_k=len(trace.candidates),
            top_k=MAX_PASSAGES,
            reranked=False,
            dropped_by_floor=0,
        )
        search_input.update(_span_context(question, address, trace, passages, tool))
        emit_retrieval_span(tool_name=tool, search_input=search_input, picks=_span_picks(passages))
    except Exception:  # noqa: BLE001 — tracing must never break the lookup
        logger.debug("law_lookup: retrieval span not emitted", exc_info=True)


def _span_context(question: str, address: Address, trace: LookupTrace, passages: list[Passage], tool: str) -> dict:
    """The half of the span that explains WHY these passages (field names as the eval columns read them)."""
    from agent.common.turn_status import current_retrieval_round

    context = {
        "round": current_retrieval_round(),
        "tool": tool,
        "normalized_query": re.sub(r"\s+", " ", question or "").strip().casefold(),
        "documents_fetched": len(trace.fetched),
        # Whether this call cost a picker call at all: a named provision does not.
        "deterministic": address.has_section,
    }
    if address.territory:
        context["federal_state"] = address.territory
        context["federal_state_source"] = address.territory_source
    if trace.collection:
        context["application"] = trace.collection
    if trace.as_of:
        # A past day (ADR-0171): which day, and how many hits were versions of other days.
        context["as_of"] = trace.as_of
        context["versions_dropped"] = trace.versions_dropped
    if not passages:
        context["empty"] = True
    return context


def _span_picks(passages: list[Passage]) -> dict:
    """The picks themselves: citation keys and provision ids, never passage text."""
    picks: dict = {
        "picked": [{"file": p.citation, "score": round(p.score, 4), "collection": p.collection} for p in passages]
    }
    keys = [p.citation for p in passages if p.citation]
    if keys:
        picks["citation_keys"] = keys
    clause_ids = [p.clause_label for p in passages if p.clause_label]
    if clause_ids:
        picks["clause_ids"] = clause_ids
    return picks
