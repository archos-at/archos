"""Technical notices a turn records about itself.

Budgets hit, sources withheld or repeated, research cut off, an answer
degraded, a card or verdict dropped.

They travel on the technical channel, for the details panel, never on the live line.
"""

from __future__ import annotations

import logging

from agent.common import turn_status

logger = logging.getLogger(__name__)


BUDGET_SLOT = "budget"


INPUT_BUDGET_SLOT = "budget:input"


COVERAGE_SLOT = "coverage"


def emit_family_coverage(*, family: str, listed: int, opened: int) -> None:
    """Record how much of a Richtlinien-Familie the turn actually read.

    Technical channel, like :func:`emit_checkpoint`, and for the same kind of
    operator question. "OIB-Richtlinie 2" is four documents — 2, 2.1, 2.2,
    2.3 — and an overview answer that opened three of them reads exactly like
    one that opened all four: the prose is fluent, every citation resolves, and
    the missing part is missing in the one way nothing checks. The inventory
    knows the family; the source registry knows what was read; the difference
    is the miss rate, and it was not countable before this event existed.

    Counts only, never filenames: which parts exist is a property of the corpus
    and which were read is a number, and neither needs anybody's document names
    in a trace.

    Args:
        family: The family key as the inventory prints it (``"2"``).
        listed: Members the inventory named for this turn.
        opened: Members a retrieval actually returned a passage from.
    """
    turn_status.emit_technical(f"{COVERAGE_SLOT}:{family}", family=family, listed=listed, opened=opened)


REPEAT_FETCH_SLOT = "repeat"


def emit_repeat_fetch(*, round_index: int, withheld: int) -> None:
    """Record that a round asked again for something this turn already fetched.

    Technical channel and no ``key``: whether the reader should be told "one of
    your searches was a repeat" is a product decision, and shipping a live key
    would make it silently. What this is for is the operator question the guard
    creates — *how often does a model re-fetch inside one turn, and does the
    budget it saves become another round?* — which the truncation event cannot
    answer.

    Args:
        round_index: The fetch round the guard applied to.
        withheld: Calls answered with the explanation instead of being run.
    """
    turn_status.emit_technical(f"{REPEAT_FETCH_SLOT}:{round_index}", round=round_index, withheld=withheld)


REFUSED_SOURCE_SLOT = "refused"


def emit_refused_source(*, round_index: int, withheld: int) -> None:
    """Record that a round called a source this conversation switched off.

    The counterpart of :func:`emit_repeat_fetch`, on the same channel and with
    no ``key`` for the same reason: whether the READER is told "one of your
    searches went to a source you turned off" is a product decision, and a live
    key would make it silently. The operator question it answers is the one the
    toggle creates — *how often does a turn reach for a switched-off source,
    and does the refusal change what it does next?* — which nothing else
    records, because a refused call runs nothing and announces nothing.

    Args:
        round_index: The round the refusal applied to.
        withheld: Calls answered with the refusal instead of being run.
    """
    turn_status.emit_technical(f"{REFUSED_SOURCE_SLOT}:{round_index}", round=round_index, withheld=withheld)


WIDTH_CAP_SLOT = "width"


def emit_width_cap(*, round_index: int, kept: int, withheld: int) -> None:
    """Record that a round asked for more parallel calls than the cap allows.

    Technical channel and no ``key``, like the two guards beside it. A round
    costs one whatever it fans out into, which is deliberate — but the width of
    a fan-out is what the stores feel, and nothing else counts it: a 60-call
    round and a 6-call round are the same single ``status:retrieval:N`` line.

    Args:
        round_index: The round the cap applied to.
        kept: Calls handed to the tools, in the order the model emitted them.
        withheld: Calls answered with the cap notice instead of being run.
    """
    turn_status.emit_technical(f"{WIDTH_CAP_SLOT}:{round_index}", round=round_index, kept=kept, withheld=withheld)


STEERED_SLOT = "steered"


def emit_steered_writes(*, round_index: int, withheld: int) -> None:
    """Record that a round's write calls were held back because a note arrived after the model chose them.

    Technical, like the three guards beside it: the reader sees the note itself
    applied (``steer_applied``); what an operator counts here is how often a
    correction caught a write in flight, which nothing else records, because a
    held call runs nothing.

    Args:
        round_index: The round whose writes were held.
        withheld: Calls answered with the hold notice instead of being run.
    """
    turn_status.emit_technical(f"{STEERED_SLOT}:{round_index}", round=round_index, withheld=withheld)


