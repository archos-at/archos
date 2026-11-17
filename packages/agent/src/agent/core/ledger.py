from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any

from agent.citations.entries import SourceEntry
from agent.citations.entries import lost_citations
from agent.citations.source_identity import document_key
from agent.citations.source_identity import source_label
from agent.citations.source_identity import source_origin_token
from agent.citations.wire import read_source_to_wire
from agent.citations.wire import source_entry_to_wire
from agent.common import citation_events
from agent.common.binding_claims import BindingClaim
from agent.common.binding_claims import law_cited_from_web
from agent.common.binding_claims import score_answer
from agent.common.binding_claims import turn_binding_claims
from agent.common.law_gate import law_unsettled
from agent.common.retrieval_ledger import build_retrieval_ledger
from agent.observability.citation_scores import emit_citation_line_scores
from agent.tools.bim.measurement_sources import MeasurementSource
from agent.tools.bim.measurement_sources import measurement_sources_to_wire

from .answer_pipeline import CitedSource
from .answer_pipeline import FinalAnswer
from .markers import CappedReason
from .models import ResearchAgentState

logger = logging.getLogger(__name__)


def citations_removed_summary(removed_citations: Sequence[dict[str, Any]]) -> dict[str, Any] | None:
    removed_citations = lost_citations(removed_citations)
    if not removed_citations:
        return None
    reasons: list[str] = []
    for entry in removed_citations:
        reason = str(entry.get("reason") or "unverifiable") if isinstance(entry, dict) else "unverifiable"
        if reason not in reasons:
            reasons.append(reason)
        if len(reasons) >= 5:
            break
    return {"count": len(removed_citations), "reasons": reasons}


def wire_sources(cited: Sequence[CitedSource]) -> list[dict[str, Any]]:
    wire: list[dict[str, Any]] = []
    for source in cited:
        try:
            wire.append(source_entry_to_wire(source.entry, number=source.number))
        except Exception:  # noqa: BLE001 - one bad entry must not drop the turn's chips
            logger.warning(
                "Skipping source that failed wire serialization: %s",
                source.entry.url or source.entry.citation_key,
                exc_info=True,
            )
    return wire


def read_but_uncited(
    turn_sources: Sequence[SourceEntry],
    cited: Sequence[CitedSource],
) -> list[dict[str, Any]] | None:
    cited_docs = {document_key(source.entry) for source in cited}
    seen: set[str] = set()
    wire: list[dict[str, Any]] = []
    for entry in turn_sources:
        if source_label(entry) is None:
            continue
        key = document_key(entry)
        if key in cited_docs or key in seen:
            continue
        seen.add(key)
        try:
            wire.append(read_source_to_wire(entry))
        except Exception:  # noqa: BLE001 - one bad entry must not drop the turn's disclosure
            logger.warning(
                "Skipping read-but-uncited source that failed wire serialization: %s",
                entry.url or entry.citation_key,
                exc_info=True,
            )
    return wire or None


def record_turn_ledger(
    final: FinalAnswer,
    *,
    turn_sources: Sequence[SourceEntry],
    wire: Sequence[dict[str, Any]],
    capped_reason: CappedReason | None,
) -> None:
    citation_events.record_turn(
        agent="shallow",
        source_count=len(turn_sources),
        cited_count=len(wire),
        removed_citations=list(final.removed_citations),
        unverified_quote_count=final.unverified_quote_count,
        grounded=final.citation_grounded,
        fallback_used=False,
        confidence_capped_reason=capped_reason,
        source_origins=[source_origin_token(entry).strip("[]").lower() or None for entry in turn_sources],
        source_lanes=[source.get("lane") for source in wire],
        source_tools=[entry.tool_name or None for entry in turn_sources],
        retrieved_source_labels=[label for label in map(source_label, turn_sources) if label],
        cited_source_labels=[label for label in ((s.get("citation_key") or s.get("url")) for s in wire) if label],
    )


def _claims_without_records(final: FinalAnswer) -> list[BindingClaim]:
    if not final.answered:
        return []
    cited = [(source.entry, source.number) for source in final.cited]
    claims = turn_binding_claims(final.content, cited)
    score_answer(claims, law_cited_from_web(final.content, cited))
    return claims


def assemble_result(
    graph_result: dict[str, Any],
    final: FinalAnswer,
    *,
    turn_sources: Sequence[SourceEntry],
    turn_measurements: Sequence[MeasurementSource],
    lane_hits: Sequence[dict[str, Any]] = (),
) -> ResearchAgentState:
    measurement_grounded = bool(graph_result.get("answer_measurement_grounded", False))
    claims = _claims_without_records(final)
    wire = wire_sources(final.cited)
    ledger = build_retrieval_ledger(graph_result.get("retrieval_rounds"), lane_hits)
    result: dict[str, Any] = {
        **graph_result,
        "messages": final.messages,
        "answer_citation_grounded": final.citation_grounded,
        "answer_measurement_grounded": measurement_grounded,
        "confidence_check": final.confidence_check,
        "answer_open_points": list(final.open_points),
        "answer_lookup_found_nothing": final.lookup_found_nothing,
        "answer_quotes_verified": final.quotes_verified,
        "answer_law_unsettled": law_unsettled(source.entry for source in final.cited) or bool(claims),
        "escalation_requested": final.escalation_requested,
        "answer_is_handoff": final.answer_is_handoff,
        "answer_confidence_marker": final.confidence_marker,
        "answer_confidence_marker_reason": final.confidence_marker_reason,
        "answer_escalation_reason": final.escalation_reason,
        "source_lookup_attempted": final.source_lookup_attempted,
        "answer_meta": final.answer_meta,
        "skills_applied": list(final.skills_applied) or None,
        "verified_sources": (wire + measurement_sources_to_wire(list(turn_measurements))) or None,
        "read_sources": read_but_uncited(turn_sources, final.cited),
    }
    summary = citations_removed_summary(final.removed_citations)
    if summary is not None:
        result["citations_removed"] = summary
    if ledger is not None:
        result["retrieval_ledger"] = ledger
    if final.quote_stamps:
        result["quote_stamps"] = list(final.quote_stamps)
    state = ResearchAgentState.model_validate(result)
    emit_citation_line_scores(wire, writer="chat")
    if final.answered and (final.source_lookup_attempted or measurement_grounded):
        record_turn_ledger(
            final, turn_sources=turn_sources, wire=wire, capped_reason=state.answer_confidence_capped_reason
        )
    return state
