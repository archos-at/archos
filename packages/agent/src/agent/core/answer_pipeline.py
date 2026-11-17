from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Awaitable
from collections.abc import Callable
from collections.abc import Collection
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from dataclasses import replace
from functools import partial
from typing import Any

from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage
from langchain_core.messages import ToolMessage
from langchain_core.tools import BaseTool
from pydantic import ValidationError

from agent.citations.entries import EmptySourceRegistryError
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
from agent.common import citation_events
from agent.common import content_to_text
from agent.common import get_source_id_for_tool
from agent.common.answer_dialect import DialectResult
from agent.common.answer_dialect import validate_dialect
from agent.common.answer_envelope import TAKEAWAYS_MIN_PROSE_CHARS
from agent.common.answer_envelope import AnswerMeta
from agent.common.answer_envelope import drop_unfiled_proposals
from agent.common.answer_envelope import extract_answer_envelope
from agent.common.answer_envelope import gate_answer_meta
from agent.common.answer_envelope import resolve_callout_marker
from agent.common.quote_stamps import stamp_quote_lines
from agent.common.retrieval_status import emit_answer_repair
from agent.common.retrieval_status import emit_citation_check
from agent.common.tool_validation import validate_tool_availability
from agent.common.turn_notices import emit_anatomy_dropped
from agent.common.unlisted_citations import writer_numbering
from agent.common.workspace_records import filed_proposal_ids
from agent.observability.answer_scores import dialect_scores
from agent.observability.answer_scores import quote_patch_scores
from agent.observability.langfuse_scores import card_validity_score
from agent.observability.langfuse_scores import dropped_citation_scores
from agent.observability.langfuse_scores import emit_scores
from agent.observability.langfuse_scores import formula_provenance_score
from agent.observability.langfuse_scores import look_scores
from agent.observability.langfuse_scores import work_unfiled_scores
from agent.observability.langfuse_trace_attributes import record_trace_metadata

from .answer_check import Answered
from .answer_check import TurnCheck
from .answer_check import check_answer
from .answer_check import prose_without_references
from .answer_shape import drop_restated_mindmaps
from .dsml import strip_and_salvage_dsml_tool_calls
from .markers import detect_and_strip_confidence_marker
from .markers import detect_and_strip_escalation_marker
from .quote_patch import QuotePatchFn
from .quote_patch import patch_quotes
from .quote_patch import select as select_quotes

logger = logging.getLogger(__name__)

RepairFn = QuotePatchFn

CardRepairFn = Callable[[dict[str, Any], str, str], Awaitable[dict[str, Any] | None]]

_CARD_MARKER_NUMBER_RE = re.compile(r"\[\[card:(\d+)\]\]")


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


def _handed_markers(messages: Sequence[Any]) -> set[int]:
    handed: set[int] = set()
    for message in messages:
        if not isinstance(message, ToolMessage):
            continue
        for match in _CARD_MARKER_NUMBER_RE.finditer(content_to_text(message.content)):
            handed.add(int(match.group(1)))
    return handed


def _envelope_index(number: int, handed: Collection[int]) -> int | None:
    if number in handed:
        return None
    offset = max(handed, default=0)
    return number - offset if number > offset else number


def _renumber_envelope_markers(
    content: str,
    *,
    handed: set[int],
    positions: dict[int, int],
    count: int,
    fallbacks: dict[int, str] | None = None,
) -> str:
    if count == 0:
        return content
    fallbacks = dict(fallbacks or {})
    placed: set[int] = set()

    def substitute(match: re.Match[str]) -> str:
        index = _envelope_index(int(match.group(1)), handed)
        if index is None or not 1 <= index <= count:
            return match.group(0)
        position = positions.get(index)
        if position is not None:
            return f"[[card:{position}]]"
        if index in fallbacks and index not in placed:
            placed.add(index)
            return f"\n\n{fallbacks[index]}\n\n"
        return ""

    content = _CARD_MARKER_NUMBER_RE.sub(substitute, content)
    if not fallbacks:
        return content
    trailing = [fallbacks[index] for index in sorted(fallbacks) if index not in placed]
    if trailing:
        content = content.rstrip() + "\n\n" + "\n\n".join(trailing)
    return re.sub(r"\n{3,}", "\n\n", content)


