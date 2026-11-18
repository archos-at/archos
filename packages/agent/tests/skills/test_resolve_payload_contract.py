from __future__ import annotations

import json
from pathlib import Path
from unittest import mock

import pytest

from agent.common import cache as shared_cache
from agent.skills.models import Skill
from agent.skills.models import preferred_cards
from agent.skills.models import skill_hidden
from agent.skills.models import skill_title
from agent.skills.resolver import SkillResolver

REPO_ROOT = Path(__file__).resolve().parents[4]
FIXTURE = REPO_ROOT / "tests" / "fixtures" / "skills_resolve" / "resolve_payload.json"

AGENT = "researcher"
ORGANIZATION = "org_1"

STANDARD = "piloti-voice"


def served_rows() -> list[dict]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture(autouse=True)
def _reset_cache():
    shared_cache.reset_local_store()
    yield
    shared_cache.reset_local_store()


@pytest.fixture
def resolved() -> dict[str, Skill]:
    resolver = SkillResolver(agent=AGENT)
    resolver._builtin_by_name = {}
    with mock.patch.object(resolver, "_fetch_org_skills", return_value=served_rows()):
        return {skill.name: skill for skill in resolver.resolve(ORGANIZATION)}


def test_the_guard_is_actually_reading_the_fixture() -> None:
    rows = served_rows()
    assert len(rows) >= 4
    assert STANDARD in {row["name"] for row in rows}


def test_every_served_row_survives_validation(resolved: dict[str, Skill]) -> None:
    assert set(resolved) == {row["name"] for row in served_rows()}


def test_the_standard_row_resolves_as_an_ordinary_skill(resolved: dict[str, Skill]) -> None:
    row = next(row for row in served_rows() if row["name"] == STANDARD)
    assert "standard" not in row, "the BFF stopped serving it; a payload that grew it back retired nothing"
    assert "standard" not in Skill.model_fields
    voice = resolved[STANDARD]
    assert voice.name == STANDARD and voice.body


def test_no_row_in_the_payload_can_impose_itself(resolved: dict[str, Skill]) -> None:
    for skill in resolved.values():
        assert not hasattr(skill, "standard")


def test_the_reserved_metadata_survives_the_crossing(resolved: dict[str, Skill]) -> None:
    voice = resolved[STANDARD]
    assert skill_hidden(voice.metadata) is True
    assert skill_title(voice) == "Piloti-Stimme"
    assert preferred_cards(voice.metadata) == ("calculation",)


def test_a_row_the_platform_did_not_hide_stays_on_the_live_line(resolved: dict[str, Skill]) -> None:
    assert [name for name, skill in resolved.items() if skill_hidden(skill.metadata)] == [STANDARD]


def test_the_body_crosses_too_and_not_just_the_description(resolved: dict[str, Skill]) -> None:
    sampled = {row["name"]: row for row in served_rows()}
    assert resolved[STANDARD].body == sampled[STANDARD]["body"]
    assert resolved[STANDARD].description == sampled[STANDARD]["description"]


def test_the_served_rows_are_org_origin_whatever_the_payload_calls_them(
    resolved: dict[str, Skill],
) -> None:
    assert {skill.origin for skill in resolved.values()} == {"org"}
