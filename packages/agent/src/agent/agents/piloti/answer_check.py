from __future__ import annotations

import re
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

_REFERENCES_SECTION_RE = re.compile(
    r"\n\s*(?:\*\*(?:References|Sources|Quellen):?\*\*|#{2,3}\s+(?:References|Sources|Quellen))\s*(?:\n|$)",
    re.IGNORECASE,
)

_REFERENCE_LINE_RE = re.compile(r"^\s*$|\[\d+\]|<?https?://")


def prose_without_references(content: str) -> str:
    if not isinstance(content, str):
        return ""
    for match in reversed(list(_REFERENCES_SECTION_RE.finditer(content))):
        tail = content[match.end() :]
        if all(_REFERENCE_LINE_RE.search(line) for line in tail.splitlines()):
            return content[: match.start()]
    return content


@dataclass(frozen=True)
class TurnCheck:

    judge: JudgeFn | None = None
    context: tuple[str, ...] = ()


@dataclass(frozen=True)
class Answered:

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
    return [inner for _, inner, _ in _quoted_spans(_answer_body_before_sources(answer_text), MIN_QUOTE_LEN)]


def _question(messages: Sequence[Any]) -> str:
    human = next((msg for msg in reversed(messages) if isinstance(msg, HumanMessage)), None)
    return content_to_text(human.content) if human is not None else ""


def _passages(answered: Answered) -> list[Passage]:
    passages: list[Passage] = []
    seen: set[tuple[str, str]] = set()
    cited = [(f"[{s.number}] {s.entry.citation_key}", s.entry, True) for s in answered.cited if s.number is not None]
    for label, entry, is_cited in [*cited, *((e.citation_key, e, False) for e in answered.registered)]:
        key = (entry.citation_key, entry.chunk_text or "")
        if entry.chunk_text and key not in seen and not is_look_place(entry):
            seen.add(key)
            passages.append(Passage(label, entry.chunk_text, is_cited))
    return passages


def evidence_for(answered: Answered, context: Sequence[str] = (), reason: str | None = None) -> Evidence:
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
        confidence_reason=reason or "",
        passages=passages,
        records=records,
        context=list(context),
        measurements=[value for value in answered.measured_values if value],
        readings=[*answered.readings, *(f"[{s.number}] {s.entry.read}" for s in answered.cited if s.entry.read)],
        quotes_found=found,
        quotes_not_found=not_found,
    )


async def check_answer(
    answered: Answered, check: TurnCheck | None, self_report: str | None, reason: str | None
) -> tuple[dict[str, Any] | None, tuple[str, ...]]:
    from agent.observability.langfuse_trace_attributes import record_trace_metadata

    if self_report is None:
        return None, ()
    check = check or TurnCheck()
    no_judge = Unavailable("no_judge")
    evidence = evidence_for(answered, check.context, reason)
    result = await check.judge(evidence) if check.judge is not None else no_judge
    if isinstance(result, Unavailable):
        unavailable = result.to_wire()
        scores = [*answer_check_scores(None), *answer_check_unavailable_scores(unavailable)]
        record_trace_metadata(answer_check_unavailable=result.cause, answer_check_truncated=result.truncated or None)
        wire: dict[str, Any] = {"status": "unavailable", "unavailable_reason": unavailable}
        open_points: tuple[str, ...] = ()
    else:
        scores = answer_check_scores(result.level, result.open_points)
        wire = {"status": "judged", "level": result.level, "findings": [f.to_wire() for f in result.findings]}
        open_points = result.open_points
    emit_scores(scores, writer="piloti")
    return wire, open_points