def emit_research_truncated(
    *,
    ceiling: int,
    research_budget: int,
    spent: int,
    rounds: int,
    shape: list[str] | None = None,
) -> None:
    """Record that evidence-gathering was CUT OFF, not completed.

    Technical channel, and therefore no ``key``: whether the reader should be
    told "this answer stopped early" is a product decision, and shipping a live
    key would make it silently. What this is for is the operator question the
    config comment has been asking in prose for a release — *how often does
    truncation happen, and on which question shapes* — which needs the event to
    exist at all before it can be counted.

    Args:
        ceiling: The ROUND count that triggered forced synthesis.
        research_budget: ``max_tool_iterations``. The same number as ``ceiling``
            now that nothing is reserved on top of it; both are recorded so a
            counted record stays readable across the change.
        spent: Rounds charged when the ceiling was hit. Equal to ``rounds``
            since the budget became one unit per ROUND rather than per emitted
            call; both stay on the record so a record counted before and after
            the change reads the same way, and a reader never has to know which
            release wrote it.
        rounds: LLM turns that asked for tools. Was the pair with ``spent``
            that told one greedy batch from a long walk into the wall — a
            distinction the round budget removes, because a greedy batch is now
            one round and costs one.
        shape: Ordered tool basenames of the run. Names only; a query string is
            the reader's own words and does not belong in telemetry.
    """
    turn_status.emit_technical(
        BUDGET_SLOT,
        truncated=True,
        ceiling=ceiling,
        research_budget=research_budget,
        spent=spent,
        rounds=rounds,
        tools=list(shape) if shape else None,
    )


def emit_input_budget_exhausted(
    *,
    limit: int,
    spent: int,
    rounds: int,
    shape: list[str] | None = None,
) -> None:
    """Record that a turn was cut off by what it COST, not by how far it got.

    The other half of :func:`emit_research_truncated`, and technical for the
    same reason: whether the reader is told "this answer stopped early" is a
    product decision. What this is for is the operator question the bound
    creates the moment it exists — *does it ever fire, and on what?* A stop
    sized above every turn we have measured should be silent for releases at a
    time; the day it is not is either a runaway worth seeing or a ceiling that
    has gone stale, and nothing else in the log tells the two apart.

    Args:
        limit: ``max_input_tokens_per_turn``, the bound that fired.
        spent: Cumulative input tokens the turn had metered when it fired
            (≥ limit: the call that crossed it is never cut off mid-flight).
        rounds: Rounds the turn had spent — the pair with ``spent`` that says
            whether this was one enormous context or many ordinary ones.
        shape: Ordered tool basenames of the run. Names only; a query string is
            the reader's own words and does not belong in telemetry.
    """
    turn_status.emit_technical(
        INPUT_BUDGET_SLOT, truncated=True, limit=limit, spent=spent, rounds=rounds, tools=list(shape) if shape else None
    )


DEEP_BUDGET_SLOT = "budget:deep"


CUTOFF_WALL_CLOCK = "wall_clock"


CUTOFF_STEP_LIMIT = "step_limit"


CUTOFF_RUN_BUDGET = "run_budget"


CUTOFF_UPSTREAM_TIMEOUT = "upstream_timeout"


CUTOFF_USER_REQUESTED = "user_requested"


DEGRADED_NO_REPORT_FILE = "no_report_file"


DEGRADED_NO_VALID_CITATIONS = "no_valid_citations"


DEGRADED_UNVERIFIED_QUOTES = "unverified_quotes"


DEGRADED_CARDS_GENERATION_FAILED = "cards_generation_failed"


DEGRADED_BASIS_UNREAD = "basis_unread"


