from __future__ import annotations

import dataclasses
from types import SimpleNamespace

import pytest
from knowledge_layer.search import format_results

from agent.citations.entries import SourceEntry
from agent.citations.extraction import extract_sources_from_tool_result
from agent.citations.registry import SourceRegistry
from agent.citations.session import _registry_from_cached_entries
from agent.citations.verification import verify_citations
from agent.citations.wire import source_entry_to_wire
from agent.common.grounding_block import begin_grounding_capture
from agent.common.grounding_block import end_grounding_capture

BESTAND = "aaaaaaaa-0000-4000-8000-00000000000a"
ENTWURF = "bbbbbbbb-0000-4000-8000-00000000000b"
FOLDERS = {BESTAND: "Bestand", ENTWURF: "Entwurf"}


@pytest.fixture(autouse=True)
def folders_by_id(monkeypatch):
    from agent.knowledge import factory

    def folder_paths(collection, names, document_ids=None):
        return {document_id: FOLDERS[document_id] for document_id in document_ids or ()}

    monkeypatch.setattr(factory, "get_document_folder_paths", folder_paths)
    for name in ("get_document_doc_classes", "get_document_display_titles"):
        monkeypatch.setattr(factory, name, lambda collection, names, document_ids=None: {})


def _chunk(document_id: str | None, page: int = 3, body: str = "Fluchtweg.", collection: str = "proj_1"):
    metadata = {"collection": collection, "shelf": "project"}
    if document_id:
        metadata["document_id"] = document_id
    return SimpleNamespace(
        file_name="Plan.pdf",
        page_number=page,
        content=body,
        content_type=SimpleNamespace(value="text"),
        score=0.8,
        metadata=metadata,
    )


def _search_text(*chunks) -> str:
    return format_results(SimpleNamespace(success=True, error_message=None, chunks=list(chunks)), "Fluchtweg")


def _registered(*chunks, records: bool = True) -> SourceRegistry:
    registry = SourceRegistry()
    token = begin_grounding_capture() if records else None
    try:
        for entry in extract_sources_from_tool_result("knowledge_search", _search_text(*chunks)):
            registry.add(entry)
    finally:
        if token is not None:
            end_grounding_capture(token)
    return registry


TWO_PLANS = (_chunk(BESTAND, body="Bestand: Fluchtweg 40 m."), _chunk(ENTWURF, body="Entwurf: Fluchtweg 35 m."))


class TestTwoDocumentsOfOneNameInOneCollection:
    def test_they_are_two_sources_each_keyed_by_its_folder(self):
        registry = _registered(*TWO_PLANS)

        assert [(entry.citation_key, entry.document_id) for entry in registry.all_sources()] == [
            ("Bestand/Plan.pdf, p.3", BESTAND),
            ("Entwurf/Plan.pdf, p.3", ENTWURF),
        ]

    def test_each_key_finds_its_own_document(self):
        registry = _registered(*TWO_PLANS)

        assert registry.entry_for_citation_key("Entwurf/Plan.pdf, p.3").document_id == ENTWURF
        assert registry.entry_for_citation_key("Bestand/Plan.pdf, p.3").document_id == BESTAND

    def test_the_wire_names_each_stored_document_and_its_bare_file_name(self):
        registry = _registered(*TWO_PLANS)

        wire = [source_entry_to_wire(entry) for entry in registry.all_sources()]

        assert [(chip["stored_document_id"], chip["document_id"], chip["file_name"]) for chip in wire] == [
            (BESTAND, f"doc:id:{BESTAND}", "Plan.pdf"),
            (ENTWURF, f"doc:id:{ENTWURF}", "Plan.pdf"),
        ]

    def test_an_answer_citing_both_keeps_both(self):
        registry = _registered(*TWO_PLANS)
        answer = (
            "Im Bestand ist der Fluchtweg 40 m lang [1], im Entwurf 35 m [2].\n\n"
            "## Quellen\n- [1] Bestand/Plan.pdf, p.3\n- [2] Entwurf/Plan.pdf, p.3\n"
        )

        verification = verify_citations(answer, registry, reference_sources=registry.all_sources())

        cited = [registry.entry_for_citation_key(c["citation_key"]) for c in verification.valid_citations]
        assert [entry.document_id for entry in cited] == [BESTAND, ENTWURF]
        assert verification.removed_citations == []

    def test_a_replayed_turn_read_from_the_text_still_holds_two_sources(self):
        registry = _registered(*TWO_PLANS, records=False)

        assert [entry.citation_key for entry in registry.all_sources()] == [
            "Bestand/Plan.pdf, p.3",
            "Entwurf/Plan.pdf, p.3",
        ]


class TestOneDocumentFoundTwice:
    def test_two_passages_of_one_page_are_one_source(self):
        registry = _registered(_chunk(ENTWURF, body="Erster Absatz."), _chunk(ENTWURF, body="Zweiter Absatz."))

        (entry,) = registry.all_sources()
        assert entry.document_id == ENTWURF and "Zweiter Absatz." in (entry.chunk_text or "")

    def test_a_lone_name_in_a_block_keeps_its_plain_key(self):
        registry = _registered(_chunk(ENTWURF))

        assert [entry.citation_key for entry in registry.all_sources()] == ["Plan.pdf, p.3"]

    def test_the_plain_key_and_the_folder_key_of_one_document_are_one_source(self):
        registry = SourceRegistry()
        token = begin_grounding_capture()
        try:
            for found in ((_chunk(ENTWURF),), TWO_PLANS):
                for entry in extract_sources_from_tool_result("knowledge_search", _search_text(*found)):
                    registry.add(entry)
        finally:
            end_grounding_capture(token)

        assert sorted(entry.document_id for entry in registry.all_sources()) == [BESTAND, ENTWURF]
        assert registry.entry_for_citation_key("Plan.pdf, p.3").document_id == ENTWURF

    def test_a_reading_without_an_id_joins_the_document_of_its_name(self):
        registry = _registered(_chunk(ENTWURF))
        registry.add(
            SourceEntry(
                citation_key="Plan.pdf, p.3",
                source_type="knowledge_layer",
                tool_name="read_file",
                collection="proj_1",
                folder_path="Entwurf",
                chunk_text="Seite drei.",
            )
        )

        (entry,) = registry.all_sources()
        assert entry.document_id == ENTWURF and "Seite drei." in (entry.chunk_text or "")


def test_a_resumed_conversation_keeps_the_document_identity():
    registry = _registered(*TWO_PLANS)

    restored = _registry_from_cached_entries([dataclasses.asdict(entry) for entry in registry.all_sources()])

    assert [(entry.document_id, entry.folder_path) for entry in restored.all_sources()] == [
        (BESTAND, "Bestand"),
        (ENTWURF, "Entwurf"),
    ]


def test_the_base_corpus_keeps_its_name_identity_and_names_no_stored_document():
    base = SimpleNamespace(
        file_name="oib-rl_2_ausgabe_mai_2023.pdf",
        page_number=12,
        content="Brandabschnitte.",
        content_type=SimpleNamespace(value="text"),
        score=0.9,
        metadata={"collection": "base_corpus", "shelf": "base", "doc_class": "oib_guideline"},
    )
    registry = SourceRegistry()
    for entry in extract_sources_from_tool_result("knowledge_search", _search_text(base)):
        registry.add(entry)

    (chip,) = [source_entry_to_wire(entry) for entry in registry.all_sources()]
    assert chip["document_id"] == "doc:base_corpus:oib-rl_2_ausgabe_mai_2023.pdf"
    assert "stored_document_id" not in chip
