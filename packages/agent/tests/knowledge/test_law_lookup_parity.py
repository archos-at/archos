from __future__ import annotations

import json

import pytest
from agent_testing.law_lookup_parity import CASES
from agent_testing.law_lookup_parity import GOLDEN
from agent_testing.law_lookup_parity import Upstream
from agent_testing.law_lookup_parity import run_law_lookup
from agent_testing.law_lookup_parity import run_law_lookup_from_turn
from agent_testing.law_lookup_parity import run_ris_lookup

pytestmark = pytest.mark.asyncio

_GOLDEN = json.loads(GOLDEN.read_text(encoding="utf-8"))
_RUNNERS = {
    "ris_lookup": run_ris_lookup,
    "law_lookup": run_law_lookup,
    "law_lookup_from_turn": run_law_lookup_from_turn,
}


DEPARTURES = {
    "as-of": [
        "https://data.bka.gv.at/ris/api/v2.6/Landesrecht?Applikation=LrKons&DokumenteProSeite=OneHundred"
        "&Seitennummer=1&Titel=Garagengesetz+Wien&Bundesland.SucheInWien=true"
        "&Abschnitt.Von=50&Abschnitt.Bis=50&Abschnitt.Typ=Paragraph",
        "https://data.bka.gv.at/ris/api/v2.6/Landesrecht?Applikation=LrKons&DokumenteProSeite=OneHundred"
        "&Seitennummer=1&Titel=Garagengesetz+Wien&Bundesland.SucheInWien=true",
    ],
}


def test_every_case_has_its_recording():
    assert sorted(_GOLDEN) == sorted(case.id for case in CASES)


@pytest.mark.parametrize("runner", sorted(_RUNNERS))
@pytest.mark.parametrize("case", CASES, ids=[case.id for case in CASES])
async def test_the_lookup_sends_and_returns_what_the_ris_tool_did(case, runner):
    result = await _RUNNERS[runner](case, Upstream.load())

    departed = DEPARTURES.get(case.id, []) if runner != "ris_lookup" else []
    assert list(result.requested[: len(departed)]) == departed
    assert sorted(result.requested[len(departed) :]) == sorted(_GOLDEN[case.id]["requested"])
    assert result.output == _GOLDEN[case.id]["output"]


def _records_turn():
    from agent.common.knowledge_context import EditionUse
    from agent.common.knowledge_context import KnowledgeContext
    from agent.common.knowledge_context import SourceRef

    use = EditionUse(
        work_id="work:bo-wien",
        edition_id=None,
        role="binding",
        via="territory",
        source_refs=(SourceRef(scheme="ris_gesetzesnummer", value="20000006"),),
    )
    return KnowledgeContext(gate="core", site_country="AT", uses=(use,), retrieval_countries=frozenset({"AT"}))


@pytest.mark.parametrize("case", CASES, ids=[case.id for case in CASES])
async def test_every_hit_states_the_record_the_ris_tool_stated(case):
    from agent.common.knowledge_context import set_turn_knowledge_context

    set_turn_knowledge_context(_records_turn())
    try:
        old = await run_ris_lookup(case, Upstream.load())
        new = await run_law_lookup(case, Upstream.load())
    finally:
        set_turn_knowledge_context(None)

    assert new.output == old.output
    assert new.records == old.records


async def test_a_hit_from_a_document_the_records_name_carries_its_work():
    from agent.common.knowledge_context import set_turn_knowledge_context

    case = next(case for case in CASES if case.id == "named-subsection")
    set_turn_knowledge_context(_records_turn())
    try:
        result = await run_law_lookup(case, Upstream.load())
    finally:
        set_turn_knowledge_context(None)

    assert {record[3] for record in result.records} == {"work:bo-wien"}
