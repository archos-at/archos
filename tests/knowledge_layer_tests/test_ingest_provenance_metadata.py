import pytest
from knowledge_layer.ingest import EMBED_EXCLUDED_METADATA_KEYS
from knowledge_layer.ingest import provenance_from_config

_STAMPED = {
    "authored_by": "agent",
    "approved_by": "Maria Huber",
    "approved_at": "2026-09-01T10:00:00.000Z",
    "producer": "agent_document",
}


class TestProvenanceFromConfig:
    def test_the_four_keys_come_off_the_job_config(self):
        assert provenance_from_config({"cleanup_files": True, **_STAMPED}) == _STAMPED

    def test_a_human_document_yields_nothing_to_stamp(self):
        assert provenance_from_config({"cleanup_files": True}) == {}

    def test_a_non_agent_author_yields_nothing_either(self):
        assert provenance_from_config({"authored_by": "user", "approved_by": "Maria Huber"}) == {}

    def test_a_missing_approver_does_not_lose_the_author(self):
        assert provenance_from_config({"authored_by": "agent"}) == {"authored_by": "agent"}


class TestEmbedExclusions:
    @pytest.mark.parametrize("key", sorted(_STAMPED))
    def test_provenance_is_excluded_from_the_embedded_text(self, key):
        assert key in EMBED_EXCLUDED_METADATA_KEYS

    def test_doc_class_is_still_embedded(self):
        assert "doc_class" not in EMBED_EXCLUDED_METADATA_KEYS


class TestDocumentMetadataStore:
    @pytest.fixture()
    def store(self, tmp_path):
        from agent.knowledge.document_metadata_store import DocumentMetadataStore

        store = DocumentMetadataStore(f"sqlite:///{tmp_path / 'meta.db'}")
        store.register("proj_abc", "piloti/doc_1/aktenvermerk-2026-09-01.md", "Ein Aktenvermerk.")
        return store

    def test_provenance_round_trips(self, store):
        assert store.set_provenance("proj_abc", "piloti/doc_1/aktenvermerk-2026-09-01.md", _STAMPED) is True
        assert store.get_provenance("proj_abc", "piloti/doc_1/aktenvermerk-2026-09-01.md") == _STAMPED

    def test_an_unmarked_document_reads_as_none(self, store):
        assert store.get_provenance("proj_abc", "piloti/doc_1/aktenvermerk-2026-09-01.md") is None

    def test_clearing_it_is_what_a_human_document_means(self, store):
        store.set_provenance("proj_abc", "piloti/doc_1/aktenvermerk-2026-09-01.md", _STAMPED)
        store.set_provenance("proj_abc", "piloti/doc_1/aktenvermerk-2026-09-01.md", None)
        assert store.get_provenance("proj_abc", "piloti/doc_1/aktenvermerk-2026-09-01.md") is None

    def test_a_document_with_no_row_is_not_invented(self, store):
        assert store.set_provenance("proj_abc", "never-ingested.pdf", _STAMPED) is False

    def test_re_summarising_does_not_undo_the_provenance(self, store):
        store.set_provenance("proj_abc", "piloti/doc_1/aktenvermerk-2026-09-01.md", _STAMPED)
        store.register("proj_abc", "piloti/doc_1/aktenvermerk-2026-09-01.md", "Neu zusammengefasst.")
        assert store.get_provenance("proj_abc", "piloti/doc_1/aktenvermerk-2026-09-01.md") == _STAMPED

    def test_the_row_goes_when_the_chunks_do(self, store):
        store.set_provenance("proj_abc", "piloti/doc_1/aktenvermerk-2026-09-01.md", _STAMPED)
        store.unregister("proj_abc", "piloti/doc_1/aktenvermerk-2026-09-01.md")
        assert store.get_provenance("proj_abc", "piloti/doc_1/aktenvermerk-2026-09-01.md") is None

    def test_an_unreadable_stored_value_reads_as_unmarked(self, store):
        store._update_column("proj_abc", "piloti/doc_1/aktenvermerk-2026-09-01.md", "provenance", "not json")
        assert store.get_provenance("proj_abc", "piloti/doc_1/aktenvermerk-2026-09-01.md") is None
