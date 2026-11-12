"""The memory note guard, held to the table its TypeScript twin reads too.

``tests/fixtures/memory_note_guard_cases.json`` is the one statement of what a
memory note may not hold. ``apps/workspace/bff/knowledge/note-content-guard.spec.ts``
runs the same cases against the BFF's refusal, so the agent's early refusal and
the server's cannot drift apart: a case added for one fails the other until both
agree.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agent.knowledge.memory_content_guard import CONTACT_KINDS
from agent.knowledge.memory_content_guard import SECRET_KINDS
from agent.knowledge.memory_content_guard import note_refusal
from agent.knowledge.project_memory import looks_like_personal_data
from agent.knowledge.project_memory import looks_like_secret

_FIXTURE = Path(__file__).resolve().parents[4] / "tests" / "fixtures" / "memory_note_guard_cases.json"


def _fixture() -> dict:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _cases() -> list[dict]:
    return _fixture()["cases"]


def test_the_fixture_holds_the_kinds_defined_here() -> None:
    assert tuple(_fixture()["secret_kinds"]) == SECRET_KINDS
    assert tuple(_fixture()["contact_kinds"]) == CONTACT_KINDS


@pytest.mark.parametrize("case", _cases(), ids=lambda case: case["name"])
def test_each_case_is_refused_as_the_fixture_says(case: dict) -> None:
    text = case["text"]
    # Every shelf refuses a secret; a shared shelf also refuses a contact detail.
    assert note_refusal(text, shared=False) == case["secret"]
    assert note_refusal(text, shared=True) == (case["secret"] or case["contact"])
    assert looks_like_secret(text) is (case["secret"] is not None)
    assert looks_like_personal_data(text) is (case["secret"] is not None or case["contact"] is not None)


def test_the_table_holds_enough_notes_that_must_pass() -> None:
    passing = [case for case in _cases() if case["secret"] is None and case["contact"] is None]
    assert len(passing) >= 20
