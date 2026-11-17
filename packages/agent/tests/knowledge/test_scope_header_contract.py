from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from agent.common.source_kinds import Shelf
from agent.knowledge.scoping import _base64url_decode
from agent.knowledge.scoping import _parse_scope_payload

_FIXTURE = Path(__file__).resolve().parents[4] / "tests" / "fixtures" / "collection_scope" / "scope_header.json"


def _contract() -> dict[str, Any]:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _cases() -> list[dict[str, Any]]:
    return _contract()["cases"]


def _ids() -> list[str]:
    return [case["name"] for case in _cases()]


@pytest.mark.parametrize("case", _cases(), ids=_ids())
def test_agent_reads_every_payload_the_bff_can_write(case: dict[str, Any]) -> None:
    decoded = json.loads(_base64url_decode(case["header"]).decode("utf-8"))

    entries = _parse_scope_payload(decoded)

    assert entries is not None, case["name"]
    actual = [(entry.collection, entry.shelf.value if entry.shelf else None) for entry in entries]
    expected = [(row["collection"], row["shelf"]) for row in case["parsed"]]
    assert actual == expected


def test_a_session_collection_is_its_own_shelf_not_project() -> None:
    entries = _parse_scope_payload([{"collection": "s_conv_abc", "shelf": "session"}])

    assert entries is not None
    assert entries[0].shelf is Shelf.SESSION


def test_a_missing_shelf_is_unknown_and_is_never_defaulted() -> None:
    entries = _parse_scope_payload([{"collection": "some_custom_corpus"}])

    assert entries is not None
    assert entries[0].shelf is None


def test_a_legacy_bare_string_payload_still_reads() -> None:
    entries = _parse_scope_payload(["oib_knowledge", "s_conv_abc"])

    assert entries is not None
    assert [entry.collection for entry in entries] == ["oib_knowledge", "s_conv_abc"]
    assert all(entry.shelf is None for entry in entries)


def test_the_fixture_exercises_every_shelf() -> None:
    covered = {row["shelf"] for case in _cases() for row in case["parsed"] if row["shelf"] is not None}

    assert covered == {shelf.value for shelf in Shelf}
