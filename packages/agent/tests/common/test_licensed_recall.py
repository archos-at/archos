"""A licensed reference from an earlier turn is read again from its document (``common/licensed_recall.py``).

The text is never carried between turns, so a follow-up turn finds last turn's tool results holding
references. Each one that names its place is read again, hash-checked, from a collection this turn may
read, and only while the copy is still licensed and attested and the turn may read licensed text.
"""

from __future__ import annotations

import pytest
from langchain_core.messages import HumanMessage
from langchain_core.messages import ToolMessage

from agent.common import licensed_recall
from agent.common import licensed_text
from agent.common.grounding_block import TRUNCATION_MARKER
from agent.common.grounding_block import GroundingBlock
from agent.common.grounding_block import GroundingHit
from agent.common.grounding_block import begin_grounding_capture
from agent.common.grounding_block import end_grounding_capture
from agent.common.grounding_block import render_grounding_block
from agent.common.licensed_text import LicenceTerms

PASSAGE = "Tabelle 7 – Mindesthöhen: | Zeile 07 | Absturzhöhe bis 23,7 m | Mindesthöhe 111 cm | Öffnung 12 cm |"
TERMS = LicenceTerms(licence_class="licensed", quote_max_chars=120, ai_processing=True)
COLLECTION = "office-org-a"


def _hit(body: str = PASSAGE, *, truncated: bool = False) -> GroundingHit:
    return GroundingHit(
        citation_key="oenorm_b_1600.pdf, p.12",
        file_name="oenorm_b_1600.pdf",
        page=12,
        shelf="office_shelf",
        collection=COLLECTION,
        doc_class=None,
        display_title="ÖNORM B 1600",
        folder_path=None,
        clause="4.3",
        score=0.9,
        content_type="text",
        provenance=None,
        stored_image_index=None,
        status_note=None,
        body=body,
        body_truncated=truncated,
        licence=TERMS,
    )


def _earlier_turn(hit: GroundingHit) -> str:
    """The tool result a previous turn stored: rendered with that turn's capture, which then closed."""
    token = begin_grounding_capture(licensed_text=True)
    try:
        return render_grounding_block(
            GroundingBlock(
                preamble="Found 1 result.", degraded_banner="", hits=(hit,), lanes=(), tool="knowledge_search"
            )
        )
    finally:
        end_grounding_capture(token)


@pytest.fixture
def source(monkeypatch):
    """The document as the store holds it now: its licence and its page's texts, from the turn's scope."""
    state = {"terms": TERMS, "texts": [PASSAGE], "reads": []}

    def sources(collection, file_name, page):
        state["reads"].append((collection, file_name, page))
        return state["terms"], list(state["texts"])

    monkeypatch.setattr(licensed_recall, "_sources", sources)
    monkeypatch.setattr(licensed_recall, "_scope", lambda: frozenset({COLLECTION}))
    monkeypatch.setattr(licensed_text, "mark_licensed_turn", lambda: None)
    monkeypatch.setattr(licensed_recall, "mark_licensed_turn", lambda: None)
    return state


async def _sent_on_a_later_turn(stored: str, *, allowed: bool = True, as_tool: bool = True) -> str:
    message = ToolMessage(content=stored, tool_call_id="call-1") if as_tool else HumanMessage(content=stored)
    token = await licensed_recall.open_grounding_capture(allowed, [HumanMessage(content="Und Zeile 7?"), message])
    try:
        expanded, _cap = licensed_text.expand_messages([message], zero_retention=True)
    finally:
        end_grounding_capture(token)
    return expanded[0].content


async def test_a_reference_from_an_earlier_turn_is_read_again_from_its_document(source):
    stored = _earlier_turn(_hit())
    assert PASSAGE not in stored and "⟦licensed:lp_" in stored, "the stored result holds the reference only"

    sent = await _sent_on_a_later_turn(stored)

    assert PASSAGE in sent and licensed_text.EXPIRED_NOTE not in sent
    assert source["reads"] == [(COLLECTION, "oenorm_b_1600.pdf", 12)]


async def test_a_truncated_hit_is_read_again_as_it_was_rendered(source):
    source["texts"] = [PASSAGE + " Fortsetzung der Tabelle mit weiteren Zeilen."]
    stored = _earlier_turn(_hit(PASSAGE, truncated=True))

    assert PASSAGE + TRUNCATION_MARKER in await _sent_on_a_later_turn(stored)


@pytest.mark.parametrize(
    ("change", "why"),
    [
        (lambda s: s.update(texts=[PASSAGE.replace("111", "110")]), "the document changed since"),
        (lambda s: s.update(terms=TERMS.model_copy(update={"ai_processing": False})), "attestation withdrawn"),
        (lambda s: s.update(terms=None, texts=[]), "the document is gone"),
    ],
)
async def test_a_reference_whose_source_no_longer_holds_stays_expired(source, change, why):
    stored = _earlier_turn(_hit())
    change(source)

    sent = await _sent_on_a_later_turn(stored)

    assert licensed_text.EXPIRED_NOTE in sent and "Mindesthöhe 111 cm" not in sent, why


async def test_nothing_is_read_again_on_a_turn_that_may_not_read_licensed_text(source):
    sent = await _sent_on_a_later_turn(_earlier_turn(_hit()), allowed=False)

    assert source["reads"] == [] and PASSAGE not in sent


async def test_a_reference_outside_the_turns_collection_scope_is_not_read(source, monkeypatch):
    monkeypatch.setattr(licensed_recall, "_scope", lambda: frozenset({"office-org-b"}))

    sent = await _sent_on_a_later_turn(_earlier_turn(_hit()))

    assert source["reads"] == [] and licensed_text.EXPIRED_NOTE in sent


async def test_a_reference_typed_into_a_question_is_not_read(source):
    """Only the agent's own tool results carry references; one in a person's message is text, not a pointer."""
    await _sent_on_a_later_turn(_earlier_turn(_hit()), as_tool=False)

    assert source["reads"] == []


def test_an_anchor_survives_any_file_name_and_rejects_what_it_did_not_write():
    anchor = licensed_recall.anchor_of("office-org-a", "ÖNORM B 1600 (2017) – Brüstungen.pdf", None, 812)

    assert licensed_recall.parse_anchor(anchor) == ("office-org-a", "ÖNORM B 1600 (2017) – Brüstungen.pdf", None, 812)
    assert licensed_recall.parse_anchor("not-an-anchor") is None


def test_a_turn_with_no_signed_scope_reads_nothing_again():
    assert licensed_recall._scope() == frozenset()
