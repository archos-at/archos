"""A deterministic stand-in for the answer check (``common/claim_judge.py``) in unit tests.

The model's grading is not what these tests are about: they test what the
pipeline hands the check and what it does with the reply. The stub answers a
fixed level (``high`` unless told otherwise) and records every
:class:`~agent.common.claim_judge.Evidence` it was asked about.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path

from agent.common.claim_judge import Check
from agent.common.claim_judge import Evidence
from agent.common.claim_judge import Finding
from agent.common.claim_judge import JudgeFn
from agent.common.claim_judge import Level
from agent.common.claim_judge import Passage
from agent.common.claim_judge import Unavailable

#: The measurement set: twelve stored answers with what their turns registered (ADR-0139).
REPO_ROOT = next(path for path in Path(__file__).resolve().parents if (path / "Taskfile.yml").is_file())
STORED_ANSWERS = REPO_ROOT / "tests" / "fixtures" / "answer_check" / "stored_answers_2026-10.json"


def stored_answers() -> list[dict]:
    return json.loads(STORED_ANSWERS.read_text(encoding="utf-8"))["answers"]


def stored_evidence(answer: dict) -> Evidence:
    """What the turn of a stored answer registered, as the check reads it."""
    passages = [Passage(f"[{n}]", text, cited=True) for n, text in (answer.get("passages") or {}).items()]
    passages += [Passage(row["citation_key"], row["text"]) for row in answer.get("turn") or [] if row.get("text")]
    return Evidence(
        question=answer.get("question", ""),
        answer=answer["content"],
        passages=passages,
        context=[answer["project_context"]] if answer.get("project_context") else [],
    )


def stub_judge(
    level: Level = "high",
    findings: Sequence[Finding] = (),
    calls: list[Evidence] | None = None,
    open_points: Sequence[str] = (),
) -> JudgeFn:
    """A judge that always answers ``level``, ``findings`` and ``open_points``, appending each request to ``calls``."""

    async def judge(evidence: Evidence) -> Check | None:
        if calls is not None:
            calls.append(evidence)
        return Check(level, tuple(findings), tuple(open_points))

    return judge


def failing_judge(calls: list[Evidence] | None = None, reason: Unavailable | None = None) -> JudgeFn:
    """A judge that could not run (``reason``, a timeout unless told otherwise): the turn surfaces no level."""

    async def judge(evidence: Evidence) -> Unavailable:
        if calls is not None:
            calls.append(evidence)
        return reason or Unavailable("timeout", error_type="TimeoutError", elapsed_ms=12_000)

    return judge
