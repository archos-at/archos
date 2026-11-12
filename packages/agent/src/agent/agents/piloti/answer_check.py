"""What a Piloti turn hands the answer check, and what it makes of the reply (ADR-0139).

The check itself, one model call grading the answer against its evidence, is
``common/claim_judge.py``. This module is the Piloti side of it: which
evidence a turn registered (:func:`evidence_for`), the turn's judge and turn
context (:func:`turn_check`), and the call with its scores
(:func:`check_answer`). ``answer_pipeline.finalize_answer`` runs it on the
final text, after the quote stamps.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from langchain_core.messages import HumanMessage

from agent.citations.entries import SourceEntry
from agent.citations.entries import is_look_place
from agent.citations.quote_matching import MIN_QUOTE_LEN
from agent.citations.quote_matching import UnverifiedQuote
from agent.citations.quote_verification import _answer_body_before_sources
from agent.citations.quote_verification import _quoted_spans
from agent.common import content_to_text
from agent.common.claim_judge import Evidence
from agent.common.claim_judge import JudgeFn
from agent.common.claim_judge import Passage
from agent.common.claim_judge import Unavailable
from agent.common.workspace_records import records_from_messages
from agent.observability.langfuse_scores import answer_check_scores
from agent.observability.langfuse_scores import answer_check_unavailable_scores
from agent.observability.langfuse_scores import emit_scores


@dataclass(frozen=True)
class TurnCheck:
    """The turn's judge and the turn context it reads beside the evidence (profile, inventory, building law)."""

    judge: JudgeFn | None = None
    context: tuple[str, ...] = ()


@dataclass(frozen=True)
class Answered:
    """What the pipeline knows about the final answer when the check runs."""

    messages: Sequence[Any]
    content: str
    cited: Sequence[Any]
    registered: Sequence[SourceEntry]
    quote_stamps: Sequence[dict[str, Any]]
    unverified_quotes: Sequence[UnverifiedQuote]
    turn: Sequence[Any]
    measured_values: Sequence[str] = ()
    readings: Sequence[str] = ()


def turn_check(state: Any, llm: Any) -> TurnCheck:
    """The turn's check: its judge on the org's follow-ups model (override, BYOK), and the turn context.

    The context carries the turn's ``<building_law>`` block, the records' statement of which edition binds
    at the site and since when (ADR-0175). The answer was told to state the binding edition from it; a
    check without it found every such statement unbacked and graded the answer low (dev QC, 2026-11-12).
    """
    from agent.common.claim_judge import llm_judge
    from agent.common.law_gate import turn_building_law_block
    from agent.common.model_overrides import AgentGroup
    from agent.knowledge.inventory import in_scope_shelves_from_context
    from agent.knowledge.inventory import render_inventory_block
    from agent.stages.runner import resolve_group_llm

    resolved = resolve_group_llm(llm, AgentGroup.FOLLOW_UPS, label="answer check")
    documents = [doc.model_dump() for doc in (getattr(state, "available_documents", None) or [])]
    inventory = render_inventory_block(documents, in_scope_shelves=in_scope_shelves_from_context() or None)
    parts = (getattr(state, "project_context", None), inventory, turn_building_law_block())
    context = tuple(part for part in parts if part)
    return TurnCheck(llm_judge(resolved) if resolved is not None else None, context)


def quoted_spans(answer_text: str) -> list[str]:
    """The quotations in the answer body long enough to check, as written; the check reads which of them held."""
    return [inner for _, inner, _ in _quoted_spans(_answer_body_before_sources(answer_text), MIN_QUOTE_LEN)]


def _question(messages: Sequence[Any]) -> str:
    """The newest question: the last ``HumanMessage``'s text."""
    human = next((msg for msg in reversed(messages) if isinstance(msg, HumanMessage)), None)
    return content_to_text(human.content) if human is not None else ""


def _passages(answered: Answered) -> list[Passage]:
    """The answer's cited passages under the ``[N]`` it shows, then every other passage registered, once each."""
    passages: list[Passage] = []
    seen: set[tuple[str, str]] = set()
    cited = [(f"[{s.number}] {s.entry.citation_key}", s.entry, True) for s in answered.cited if s.number is not None]
    for label, entry, is_cited in [*cited, *((e.citation_key, e, False) for e in answered.registered)]:
        key = (entry.citation_key, entry.chunk_text or "")
        if entry.chunk_text and key not in seen and not is_look_place(entry):
            seen.add(key)
            passages.append(Passage(label, entry.chunk_text, is_cited))
    return passages


def evidence_for(answered: Answered, context: Sequence[str] = ()) -> Evidence:
    """Everything the turn registered that the answer could rest on.

    Passages; this turn's workspace records, never Piloti's own earlier words
    (``workspace_records``), and the turn context; the measurements and
    readings, a cited place's among them; and which quotations the server's
    quote check found in their passage.
    """
    from agent.agents.piloti.answer_pipeline import prose_without_references

    passages = _passages(answered)
    not_found = [quote.quote for quote in answered.unverified_quotes]
    not_found += [stamp["text"] for stamp in answered.quote_stamps if stamp.get("status") == "not_found"]
    found = [stamp["text"] for stamp in answered.quote_stamps if stamp.get("status") == "verbatim"]
    if passages:
        found += [quote for quote in quoted_spans(answered.content) if quote not in not_found]
    records = [f"{r.operation} ({r.outcome}): {r.text}" for r in records_from_messages(answered.turn)]
    return Evidence(
        question=_question(answered.messages),
        answer=prose_without_references(answered.content),
        passages=passages,
        records=[*records, *context],
        measurements=[value for value in answered.measured_values if value],
        readings=[*answered.readings, *(f"[{s.number}] {s.entry.read}" for s in answered.cited if s.entry.read)],
        quotes_found=found,
        quotes_not_found=not_found,
    )


async def check_answer(answered: Answered, check: TurnCheck | None) -> dict[str, Any]:
    """One judge call; the check wire-ready, ``unavailable`` with its reason without a judge or a usable reply.

    Scored, and an unavailable check's cause is the trace's ``answer_check_unavailable``.
    """
    from agent.observability.langfuse_trace_attributes import record_trace_metadata

    check = check or TurnCheck()
    no_judge = Unavailable("no_judge")
    result = await check.judge(evidence_for(answered, check.context)) if check.judge is not None else no_judge
    if isinstance(result, Unavailable):
        reason = result.to_wire()
        scores = [*answer_check_scores(None), *answer_check_unavailable_scores(reason)]
        record_trace_metadata(answer_check_unavailable=result.cause, answer_check_truncated=result.truncated or None)
        wire: dict[str, Any] = {"status": "unavailable", "unavailable_reason": reason}
    else:
        scores = answer_check_scores(result.level)
        wire = {"status": "judged", "level": result.level, "findings": [f.to_wire() for f in result.findings]}
    emit_scores(scores, writer="piloti")
    return wire