def emit_deep_research_cutoff(
    *,
    reason: str,
    salvaged: bool,
    source_count: int,
    report_chars: int,
    elapsed_seconds: float | None = None,
) -> None:
    """Record that a DEEP run was cut off, and whether anything survived it.

    Technical channel, like :func:`emit_research_truncated`, and for the same
    operator question: *how often does a deep run run out of clock or steps, and
    when it does, do we still ship something?* Before this existed a cutoff was
    an exception in a log and the run's whole output was discarded, so neither
    half of that question could be answered.

    Args:
        reason: :data:`CUTOFF_WALL_CLOCK` or :data:`CUTOFF_STEP_LIMIT`.
        salvaged: Whether a report was recovered from the partial run.
        source_count: Sources the run had captured when it was cut off — the
            number that decides whether salvage was even allowed.
        report_chars: Length of the salvaged report; 0 when nothing survived.
        elapsed_seconds: Wall-clock the run had spent, when known.
    """
    turn_status.emit_technical(
        DEEP_BUDGET_SLOT,
        truncated=True,
        agent="deep",
        reason=reason,
        salvaged=salvaged,
        source_count=source_count,
        report_chars=report_chars,
        elapsed_seconds=round(elapsed_seconds, 1) if elapsed_seconds is not None else None,
    )


def emit_answer_degraded(*, agent: str, reasons: list[str]) -> None:
    """Record that an answer shipped in a known-weaker form than a clean run.

    The two deep-research cases this exists for both used to be a bare
    ``logger.warning`` beside a ``return``: the writer never persisted a report
    (so the answer is a chat message wearing a report's clothes), and citation
    verification found no valid citations at all (so nothing in the answer is
    provably grounded). Both shipped looking exactly like a good answer.

    Args:
        agent: Which researcher degraded (``deep`` / ``shallow``).
        reasons: Stable tokens, e.g. :data:`DEGRADED_NO_REPORT_FILE`.
    """
    if not reasons:
        return
    turn_status.emit_technical("degraded", agent=agent, degraded=True, reasons=list(reasons))


VERDICT_DROPPED_SLOT = "verdict:dropped"


VERDICT_DROP_AGENT_AUTHORED = "agent_authored_reference"


VERDICT_DROP_UNREFERENCED_WITH_AGENT_SOURCE = "unreferenced_with_agent_source"


CARD_INVALID_SLOT = "card:invalid"


CARD_INVALID_REPAIRED = "repaired"


CARD_INVALID_DROPPED = "dropped"


def emit_card_invalid(*, card_type: str, index: int, outcome: str) -> None:
    """Record that an envelope card failed validation, and what became of it.

    Technical channel, no ``key``: the reader keeps the answer, and a missing
    card is not a sentence for the live line. The operator question is the
    one ``emit_card``'s log line used to answer — WHICH type the model reached
    for and could not fill — plus whether the small model's repair put it
    back. A turn whose card was silently dropped would be indistinguishable
    from one that never earned a card.

    Args:
        card_type: The ``type`` the model declared, ``"?"`` when it declared none.
        index: The card's position in the envelope's ``cards`` array, from 0.
        outcome: :data:`CARD_INVALID_REPAIRED` or :data:`CARD_INVALID_DROPPED`.
    """
    turn_status.emit_technical(f"{CARD_INVALID_SLOT}:{index}", cardType=card_type, outcome=outcome)


ANATOMY_DROPPED_SLOT = "anatomy:dropped"


def emit_anatomy_dropped(*, field: str, reason: str) -> None:
    """Record that an anatomy field other than the verdict was refused.

    Args:
        field: The envelope field, e.g. ``summary``.
        reason: A stable token, e.g. ``too_long``; counted, not read.
    """
    turn_status.emit_technical(ANATOMY_DROPPED_SLOT, field=field, reason=reason)


def emit_verdict_dropped(*, reason: str) -> None:
    """Record that an answer's headline verdict was refused, and why.

    Technical channel and no ``key``, like :func:`emit_research_truncated`: the
    reader keeps the whole answer either way — only the masthead is gone — so
    there is nothing to tell them, while the operator question is real and
    currently unanswerable. *How often does an answer try to rest a normative
    value on a document we wrote ourselves?* is the rate that decides whether
    the prompt-side wording is working, and a gate that drops silently makes it
    uncountable.

    Args:
        reason: A stable token, e.g. :data:`VERDICT_DROP_AGENT_AUTHORED`.
    """
    turn_status.emit_technical(VERDICT_DROPPED_SLOT, reason=reason)
