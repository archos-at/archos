from __future__ import annotations

import asyncio
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from dataclasses import replace
from functools import partial
from typing import Any

from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage
from langchain_core.tools import BaseTool

from agent.citations.entries import SourceEntry
from agent.citations.entries import is_look_place
from agent.citations.entries import merged_citations
from agent.citations.quote_matching import UnverifiedQuote
from agent.citations.quote_verification import verify_quoted_spans
from agent.citations.references import expand_grouped_citations
from agent.citations.registry import SourceRegistry
from agent.citations.sanitize import sanitize_report
from agent.citations.session import get_turn_captures
from agent.citations.source_identity import agent_authored_document_names
from agent.citations.trailer_values import drop_ungrounded_trailer_values
from agent.citations.verification import verify_citations
from agent.common import content_to_text
from agent.common.answer_dialect import DialectResult
from agent.common.answer_dialect import validate_dialect
from agent.common.answer_envelope import AnswerMeta
from agent.common.envelope_gates import drop_unfiled_proposals
from agent.common.envelope_gates import gate_answer_meta
from agent.common.envelope_parsing import extract_answer_envelope
from agent.common.envelope_parsing import resolve_callout_marker
from agent.common.quote_stamps import stamp_quote_lines
from agent.common.retrieval_status import emit_answer_repair
from agent.common.retrieval_status import emit_citation_check
from agent.common.turn_notices import emit_anatomy_dropped
from agent.common.unlisted_citations import writer_numbering
from agent.common.workspace_records import filed_proposal_ids
from agent.observability.answer_scores import dialect_scores
from agent.observability.answer_scores import quote_patch_scores
from agent.observability.langfuse_scores import dropped_citation_scores
from agent.observability.langfuse_scores import emit_scores
from agent.observability.langfuse_scores import look_scores
from agent.observability.langfuse_scores import work_unfiled_scores
from agent.observability.langfuse_trace_attributes import record_trace_metadata

from .answer_check import Answered
from .answer_check import TurnCheck
from .answer_check import check_answer
from .answer_check import prose_without_references
from .answer_shape import drop_restated_mindmaps
from .card_suppression import _suppress_cards
from .dsml import strip_and_salvage_dsml_tool_calls
from .envelope_cards import CardRepairFn
from .envelope_cards import _handed_markers
from .envelope_cards import _register_envelope_cards
from .markers import detect_and_strip_confidence_marker
from .markers import detect_and_strip_escalation_marker
from .quote_patch import QuotePatchFn
from .quote_patch import patch_quotes
from .quote_patch import select as select_quotes
from .retrieval_attempts import _passage_lookup_attempted
from .retrieval_attempts import _require_retrieval
from .retrieval_attempts import _source_lookup_attempted

logger = logging.getLogger(__name__)

RepairFn = QuotePatchFn


@dataclass(frozen=True)
class CitedSource:
    entry: SourceEntry
    number: int | None


@dataclass(frozen=True)
class FinalAnswer:
    messages: list[Any]
    answered: bool
    content: str | None = None
    citation_grounded: bool = False
    quotes_verified: bool = True
    unverified_quote_count: int = 0
    escalation_requested: bool | None = None
    answer_is_handoff: bool = False
    confidence_marker: str | None = None
    confidence_marker_reason: str | None = None
    escalation_reason: str | None = None
    source_lookup_attempted: bool = False
    answer_meta: dict[str, Any] | None = None
    skills_applied: tuple[str, ...] = ()
    cited: tuple[CitedSource, ...] = ()
    removed_citations: tuple[dict[str, Any], ...] = ()
    quote_stamps: tuple[dict[str, Any], ...] = ()
    dialect_repairs: tuple[dict[str, str], ...] = ()
    confidence_check: dict[str, Any] | None = None
    open_points: tuple[str, ...] = ()
    lookup_found_nothing: bool = False


def answer_index(messages: Sequence[Any]) -> int | None:
    for index in range(len(messages) - 1, -1, -1):
        message = messages[index]
        if isinstance(message, AIMessage) and not message.tool_calls:
            return index
    return None


@dataclass(frozen=True)
class _Extracted:
    content: str
    meta: AnswerMeta | None
    escalation_requested: bool
    confidence: str | None
    confidence_reason: str | None
    escalation_reason: str | None = None


def _skills_applied(meta: AnswerMeta | None) -> tuple[str, ...]:
    if meta is None or not meta.skills_applied:
        return ()
    names: list[str] = []
    for raw in meta.skills_applied:
        name = str(raw).strip().strip("`")
        if name and name not in names:
            names.append(name)
    return tuple(names)


