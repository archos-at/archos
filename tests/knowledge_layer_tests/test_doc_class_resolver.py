from __future__ import annotations

import tempfile
from pathlib import Path
from types import SimpleNamespace

from knowledge_layer.search import format_results

from agent.knowledge.document_metadata_store import DocumentMetadataStore
from agent.knowledge.factory import configure_summary_db
from agent.knowledge.factory import register_summary
from agent.knowledge.factory import set_document_doc_class


def _chunk(*, file_name: str, collection: str, doc_class: str | None):
    metadata = {"collection": collection}
    if doc_class is not None:
        metadata["doc_class"] = doc_class
    return SimpleNamespace(
        file_name=file_name,
        page_number=3,
        content="snippet",
        content_type=SimpleNamespace(value="text"),
        score=0.9,
        metadata=metadata,
    )


def test_stored_doc_class_wins_over_chunk_metadata():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_url = f"sqlite:///{Path(tmpdir) / 'resolver.db'}"
        DocumentMetadataStore._tables_initialized.discard(db_url)
        configure_summary_db(db_url)

        register_summary("oib_knowledge", "doc.pdf", "A document.")
        assert set_document_doc_class("oib_knowledge", "doc.pdf", "oib_guideline")

        result = SimpleNamespace(
            success=True,
            chunks=[_chunk(file_name="doc.pdf", collection="oib_knowledge", doc_class="oib_guide")],
            error_message=None,
        )
        text = format_results(result, "q")

        assert "Dokumentart: oib_guideline" in text
        assert "Dokumentart: oib_guide —" not in text
        assert "building_law_oib" in text
        DocumentMetadataStore.dispose_engine(db_url)


def test_falls_back_to_chunk_metadata_when_store_empty():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_url = f"sqlite:///{Path(tmpdir) / 'resolver2.db'}"
        DocumentMetadataStore._tables_initialized.discard(db_url)
        configure_summary_db(db_url)

        result = SimpleNamespace(
            success=True,
            chunks=[_chunk(file_name="orphan.pdf", collection="oib_knowledge", doc_class="oib_guide")],
            error_message=None,
        )
        text = format_results(result, "q")

        assert "Dokumentart: oib_guide" in text
        DocumentMetadataStore.dispose_engine(db_url)


def test_stored_display_title_is_the_source_label():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_url = f"sqlite:///{Path(tmpdir) / 'title.db'}"
        DocumentMetadataStore._tables_initialized.discard(db_url)
        configure_summary_db(db_url)

        register_summary("oib_knowledge", "oib-rl_2_ausgabe_mai_2023.pdf", "Brandschutz.")
        from agent.knowledge.factory import set_document_display_title

        assert set_document_display_title("oib_knowledge", "oib-rl_2_ausgabe_mai_2023.pdf", "Custom OIB Name")

        result = SimpleNamespace(
            success=True,
            chunks=[_chunk(file_name="oib-rl_2_ausgabe_mai_2023.pdf", collection="oib_knowledge", doc_class=None)],
            error_message=None,
        )
        text = format_results(result, "q")

        assert "Source: Custom OIB Name" in text
        assert "Source: oib-rl_2_ausgabe_mai_2023.pdf" not in text
        assert "Citation: oib-rl_2_ausgabe_mai_2023.pdf, p.3" in text
        DocumentMetadataStore.dispose_engine(db_url)


def test_display_title_falls_back_to_derived_default():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_url = f"sqlite:///{Path(tmpdir) / 'title2.db'}"
        DocumentMetadataStore._tables_initialized.discard(db_url)
        configure_summary_db(db_url)

        result = SimpleNamespace(
            success=True,
            chunks=[_chunk(file_name="oib-rl_2_ausgabe_mai_2023.pdf", collection="oib_knowledge", doc_class=None)],
            error_message=None,
        )
        text = format_results(result, "q")

        assert "Source: OIB-Richtlinie 2, Ausgabe Mai 2023" in text
        DocumentMetadataStore.dispose_engine(db_url)


def test_non_oib_upload_keeps_its_filename_as_source():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_url = f"sqlite:///{Path(tmpdir) / 'title3.db'}"
        DocumentMetadataStore._tables_initialized.discard(db_url)
        configure_summary_db(db_url)

        result = SimpleNamespace(
            success=True,
            chunks=[_chunk(file_name="Brandschutzkonzept.pdf", collection="s_session", doc_class=None)],
            error_message=None,
        )
        text = format_results(result, "q")

        assert "Source: Brandschutzkonzept.pdf" in text
        DocumentMetadataStore.dispose_engine(db_url)
