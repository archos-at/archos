"""A listing from what the writers really put on a chunk (``ingest.listing``)."""

from __future__ import annotations

from datetime import UTC
from datetime import datetime

from knowledge_layer.ingest import files_from_payloads
from knowledge_layer.ingest import stamp_chunk_metadata
from knowledge_layer.ingest import text_documents_for_pages
from knowledge_layer.vector_store import ChunkRecord
from knowledge_layer.vector_store import build_payload
from knowledge_layer.vector_store import enrichment


def _pdf_payloads(file_name: str) -> list[dict]:
    """The payloads the PDF text path writes for a two-page file, enrichment included."""
    pages = [{"page_number": n, "text": "Bescheid über die Baubewilligung " * 30, "tables": []} for n in (1, 2)]
    documents = text_documents_for_pages(pages, file_name, 12_345)
    stamp_chunk_metadata(documents, doc_class="permit", provenance={}, chunk_size=1024, file_name=file_name)
    extra = enrichment("proj_x", {"organization_id": "org_1"})
    return [
        build_payload(
            "proj_x", ChunkRecord(chunk_id=f"c{i}", text=doc.text, embedding=[], metadata=doc.metadata), extra
        )
        for i, doc in enumerate(documents)
    ]


class TestAListingFromTheChunks:
    def test_a_pdf_keeps_its_ingest_date_and_type_once_its_job_record_is_gone(self):
        info = files_from_payloads("proj_x", _pdf_payloads("Bescheid.pdf"))["Bescheid.pdf"]

        assert info.ingested_at is not None
        assert abs((datetime.now(UTC) - info.ingested_at).total_seconds()) < 60
        assert info.metadata["file_type"] == "application/pdf"
        assert info.metadata["page_count"] == 2

    def test_the_newest_write_is_the_ingest_date(self):
        older = {"file_name": "a.pdf", "indexed_at": 1_700_000_000}
        newer = {"file_name": "a.pdf", "indexed_at": 1_800_000_000}
        info = files_from_payloads("c", [older, newer, None])["a.pdf"]

        assert info.ingested_at == datetime.fromtimestamp(1_800_000_000, UTC)
        assert info.chunk_count == 2

    def test_a_date_the_plain_text_reader_stamped_still_wins(self):
        payload = {"file_name": "a.txt", "last_modified_date": "2026-10-01", "indexed_at": 1_800_000_000}
        info = files_from_payloads("c", [payload])["a.txt"]

        assert info.ingested_at == datetime(2026, 10, 1)
        assert info.metadata["file_type"] == "text/plain"
