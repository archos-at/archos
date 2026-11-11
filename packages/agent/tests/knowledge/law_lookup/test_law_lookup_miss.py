"""Ways to find nothing, and what each says. None of them is empty.

An empty tool result is the one output that reliably produces an invented
citation: the model has a question, no evidence, and nothing telling it what to
do instead. Each shape gets its own words, in the source's terms, and each ends
in one concrete retry. Ported from the RIS tool's suite (``test_ris_lookup_miss``)
onto XA's statute portal.
"""

from __future__ import annotations

import pytest
from agent_testing import law_lookup_portal as xa

pytestmark = pytest.mark.asyncio


async def _ask(portal=None, *, catalog=None, planner=None, picker=None, **args) -> str:
    portal = portal or xa.Portal.with_codes()
    async with xa.session(portal, catalog=catalog, planner_call=planner, picker_call=picker) as lookup:
        return await lookup.call(**args)


async def test_nothing_matched_anywhere_still_says_what_was_searched():
    """No catalog entry, no live hit: the miss names the planner's terms and the province."""
    output = await _ask(
        planner=xa.planner(collection="Regional", terms="parking obligation"),
        question="How many parking spaces?",
        jurisdiction="Southmark",
    )

    assert output.strip()
    assert "'parking obligation'" in output, "the model must see the rewrite it did not write"
    assert "Assumed province: Southmark (from jurisdiction argument)." in output
    assert "Retry once" in output


async def test_an_unresolved_province_is_the_first_thing_the_retry_asks_for():
    output = await _ask(question="What does the building code require?")

    assert "No province was resolved" in output
    assert "Retry once: name the province" in output


async def test_a_catalog_entry_with_no_full_text_is_named_and_not_invented():
    """The catalog's own honest case: the norm exists, its text is not in the source."""
    standard = xa.catalog_entry(
        id="xa-standard-1300",
        title="XA Standard 1300",
        short="S 1300",
        application="",
        document_number="",
        citation_url="",
        full_law_url="",
        topics=["building code", "object security"],
    )

    output = await _ask(
        catalog=[standard], question="What does the building code say on object security?", jurisdiction="Northmark"
    )

    assert "Matched but not read:" in output
    assert "XA Standard 1300" in output
    assert "Not in Statutes - no accessible full text (reference only, say so openly)" in output


async def test_a_web_only_catalog_entry_hands_the_web_tool_its_next_move():
    leaflet = xa.catalog_entry(
        id="xa-permit-leaflet",
        title="Permit Office Leaflet",
        short="Leaflet",
        application="",
        document_number="",
        citation_url="",
        full_law_url="",
        source_url="https://permits.xa.example/leaflet",
        topics=["building code", "permit application"],
    )

    output = await _ask(catalog=[leaflet], question="What does the building code ask of a permit application?")

    assert "Not in Statutes - web source: https://permits.xa.example/leaflet" in output


async def test_a_document_that_was_read_but_answers_nothing_returns_its_index():
    """The twin of ``read_passage``'s outline, labelled as an index."""
    portal = xa.Portal.with_codes()
    output = await _ask(
        portal,
        catalog=[xa.catalog_entry()],
        picker=xa.picker(),  # names nothing: no heading answers this
        question="What does the building code say about stamp duty?",
    )

    assert portal.documents_requested == [xa.CODE_URL], "the law was read; it just answers nothing"
    assert "INDEX, not evidence" in output
    assert "§ 63 — Permit application" in output
    assert "Citation:" not in output, "an index is not evidence and must carry no citation key"


async def test_a_named_provision_the_law_does_not_have_is_a_miss_not_a_guess():
    output = await _ask(catalog=[xa.catalog_entry()], question="What does § 999 require?", instrument="Building Code")

    assert "No Statutes passage answered" in output
    assert "Citation:" not in output


@pytest.mark.parametrize(
    "answer",
    [xa.search_answer(error="page number too high"), {"status": "503", "content_type": "text/plain", "body": "down"}],
    ids=["refused", "unavailable"],
)
async def test_a_failed_live_search_is_a_miss_with_a_retry_not_an_exception(answer):
    portal = xa.Portal.with_codes()
    portal.search = answer

    output = await _ask(portal, planner=xa.planner(), question="What does the building code require?")

    assert portal.searches, "the search was sent"
    assert "No Statutes passage answered" in output
    assert "Retry once" in output


async def test_a_live_hit_that_cannot_be_fetched_is_named_as_unread():
    """The fetch failed; the miss still says which document it was."""
    portal = xa.Portal()  # every document is a 404
    portal.search = xa.search_answer(xa.hit("XAN40299999", "Garage Act 2008", collection="Regional"))

    output = await _ask(portal, planner=xa.planner(), question="What does the garage act require?")

    assert "Matched but not read:" in output
    assert "Garage Act 2008" in output


class TestActionRow:
    """One ``law`` row per call (ADR-0132): the question, the provision asked for, how many passages were cut."""

    @pytest.fixture
    def rows(self, monkeypatch):
        bodies = []
        monkeypatch.setattr("agent.common.turn_status.get_stream_writer", lambda: bodies.append)
        return bodies

    @staticmethod
    def _call(bodies):
        actions = [body.step for body in bodies if body.step.kind == "action"]
        assert len(actions) == 2
        assert actions[0].status == "running"
        assert actions[0].id == actions[1].id
        return actions

    async def test_a_miss_is_an_empty_row(self, rows):
        await _ask(question="How many parking spaces?", jurisdiction="Southmark", instrument="§ 36 Building Code")

        started, finished = self._call(rows)
        assert (started.verb, started.query, started.target) == (
            "law",
            "How many parking spaces?",
            "§ 36 Building Code",
        )
        assert (finished.status, finished.counts.hits) == ("empty", 0)

    async def test_a_named_provision_is_an_ok_row_with_its_passage_count(self, rows):
        await _ask(catalog=[xa.catalog_entry()], question="What does § 63 require?", instrument="Building Code")

        finished = self._call(rows)[1]
        assert (finished.status, finished.counts.hits) == ("ok", 1)

    async def test_an_empty_question_is_refused_without_a_row(self, rows):
        output = await _ask(question="  ")

        assert output.startswith("Error: law_lookup needs a question")
        assert rows == []
