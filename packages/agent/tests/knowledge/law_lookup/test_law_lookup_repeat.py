"""The same lookup twice in one turn costs one download.

No call of the lookup is withheld by the duplicate-fetch guard
(``tool_calls.fetch_signature`` signs ``knowledge_search`` and ``read_passage``
alone). What makes the repeat nearly free is the shared read-through cache
(``cache.fetch_document_cached``), keyed on the DOCUMENT. Ported from the RIS
tool's suite (``test_ris_lookup_repeat``) onto XA's statute portal.
"""

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
    """The cache is keyed on the document, so another provision of the same law is free."""
    portal = xa.Portal.with_codes()
    async with xa.session(portal, catalog=[xa.catalog_entry()]) as lookup:
        await lookup.call(question=_QUESTION, instrument="Building Code")
        output = await lookup.call(question="How high may one build? § 75", instrument="Building Code")

    assert portal.documents_requested == [xa.CODE_URL]
    assert "Punkt: § 75" in output


@pytest.mark.parametrize("name", ["law_lookup", "ris_lookup", "ris_lookup_tool"])
async def test_the_lookup_is_not_signed_by_the_duplicate_fetch_guard(name):
    """Pinned where a change would break it silently: under any name the lookup is bound by.

    If the lookup is ever added to ``fetch_signature``, whoever adds it decides what the withheld call
    returns; the guard's answer to a repeat is worse than the cache hit the tests above prove.
    """
    from agent.common.tool_calls import fetch_signature

    assert fetch_signature({"name": name, "args": {"question": _QUESTION}}) is None
