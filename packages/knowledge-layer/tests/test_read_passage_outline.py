from __future__ import annotations

import importlib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from knowledge_layer.register import KnowledgeRetrievalConfig

from agent.citations.extraction import extract_sources_from_tool_result
from agent.common.grounding_block import begin_grounding_capture
from agent.common.grounding_block import end_grounding_capture
from agent.common.grounding_block import get_grounding_block
from agent.common.source_kinds import Shelf
from agent.knowledge.schema import Chunk
from agent.knowledge.schema import ContentType
from agent.knowledge.scoping import ScopedCollection

rp = importlib.import_module("knowledge_layer.read_passage.tool")

OIB = "oib-rl_2_ausgabe_mai_2023.pdf"
PLAN = "Brandschutzkonzept.pdf"
SHEET = "Kostenaufstellung.xlsx"


def _document(file_name: str, display_title: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(file_name=file_name, display_title=display_title, summary=None, tags=None)


def _clause_chunk(
    clause: str,
    depth: int,
    title: str,
    page: int,
    *,
    content: str = "",
    chunk_id: str = "",
    file_name: str = OIB,
) -> Chunk:
    return Chunk(
        chunk_id=chunk_id or f"{file_name}:{clause}",
        content=content or f"{clause} {title}\n\nText zu {title}.",
        score=0.71,
        file_name=file_name,
        page_number=page,
        display_citation=f"{file_name}, p.{page}",
        content_type=ContentType.TEXT,
        metadata={
            "chunking": "clause",
            "clause_id": clause,
            "clause_depth": depth,
            "clause_title": title,
            "page_label": str(page),
        },
    )


def _sheet_chunk(sheet: str, content: str, *, file_name: str = SHEET) -> Chunk:
    return Chunk(
        chunk_id=f"{file_name}:{sheet}",
        content=content,
        score=0.71,
        file_name=file_name,
        page_number=None,
        display_citation=f"{file_name}, {sheet}",
        content_type=ContentType.TEXT,
        metadata={"chunking": "page", "page_label": sheet},
    )


def _page_chunk(page: int, content: str, *, file_name: str = PLAN) -> Chunk:
    return Chunk(
        chunk_id=f"{file_name}:p{page}",
        content=content,
        score=0.71,
        file_name=file_name,
        page_number=page,
        display_citation=f"{file_name}, p.{page}",
        content_type=ContentType.TEXT,
        metadata={"chunking": "page", "page_label": str(page)},
    )


def _is_fallback_fetch(filters: dict) -> bool:
    return "$and" not in filters


class _Store:
    def __init__(self, documents: list[SimpleNamespace]):
        self.documents = documents
        self.calls: list[dict] = []
        self.outline_chunks: list[Chunk] = []
        self.page_chunks: list[Chunk] = []

    async def retrieve(self, query, collection_name, top_k, filters):
        self.calls.append({"query": query, "collection": collection_name, "top_k": top_k, "filters": filters})
        chunks = self.page_chunks if _is_fallback_fetch(filters) else self.outline_chunks
        return SimpleNamespace(chunks=list(chunks), success=True, error_message=None)


@pytest.fixture
def store(monkeypatch):
    handle = _Store([_document(OIB, "OIB-Richtlinie 2, Ausgabe Mai 2023"), _document(PLAN), _document(SHEET)])

    async def _documents(collection: str):
        return list(handle.documents)

    monkeypatch.setattr("agent.knowledge.factory.get_active_retriever", lambda: handle)
    monkeypatch.setattr("agent.knowledge.factory.get_available_documents_async", _documents)
    monkeypatch.setattr(
        "agent.knowledge.scoping.get_scoped_collections_from_context",
        lambda: [ScopedCollection("oib_knowledge", Shelf.BASE)],
    )
    for name in ("get_document_doc_classes", "get_document_display_titles", "get_document_folder_paths"):
        monkeypatch.setattr(f"agent.knowledge.factory.{name}", lambda _c, _f: {})
    return handle


def _builder() -> MagicMock:
    builder = MagicMock()
    builder.get_function_config = MagicMock(
        return_value=KnowledgeRetrievalConfig(collection_name="oib_knowledge", include_base_collection=True)
    )
    return builder


async def _read(**kwargs) -> str:
    async with rp.read_passage(rp.ReadPassageConfig(), _builder()) as info:
        return await info.single_fn(info.input_schema(**kwargs))


def _outline(out: str) -> list[str]:
    assert "## Gliederung" in out, out
    return [line for line in out.split("## Gliederung", 1)[1].splitlines() if line.strip()]


def _oib_outline() -> list[Chunk]:
    return [
        _clause_chunk("0", 1, "Vorbemerkungen", 3, content="Diese Richtlinie gilt für …", chunk_id="v1"),
        _clause_chunk("0", 1, "Vorbemerkungen", 3, content="… und ist so zu lesen.", chunk_id="v2"),
        _clause_chunk("1", 1, "Begriffsbestimmungen", 3),
        _clause_chunk("2", 1, "Allgemeine Anforderungen", 4),
        _clause_chunk("2.1", 2, "Abstände", 4),
        _clause_chunk("2.1.1", 3, "Abstand zur Nachbargrenze", 4),
        _clause_chunk("2.9", 2, "Löschwasser", 5),
        _clause_chunk("2.10", 2, "Blitzschutz", 5),
    ]


def _section_chunk(locator: str, depth: int, title: str, order: int, *, file_name: str = PLAN) -> Chunk:
    return Chunk(
        chunk_id=f"{file_name}:{locator}",
        content=f"Digest › {title}\n\nText zu {title}.",
        score=0.71,
        file_name=file_name,
        page_number=None,
        display_citation=file_name,
        content_type=ContentType.TEXT,
        metadata={
            "chunking": "section",
            "clause_id": locator,
            "clause_depth": depth,
            "clause_title": title,
            "section_order": order,
        },
    )


class TestATenantSectionOutline:
    async def test_unnumbered_sections_are_listed_in_document_order_under_their_address(self, store):
        store.outline_chunks = [
            _section_chunk("Materialien", 1, "Materialien", 5),
            _section_chunk("Modellangaben", 1, "Modellangaben", 1),
            _section_chunk("Geschoße › EG", 2, "EG", 3),
            _section_chunk("Geschoße", 1, "Geschoße", 2),
        ]

        lines = _outline(await _read(document=PLAN))

        assert lines[:4] == [
            "- Punkt Modellangaben — Text zu Modellangaben.",
            "- Punkt Geschoße — Text zu Geschoße.",
            "  - Punkt Geschoße › EG: EG",
            "- Punkt Materialien — Text zu Materialien.",
        ]

    async def test_its_passage_is_the_first_section_not_the_alphabetically_first(self, store):
        store.outline_chunks = [
            _section_chunk("Materialien", 1, "Materialien", 5),
            _section_chunk("Modellangaben", 1, "Modellangaben", 1),
        ]

        out = await _read(document=PLAN)

        assert "Text zu Modellangaben." in out.split("## Gliederung", 1)[0]
        assert "Text zu Materialien." not in out.split("## Gliederung", 1)[0]


class TestTheClauseOutline:
    async def test_it_lists_depth_one_and_two_in_numbering_order(self, store):
        store.outline_chunks = _oib_outline()

        out = await _read(document=OIB, conclusion="Ich kenne die OIB 2 noch nicht.")

        assert _outline(out)[:6] == [
            "- Punkt 0: Vorbemerkungen (p. 3) — Diese Richtlinie gilt für …",
            "- Punkt 1: Begriffsbestimmungen (p. 3) — Text zu Begriffsbestimmungen.",
            "- Punkt 2: Allgemeine Anforderungen (p. 4) — Text zu Allgemeine Anforderungen.",
            "  - Punkt 2.1: Abstände (p. 4)",
            "  - Punkt 2.9: Löschwasser (p. 5)",
            "  - Punkt 2.10: Blitzschutz (p. 5)",
        ]

    async def test_a_chapter_line_carries_its_opening_sentence_and_a_sub_clause_does_not(self, store):
        long_body = "Tragende Bauteile müssen " + "sehr " * 40 + "lange halten. Zweiter Satz."
        store.outline_chunks = [
            _clause_chunk(
                "0",
                1,
                "Vorbemerkungen",
                3,
                content="0 Vorbemerkungen\n\nDiese Richtlinie gilt für Bauwerke. Sie ersetzt nichts.",
            ),
            _clause_chunk("2", 1, "Anforderungen", 4, content=f"2 Anforderungen\n\n{long_body}"),
            _clause_chunk("2.1", 2, "Abstände", 4),
        ]

        lines = _outline(await _read(document=OIB))

        assert lines[0] == "- Punkt 0: Vorbemerkungen (p. 3) — Diese Richtlinie gilt für Bauwerke."
        assert lines[1].startswith("- Punkt 2: Anforderungen (p. 4) — Tragende Bauteile müssen sehr")
        assert lines[1].endswith("…")
        assert len(lines[1].split(" — ", 1)[1]) <= rp._EXCERPT_CHARS + 1
        assert lines[2] == "  - Punkt 2.1: Abstände (p. 4)"

    async def test_the_numbering_orders_the_index_even_when_a_page_runs_ahead(self, store):
        store.outline_chunks = [
            _clause_chunk("2", 1, "Allgemeine Anforderungen", 4),
            _clause_chunk("2.1", 2, "Abstände", 4),
            _clause_chunk("2.2", 2, "Löschwasser", 6),
            _clause_chunk("3", 1, "Brandschutz", 5),
        ]

        assert _outline(await _read(document=OIB)) == [
            "- Punkt 2: Allgemeine Anforderungen (p. 4) — Text zu Allgemeine Anforderungen.",
            "  - Punkt 2.1: Abstände (p. 4)",
            "  - Punkt 2.2: Löschwasser (p. 6)",
            "- Punkt 3: Brandschutz (p. 5) — Text zu Brandschutz.",
            rp._OUTLINE_INSTRUCTION,
        ]

    async def test_a_split_clause_is_one_line_not_two(self, store):
        store.outline_chunks = _oib_outline()

        lines = _outline(await _read(document=OIB))

        assert len([line for line in lines if line.strip().startswith("- Punkt 0:")]) == 1

    async def test_depth_three_is_not_listed(self, store):
        store.outline_chunks = _oib_outline()

        assert "2.1.1" not in "\n".join(_outline(await _read(document=OIB)))

    async def test_clause_zero_is_the_passage_and_carries_a_citation(self, store):
        store.outline_chunks = _oib_outline()

        out = await _read(document=OIB)
        head = out.split("## Gliederung", 1)[0]

        assert "Diese Richtlinie gilt für …" in head
        assert f"Citation: {OIB}, p.3" in head
        assert "Punkt: 0" in head
        assert "## Trace-Lanes" in head

    async def test_the_headings_are_not_rendered_as_passages(self, store):
        store.outline_chunks = _oib_outline()

        out = await _read(document=OIB)

        assert "Read 2 passage(s) of" in out
        assert "--- Result 3 ---" not in out

    async def test_it_closes_by_saying_the_index_is_not_evidence(self, store):
        store.outline_chunks = _oib_outline()

        out = await _read(document=OIB)

        assert "Open a listed Punkt by its number" in out
        assert "not evidence" in out

    async def test_a_document_without_clause_zero_opens_its_first_clause(self, store):
        store.outline_chunks = [
            _clause_chunk("10", 1, "Schlussbestimmungen", 3, content="Zehntens …"),
            _clause_chunk("2", 1, "Allgemeine Anforderungen", 3, content="Zweitens …"),
            _clause_chunk("1", 1, "Begriffsbestimmungen", 3, content="Erstens …"),
            _clause_chunk("1.1", 2, "Bauwerk", 3, content="Ein Bauwerk ist …"),
        ]

        out = await _read(document=OIB)
        head = out.split("## Gliederung", 1)[0]

        assert "Read 1 passage(s) of" in head
        assert "Erstens …" in head
        assert "Zweitens …" not in head
        assert _outline(out)[0] == "- Punkt 1: Begriffsbestimmungen (p. 3) — Erstens …"


class TestTheRecheckHoldsWhenTheBackendDoesNot:
    async def test_depth_three_chunks_a_backend_smuggled_in_are_dropped(self, store):
        store.outline_chunks = [
            _clause_chunk("2", 1, "Allgemeine Anforderungen", 4),
            _clause_chunk("2.1", 2, "Abstände", 4),
            _clause_chunk("2.1.1", 3, "Abstand zur Nachbargrenze", 4),
            _clause_chunk("2.1.2", 3, "Abstand zu Verkehrsflächen", 4),
        ]

        lines = _outline(await _read(document=OIB))

        assert lines[:2] == [
            "- Punkt 2: Allgemeine Anforderungen (p. 4) — Text zu Allgemeine Anforderungen.",
            "  - Punkt 2.1: Abstände (p. 4)",
        ]
        assert not any("2.1.1" in line or "2.1.2" in line for line in lines)

    async def test_a_depth_stored_as_a_string_still_counts(self, store):
        chunk = _clause_chunk("2", 1, "Allgemeine Anforderungen", 4)
        chunk.metadata["clause_depth"] = "1"
        store.outline_chunks = [chunk]

        assert (
            _outline(await _read(document=OIB))[0]
            == "- Punkt 2: Allgemeine Anforderungen (p. 4) — Text zu Allgemeine Anforderungen."
        )


class TestTheCap:
    async def test_eighty_lines_then_the_count_of_the_rest(self, store):
        store.outline_chunks = [_clause_chunk(str(number), 1, f"Punkt {number}", 3) for number in range(1, 91)]

        lines = _outline(await _read(document=OIB))
        listed = [line for line in lines if line.strip().startswith("- Punkt ")]

        assert len(listed) == rp._MAX_OUTLINE_LINES == 80
        assert "(+10 more Punkte not listed)" in lines

    async def test_an_outline_that_fits_says_nothing_about_a_rest(self, store):
        store.outline_chunks = _oib_outline()

        assert not any("weitere Punkte" in line for line in _outline(await _read(document=OIB)))


class TestThePerPageFallback:
    async def test_the_first_pages_are_the_passages(self, store):
        store.page_chunks = [_page_chunk(page, f"Seite {page} des Konzepts") for page in (1, 2, 3)]

        out = await _read(document=PLAN)

        assert "Read 3 passage(s) of" in out
        assert f"Citation: {PLAN}, p.1" in out
        assert "Seite 3 des Konzepts" in out

    async def test_there_is_no_outline_and_it_says_so(self, store):
        store.page_chunks = [_page_chunk(1, "Seite 1 des Konzepts")]

        out = await _read(document=PLAN)

        assert "## Gliederung" not in out
        assert "not structured in Punkte" in out
        assert "further pages open by their number" in out

    async def test_pages_come_back_in_page_order(self, store):
        store.page_chunks = [_page_chunk(page, f"Seite {page}") for page in (3, 1, 2)]

        out = await _read(document=PLAN)

        assert out.index(f"Citation: {PLAN}, p.1") < out.index(f"Citation: {PLAN}, p.3")

    async def test_only_the_opening_passages_travel(self, store):
        store.page_chunks = [_page_chunk(page, f"Seite {page}") for page in range(1, 41)]

        out = await _read(document=PLAN)

        assert f"Read {rp._MAX_PASSAGE_CHUNKS} passage(s) of" in out
        assert "Seite 1" in out
        assert "Seite 40" not in out

    async def test_a_document_with_nothing_stored_is_not_an_invented_citation(self, store):
        out = await _read(document=PLAN)

        assert "no passage of it could be read" in out
        assert "knowledge_search" in out
        assert "--- Result 1 ---" not in out


class TestWhatTheStoreIsAsked:
    async def test_the_outline_filter_is_exactly_the_documented_shape(self, store):
        store.outline_chunks = _oib_outline()

        await _read(document="OIB-Richtlinie 2, Ausgabe Mai 2023")

        (call,) = store.calls
        assert call["filters"] == {
            "$and": [
                {"file_name": {"$eq": OIB}},
                {
                    "$or": [
                        {"clause_id": {"$eq": "0"}},
                        {"clause_depth": {"$in": [1, 2]}},
                        {"clause_depth": {"$in": ["1", "2"]}},
                    ]
                },
            ]
        }
        assert call["top_k"] == rp._MAX_OUTLINE_CHUNKS == 160
        assert call["collection"] == "oib_knowledge"

    async def test_the_fetch_names_the_document_alone(self, store):
        store.outline_chunks = _oib_outline()

        await _read(document=OIB)

        assert store.calls[0]["query"] == OIB

    async def test_the_fallback_asks_for_the_document_and_nothing_narrower(self, store):
        store.page_chunks = [_page_chunk(1, "Seite 1")]

        await _read(document=PLAN)

        assert [call["filters"] for call in store.calls][1] == {"file_name": {"$eq": PLAN}}
        assert "page_label" not in str(store.calls[1]["filters"])

    async def test_the_page_fetch_only_happens_when_there_are_no_clauses(self, store):
        store.outline_chunks = _oib_outline()

        await _read(document=OIB)

        assert len(store.calls) == 1

    def test_both_filters_survive_the_real_translator(self):
        from knowledge_layer.vector_store import translate

        assert translate(rp._outline_filters(OIB)) is not None
        assert translate(rp._whole_document_filters(OIB)) is not None


class TestADocumentWhosePageLabelIsNotAPage:
    async def test_a_workbook_outlines_with_its_sheets_as_passages(self, store):
        store.page_chunks = [
            _sheet_chunk("Kostenaufstellung", "Position | Betrag …"),
            _sheet_chunk("Annahmen", "Preisbasis 2024 …"),
        ]

        out = await _read(document=SHEET, conclusion="Ich weiß noch nicht, was die Datei enthält.")

        assert "Read 2 passage(s) of" in out
        assert "Position | Betrag …" in out
        assert "Preisbasis 2024 …" in out
        assert "no passage of it could be read" not in out
        assert "not structured in Punkte" in out

    async def test_the_workbook_passages_carry_a_citation(self, store):
        store.page_chunks = [_sheet_chunk("Kostenaufstellung", "Position | Betrag …")]

        out = await _read(document=SHEET)

        assert f"Citation: {SHEET}" in out
        assert "## Trace-Lanes" in out


class TestTheDepthClauseMatchesTheRecheck:
    def test_the_clause_asks_for_both_spellings(self):
        assert rp._outline_filters(OIB)["$and"][1]["$or"][1:] == [
            {"clause_depth": {"$in": [1, 2]}},
            {"clause_depth": {"$in": ["1", "2"]}},
        ]

    def test_every_spelling_it_asks_for_passes_the_recheck(self):
        from types import SimpleNamespace as NS

        asked = [
            depth
            for clause in rp._outline_filters(OIB)["$and"][1]["$or"][1:]
            for depth in clause["clause_depth"]["$in"]
        ]

        assert asked == [1, 2, "1", "2"]
        for depth in asked:
            assert rp._is_outline_chunk(NS(metadata={"clause_id": "2", "clause_depth": depth})), depth


class TestResolutionIsUnchanged:
    async def test_an_unknown_document_is_still_refused_with_the_guesses(self, store):
        out = await _read(document="oib-rl_2_ausgabe_mai_20233.pdf")

        assert "No document in scope is named" in out
        assert f"- {OIB}" in out
        assert store.calls == []

    async def test_an_empty_document_still_asks_for_a_name(self, store):
        out = await _read(document="  ")

        assert "Provide `document=`" in out
        assert store.calls == []


class TestTheContract:
    def test_the_first_sentence_covers_both_modes(self):
        first = rp._READ_PASSAGE_DESCRIPTION.split("\n")[0]

        assert "OUTLINE" in first
        assert "`clause=`" in first and "`page=`" in first

    def test_the_refusal_that_sent_the_model_back_to_a_search_is_gone(self):
        assert "Provide `clause=`" not in rp._READ_PASSAGE_DESCRIPTION

    def test_returns_describes_the_outline_as_an_index(self):
        returns = rp._READ_PASSAGE_DESCRIPTION.split("Returns:")[1]

        assert "Gliederung" in returns
        assert "not evidence" in returns


OUTLINE_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "read_passage_outline.txt"


@pytest.fixture
def capturing():
    token = begin_grounding_capture()
    yield
    end_grounding_capture(token)


class TestTheOutlineIsReadAsRecords:
    async def test_an_outline_result_is_filed_under_its_own_bytes(self, store, capturing):
        store.outline_chunks = _oib_outline()

        assert get_grounding_block(await _read(document=OIB)) is not None

    async def test_a_document_without_clauses_is_filed_too(self, store, capturing):
        store.page_chunks = [_page_chunk(1, "Seite 1 des Konzepts")]

        assert get_grounding_block(await _read(document=PLAN)) is not None

    async def test_the_outline_bytes_did_not_move(self, store):
        store.outline_chunks = _oib_outline()

        assert await _read(document=OIB) == OUTLINE_FIXTURE.read_text(encoding="utf-8")

    async def test_the_outline_is_still_not_evidence_on_the_text_path(self, store):
        store.outline_chunks = _oib_outline()

        entries = extract_sources_from_tool_result("read_passage", await _read(document=OIB))

        assert [entry.chunk_text for entry in entries] == ["Diese Richtlinie gilt für …", "… und ist so zu lesen."]


class TestANumericClause:
    async def test_an_int_clause_opens_that_clause(self, store):
        store.outline_chunks = [_clause_chunk("3", 5, "Brandschutz", 2)]

        out = await _read(document=OIB, clause=3)

        assert "Brandschutz" in out
        assert {"clause_id": {"$eq": "3"}} in store.calls[-1]["filters"]["$and"]