async def _register_envelope_cards(
    meta: AnswerMeta | None,
    content: str,
    messages: Sequence[Any],
    card_repair: CardRepairFn | None,
) -> str:
    from agent.cards.catalog import retired_card_markdown
    from agent.cards.envelope import envelope_card_objects
    from agent.cards.envelope import register_envelope_card
    from agent.cards.registry import get_card_registry

    raw = envelope_card_objects(meta.cards if meta is not None else None)
    if not raw:
        return content
    registry = get_card_registry()
    if registry is None:
        logger.info("answer envelope carried %d card(s) with no card registry bound; dropped", len(raw))
        return content
    handed = _handed_markers(messages)
    checked = await asyncio.gather(
        *(_checked_envelope_card(payload, index, content, card_repair) for index, payload in enumerate(raw))
    )
    positions: dict[int, int] = {}
    fallbacks: dict[int, str] = {}
    for index, validated in enumerate(checked):
        if validated is None:
            markdown = retired_card_markdown(raw[index])
            if markdown:
                fallbacks[index + 1] = markdown
                logger.info("answer envelope's retired '%s' card laid out as Markdown", raw[index].get("type"))
            continue
        await register_envelope_card(registry, validated)
        positions[index + 1] = len(registry)
        provenance = formula_provenance_score(validated, index=len(registry))
        if provenance is not None:
            emit_scores([provenance], writer="piloti")
        logger.info("answer envelope registered a '%s' card as card %d", validated["type"], len(registry))
    return _renumber_envelope_markers(content, handed=handed, positions=positions, count=len(raw), fallbacks=fallbacks)


async def _checked_envelope_card(
    payload: Any, index: int, content: str, card_repair: CardRepairFn | None
) -> dict[str, Any] | None:
    from agent.cards.envelope import REFUSED_SHAPE
    from agent.cards.envelope import validate_model_card
    from agent.cards.formula_card import stated_result_fields
    from agent.common.turn_notices import CARD_INVALID_DROPPED
    from agent.common.turn_notices import CARD_INVALID_REPAIRED
    from agent.common.turn_notices import emit_card_invalid

    validated, refusal = validate_model_card(payload)
    card_type = refusal.card_type if refusal is not None else str(validated["type"])
    if validated is None and refusal is not None and refusal.kind == REFUSED_SHAPE and card_repair is not None:
        repaired = await card_repair(payload, refusal.for_repair(), content)
        if repaired is not None:
            validated, _ = validate_model_card(repaired)
        if validated is not None:
            emit_card_invalid(card_type=card_type, index=index, outcome=CARD_INVALID_REPAIRED)
            emit_scores([card_validity_score(outcome="repaired", card_type=card_type, index=index)], writer="piloti")
    if validated is None:
        emit_card_invalid(card_type=card_type, index=index, outcome=CARD_INVALID_DROPPED)
        emit_scores([card_validity_score(outcome="dropped", card_type=card_type, index=index)], writer="piloti")
        return None
    stated = stated_result_fields(payload)
    if stated:
        logger.info("envelope card %d (%s): %d stated result field(s) removed", index, card_type, stated)
        emit_scores(
            [card_validity_score(outcome="stripped", card_type=card_type, index=index, fields=stated)],
            writer="piloti",
        )
    return validated


def this_turn(messages: Sequence[Any]) -> list[Any]:
    for index in range(len(messages) - 1, -1, -1):
        if isinstance(messages[index], HumanMessage):
            return list(messages[index + 1 :])
    return list(messages)


def _source_lookup_attempted(messages: Sequence[Any]) -> bool:
    return any(
        isinstance(msg, ToolMessage) and get_source_id_for_tool(getattr(msg, "name", "") or "") is not None
        for msg in messages
    )


RECORD_TOOLS = frozenset({"project_lookup"})


def _passage_lookup_attempted(messages: Sequence[Any]) -> bool:
    return any(
        isinstance(msg, ToolMessage)
        and (name := getattr(msg, "name", "") or "") not in RECORD_TOOLS
        and get_source_id_for_tool(name) is not None
        for msg in messages
    )


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


def _require_retrieval(lookup_attempted: bool, tools: Sequence[BaseTool], *, ruling: bool) -> bool:
    if not lookup_attempted:
        logger.debug("Piloti: answered without querying any data-source tool; no verification")
        return False
    _, available_count, unavailable = validate_tool_availability(
        list(tools), research_type="research", enable_logging=False
    )
    citation_events.record_empty_registry(
        agent="shallow", unavailable_tools=unavailable, available_count=available_count
    )
    if ruling:
        raise EmptySourceRegistryError("research", unavailable_tools=unavailable, available_count=available_count)
    logger.info("Piloti: a lookup found nothing; the answer ships labelled as model knowledge")
    return True


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


