"""The intake's lookups map one to one onto catalog operations the door offers (design §5.3, ADR-0173)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agent.agents.intake import lookups

EXPOSURE = Path(__file__).resolve().parents[5] / "apps/workspace/tests/fixtures/exposure.json"


@pytest.fixture(scope="module")
def operations() -> dict[str, dict[str, object]]:
    return json.loads(EXPOSURE.read_text(encoding="utf-8"))["operations"]


def test_every_lookup_runs_an_operation_the_door_offers_the_agent(operations):
    for tool, operation in lookups.INTAKE_LOOKUPS.items():
        assert operation in operations, f"{tool}: {operation} is not in the catalog"
        assert operations[operation]["agent"] is True, f"{tool}: the door does not offer {operation} to the agent"


def test_every_native_lookup_is_the_tool_the_catalog_names(operations):
    for tool, operation in lookups.NATIVE_LOOKUPS.items():
        assert operations[operation]["agent"] == f"native:{tool}"


def test_the_tools_are_the_map_one_to_one():
    assert [tool.name for tool in lookups.make_intake_lookup_tools()] == list(lookups.INTAKE_LOOKUPS)


async def test_a_lookup_runs_its_operation_as_the_run_s_person(monkeypatch):
    calls: list[tuple[str, dict[str, object]]] = []

    async def fake_read(name, input):  # noqa: A002 - the server's own argument name
        calls.append((name, input))
        return {"context": {"gate": {"state": "site_unknown"}}}

    monkeypatch.setattr(lookups, "read_operation", fake_read)
    monkeypatch.setattr(lookups, "get_project_id_from_context", lambda: "project_1")
    text = await lookups._project_base_get()
    assert calls == [("project-base-get", {"params": {"id": "project_1"}})]
    assert "site_unknown" in text


async def test_a_lookup_that_cannot_run_says_so(monkeypatch):
    async def refused(name, input):  # noqa: A002, ARG001
        return None

    monkeypatch.setattr(lookups, "read_operation", refused)
    assert "could not run" in await lookups._site_resolve("Herrengasse 16, Graz")
