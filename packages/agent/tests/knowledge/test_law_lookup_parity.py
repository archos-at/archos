"""The law lookup answers every recorded call as the RIS tool did: same requests, same text, byte for byte.

The rig, the cases and why parity is the bar: ``agent_testing.law_lookup_parity``.
``golden.json`` is what the RIS tool returned; re-record it only from that tool
(``python -m agent_testing.law_lookup_parity``), never from the lookup it holds.
"""

from __future__ import annotations

import json

import pytest
from agent_testing.law_lookup_parity import CASES
from agent_testing.law_lookup_parity import GOLDEN
from agent_testing.law_lookup_parity import Upstream
from agent_testing.law_lookup_parity import run_ris_lookup

pytestmark = pytest.mark.asyncio

_GOLDEN = json.loads(GOLDEN.read_text(encoding="utf-8"))
_RUNNERS = {"ris_lookup": run_ris_lookup}


def test_every_case_has_its_recording():
    assert sorted(_GOLDEN) == sorted(case.id for case in CASES)


@pytest.mark.parametrize("runner", sorted(_RUNNERS))
@pytest.mark.parametrize("case", CASES, ids=[case.id for case in CASES])
async def test_the_lookup_sends_and_returns_what_the_ris_tool_did(case, runner):
    result = await _RUNNERS[runner](case, Upstream.load())

    # Documents are fetched in parallel, so the order of two fetches is not part of the contract.
    assert sorted(result.requested) == sorted(_GOLDEN[case.id]["requested"])
    assert result.output == _GOLDEN[case.id]["output"]
