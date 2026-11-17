from __future__ import annotations

import logging

from agent.common import turn_status

logger = logging.getLogger(__name__)


BUDGET_SLOT = "budget"


INPUT_BUDGET_SLOT = "budget:input"


COVERAGE_SLOT = "coverage"


def emit_family_coverage(*, family: str, listed: int, opened: int) -> None:
    turn_status.emit_technical(f"{COVERAGE_SLOT}:{family}", family=family, listed=listed, opened=opened)


REPEAT_FETCH_SLOT = "repeat"


def emit_repeat_fetch(*, round_index: int, withheld: int) -> None:
    turn_status.emit_technical(f"{REPEAT_FETCH_SLOT}:{round_index}", round=round_index, withheld=withheld)


REFUSED_SOURCE_SLOT = "refused"


def emit_refused_source(*, round_index: int, withheld: int) -> None:
    turn_status.emit_technical(f"{REFUSED_SOURCE_SLOT}:{round_index}", round=round_index, withheld=withheld)


WIDTH_CAP_SLOT = "width"


def emit_width_cap(*, round_index: int, kept: int, withheld: int) -> None:
    turn_status.emit_technical(f"{WIDTH_CAP_SLOT}:{round_index}", round=round_index, kept=kept, withheld=withheld)


STEERED_SLOT = "steered"


def emit_steered_writes(*, round_index: int, withheld: int) -> None:
    turn_status.emit_technical(f"{STEERED_SLOT}:{round_index}", round=round_index, withheld=withheld)


def emit_research_truncated(
    *,
    ceiling: int,
    research_budget: int,
    spent: int,
    rounds: int,
    shape: list[str] | None = None,
) -> None:
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
    turn_status.emit_technical(f"{CARD_INVALID_SLOT}:{index}", cardType=card_type, outcome=outcome)


ANATOMY_DROPPED_SLOT = "anatomy:dropped"


def emit_anatomy_dropped(*, field: str, reason: str) -> None:
    turn_status.emit_technical(ANATOMY_DROPPED_SLOT, field=field, reason=reason)


def emit_verdict_dropped(*, reason: str) -> None:
    turn_status.emit_technical(VERDICT_DROPPED_SLOT, reason=reason)
