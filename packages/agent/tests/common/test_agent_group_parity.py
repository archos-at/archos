from __future__ import annotations

import re
from pathlib import Path

import pytest

from agent.common.model_overrides import AgentGroup

_MIRROR = Path("apps/workspace/bff/model-config/agent-groups.ts")


@pytest.fixture(scope="module")
def mirror_source() -> str:
    if not _MIRROR.is_file():
        pytest.skip("frontend not present in this checkout")
    return _MIRROR.read_text(encoding="utf-8")


def _mirrored_ids(source: str) -> set[str]:
    block = re.search(r"AGENT_GROUPS:\s*AgentGroupDefinition\[\]\s*=\s*\[(.*?)\n\]", source, re.DOTALL)
    assert block, "the AGENT_GROUPS registry was not found in the frontend mirror"
    return set(re.findall(r"^\s*id:\s*'([^']+)'", block.group(1), re.MULTILINE))


def test_the_agent_group_ids_match(mirror_source: str):
    assert _mirrored_ids(mirror_source) == {group.value for group in AgentGroup}


def test_the_mirror_actually_parses(mirror_source: str):
    assert len(_mirrored_ids(mirror_source)) >= 5