def _extract(raw: str) -> _Extracted:
    content = strip_and_salvage_dsml_tool_calls(raw)
    content, meta = extract_answer_envelope(content)
    content = expand_grouped_citations(content)
    content, escalation = detect_and_strip_escalation_marker(content)
    content, confidence, reason = detect_and_strip_confidence_marker(content)
    escalation_reason: str | None = None
    if meta is not None and meta.escalate_to_deep:
        escalation = True
        escalation_reason = (meta.escalation_reason or "").strip()[:300] or None
    if meta is not None and meta.confidence is not None:
        confidence = meta.confidence.level
        reason = (meta.confidence.reason or "").strip()[:300] or None
    return _Extracted(content, meta, escalation, confidence, reason, escalation_reason)


def this_turn(messages: Sequence[Any]) -> list[Any]:
    for index in range(len(messages) - 1, -1, -1):
        if isinstance(messages[index], HumanMessage):
            return list(messages[index + 1 :])
    return list(messages)


def handed_this_turn(messages: Sequence[Any]) -> frozenset[int]:
    return frozenset(_handed_markers(this_turn(messages)))


@dataclass(frozen=True)
class _Verified:
    content: str
    verification: Any
    unverified_quotes: tuple[UnverifiedQuote, ...]


def _verify(
    content: str,
    registry: SourceRegistry,
    *,
    with_nearest: bool = False,
    numbering: Sequence[SourceEntry | None] | None = None,
) -> _Verified:
    verification = verify_citations(
        content, registry, reference_sources=numbering, drop_unresolved=True, check_locus=True
    )
    logger.debug(
        "Piloti: citation verification complete — %d valid, %d removed",
        len(verification.valid_citations),
        len(verification.removed_citations),
    )
    quotes = verify_quoted_spans(verification.verified_report, registry, with_nearest=with_nearest)
    return _Verified(verification.verified_report, verification, tuple(quotes))


async def _verify_with_quote_patch(
    content: str,
    registry: SourceRegistry,
    patch: RepairFn | None,
    numbering: Sequence[SourceEntry | None] | None = None,
) -> _Verified:
    verified = await asyncio.to_thread(
        partial(_verify, with_nearest=patch is not None, numbering=numbering), content, registry
    )
    if patch is None or not verified.unverified_quotes:
        return verified
    candidates = select_quotes(verified.unverified_quotes)
    if not candidates:
        return verified
    emit_answer_repair(quotes=len(candidates))
    patched, count = await patch_quotes(verified.content, candidates, patch)
    emit_scores(quote_patch_scores(count), writer="piloti")
    if not count:
        return verified
    shipped = await asyncio.to_thread(partial(_verify, numbering=numbering), patched, registry)
    removed = [*verified.verification.removed_citations, *shipped.verification.removed_citations]
    return replace(shipped, verification=replace(shipped.verification, removed_citations=removed))


@dataclass(frozen=True)
class _Grounding:
    content: str
    citation_grounded: bool = False
    cited: tuple[CitedSource, ...] = ()
    unverified_quotes: tuple[UnverifiedQuote, ...] = ()
    removed_citations: tuple[dict[str, Any], ...] = ()


def _entry_for(citation: dict[str, Any], registry: SourceRegistry) -> SourceEntry | None:
    if citation.get("citation_key"):
        return registry.entry_for_citation_key(citation["citation_key"])
    if citation.get("url"):
        return registry.entry_for_url(citation["url"])
    return None


def _cited_sources(valid_citations: Sequence[dict[str, Any]], registry: SourceRegistry) -> tuple[CitedSource, ...]:
    cited: list[CitedSource] = []
    seen: set[int] = set()
    for citation in valid_citations:
        entry = _entry_for(citation, registry)
        if entry is None or id(entry) in seen:
            continue
        seen.add(id(entry))
        number = citation.get("number")
        cited.append(CitedSource(entry, number if isinstance(number, int) else None))
    return tuple(cited)


def _ground(verified: _Verified, registry: SourceRegistry) -> _Grounding:
    content = verified.content
    if verified.unverified_quotes:
        logger.info(
            "Piloti: %d quoted span(s) not verbatim in any retrieved passage; confidence capped",
            len(verified.unverified_quotes),
        )
    common = {
        "unverified_quotes": verified.unverified_quotes,
        "removed_citations": tuple(verified.verification.removed_citations),
    }
    if verified.verification.valid_citations:
        cited = _cited_sources(verified.verification.valid_citations, registry)
        grounded = not cited or any(not is_look_place(source.entry) for source in cited)
        return _Grounding(content, citation_grounded=grounded, cited=cited, **common)
    return _Grounding(content, **common)


