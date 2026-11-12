"""The synthetic country XA answers a law lookup from its own record, and no code names it (plan step 4's gate).

XA's gazette is a record as an operator's agent proposes it through the door
(``synthetic-country-door.integration.spec.ts`` takes the same one to a release):
a portal that lists one document and offers no search, an HTML statute page, a
locus grammar in English. A turn in XA carries it; the lookup reads it, fetches
the page through the network edge and cuts the provision the question names.
"""

from __future__ import annotations

import pytest
from agent_testing.law_lookup_parity import Case
from agent_testing.law_lookup_parity import Upstream
from agent_testing.law_lookup_parity import run_law_lookup

pytestmark = pytest.mark.asyncio

_HOST = "gazette.xa.example"
_CODE_URL = f"https://{_HOST}/building-code"
_PAGE = """<!DOCTYPE html><html><head><title>Building Code of Xanadu</title></head><body>
<h1>Building Code of Xanadu</h1>
<section><span class="nr">§ 1</span><h2>Scope</h2><p>This code applies to every building in Xanadu.</p></section>
<section><span class="nr">§ 2</span><h2>Heights</h2><p>No building in Xanadu is higher than the palace.</p></section>
</body></html>"""

#: The gazette as the door releases it to a turn: the proposed record in snake case, without its fixtures.
XA_GAZETTE = {
    "id": "xa-gazette",
    "title": "Gazette of Xanadu",
    "territory": "XA",
    "protocol": "web_document",
    "format": "html_statute",
    "hosts": [_HOST],
    "data_flow": "public_only",
    "terms": {"url": f"https://{_HOST}/terms", "licence": "public_open", "checked": "2026-11-01"},
    "access": {"documents": [{"id": "code", "url": _CODE_URL, "title": "Building Code"}]},
    "engine": {"unit": "//section", "number": "./span[@class='nr']", "heading": "./h2", "title": "//h1"},
    "lookup": {
        "language": "en",
        "locus": {
            "units": [{"sign": "§", "forms": ["§"], "repeatable": True, "word": False}],
            "subsection": ["para"],
            "conjunctions": ["and"],
            "range_words": ["to"],
        },
        "collections": [{"id": "code", "kind": "statute"}],
        "wording": {"source": "Gazette", "subdivision": "province", "language": "English"},
    },
}


def _upstream() -> Upstream:
    return Upstream(responses={_CODE_URL: {"content_type": "text/html; charset=utf-8", "body": _PAGE}})


async def test_a_turn_in_xa_reads_the_provision_from_its_gazette():
    case = Case("xa", {"question": "How high may a building in Xanadu be?", "instrument": "§ 2 Building Code"})

    result = await run_law_lookup(case, _upstream(), turn_record=XA_GAZETTE)

    assert result.requested == (_CODE_URL,)
    assert "No building in Xanadu is higher than the palace." in result.output
    assert "This code applies" not in result.output
    assert "§ 2" in result.output


async def test_a_provision_the_gazette_does_not_hold_is_a_miss_in_its_own_words():
    case = Case("xa-miss", {"question": "What does § 9 say?", "instrument": "§ 9 Building Code"})

    result = await run_law_lookup(case, _upstream(), turn_record=XA_GAZETTE)

    assert result.output.startswith("No Gazette passage answered")


#: The gazette's statute page at the address that states its number, as the record declares (``nr``).
_NUMBERED_URL = f"{_CODE_URL}?nr=42"


def _numbered(declares: dict) -> dict:
    """XA's gazette serving the code at its numbered address, declaring ``declares`` as its identifiers."""
    documents = [{"id": "code", "url": _NUMBERED_URL, "title": "Building Code"}]
    return {**XA_GAZETTE, "identifiers": declares, "access": {"documents": documents}}


def _code_use(value: str):
    """XA's building code as the turn's records resolve it: read live, carrying its number at the gazette."""
    from agent.common.knowledge_context import EditionUse
    from agent.common.knowledge_context import SourceRef

    ref = SourceRef(scheme="xa_gazette_number", value=value)
    return EditionUse(work_id="work:xa-code", edition_id=None, role="binding", via="territory", source_refs=(ref,))


@pytest.mark.parametrize(
    ("declares", "carried", "work"),
    [
        ({"xa_gazette_number": {"query": "nr"}}, "42", "work:xa-code"),
        ({"xa_gazette_number": {"query": "nr"}}, "43", None),  # the records name another number
        ({}, "42", None),  # the source declares no scheme: an address decides nothing
    ],
)
async def test_a_passage_from_the_gazette_finds_its_work_by_a_scheme_only_records_name(declares, carried, work):
    """A country's identifier is a record: the gazette's record says its addresses state ``xa_gazette_number``
    in ``nr``, the work's record carries the value, and no code names the scheme (country-as-data §3.5)."""
    case = Case("xa-numbered", {"question": "How high may a building in Xanadu be?", "instrument": "§ 2 Building Code"})
    upstream = Upstream(responses={_NUMBERED_URL: {"content_type": "text/html; charset=utf-8", "body": _PAGE}})

    result = await run_law_lookup(case, upstream, turn_record=_numbered(declares), uses=(_code_use(carried),))

    assert "No building in Xanadu is higher than the palace." in result.output
    assert {record[3] for record in result.records} == {work}
