from __future__ import annotations

import pytest
from agent_testing import law_lookup_portal as xa

pytestmark = pytest.mark.asyncio

_QUESTION = "What does § 63 Building Code require?"


async def test_the_second_identical_lookup_downloads_nothing():
    portal = xa.Portal.with_codes()
    async with xa.session(portal, catalog=[xa.catalog_entry()]) as lookup:
        first = await lookup.call(question=_QUESTION, instrument="Building Code")
        second = await lookup.call(question=_QUESTION, instrument="Building Code")

    assert first == second
    assert portal.documents_requested == [xa.CODE_URL], "the repeat must come out of the shared cache"


async def test_a_second_question_about_the_same_law_downloads_nothing_either():
    portal = xa.Portal.with_codes()
    async with xa.session(portal, catalog=[xa.catalog_entry()]) as lookup:
        await lookup.call(question=_QUESTION, instrument="Building Code")
        output = await lookup.call(question="How high may one build? § 75", instrument="Building Code")

    assert portal.documents_requested == [xa.CODE_URL]
    assert "Punkt: § 75" in output


@pytest.mark.parametrize("name", ["law_lookup", "ris_lookup", "ris_lookup_tool"])
async def test_the_lookup_is_not_signed_by_the_duplicate_fetch_guard(name):
    from agent.common.tool_calls import fetch_signature

    assert fetch_signature({"name": name, "args": {"question": _QUESTION}}) is None