def _recite_surface_cards(
    renumber_map: dict[int, int] | None,
    cited: tuple[CitedSource, ...],
    removed_citations: Sequence[dict[str, Any]] = (),
) -> None:
    from agent.cards.registry import get_card_registry
    from agent.cards.surface_citations import recite_surface

    registry = get_card_registry()
    if registry is None:
        return
    numbers = {source.number for source in cited if source.number is not None}
    merged = merged_citations(removed_citations)
    for index, card in enumerate(registry.snapshot()):
        recited = recite_surface(card, renumber_map or {}, numbers, merged)
        if recited is not card:
            registry.replace(index, recited)


def settle_streamed_citations(
    prose: str,
    sources_text: str,
    registry: SourceRegistry,
    *,
    kind: str | None = None,
) -> SettledStream | None:
    from .ledger import wire_sources  # ledger imports this module

    if not sources_text.strip() or not registry.all_sources():
        return None
    verified = _verify(prose.rstrip() + "\n\n" + sources_text.strip(), registry)
    grounding = _ground(verified, registry)
    sanitized = sanitize_report(validate_dialect(grounding.content, kind).text)
    content, _ = drop_restated_mindmaps(sanitized.sanitized_report)
    cited = _renumbered(grounding.cited, sanitized.renumber_map)
    return SettledStream(
        content=content.rstrip(),
        sources=wire_sources(cited),
        renumber_map=dict(sanitized.renumber_map or {}),
        numbers=frozenset(source.number for source in cited if source.number is not None),
        merged=merged_citations(grounding.removed_citations),
    )


@dataclass(frozen=True)
class SettledStream:
    content: str
    sources: list[dict[str, Any]]
    renumber_map: dict[int, int] = field(default_factory=dict)
    numbers: frozenset[int] = frozenset()
    merged: dict[int, int] = field(default_factory=dict)
    answer_meta: dict[str, Any] | None = None


def _renumbered(cited: tuple[CitedSource, ...], renumber_map: dict[int, int] | None) -> tuple[CitedSource, ...]:
    if not renumber_map:
        return cited
    return tuple(
        CitedSource(source.entry, renumber_map.get(source.number, source.number) if source.number is not None else None)
        for source in cited
    )


def _gated_meta(
    extracted: _Extracted,
    content: str,
    registry: SourceRegistry,
    *,
    turn_sources: Sequence[SourceEntry] | None = None,
    filed_proposals: frozenset[str] = frozenset(),
) -> dict[str, Any] | None:
    if extracted.meta is None or extracted.escalation_requested:
        return None
    gated = gate_answer_meta(
        extracted.meta,
        prose_chars=len(prose_without_references(content)),
        prose=prose_without_references(content),
        agent_authored_documents=agent_authored_document_names(registry),
    )
    if gated is None:
        return None
    captures = list(turn_sources) if turn_sources is not None else get_turn_captures()
    grounded = drop_ungrounded_trailer_values(gated, captures)
    if extracted.meta.kind != "work":
        return grounded
    reported, unfiled = drop_unfiled_proposals(grounded, filed_proposals)
    if unfiled:
        emit_anatomy_dropped(field="work", reason="proposal_not_filed")
    emit_scores(work_unfiled_scores(unfiled), writer="piloti")
    return reported


def _held_to_dialect(content: str, meta: AnswerMeta | None) -> DialectResult:
    dialect = validate_dialect(content, meta.kind if meta is not None else None)
    if dialect.census or dialect.repairs:
        record_trace_metadata(answer_dialect=dialect.as_trace())
    emit_scores(dialect_scores(dialect.repairs, dialect.sketches), writer="piloti")
    return dialect


def _trailer_captures(turn_sources: Sequence[SourceEntry] | None) -> list[SourceEntry]:
    return list(turn_sources if turn_sources is not None else get_turn_captures())


