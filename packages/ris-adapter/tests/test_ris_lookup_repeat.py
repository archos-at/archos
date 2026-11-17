from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


async def test_the_second_identical_lookup_downloads_nothing(lookup, catalog):
    first = await lookup.run(question="Was verlangt § 63 BO Wien?", instrument="BO Wien")
    second = await lookup.run(question="Was verlangt § 63 BO Wien?", instrument="BO Wien")

    assert first == second
    assert lookup.client.fetch_calls == [lookup.WIEN_URL], "the repeat must come out of the shared cache"


async def test_a_second_question_about_the_same_law_downloads_nothing_either(lookup, catalog):
    await lookup.run(question="Was verlangt § 63 BO Wien?", instrument="BO Wien")
    output = await lookup.run(question="Wie hoch darf gebaut werden? § 75", instrument="BO Wien")

    assert lookup.client.fetch_calls == [lookup.WIEN_URL]
    assert "Punkt: § 75" in output


async def test_ris_lookup_is_not_signed_by_the_duplicate_fetch_guard(lookup):
    from agent.common.tool_calls import fetch_signature

    call = {"name": "ris_lookup_tool", "args": {"question": "Was verlangt § 63 BO Wien?"}}

    assert fetch_signature(call) is None