class LiveAnswer:
    def __init__(self, registry: SourceRegistry, *, handed: Collection[int] = ()) -> None:
        self._registry = registry
        self._handed = frozenset(handed)
        self._settled: SettledStream | None = None
        self._tool_cards: list[dict[str, Any]] | None = None

    def masthead(self, fields: dict[str, Any], prose: str = "") -> dict[str, Any] | None:
        from agent.common.answer_envelope import MASTHEAD_FIELDS

        try:
            meta = AnswerMeta.model_validate({key: value for key, value in fields.items() if key in MASTHEAD_FIELDS})
        except ValidationError:
            return None
        gated = gate_answer_meta(
            meta,
            prose_chars=len(prose),
            prose=prose,
            agent_authored_documents=agent_authored_document_names(self._registry),
            record=False,
        )
        if gated is None:
            return None
        grounded = drop_ungrounded_trailer_values(gated, get_turn_captures()) or {}
        head = {key: value for key, value in grounded.items() if key in MASTHEAD_FIELDS}
        return {"v": grounded.get("v"), **head} if head else None

    def settle(self, prose: str, sources_text: str, fields: dict[str, Any] | None) -> SettledStream | None:
        settled = settle_streamed_citations(
            prose,
            sources_text,
            self._registry,
            kind=(fields or {}).get("kind"),
        )
        if settled is None:
            return None
        meta = self.masthead(fields, prose_without_references(settled.content)) if fields else None
        self._settled = replace(settled, answer_meta=meta)
        return self._settled

    def tool_cards(self) -> list[dict[str, Any]]:
        if self._tool_cards is None:
            from agent.cards.registry import get_card_registry

            registry = get_card_registry()
            self._tool_cards = registry.snapshot() if registry is not None else []
        return list(self._tool_cards)

    def place(self, text: str) -> str:
        tools = len(self.tool_cards())
        if not tools and not self._handed:
            return text

        def substitute(match: re.Match[str]) -> str:
            index = _envelope_index(int(match.group(1)), self._handed)
            return match.group(0) if index is None or index < 1 else f"[[card:{tools + index}]]"

        return _CARD_MARKER_NUMBER_RE.sub(substitute, text)

    def card(self, payload: Any) -> dict[str, Any] | None:
        from agent.cards.envelope import validate_model_card
        from agent.cards.surface_citations import recite_surface

        card, _refusal = validate_model_card(payload)
        if card is None:
            return None
        settled = self._settled or SettledStream(content="", sources=[])
        return recite_surface(card, settled.renumber_map, settled.numbers, settled.merged)


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


_CARD_SUPPRESS_MIN_PROSE_CHARS = 400

_CARD_MARKER_RE = re.compile(r"\[\[card:\d+\]\]")


def _should_suppress_meta_cards(content: str, gated_meta: dict[str, Any] | None) -> bool:
    if not gated_meta:
        return False
    try:
        prose_chars = len(prose_without_references(content))
    except Exception:
        return False
    if prose_chars >= _CARD_SUPPRESS_MIN_PROSE_CHARS:
        return False
    if gated_meta.get("verdict") is not None:
        return False
    return gated_meta.get("kind") not in ("ruling", "work")


def _suppress_cards(content: str, gated_meta: dict[str, Any] | None) -> tuple[str, dict[str, Any] | None, bool]:
    if not _should_suppress_meta_cards(content, gated_meta):
        return content, gated_meta, False
    try:
        from agent.cards.envelope import is_floor_exempt
        from agent.cards.registry import get_card_registry as _get_registry_for_guard

        _guard_registry = _get_registry_for_guard()
        if _guard_registry is not None and any(is_floor_exempt(card) for card in _guard_registry.snapshot()):
            logger.info("Piloti: answer cards suppressed: veto card present, keeping cards and meta")
            return content, gated_meta, False
    except Exception:
        logger.debug("Suppression veto guard skipped", exc_info=True)
    try:
        prose_chars = len(prose_without_references(content))
    except Exception:
        prose_chars = -1
    logger.info(
        "Piloti: answer cards suppressed: prose %d chars under the %d floor with no verdict",
        prose_chars,
        _CARD_SUPPRESS_MIN_PROSE_CHARS,
    )
    try:
        from agent.cards.registry import get_card_registry

        registry = get_card_registry()
        if registry is not None and len(registry) > 0:
            logger.info("Piloti: answer cards suppressed: dropping %d tool-registered card(s)", len(registry))
            registry.clear()
    except Exception:
        logger.debug("Card registry suppression skipped", exc_info=True)
    try:
        stripped = _CARD_MARKER_RE.sub("", content)
        stripped = re.sub(r"\n{3,}", "\n\n", stripped).strip()
        content = stripped
    except Exception:
        pass
    if prose_chars >= TAKEAWAYS_MIN_PROSE_CHARS:
        return content, gated_meta, True
    kept = {key: value for key, value in (gated_meta or {}).items() if key in ("v", "callout")}
    return content, (kept if "callout" in kept else None), True


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
    found_nothing = False
    if not any(not is_look_place(source) for source in sources):
        ruling = extracted.meta is not None and extracted.meta.kind == "ruling"
        found_nothing = _require_retrieval(_passage_lookup_attempted(turn), tools, ruling=ruling)
    if sources:
        emit_citation_check(source_count=len(sources))
        numbering = writer_numbering(extracted.content, turn)
        verified = await _verify_with_quote_patch(extracted.content, registry, repair, numbering)
    else:
        verified = _verify(extracted.content, registry)
    grounding = _ground(verified, registry)

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
