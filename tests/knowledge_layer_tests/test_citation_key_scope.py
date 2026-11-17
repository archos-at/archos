from __future__ import annotations

from types import SimpleNamespace

from knowledge_layer.search import format_results
from knowledge_layer.search.grounding_hits import _ambiguous_file_names

from agent.citations.entries import SourceEntry
from agent.citations.extraction import extract_sources_from_tool_result
from agent.citations.registry import SourceRegistry
from agent.common.source_kinds import Shelf


def _chunk(*, file_name: str, collection: str, shelf: str | None = None, page: int | None = 3):
    metadata: dict[str, str] = {"collection": collection}
    if shelf is not None:
        metadata["shelf"] = shelf
    return SimpleNamespace(
        file_name=file_name,
        page_number=page,
        content="snippet",
        content_type=SimpleNamespace(value="text"),
        score=0.9,
        metadata=metadata,
    )


def _format(chunks) -> str:
    return format_results(SimpleNamespace(success=True, chunks=chunks, error_message=None), "q")


def test_a_name_held_on_one_shelf_is_not_qualified():
    text = _format(
        [
            _chunk(file_name="Plan.pdf", collection="proj_alpha", shelf="project"),
            _chunk(file_name="Konzept.pdf", collection="proj_alpha", shelf="project", page=7),
        ]
    )
    assert "Citation: Plan.pdf, p.3" in text
    assert "Citation: Konzept.pdf, p.7" in text
    assert "(Projektwissen)" not in text


def test_a_name_held_on_two_shelves_is_qualified_on_both():
    text = _format(
        [
            _chunk(file_name="Plan.pdf", collection="proj_alpha", shelf="project"),
            _chunk(file_name="Plan.pdf", collection="archiv_org1", shelf="office_shelf"),
        ]
    )
    assert "Citation: Plan.pdf (Projektwissen), p.3" in text
    assert "Citation: Plan.pdf (Büroablage), p.3" in text


def test_only_the_ambiguous_name_is_qualified():
    text = _format(
        [
            _chunk(file_name="Plan.pdf", collection="proj_alpha", shelf="project"),
            _chunk(file_name="Plan.pdf", collection="archiv_org1", shelf="office_shelf"),
            _chunk(file_name="Konzept.pdf", collection="proj_alpha", shelf="project", page=7),
        ]
    )
    assert "Citation: Konzept.pdf, p.7" in text
    assert "Citation: Konzept.pdf (Projektwissen)" not in text


def test_a_private_session_file_is_not_cited_as_project_knowledge():
    chunks = [
        _chunk(file_name="Plan.pdf", collection="s_9f2a4c", shelf="session"),
        _chunk(file_name="Plan.pdf", collection="proj_alpha", shelf="project"),
    ]
    assert _ambiguous_file_names(chunks) == {"plan.pdf"}
    text = _format(chunks)
    assert "Citation: Plan.pdf (Private Sitzung), p.3" in text
    assert "Citation: Plan.pdf (Projektwissen), p.3" in text


def test_two_collections_on_the_same_shelf_are_not_a_collision():
    chunks = [
        _chunk(file_name="Plan.pdf", collection="proj_alpha", shelf="project"),
        _chunk(file_name="Plan.pdf", collection="proj_beta", shelf="project"),
    ]
    assert _ambiguous_file_names(chunks) == set()
    assert "(Projektwissen)" not in _format(chunks)


def test_an_unstated_shelf_is_never_guessed_from_the_collection_id():
    chunks = [
        _chunk(file_name="Plan.pdf", collection="proj_alpha"),
        _chunk(file_name="Plan.pdf", collection="archiv_org1"),
    ]
    assert _ambiguous_file_names(chunks) == set()
    text = _format(chunks)
    assert "Citation: Plan.pdf, p.3" in text
    assert "(Projektwissen)" not in text
    assert "(Büroablage)" not in text
    assert "Shelf:" not in text


def test_the_display_title_is_unaffected():
    text = _format(
        [
            _chunk(file_name="Plan.pdf", collection="proj_alpha", shelf="project"),
            _chunk(file_name="Plan.pdf", collection="archiv_org1", shelf="office_shelf"),
        ]
    )
    assert "Source: Plan.pdf\n" in text


def test_the_shelf_travels_from_chunk_metadata_into_the_citation_payload():
    text = _format(
        [
            _chunk(file_name="Plan.pdf", collection="s_9f2a4c", shelf="session"),
            _chunk(file_name="Norm.pdf", collection="oib_knowledge", shelf="base", page=12),
        ]
    )
    assert "Shelf: session" in text
    assert "Shelf: base" in text

    entries = extract_sources_from_tool_result("knowledge_search", text)
    by_name = {(entry.citation_key or "").split(",")[0]: entry for entry in entries}
    assert by_name["Plan.pdf"].shelf == "session"
    assert by_name["Norm.pdf"].shelf == "base"


def test_a_qualified_key_resolves_to_the_entry_on_that_shelf():
    text = _format(
        [
            _chunk(file_name="Plan.pdf", collection="s_9f2a4c", shelf="session"),
            _chunk(file_name="Plan.pdf", collection="proj_alpha", shelf="project"),
        ]
    )
    registry = SourceRegistry()
    for entry in extract_sources_from_tool_result("knowledge_search", text):
        registry.add(entry)

    session_hit = registry.entry_for_citation_key("Plan.pdf (Private Sitzung), p.3")
    project_hit = registry.entry_for_citation_key("Plan.pdf (Projektwissen), p.3")
    assert session_hit is not None and session_hit.collection == "s_9f2a4c"
    assert project_hit is not None and project_hit.collection == "proj_alpha"


def test_a_legacy_entry_without_a_shelf_still_resolves_by_collection_name():
    registry = SourceRegistry()
    registry.add(
        SourceEntry(
            citation_key="Plan.pdf (Büroablage), p.3",
            source_type="knowledge_layer",
            tool_name="knowledge_search",
            collection="archiv_org1",
        )
    )
    registry.add(
        SourceEntry(
            citation_key="Plan.pdf (Projektwissen), p.3",
            source_type="knowledge_layer",
            tool_name="knowledge_search",
            collection="proj_alpha",
        )
    )
    office_shelf_hit = registry.entry_for_citation_key("Plan.pdf (Büroablage), p.3")
    assert office_shelf_hit is not None and office_shelf_hit.collection == "archiv_org1"


def test_the_wire_payload_carries_the_shelf_and_omits_an_unknown_one():
    from agent.citations.wire import source_entry_to_wire

    stated = SourceEntry(
        citation_key="Plan.pdf, p.3",
        source_type="knowledge_layer",
        collection="s_9f2a4c",
        shelf=str(Shelf.SESSION),
    )
    assert source_entry_to_wire(stated)["shelf"] == "session"

    unknown = SourceEntry(citation_key="Plan.pdf, p.3", source_type="knowledge_layer", collection="s_9f2a4c")
    assert "shelf" not in source_entry_to_wire(unknown)
