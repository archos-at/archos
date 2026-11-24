from __future__ import annotations

import re
from collections.abc import Callable
from collections.abc import Collection
from typing import Any

from eval_sets import set_module
from run_record import Run


def _normal(text: str) -> str:
    return text.translate(str.maketrans("₀₁₂₃₄₅₆₇₈₉  ", "0123456789  ")).casefold()


def _family_number(family: str | None) -> str | None:
    match = re.search(r"OIB-RL\s*(\d+(?:\.\d+)?)", str(family or ""), re.IGNORECASE)
    return match.group(1) if match else None


def _card_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [text for item in value.values() for text in _card_strings(item)]
    if isinstance(value, list):
        return [text for item in value for text in _card_strings(item)]
    return []


def _has_shape(shape: str, prose: str, cards: list[Any]) -> bool:
    cards = [card for card in cards if isinstance(card, dict)]
    text = "\n".join([prose, *_card_strings(cards)])
    if shape == "tabs":
        return any(
            card.get("type") == "surface" and any(c.get("component") == "Tabs" for c in card.get("components", []))
            for card in cards
        )
    if shape == "table":
        return bool(re.search(r"^\s*\|.*\|\s*$", text, re.MULTILINE))
    if shape == "diagram":
        return "```mermaid" in text
    blocks = _directive_blocks(text)
    if shape == "plain":
        return not blocks
    if shape in _DIALECT_BLOCKS:
        return shape in blocks
    return False


_DIALECT_BLOCKS = frozenset(
    {"check", "procedure", "cases", "metrics", "compare", "details", "actions", "not-found", "subsumption"}
)
_DIRECTIVE_OPENER = re.compile(r"^[ \t]*:{3,}[ \t]*([A-Za-z][\w-]*)", re.MULTILINE)


def _directive_blocks(text: str) -> set[str]:
    outside = re.sub(r"^[ \t]*(`{3,}|~{3,}).*?^[ \t]*\1[ \t]*$", "", text, flags=re.MULTILINE | re.DOTALL)
    return {name for name in _DIRECTIVE_OPENER.findall(outside) if name in _DIALECT_BLOCKS}


def check(question: dict, run: Run, envelope: dict | None) -> dict[str, bool]:
    checks: dict[str, bool] = {"envelope": envelope is not None}
    if question.get("kind"):
        accepted = [question["kind"], *((question.get("expect") or {}).get("kind_also") or [])]
        checks["kind"] = run.kind in accepted
    module = set_module(question.get("set"))
    if (family := _family_number(question.get("family"))) and getattr(module, "CHECKS_FAMILY", True):
        checks["family_cited"] = family in run.cited_families
    expect = question.get("expect") or {}
    answer = _normal("\n".join([run.answer, *_card_strings((envelope or {}).get("cards") or [])]))
    for item in expect.get("mentions") or []:
        options = item if isinstance(item, list) else [item]
        checks[f"mentions:{options[0]}"] = any(_normal(str(option)) in answer for option in options)
    for item in expect.get("not_mentions") or []:
        checks[f"not:{item}"] = _normal(str(item)) not in answer
    shapes = expect.get("shape")
    if shapes:
        options = shapes if isinstance(shapes, list) else [shapes]
        cards = (envelope or {}).get("cards") or []
        checks[f"shape:{'|'.join(options)}"] = any(_has_shape(option, run.answer, cards) for option in options)
    projects = _office_projects(str(question.get("scenario") or "")) if expect.get("lookup") else None
    checks.update(
        precedent_checks(
            expect, run, answer, question=str(question.get("question") or ""), judge=_judge(), projects=projects
        )
    )
    if callable(
        set_checks := getattr(module, "set_checks", None)
    ):  # after precedent_checks, which clears judge signals
        checks.update(set_checks(question, run, answer, _judge()))
    return checks


def _office_projects(scenario: str) -> list[str]:
    from fixture_bff import DEFAULT_SCENARIO
    from fixture_bff import FixtureOffice

    return FixtureOffice(scenario=scenario or DEFAULT_SCENARIO).project_names()


def _judge() -> Judge | None:
    import judge

    return judge.ask if judge.available() else None


def looked_up(run: Run) -> bool:
    return bool(run.lookups) or any(str(name).endswith("project_lookup") for name in run.tool_calls)


Judge = Callable[[str, str, str], bool | None]

JUDGE_UNAVAILABLE = "judge_unavailable:"
MEANING_CHECKS = ("says_none", "caveat")

_SOURCE_PROJECT = re.compile(
    r"^\s*(?:[-*]\s*)?\[\d+\]\s*\[KB\]\s+[^\n]*?\(([^()\n]+)\)(?:,\s*p\.\s*\d+)?\s*$", re.MULTILINE
)


def sourced_projects(answer: str) -> list[str]:
    return [" ".join(name.split()) for name in _SOURCE_PROJECT.findall(answer)]


def _cited(options: list[Any], question: str, answer: str) -> bool:
    asked = _normal(question)
    return any(_normal(str(option)) in answer for option in options if _normal(str(option)) not in asked)


def precedent_checks(
    expect: dict,
    run: Run,
    answer: str,
    *,
    question: str = "",
    judge: Judge | None = None,
    projects: Collection[str] | None = None,
) -> dict[str, bool]:
    checks: dict[str, bool] = {}
    run.signals[:] = [signal for signal in run.signals if not signal.startswith(JUDGE_UNAVAILABLE)]
    lookup = expect.get("lookup")
    if lookup == "required":
        checks["looked_up"] = looked_up(run)
    elif lookup == "forbidden":
        checks["no_lookup"] = not looked_up(run)
    for group in expect.get("cites") or []:
        options = group if isinstance(group, list) else [group]
        checks[f"cites:{options[0]}"] = _cited(options, question, answer)
    for name in expect.get("not_cites") or []:
        checks[f"not_cites:{name}"] = _normal(str(name)) not in answer
    if projects is not None:
        known = {_normal(" ".join(name.split())) for name in projects}
        checks["real_projects"] = all(_normal(name) in known for name in sourced_projects(run.answer))
    for kind in MEANING_CHECKS:
        if not expect.get(kind):
            continue
        verdict = judge(kind, question, run.answer) if judge is not None and run.answer.strip() else None
        checks[kind] = bool(verdict)
        if verdict is None and run.answer.strip():
            run.signals.append(f"{JUDGE_UNAVAILABLE}{kind}")
    return checks