async def finalize_answer(
    messages: Sequence[Any],
    *,
    registry: SourceRegistry,
    tools: Sequence[BaseTool],
    repair: RepairFn | None,
    turn_sources: Sequence[SourceEntry] | None = None,
    card_repair: CardRepairFn | None = None,
    measured_values: Sequence[str] = (),
    check: TurnCheck | None = None,
) -> FinalAnswer:
    index = answer_index(messages)
    if index is None or not messages[index].content:
        return FinalAnswer(messages=list(messages), answered=False)
    extracted = _extract(content_to_text(messages[index].content))
    turn = this_turn(messages)
    with_cards = await _register_envelope_cards(extracted.meta, extracted.content, turn, card_repair)
    if with_cards != extracted.content:
        extracted = replace(extracted, content=with_cards)
    sources = registry.all_sources()
    found_nothing = _lookup_found_nothing(extracted.meta, sources, turn, tools)
    grounding = await _verified_grounding(extracted.content, registry, repair, turn, sources)

    dialect = _held_to_dialect(grounding.content, extracted.meta)
    sanitized = sanitize_report(dialect.text)
    content, _ = drop_restated_mindmaps(sanitized.sanitized_report)
    cited = _renumbered(grounding.cited, sanitized.renumber_map)
    _recite_surface_cards(sanitized.renumber_map, cited, grounding.removed_citations)
    meta = _gated_meta(
        extracted,
        content,
        registry,
        turn_sources=_trailer_captures(turn_sources),
        filed_proposals=filed_proposal_ids(turn),
    )
    from agent.tools.look.cards import place_look_cards
    from agent.tools.look.cards import relied_readings
    from agent.tools.look.cards import take_looks

    looks = take_looks()
    looks_made = sum(1 for entry in looks if entry["item"]["origin"] == "look")
    content, meta, _cards_suppressed = _suppress_cards(content, meta)
    place_look_cards(looks, cited)
    content = resolve_callout_marker(content, has_callout=bool(meta and "callout" in meta))
    pairs = [(source.entry, source.number) for source in cited if not is_look_place(source.entry)]
    stamps = await asyncio.to_thread(stamp_quote_lines, content, pairs, registry.all_sources())
    _emit_answer_scores(looks, looks_made, content, cited, readings := relied_readings(looks, cited), grounding)
    seen, quotes = [*_trailer_captures(turn_sources), *sources], grounding.unverified_quotes
    answered = Answered(messages, content, cited, seen, stamps, quotes, turn, measured_values, readings)
    checked, open_points = await check_answer(answered, check, extracted.confidence, extracted.confidence_reason)
    return _final_answer(
        messages,
        index,
        content,
        extracted,
        grounding,
        turn,
        meta=meta,
        cited=cited,
        stamps=stamps,
        dialect=dialect,
        checked=checked,
        open_points=open_points,
        found_nothing=found_nothing,
    )


def _lookup_found_nothing(
    meta: AnswerMeta | None, sources: Sequence[SourceEntry], turn: Sequence[Any], tools: Sequence[BaseTool]
) -> bool:
    if any(not is_look_place(source) for source in sources):
        return False
    ruling = meta is not None and meta.kind == "ruling"
    return _require_retrieval(_passage_lookup_attempted(turn), tools, ruling=ruling)


async def _verified_grounding(
    content: str,
    registry: SourceRegistry,
    repair: RepairFn | None,
    turn: Sequence[Any],
    sources: Sequence[SourceEntry],
) -> _Grounding:
    if sources:
        emit_citation_check(source_count=len(sources))
        numbering = writer_numbering(content, turn)
        verified = await _verify_with_quote_patch(content, registry, repair, numbering)
    else:
        verified = _verify(content, registry)
    return _ground(verified, registry)


def _final_answer(
    messages: Sequence[Any],
    index: int,
    content: str,
    extracted: _Extracted,
    grounding: _Grounding,
    turn: Sequence[Any],
    *,
    meta: dict[str, Any] | None,
    cited: tuple[CitedSource, ...],
    stamps: Sequence[dict[str, Any]],
    dialect: DialectResult,
    checked: dict[str, Any] | None,
    open_points: tuple[str, ...],
    found_nothing: bool,
) -> FinalAnswer:
    final_messages = list(messages)
    final_messages[index] = messages[index].model_copy(update={"content": content})
    return FinalAnswer(
        messages=final_messages,
        answered=True,
        content=content,
        citation_grounded=grounding.citation_grounded,
        quotes_verified=not grounding.unverified_quotes,
        unverified_quote_count=len(grounding.unverified_quotes),
        escalation_requested=extracted.escalation_requested,
        answer_is_handoff=bool(extracted.meta is not None and extracted.meta.kind == "handoff"),
        confidence_marker=extracted.confidence,
        confidence_marker_reason=extracted.confidence_reason,
        escalation_reason=extracted.escalation_reason,
        source_lookup_attempted=_source_lookup_attempted(turn),
        answer_meta=meta,
        skills_applied=_skills_applied(extracted.meta),
        cited=cited,
        removed_citations=grounding.removed_citations,
        quote_stamps=tuple(stamps),
        dialect_repairs=tuple(dialect.repairs),
        confidence_check=checked,
        open_points=open_points,
        lookup_found_nothing=found_nothing,
    )


def _emit_answer_scores(
    looks: Sequence[dict[str, Any]],
    looks_made: int,
    content: str,
    cited: Sequence[CitedSource],
    readings: Sequence[str],
    grounding: _Grounding,
) -> None:
    from agent.tools.look.cards import drawing_value_status

    drawing_value, region_look_first = drawing_value_status(looks, content, cited, readings)
    emit_scores(
        [
            *look_scores(looks=looks_made, drawing_value=drawing_value, region_look_first=region_look_first),
            *dropped_citation_scores(len(grounding.removed_citations)),
        ],
        writer="piloti",
    )
