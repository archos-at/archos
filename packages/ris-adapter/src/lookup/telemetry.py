from __future__ import annotations

import logging
import re

from ris_adapter.lookup.address import Address
from ris_adapter.lookup.extract import MAX_PASSAGES
from ris_adapter.lookup.passages import Passage
from ris_adapter.lookup.trace import LookupTrace
from ris_adapter.register import _capture_lane_hits

logger = logging.getLogger(__name__)


def capture_passages(passages: list[Passage]) -> None:
    _capture_lane_hits([(p.url, p.title or None, p.clause_label or None) for p in passages])


def emit_lookup_span(question: str, address: Address, trace: LookupTrace, passages: list[Passage]) -> None:
    try:
        from types import SimpleNamespace

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
        search_input.update(_span_context(question, address, trace, passages))
        emit_retrieval_span(tool_name="ris_lookup", search_input=search_input, picks=_span_picks(passages))
    except Exception:  # noqa: BLE001 — tracing must never break the lookup
        logger.debug("ris_lookup: retrieval span not emitted", exc_info=True)


def _span_context(question: str, address: Address, trace: LookupTrace, passages: list[Passage]) -> dict:
    from agent.common.turn_status import current_retrieval_round

    context = {
        "round": current_retrieval_round(),
        "tool": "ris_lookup",
        "normalized_query": re.sub(r"\s+", " ", question or "").strip().casefold(),
        "documents_fetched": len(trace.fetched),
        "deterministic": address.has_section,
    }
    if address.federal_state:
        context["federal_state"] = address.federal_state
        context["federal_state_source"] = address.federal_state_source
    if trace.application:
        context["application"] = trace.application
    if trace.as_of:
        context["as_of"] = trace.as_of
        context["versions_dropped"] = trace.versions_dropped
    if not passages:
        context["empty"] = True
    return context


def _span_picks(passages: list[Passage]) -> dict:
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
