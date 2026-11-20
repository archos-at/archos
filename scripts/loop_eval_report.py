from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field

from scripts.loop_eval_rows import _BOOLEAN_FIELDS
from scripts.loop_eval_rows import _DOUBLE_FETCH_FIELDS
from scripts.loop_eval_rows import _RIS_FIELDS
from scripts.loop_eval_rows import Observation
from scripts.loop_eval_rows import family_coverage


@dataclass(frozen=True)
class Summary:
    answered: int = 0
    rounds_total: int = 0
    kind_as_expected: int = 0
    clause_measured: int = 0
    clause_matched: int = 0
    paragraph_measured: int = 0
    paragraph_matched: int = 0
    ris_calls: int = 0
    booleans: dict[str, int] = field(default_factory=dict)
    checkpoint_sources: dict[str, int] = field(default_factory=dict)
    families_touched: int = 0
    families_complete: int = 0
    errors: int = 0


def summarise(rows: Sequence[Observation]) -> Summary:
    booleans = {name: sum(1 for row in rows if getattr(row, name) == "yes") for name in _BOOLEAN_FIELDS}
    sources: dict[str, int] = {}
    for row in rows:
        for token in filter(None, row.checkpoint_sources.split(">")):
            sources[token] = sources.get(token, 0) + 1
    touched = [pair for row in rows for pair in family_coverage(row.family_coverage)]
    return Summary(
        answered=sum(1 for row in rows if not row.error),
        rounds_total=sum(int(row.rounds or 0) for row in rows),
        kind_as_expected=sum(1 for row in rows if row.kind and row.kind == row.expected_kind),
        clause_measured=sum(1 for row in rows if row.clause_match),
        clause_matched=sum(1 for row in rows if row.clause_match == "yes"),
        paragraph_measured=sum(1 for row in rows if row.paragraph_match),
        paragraph_matched=sum(1 for row in rows if row.paragraph_match == "yes"),
        ris_calls=sum(int(row.ris_calls or 0) for row in rows),
        booleans=booleans,
        checkpoint_sources=sources,
        families_touched=len(touched),
        families_complete=sum(1 for _family, opened, listed in touched if listed and opened == listed),
        errors=sum(1 for row in rows if row.error),
    )


_COMPARED_FIELDS = (
    "kind",
    "verdict",
    "rounds",
    "read_passage",
    "clause_match",
    "truncated",
    "checkpoint_sources",
    "family_coverage",
    *_DOUBLE_FETCH_FIELDS,
    *_RIS_FIELDS,
)


def changed_rows(before: Sequence[Observation], after: Sequence[Observation]) -> list[tuple[str, str, str, str]]:
    left = {row.id: row for row in before}
    right = {row.id: row for row in after}
    out: list[tuple[str, str, str, str]] = []
    for question_id in sorted(left.keys() | right.keys()):
        out.extend(_moved_cells(question_id, left.get(question_id), right.get(question_id)))
    return out


def _moved_cells(question_id: str, old: Observation | None, new: Observation | None) -> list[tuple[str, str, str, str]]:
    out: list[tuple[str, str, str, str]] = []
    for name in _COMPARED_FIELDS:
        was = getattr(old, name) if old else "—"
        now = getattr(new, name) if new else "—"
        if was != now:
            out.append((question_id, name, was, now))
    return out


def _delta(was: int, now: int) -> str:
    return f"{was} → {now} ({now - was:+d})"


def format_comparison(before: Sequence[Observation], after: Sequence[Observation]) -> str:
    old, new = summarise(before), summarise(after)
    lines = [
        f"questions: {_delta(len(before), len(after))}",
        f"answered without error: {_delta(old.answered, new.answered)}",
        f"kind as expected: {_delta(old.kind_as_expected, new.kind_as_expected)}",
        f"retrieval rounds, total: {_delta(old.rounds_total, new.rounds_total)}",
        f"cited Punkt matched: {_delta(old.clause_matched, new.clause_matched)}"
        f" of {_delta(old.clause_measured, new.clause_measured)} measured",
        f"cited § matched: {_delta(old.paragraph_matched, new.paragraph_matched)}"
        f" of {_delta(old.paragraph_measured, new.paragraph_measured)} measured",
        f"RIS tool calls, total: {_delta(old.ris_calls, new.ris_calls)}",
    ]
    lines += [f"{name}: {_delta(old.booleans.get(name, 0), new.booleans.get(name, 0))}" for name in _BOOLEAN_FIELDS]
    lines.append(
        f"families read completely: {_delta(old.families_complete, new.families_complete)}"
        f" of {_delta(old.families_touched, new.families_touched)} touched"
    )
    for token in sorted(old.checkpoint_sources.keys() | new.checkpoint_sources.keys()):
        lines.append(
            f"checkpoint source {token}: "
            f"{_delta(old.checkpoint_sources.get(token, 0), new.checkpoint_sources.get(token, 0))}"
        )
    changes = changed_rows(before, after)
    lines.append("")
    lines.append(f"per question ({len(changes)} cell(s) moved):" if changes else "per question: nothing moved")
    lines += [f"  {question_id:34} {name:20} {was} → {now}" for question_id, name, was, now in changes]
    return "\n".join(lines)
