from __future__ import annotations

import re
from pathlib import Path

import pytest

from agent.common.brand import PRODUCT_NAME
from agent.common.source_kinds import _LANE_KIND_PREFIXES
from agent.common.source_kinds import AGENT_AUTHORED_LANE
from agent.common.source_kinds import AGENT_AUTHORED_LANE_LABEL
from agent.common.source_kinds import DEFAULT_SOURCE_KIND
from agent.common.source_kinds import MAIL_LANE
from agent.common.source_kinds import MAIL_LANE_LABEL
from agent.common.source_kinds import OFFICE_MAIL_LANE
from agent.common.source_kinds import Shelf
from agent.common.source_kinds import shelf_for_qualifier

_MIRROR = Path("apps/workspace/bff/source-kinds.ts")


@pytest.fixture(scope="module")
def mirror_source() -> str:
    if not _MIRROR.is_file():
        pytest.skip("frontend not present in this checkout")
    return _MIRROR.read_text(encoding="utf-8")


def test_the_legacy_qualifier_strings_resolve_to_the_same_shelf(mirror_source: str):
    block = re.search(
        r"CITATION_KEY_QUALIFIERS:[^=]*=\s*\[(.*?)\]\n",
        mirror_source,
        re.DOTALL,
    )
    assert block, "CITATION_KEY_QUALIFIERS not found in the frontend mirror"
    mirrored = re.findall(r"\['([^']*)',\s*'([^']*)'\]", block.group(1))
    assert mirrored, "the frontend mirror declares no legacy qualifiers"
    for label, shelf in mirrored:
        assert shelf_for_qualifier(label) == Shelf(shelf), f"{label!r} disagrees across the two runtimes"
    assert {label for label, _ in mirrored} >= {"Büroablage", "Büroarchiv", "Projektwissen", "Basiswissen"}


def test_the_lane_kind_prefixes_match(mirror_source: str):
    block = re.search(
        r"LANE_KIND_PREFIXES:[^=]*=\s*\[(.*?)\]\n",
        mirror_source,
        re.DOTALL,
    )
    assert block, "LANE_KIND_PREFIXES not found in the frontend mirror"
    mirrored = tuple(re.findall(r"\['([^']*)',\s*'([^']*)'\]", block.group(1)))
    assert mirrored == _LANE_KIND_PREFIXES


def test_the_agent_authored_lane_matches(mirror_source: str):
    key = re.search(r"AGENT_AUTHORED_LANE = '([^']+)'", mirror_source)
    label = re.search(r"AGENT_AUTHORED_LANE_LABEL = PRODUCT_NAME \+ '([^']+)'", mirror_source)
    assert key and label, "the agent-authored lane was not found in the frontend mirror"
    assert key.group(1) == AGENT_AUTHORED_LANE
    assert PRODUCT_NAME + label.group(1) == AGENT_AUTHORED_LANE_LABEL
    assert AGENT_AUTHORED_LANE.startswith("office_")


def test_the_mail_lanes_match(mirror_source: str):
    for name, value in (("MAIL_LANE", MAIL_LANE), ("OFFICE_MAIL_LANE", OFFICE_MAIL_LANE)):
        found = re.search(rf"export const {name} = '([^']+)'", mirror_source)
        assert found, f"{name} was not found in the frontend mirror"
        assert found.group(1) == value
    label = re.search(r"export const MAIL_LANE_LABEL = '([^']+)'", mirror_source)
    assert label and label.group(1) == MAIL_LANE_LABEL
    assert MAIL_LANE.startswith("project_") and OFFICE_MAIL_LANE.startswith("office_")


def test_the_lane_fallback_kinds_match(mirror_source: str):
    block = re.search(r"export const kindForLane =(.*?)\n\}", mirror_source, re.DOTALL)
    assert block, "kindForLane not found in the frontend mirror"
    fallback = re.search(r"return '([^']+)'\s*$", block.group(1).strip())
    assert fallback, "kindForLane's fail-open return was not found"
    assert fallback.group(1) == DEFAULT_SOURCE_KIND
