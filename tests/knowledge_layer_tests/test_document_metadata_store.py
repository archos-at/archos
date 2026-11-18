import tempfile
from pathlib import Path

import pytest

from agent.knowledge.document_metadata_store import DocumentMetadataStore
from agent.knowledge.document_metadata_store import _normalize_db_url
from agent.knowledge.schema import AvailableDocument


class TestNormalizeDbUrl:
    def test_sqlite_url_async_mode(self):
        url = "sqlite:///./summaries.db"
        result = _normalize_db_url(url, async_mode=True)
        assert result == "sqlite+aiosqlite:///./summaries.db"

    def test_sqlite_url_sync_mode(self):
        url = "sqlite:///./summaries.db"
        result = _normalize_db_url(url, async_mode=False)
        assert result == "sqlite:///./summaries.db"

    def test_sqlite_already_async(self):
        url = "sqlite+aiosqlite:///./summaries.db"
        result = _normalize_db_url(url, async_mode=True)
        assert result == "sqlite+aiosqlite:///./summaries.db"

    def test_postgresql_url_async_mode(self):
        url = "postgresql://user:pass@localhost:5432/db"  # pragma: allowlist secret
        result = _normalize_db_url(url, async_mode=True)
        assert result == "postgresql+psycopg://user:pass@localhost:5432/db"  # pragma: allowlist secret

    def test_postgresql_url_sync_mode(self):
        url = "postgresql://user:pass@localhost:5432/db"  # pragma: allowlist secret
        result = _normalize_db_url(url, async_mode=False)
        assert result == "postgresql+psycopg://user:pass@localhost:5432/db"  # pragma: allowlist secret

    def test_postgres_shorthand_url(self):
        url = "postgres://user:pass@localhost:5432/db"  # pragma: allowlist secret
        result = _normalize_db_url(url, async_mode=True)
        assert result == "postgresql+psycopg://user:pass@localhost:5432/db"  # pragma: allowlist secret

    def test_postgresql_with_existing_driver(self):
        url = "postgresql+asyncpg://user:pass@localhost:5432/db"  # pragma: allowlist secret
        result = _normalize_db_url(url, async_mode=True)
        assert "psycopg" in result

    def test_asyncpg_ssl_param_translated_to_sslmode(self):
        url = "postgresql+asyncpg://user:pass@localhost:5432/db?ssl=require"  # pragma: allowlist secret
        result = _normalize_db_url(url, async_mode=False)
        assert result == "postgresql+psycopg://user:pass@localhost:5432/db?sslmode=require"  # pragma: allowlist secret

    def test_asyncpg_ssl_param_translated_mid_query(self):
        url = "postgresql+asyncpg://u:p@localhost:5432/db?application_name=x&ssl=require"  # pragma: allowlist secret
        result = _normalize_db_url(url, async_mode=False)
        expected = (
            "postgresql+psycopg://u:p@localhost:5432/db"  # pragma: allowlist secret
            "?application_name=x&sslmode=require"
        )
        assert result == expected

    def test_asyncpg_ssl_boolean_values_mapped(self):
        url = "postgresql+asyncpg://u:p@localhost:5432/db?ssl=true"  # pragma: allowlist secret
        result = _normalize_db_url(url)
        assert result == "postgresql+psycopg://u:p@localhost:5432/db?sslmode=require"  # pragma: allowlist secret
        url = "postgresql+asyncpg://u:p@localhost:5432/db?ssl=false"  # pragma: allowlist secret
        result = _normalize_db_url(url)
        assert result == "postgresql+psycopg://u:p@localhost:5432/db?sslmode=disable"  # pragma: allowlist secret

    def test_sslmode_param_passes_through(self):
        url = "postgresql+psycopg://user:pass@localhost:5432/db?sslmode=require"  # pragma: allowlist secret
        result = _normalize_db_url(url, async_mode=True)
        assert result == "postgresql+psycopg://user:pass@localhost:5432/db?sslmode=require"  # pragma: allowlist secret

    def test_unknown_url_passthrough(self):
        url = "mysql://user:pass@localhost/db"  # pragma: allowlist secret
        result = _normalize_db_url(url, async_mode=True)
        assert result == url


class TestAvailableDocument:
    def test_create_with_summary(self):
        doc = AvailableDocument(file_name="test.pdf", summary="A test document.")
        assert doc.file_name == "test.pdf"
        assert doc.summary == "A test document."

    def test_create_without_summary(self):
        doc = AvailableDocument(file_name="test.pdf")
        assert doc.file_name == "test.pdf"
        assert doc.summary is None

    def test_model_dump(self):
        doc = AvailableDocument(file_name="report.pdf", summary="Financial report.")
        data = doc.model_dump()
        assert data == {
            "file_name": "report.pdf",
            "summary": "Financial report.",
            "tags": None,
            "doc_class": None,
            "display_title": None,
            "folder_path": None,
            "topics": None,
            "capture": None,
            "superseded_by": None,
            "supersedes": None,
            "revision_suggestion": None,
            "revision_facts": None,
            "page_count": None,
            "dossier": None,
            "doc_references": None,
            "coverage": None,
            "mail_thread": None,
            "mail_origin": None,
            "change_summary": None,
            "change_basis": None,
            "added_at": None,
            "collection": None,
            "shelf": None,
        }

    def test_model_dump_without_summary(self):
        doc = AvailableDocument(file_name="report.pdf")
        data = doc.model_dump()
        assert data == {
            "file_name": "report.pdf",
            "summary": None,
            "tags": None,
            "doc_class": None,
            "display_title": None,
            "folder_path": None,
            "topics": None,
            "capture": None,
            "superseded_by": None,
            "supersedes": None,
            "revision_suggestion": None,
            "revision_facts": None,
            "page_count": None,
            "dossier": None,
            "doc_references": None,
            "coverage": None,
            "mail_thread": None,
            "mail_origin": None,
            "change_summary": None,
            "change_basis": None,
            "added_at": None,
            "collection": None,
            "shelf": None,
        }

    def test_model_validate(self):
        data = {"file_name": "doc.pdf", "summary": "Test summary"}
        doc = AvailableDocument.model_validate(data)
        assert doc.file_name == "doc.pdf"
        assert doc.summary == "Test summary"
        assert doc.tags is None

    def test_create_with_tags(self):
        doc = AvailableDocument(file_name="plan.pdf", summary="A floor plan.", tags=["Grundriss", "Brandschutz"])
        assert doc.tags == ["Grundriss", "Brandschutz"]
        assert AvailableDocument.model_validate(doc.model_dump()).tags == ["Grundriss", "Brandschutz"]


class TestDocumentMetadataStore:
    @pytest.fixture
    def temp_db(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "test_summaries.db"
            db_url = f"sqlite:///{db_path}"
            yield db_url
            DocumentMetadataStore.dispose_engine(db_url)

    @pytest.fixture
    def store(self, temp_db):
        return DocumentMetadataStore(temp_db)

    def test_store_initialization(self, temp_db):
        store = DocumentMetadataStore(temp_db)
        assert store.db_url == temp_db

    def test_register_summary(self, store):
        store.register("test_collection", "doc1.pdf", "This is a test summary.")
        docs = store.get_all("test_collection")
        assert len(docs) == 1
        assert docs[0].file_name == "doc1.pdf"
        assert docs[0].summary == "This is a test summary."

    def test_register_multiple_summaries(self, store):
        store.register("collection1", "doc1.pdf", "Summary 1")
        store.register("collection1", "doc2.pdf", "Summary 2")
        store.register("collection1", "doc3.pdf", "Summary 3")

        docs = store.get_all("collection1")
        assert len(docs) == 3
        filenames = {doc.file_name for doc in docs}
        assert filenames == {"doc1.pdf", "doc2.pdf", "doc3.pdf"}

    def test_register_updates_existing(self, store):
        store.register("collection", "doc.pdf", "Original summary")
        store.register("collection", "doc.pdf", "Updated summary")

        docs = store.get_all("collection")
        assert len(docs) == 1
        assert docs[0].summary == "Updated summary"

    def test_register_with_tags_roundtrip(self, store):
        store.register("coll", "plan.pdf", "A floor plan.", tags=["Grundriss", "Brandschutz"])
        docs = store.get_all("coll")
        assert len(docs) == 1
        assert docs[0].summary == "A floor plan."
        assert docs[0].tags == ["Grundriss", "Brandschutz"]

    def test_register_without_tags_is_none(self, store):
        store.register("coll", "doc.pdf", "A summary.")
        docs = store.get_all("coll")
        assert docs[0].tags is None

    def test_register_tags_update_overwrites(self, store):
        store.register("coll", "doc.pdf", "Summary.", tags=["Grundriss"])
        store.register("coll", "doc.pdf", "Summary.", tags=["Schnitt", "Schallschutz"])
        docs = store.get_all("coll")
        assert docs[0].tags == ["Schnitt", "Schallschutz"]

    @pytest.mark.asyncio
    async def test_get_all_async_with_tags(self, store):
        store.register("acoll", "plan.pdf", "A plan.", tags=["Grundriss"])
        docs = await store.get_all_async("acoll")
        assert len(docs) == 1
        assert docs[0].tags == ["Grundriss"]

    def test_fresh_table_has_tags_column(self, temp_db):
        from sqlalchemy import create_engine
        from sqlalchemy import inspect

        DocumentMetadataStore(temp_db)  # creates the table
        engine = create_engine(temp_db)
        columns = {c["name"] for c in inspect(engine).get_columns("document_metadata")}
        assert "tags" in columns
        engine.dispose()

    def test_existing_table_without_tags_is_migrated(self):
        from sqlalchemy import create_engine
        from sqlalchemy import inspect
        from sqlalchemy import text

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "legacy.db"
            db_url = f"sqlite:///{db_path}"

            engine = create_engine(db_url)
            with engine.connect() as conn:
                conn.execute(
                    text(
                        "CREATE TABLE summaries ("
                        "collection VARCHAR(256) NOT NULL, "
                        "filename VARCHAR(512) NOT NULL, "
                        "summary TEXT NOT NULL, "
                        "created_at DATETIME, "
                        "PRIMARY KEY (collection, filename))"
                    )
                )
                conn.execute(
                    text("INSERT INTO summaries (collection, filename, summary) VALUES ('c', 'old.pdf', 'Legacy.')")
                )
                conn.commit()

            assert "tags" not in {c["name"] for c in inspect(engine).get_columns("summaries")}

            DocumentMetadataStore._tables_initialized.discard(db_url)
            store = DocumentMetadataStore(db_url)
            inspector = inspect(engine)
            assert not inspector.has_table("summaries")  # renamed away
            assert "tags" in {c["name"] for c in inspector.get_columns("document_metadata")}

            docs = store.get_all("c")
            assert len(docs) == 1 and docs[0].tags is None
            store.register("c", "new.pdf", "New.", tags=["Grundriss"])
            new = {d.file_name: d for d in store.get_all("c")}
            assert new["new.pdf"].tags == ["Grundriss"]

            engine.dispose()
            DocumentMetadataStore.dispose_engine(db_url)

    def test_the_retained_table_is_renamed_in_place_and_keeps_its_rows(self):
        from sqlalchemy import create_engine
        from sqlalchemy import inspect
        from sqlalchemy import text

        with tempfile.TemporaryDirectory() as tmpdir:
            db_url = f"sqlite:///{Path(tmpdir) / 'retained.db'}"
            DocumentMetadataStore._tables_initialized.discard(db_url)
            DocumentMetadataStore(db_url)  # a current database
            engine = create_engine(db_url)
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE document_revision_retained RENAME TO document_fassung_retained"))
                conn.execute(
                    text(
                        "INSERT INTO document_fassung_retained (collection, filename, superseded_by) "
                        "VALUES ('c', 'neu.pdf', 'alt.pdf')"
                    )
                )

            DocumentMetadataStore._tables_initialized.discard(db_url)
            DocumentMetadataStore(db_url)

            inspector = inspect(engine)
            assert inspector.has_table("document_revision_retained")
            assert not inspector.has_table("document_fassung_retained")
            with engine.connect() as conn:
                rows = conn.execute(text("SELECT filename, superseded_by FROM document_revision_retained")).all()
            assert [tuple(row) for row in rows] == [("neu.pdf", "alt.pdf")]
            engine.dispose()
            DocumentMetadataStore.dispose_engine(db_url)

    def test_a_german_doc_class_is_rewritten_to_its_english_key_and_others_are_left(self):
        from sqlalchemy import create_engine
        from sqlalchemy import text

        from agent.knowledge.document_metadata_store import TABLE_NAME

        with tempfile.TemporaryDirectory() as tmpdir:
            db_url = f"sqlite:///{Path(tmpdir) / 'classes.db'}"
            DocumentMetadataStore._tables_initialized.discard(db_url)
            store = DocumentMetadataStore(db_url)
            store.register("c", "rl.pdf", "OIB-RL 2")
            store.register("c", "plan.pdf", "Grundriss")
            store.register("c", "own.pdf", "Eigenes")
            engine = create_engine(db_url)
            with engine.begin() as conn:
                conn.execute(
                    text(
                        f"UPDATE {TABLE_NAME} SET doc_class = 'oib_richtlinie', "
                        "doc_class_suggestion = 'oib_leitfaden' WHERE filename = 'rl.pdf'"
                    )
                )
                conn.execute(text(f"UPDATE {TABLE_NAME} SET doc_class = 'law' WHERE filename = 'own.pdf'"))

            DocumentMetadataStore._tables_initialized.discard(db_url)
            DocumentMetadataStore(db_url)

            with engine.connect() as conn:
                rows = conn.execute(
                    text(f"SELECT filename, doc_class, doc_class_suggestion FROM {TABLE_NAME} ORDER BY filename")
                ).all()
            assert [tuple(row) for row in rows] == [
                ("own.pdf", "law", None),
                ("plan.pdf", None, None),
                ("rl.pdf", "oib_guideline", "oib_guide"),
            ]
            engine.dispose()
            DocumentMetadataStore.dispose_engine(db_url)

    def test_a_pod_that_has_not_rolled_yet_recreates_the_old_table_and_its_rows_are_moved_across(self):
        from sqlalchemy import create_engine
        from sqlalchemy import text

        with tempfile.TemporaryDirectory() as tmpdir:
            db_url = f"sqlite:///{Path(tmpdir) / 'both.db'}"
            DocumentMetadataStore._tables_initialized.discard(db_url)
            DocumentMetadataStore(db_url)
            engine = create_engine(db_url)
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "CREATE TABLE document_fassung_retained (collection VARCHAR(256) NOT NULL, "
                        "filename VARCHAR(512) NOT NULL, superseded_by TEXT, revision_suggestion TEXT, "
                        "change_summary TEXT, change_basis TEXT, PRIMARY KEY (collection, filename))"
                    )
                )
                conn.execute(
                    text(
                        "INSERT INTO document_revision_retained (collection, filename, superseded_by) "
                        "VALUES ('c', 'kept.pdf', 'new-table.pdf')"
                    )
                )
                conn.execute(
                    text(
                        "INSERT INTO document_fassung_retained (collection, filename, superseded_by) "
                        "VALUES ('c', 'kept.pdf', 'old-table.pdf'), ('c', 'moved.pdf', 'x.pdf')"
                    )
                )

            DocumentMetadataStore._tables_initialized.discard(db_url)
            DocumentMetadataStore(db_url)

            with engine.connect() as conn:
                rows = conn.execute(
                    text("SELECT filename, superseded_by FROM document_revision_retained ORDER BY filename")
                ).all()
                left = conn.execute(text("SELECT count(*) FROM document_fassung_retained")).scalar()
            assert [tuple(row) for row in rows] == [("kept.pdf", "new-table.pdf"), ("moved.pdf", "x.pdf")]
            assert left == 0
            engine.dispose()
            DocumentMetadataStore.dispose_engine(db_url)

    def test_set_and_get_doc_class_roundtrip(self, store):
        store.register("coll", "doc.pdf", "A summary.")
        assert store.get_doc_class("coll", "doc.pdf") is None  # default null
        assert store.set_doc_class("coll", "doc.pdf", "oib_guideline") is True
        assert store.get_doc_class("coll", "doc.pdf") == "oib_guideline"
        docs = store.get_all("coll")
        assert docs[0].doc_class == "oib_guideline"

    def test_set_doc_class_without_row_returns_false(self, store):
        assert store.set_doc_class("coll", "missing.pdf", "law") is False
        assert store.get_doc_class("coll", "missing.pdf") is None

    def test_a_doc_class_suggestion_is_stored_beside_the_class_never_as_it(self, store):
        store.register("coll", "doc.pdf", "A summary.")
        store.set_doc_class("coll", "doc.pdf", "other")
        assert store.set_doc_class_suggestion("coll", "doc.pdf", "law") is True
        assert store.get_doc_class("coll", "doc.pdf") == "other"
        assert store.get_doc_class_suggestions_batch("coll", ["doc.pdf", "other.pdf"]) == {"doc.pdf": "law"}
        assert store.set_doc_class_suggestion("coll", "doc.pdf", None) is True
        assert store.get_doc_class_suggestions_batch("coll", ["doc.pdf"]) == {}
        assert store.set_doc_class_suggestion("coll", "missing.pdf", "law") is False

    def test_set_doc_class_clear(self, store):
        store.register("coll", "doc.pdf", "A summary.")
        store.set_doc_class("coll", "doc.pdf", "law")
        assert store.set_doc_class("coll", "doc.pdf", None) is True
        assert store.get_doc_class("coll", "doc.pdf") is None

    def test_fresh_table_has_doc_class_column(self, temp_db):
        from sqlalchemy import create_engine
        from sqlalchemy import inspect

        DocumentMetadataStore(temp_db)  # creates the table
        engine = create_engine(temp_db)
        columns = {c["name"] for c in inspect(engine).get_columns("document_metadata")}
        assert "doc_class" in columns
        engine.dispose()

    def test_existing_table_without_doc_class_is_migrated(self):
        from sqlalchemy import create_engine
        from sqlalchemy import inspect
        from sqlalchemy import text

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "legacy_dc.db"
            db_url = f"sqlite:///{db_path}"

            engine = create_engine(db_url)
            with engine.connect() as conn:
                conn.execute(
                    text(
                        "CREATE TABLE summaries ("
                        "collection VARCHAR(256) NOT NULL, "
                        "filename VARCHAR(512) NOT NULL, "
                        "summary TEXT NOT NULL, "
                        "tags TEXT, "
                        "created_at DATETIME, "
                        "PRIMARY KEY (collection, filename))"
                    )
                )
                conn.execute(
                    text("INSERT INTO summaries (collection, filename, summary) VALUES ('c', 'old.pdf', 'Legacy.')")
                )
                conn.commit()

            assert "doc_class" not in {c["name"] for c in inspect(engine).get_columns("summaries")}

            DocumentMetadataStore._tables_initialized.discard(db_url)
            store = DocumentMetadataStore(db_url)
            assert "doc_class" in {c["name"] for c in inspect(engine).get_columns("document_metadata")}

            assert store.get_doc_class("c", "old.pdf") is None
            store.set_doc_class("c", "old.pdf", "oib_guide")
            assert store.get_doc_class("c", "old.pdf") == "oib_guide"

            engine.dispose()
            DocumentMetadataStore.dispose_engine(db_url)

    def test_existing_table_without_tags_set_by_is_migrated(self):
        from sqlalchemy import create_engine
        from sqlalchemy import inspect
        from sqlalchemy import text

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "legacy_tsb.db"
            db_url = f"sqlite:///{db_path}"

            engine = create_engine(db_url)
            with engine.connect() as conn:
                conn.execute(
                    text(
                        "CREATE TABLE summaries ("
                        "collection VARCHAR(256) NOT NULL, "
                        "filename VARCHAR(512) NOT NULL, "
                        "summary TEXT NOT NULL, "
                        "tags TEXT, "
                        "doc_class VARCHAR(64), "
                        "created_at DATETIME, "
                        "PRIMARY KEY (collection, filename))"
                    )
                )
                conn.execute(
                    text(
                        "INSERT INTO summaries (collection, filename, summary, tags) "
                        "VALUES ('c', 'old.pdf', 'Legacy.', '[\"Grundriss\"]')"
                    )
                )
                conn.commit()

            assert "tags_set_by" not in {c["name"] for c in inspect(engine).get_columns("summaries")}

            DocumentMetadataStore._tables_initialized.discard(db_url)
            store = DocumentMetadataStore(db_url)
            assert "tags_set_by" in {c["name"] for c in inspect(engine).get_columns("document_metadata")}

            assert store.get_all("c")[0].tags == ["Grundriss"]
            assert store.get_person_tags_batch("c", ["old.pdf"]) == {}

            assert store.set_tags_by_person("c", "old.pdf", ["Schnitt"]) is True
            store.register("c", "old.pdf", "Newer.", tags=["Bescheid"])
            assert store.get_person_tags_batch("c", ["old.pdf"]) == {"old.pdf": ["Schnitt"]}
            assert store.get_all("c")[0].tags == ["Schnitt"]

            engine.dispose()
            DocumentMetadataStore.dispose_engine(db_url)

    def test_set_and_get_display_title_roundtrip(self, store):
        store.register("coll", "doc.pdf", "A summary.")
        assert store.get_display_title("coll", "doc.pdf") is None  # default null
        assert store.set_display_title("coll", "doc.pdf", "OIB-Richtlinie 2, Ausgabe Mai 2023") is True
        assert store.get_display_title("coll", "doc.pdf") == "OIB-Richtlinie 2, Ausgabe Mai 2023"
        docs = store.get_all("coll")
        assert docs[0].display_title == "OIB-Richtlinie 2, Ausgabe Mai 2023"

    def test_set_display_title_without_row_returns_false(self, store):
        assert store.set_display_title("coll", "missing.pdf", "Some title") is False
        assert store.get_display_title("coll", "missing.pdf") is None

    def test_set_display_title_clear(self, store):
        store.register("coll", "doc.pdf", "A summary.")
        store.set_display_title("coll", "doc.pdf", "A title")
        assert store.set_display_title("coll", "doc.pdf", None) is True
        assert store.get_display_title("coll", "doc.pdf") is None

    def test_display_titles_batch(self, store):
        store.register("coll", "a.pdf", "A.")
        store.register("coll", "b.pdf", "B.")
        store.register("coll", "c.pdf", "C.")
        store.set_display_title("coll", "a.pdf", "Title A")
        store.set_display_title("coll", "c.pdf", "Title C")
        got = store.get_display_titles_batch("coll", ["a.pdf", "b.pdf", "c.pdf"])
        assert got == {"a.pdf": "Title A", "c.pdf": "Title C"}

    def test_fresh_table_has_display_title_column(self, temp_db):
        from sqlalchemy import create_engine
        from sqlalchemy import inspect

        DocumentMetadataStore(temp_db)  # creates the table
        engine = create_engine(temp_db)
        columns = {c["name"] for c in inspect(engine).get_columns("document_metadata")}
        assert "display_title" in columns
        engine.dispose()

    def test_legacy_summaries_table_renamed_preserving_rows(self):
        from sqlalchemy import create_engine
        from sqlalchemy import inspect
        from sqlalchemy import text

        with tempfile.TemporaryDirectory() as tmpdir:
            db_url = f"sqlite:///{Path(tmpdir) / 'legacy_full.db'}"

            engine = create_engine(db_url)
            with engine.connect() as conn:
                conn.execute(
                    text(
                        "CREATE TABLE summaries ("
                        "collection VARCHAR(256) NOT NULL, "
                        "filename VARCHAR(512) NOT NULL, "
                        "summary TEXT NOT NULL, "
                        "tags TEXT, "
                        "created_at DATETIME, "
                        "PRIMARY KEY (collection, filename))"
                    )
                )
                conn.execute(text("CREATE INDEX idx_summaries_collection ON summaries (collection)"))
                conn.execute(
                    text(
                        "INSERT INTO summaries (collection, filename, summary) "
                        "VALUES ('oib_knowledge', 'oib-rl_2_ausgabe_mai_2023.pdf', 'Brandschutz.')"
                    )
                )
                conn.commit()

            DocumentMetadataStore._tables_initialized.discard(db_url)
            store = DocumentMetadataStore(db_url)

            inspector = inspect(engine)
            assert not inspector.has_table("summaries")  # legacy table renamed away
            assert inspector.has_table("document_metadata")
            columns = {c["name"] for c in inspector.get_columns("document_metadata")}
            assert {"tags", "doc_class", "display_title"} <= columns
            index_names = {ix["name"] for ix in inspector.get_indexes("document_metadata")}
            assert "idx_document_metadata_collection" in index_names
            assert "idx_summaries_collection" not in index_names  # legacy index dropped

            docs = store.get_all("oib_knowledge")
            assert len(docs) == 1
            assert docs[0].file_name == "oib-rl_2_ausgabe_mai_2023.pdf"
            assert docs[0].summary == "Brandschutz."
            assert docs[0].doc_class is None
            assert docs[0].display_title is None

            engine.dispose()
            DocumentMetadataStore.dispose_engine(db_url)

    def test_get_all_empty_collection(self, store):
        docs = store.get_all("nonexistent_collection")
        assert docs == []

    def test_get_all_different_collections(self, store):
        store.register("collection_a", "doc1.pdf", "Summary A1")
        store.register("collection_a", "doc2.pdf", "Summary A2")
        store.register("collection_b", "doc3.pdf", "Summary B1")

        docs_a = store.get_all("collection_a")
        docs_b = store.get_all("collection_b")

        assert len(docs_a) == 2
        assert len(docs_b) == 1
        assert docs_b[0].file_name == "doc3.pdf"

    def test_unregister_summary(self, store):
        store.register("collection", "doc1.pdf", "Summary 1")
        store.register("collection", "doc2.pdf", "Summary 2")

        store.unregister("collection", "doc1.pdf")

        docs = store.get_all("collection")
        assert len(docs) == 1
        assert docs[0].file_name == "doc2.pdf"

    def test_unregister_nonexistent(self, store):
        store.unregister("collection", "nonexistent.pdf")  # Should not raise

    def test_clear_collection(self, store):
        store.register("collection", "doc1.pdf", "Summary 1")
        store.register("collection", "doc2.pdf", "Summary 2")
        store.register("other_collection", "doc3.pdf", "Summary 3")

        store.clear_collection("collection")

        assert store.get_all("collection") == []
        assert len(store.get_all("other_collection")) == 1

    def test_clear_all(self, store):
        store.register("collection1", "doc1.pdf", "Summary 1")
        store.register("collection2", "doc2.pdf", "Summary 2")

        store.clear_all()

        assert store.get_all("collection1") == []
        assert store.get_all("collection2") == []

    @pytest.mark.asyncio
    async def test_get_all_async(self, store):
        store.register("async_collection", "doc1.pdf", "Async summary 1")
        store.register("async_collection", "doc2.pdf", "Async summary 2")

        docs = await store.get_all_async("async_collection")

        assert len(docs) == 2
        filenames = {doc.file_name for doc in docs}
        assert filenames == {"doc1.pdf", "doc2.pdf"}

    @pytest.mark.asyncio
    async def test_get_all_async_empty(self, store):
        docs = await store.get_all_async("empty_collection")
        assert docs == []

    def test_update_tags_roundtrip(self, store):
        store.register("coll", "plan.pdf", "A floor plan.", tags=["Grundriss"])

        assert store.update_tags("coll", "plan.pdf", ["Schnitt", "Brandschutz"]) is True

        docs = {d.file_name: d for d in store.get_all("coll")}
        assert docs["plan.pdf"].tags == ["Schnitt", "Brandschutz"]
        assert docs["plan.pdf"].summary == "A floor plan."

    def test_update_tags_on_row_without_tags(self, store):
        store.register("coll", "legacy.pdf", "Legacy summary.")

        assert store.update_tags("coll", "legacy.pdf", ["Bescheid"]) is True

        docs = {d.file_name: d for d in store.get_all("coll")}
        assert docs["legacy.pdf"].tags == ["Bescheid"]

    def test_update_tags_empty_clears(self, store):
        store.register("coll", "plan.pdf", "A floor plan.", tags=["Grundriss"])

        assert store.update_tags("coll", "plan.pdf", []) is True

        docs = {d.file_name: d for d in store.get_all("coll")}
        assert docs["plan.pdf"].tags is None

    def test_update_tags_missing_row_returns_false(self, store):
        assert store.update_tags("coll", "ghost.pdf", ["Grundriss"]) is False
        assert store.get_all("coll") == []

    def test_update_tags_overwrites_machine_tags_and_returns_true(self, store):
        store.register("coll", "plan.pdf", "A floor plan.", tags=["Grundriss"])
        store.register("coll", "plan.pdf", "A floor plan.", tags=["Grundriss"])  # re-ingest, still machine

        assert store.update_tags("coll", "plan.pdf", ["Schnitt"]) is True

        assert store.get_all("coll")[0].tags == ["Schnitt"]
        assert store.get_person_tags_batch("coll", ["plan.pdf"]) == {}

    def test_a_re_register_keeps_the_tags_a_person_set(self, store):
        store.register("coll", "plan.pdf", "First summary.", tags=["Grundriss"])
        assert store.set_tags_by_person("coll", "plan.pdf", ["Schnitt", "Brandschutz"]) is True

        store.register("coll", "plan.pdf", "Newer summary.", tags=["Bescheid"])

        doc = store.get_all("coll")[0]
        assert doc.summary == "Newer summary."
        assert doc.tags == ["Schnitt", "Brandschutz"]

    def test_a_person_who_cleared_the_tags_is_not_overwritten_by_register(self, store):
        store.register("coll", "plan.pdf", "A plan.", tags=["Grundriss"])
        assert store.set_tags_by_person("coll", "plan.pdf", []) is True

        store.register("coll", "plan.pdf", "A plan.", tags=["Schnitt"])

        assert store.get_all("coll")[0].tags is None

    def test_update_tags_leaves_person_tags_alone_and_returns_false(self, store):
        store.register("coll", "plan.pdf", "A floor plan.", tags=["Grundriss"])
        store.set_tags_by_person("coll", "plan.pdf", ["Schnitt"])

        assert store.update_tags("coll", "plan.pdf", ["Bescheid"]) is False

        doc = store.get_all("coll")[0]
        assert doc.tags == ["Schnitt"]
        assert doc.summary == "A floor plan."

    def test_update_tags_leaves_a_person_cleared_row_alone(self, store):
        store.register("coll", "plan.pdf", "A floor plan.", tags=["Grundriss"])
        store.set_tags_by_person("coll", "plan.pdf", [])

        assert store.update_tags("coll", "plan.pdf", ["Bescheid"]) is False
        assert store.get_all("coll")[0].tags is None

    def test_person_tags_batch_returns_only_rows_a_person_set(self, store):
        store.register("coll", "machine.pdf", "M.", tags=["Grundriss"])
        store.register("coll", "person.pdf", "P.", tags=["Schnitt"])
        store.register("coll", "untagged.pdf", "U.")
        store.register("coll", "cleared.pdf", "C.", tags=["Bescheid"])
        store.set_tags_by_person("coll", "person.pdf", ["Brandschutz"])
        store.set_tags_by_person("coll", "cleared.pdf", [])

        result = store.get_person_tags_batch(
            "coll", ["machine.pdf", "person.pdf", "untagged.pdf", "cleared.pdf", "ghost.pdf"]
        )

        assert result == {"person.pdf": ["Brandschutz"], "cleared.pdf": []}

    def test_person_tags_batch_empty_input_and_other_collection(self, store):
        store.register("coll_a", "plan.pdf", "A.", tags=["Grundriss"])
        store.set_tags_by_person("coll_a", "plan.pdf", ["Schnitt"])

        assert store.get_person_tags_batch("coll_a", []) == {}
        assert store.get_person_tags_batch("coll_b", ["plan.pdf"]) == {}

    def test_set_tags_by_person_missing_row_returns_false(self, store):
        assert store.set_tags_by_person("coll", "ghost.pdf", ["Grundriss"]) is False
        assert store.get_all("coll") == []

    def test_list_collections(self, store):
        store.register("coll_b", "doc1.pdf", "S1")
        store.register("coll_a", "doc2.pdf", "S2")
        store.register("coll_a", "doc3.pdf", "S3")

        assert store.list_collections() == ["coll_a", "coll_b"]

    def test_list_collections_empty(self, store):
        assert store.list_collections() == []


class TestReSummarisingKeepsTheHumanColumns:
    @pytest.fixture
    def store(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_url = f"sqlite:///{Path(tmpdir) / 'resummarise.db'}"
            DocumentMetadataStore._tables_initialized.discard(db_url)
            yield DocumentMetadataStore(db_url)
            DocumentMetadataStore.dispose_engine(db_url)
            DocumentMetadataStore._tables_initialized.discard(db_url)

    def test_a_re_register_keeps_display_title_doc_class_and_folder(self, store):
        store.register("proj_a", "plan.pdf", "First summary")
        store.set_display_title("proj_a", "plan.pdf", "Einreichplan Erdgeschoss")
        store.set_doc_class("proj_a", "plan.pdf", "plan")
        store.set_folder_path("proj_a", "plan.pdf", "Brandschutz/Fluchtwege")

        store.register("proj_a", "plan.pdf", "A newer summary")

        doc = store.get_all("proj_a")[0]
        assert doc.summary == "A newer summary"
        assert doc.display_title == "Einreichplan Erdgeschoss"
        assert doc.doc_class == "plan"
        assert doc.folder_path == "Brandschutz/Fluchtwege"


class TestFactoryFunctions:
    @pytest.fixture(autouse=True)
    def reset_summary_store(self):
        from agent.knowledge import factory

        factory._document_metadata_store = None
        yield
        factory._document_metadata_store = None

    @pytest.fixture
    def temp_db_url(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "factory_test.db"
            yield f"sqlite:///{db_path}"
            DocumentMetadataStore.dispose_engine(f"sqlite:///{db_path}")

    def test_configure_summary_db(self, temp_db_url):
        from agent.knowledge import configure_summary_db

        configure_summary_db(temp_db_url)

        from agent.knowledge import factory

        assert factory._document_metadata_store is not None
        assert factory._document_metadata_store.db_url == temp_db_url

    def test_register_summary(self, temp_db_url):
        from agent.knowledge import configure_summary_db
        from agent.knowledge import get_available_documents
        from agent.knowledge.factory import register_summary

        configure_summary_db(temp_db_url)
        register_summary("test_collection", "test.pdf", "Test summary")

        docs = get_available_documents("test_collection")
        assert len(docs) == 1
        assert docs[0].file_name == "test.pdf"
        assert docs[0].summary == "Test summary"

    def test_register_summary_none_skipped(self, temp_db_url):
        from agent.knowledge import configure_summary_db
        from agent.knowledge import get_available_documents
        from agent.knowledge.factory import register_summary

        configure_summary_db(temp_db_url)
        register_summary("collection", "doc.pdf", None)

        docs = get_available_documents("collection")
        assert len(docs) == 0

    def test_register_summary_empty_string_skipped(self, temp_db_url):
        from agent.knowledge import configure_summary_db
        from agent.knowledge import get_available_documents
        from agent.knowledge.factory import register_summary

        configure_summary_db(temp_db_url)
        register_summary("collection", "doc.pdf", "")

        docs = get_available_documents("collection")
        assert len(docs) == 0

    def test_get_available_documents(self, temp_db_url):
        from agent.knowledge import configure_summary_db
        from agent.knowledge import get_available_documents
        from agent.knowledge.factory import register_summary

        configure_summary_db(temp_db_url)
        register_summary("my_collection", "file1.pdf", "Summary for file 1")
        register_summary("my_collection", "file2.pdf", "Summary for file 2")

        docs = get_available_documents("my_collection")
        assert len(docs) == 2
        assert all(isinstance(doc, AvailableDocument) for doc in docs)
        assert all(doc.collection == "my_collection" for doc in docs)

    @pytest.mark.asyncio
    async def test_get_available_documents_async(self, temp_db_url):
        from agent.knowledge import configure_summary_db
        from agent.knowledge.factory import get_available_documents_async
        from agent.knowledge.factory import register_summary

        configure_summary_db(temp_db_url)
        register_summary("async_test", "doc.pdf", "Async test summary")

        docs = await get_available_documents_async("async_test")
        assert len(docs) == 1
        assert docs[0].file_name == "doc.pdf"

    def test_unregister_summary(self, temp_db_url):
        from agent.knowledge import configure_summary_db
        from agent.knowledge import get_available_documents
        from agent.knowledge.factory import register_summary
        from agent.knowledge.factory import unregister_summary

        configure_summary_db(temp_db_url)
        register_summary("collection", "doc1.pdf", "Summary 1")
        register_summary("collection", "doc2.pdf", "Summary 2")

        unregister_summary("collection", "doc1.pdf")

        docs = get_available_documents("collection")
        assert len(docs) == 1
        assert docs[0].file_name == "doc2.pdf"

    def test_clear_collection_summaries(self, temp_db_url):
        from agent.knowledge import configure_summary_db
        from agent.knowledge import get_available_documents
        from agent.knowledge.factory import clear_collection_summaries
        from agent.knowledge.factory import register_summary

        configure_summary_db(temp_db_url)
        register_summary("coll1", "doc1.pdf", "Summary 1")
        register_summary("coll2", "doc2.pdf", "Summary 2")

        clear_collection_summaries("coll1")

        assert get_available_documents("coll1") == []
        assert len(get_available_documents("coll2")) == 1

    def test_clear_all_summaries(self, temp_db_url):
        from agent.knowledge import configure_summary_db
        from agent.knowledge import get_available_documents
        from agent.knowledge.factory import clear_all_summaries
        from agent.knowledge.factory import register_summary

        configure_summary_db(temp_db_url)
        register_summary("coll1", "doc1.pdf", "Summary 1")
        register_summary("coll2", "doc2.pdf", "Summary 2")

        clear_all_summaries()

        assert get_available_documents("coll1") == []
        assert get_available_documents("coll2") == []

    def test_lazy_initialization(self):
        from agent.knowledge import get_available_documents

        docs = get_available_documents("test_collection")
        assert docs == []  # Empty but works

        from agent.knowledge import factory

        assert factory._document_metadata_store is not None


class TestReconcileCollectionSummaries:
    @pytest.fixture(autouse=True)
    def reset_summary_store(self):
        from agent.knowledge import factory

        factory._document_metadata_store = None
        yield
        factory._document_metadata_store = None

    @pytest.fixture
    def temp_db_url(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "reconcile_test.db"
            yield f"sqlite:///{db_path}"
            DocumentMetadataStore.dispose_engine(f"sqlite:///{db_path}")

    @staticmethod
    def _file_info(file_name, status=None):
        from agent.knowledge.schema import FileInfo
        from agent.knowledge.schema import FileStatus

        return FileInfo(
            file_id=file_name,
            file_name=file_name,
            collection_name="coll",
            status=status or FileStatus.SUCCESS,
        )

    class _FakeIngestor:
        def __init__(self, files, text_samples=None):
            self._files = files
            self._text_samples = text_samples or {}

        def list_files(self, collection_name):
            return self._files

        def get_document_text_sample(self, collection_name, file_name):
            return self._text_samples.get(file_name)

    def test_backfills_missing_document_with_text_sample(self, temp_db_url):
        from agent.knowledge import configure_summary_db
        from agent.knowledge import get_available_documents
        from agent.knowledge.factory import reconcile_collection_summaries

        configure_summary_db(temp_db_url)

        ingestor = self._FakeIngestor(
            files=[self._file_info("orphan.pdf")],
            text_samples={"orphan.pdf": "Dies ist ein Brandschutzkonzept fuer das Gebaeude."},
        )

        backfilled = reconcile_collection_summaries(ingestor, "coll")

        assert backfilled == 1
        docs = {d.file_name: d for d in get_available_documents("coll")}
        assert "orphan.pdf" in docs
        assert "Brandschutzkonzept" in docs["orphan.pdf"].summary

    def test_no_sampler_falls_back_to_filename(self, temp_db_url):
        from agent.knowledge import configure_summary_db
        from agent.knowledge import get_available_documents
        from agent.knowledge.factory import reconcile_collection_summaries

        configure_summary_db(temp_db_url)

        class NoSamplerIngestor:
            def list_files(self, collection_name):
                return [TestReconcileCollectionSummaries._file_info("mystery.pdf")]

        backfilled = reconcile_collection_summaries(NoSamplerIngestor(), "coll")

        assert backfilled == 1
        docs = {d.file_name: d for d in get_available_documents("coll")}
        assert docs["mystery.pdf"].summary == "Indexed document: mystery.pdf"

    def test_noop_when_already_consistent(self, temp_db_url):
        from agent.knowledge import configure_summary_db
        from agent.knowledge import get_available_documents
        from agent.knowledge.factory import reconcile_collection_summaries
        from agent.knowledge.factory import register_summary

        configure_summary_db(temp_db_url)
        register_summary("coll", "already.pdf", "Already has a summary.")

        ingestor = self._FakeIngestor(files=[self._file_info("already.pdf")])

        backfilled = reconcile_collection_summaries(ingestor, "coll")

        assert backfilled == 0
        docs = get_available_documents("coll")
        assert len(docs) == 1
        assert docs[0].summary == "Already has a summary."

    def test_ignores_files_not_indexed_successfully(self, temp_db_url):
        from agent.knowledge import configure_summary_db
        from agent.knowledge import get_available_documents
        from agent.knowledge.factory import reconcile_collection_summaries
        from agent.knowledge.schema import FileStatus

        configure_summary_db(temp_db_url)

        ingestor = self._FakeIngestor(files=[self._file_info("broken.pdf", status=FileStatus.FAILED)])

        backfilled = reconcile_collection_summaries(ingestor, "coll")

        assert backfilled == 0
        assert get_available_documents("coll") == []

    def test_sampler_exception_falls_back_to_filename(self, temp_db_url):
        from agent.knowledge import configure_summary_db
        from agent.knowledge import get_available_documents
        from agent.knowledge.factory import reconcile_collection_summaries

        configure_summary_db(temp_db_url)

        class BrokenSamplerIngestor:
            def list_files(self, collection_name):
                return [TestReconcileCollectionSummaries._file_info("weird.pdf")]

            def get_document_text_sample(self, collection_name, file_name):
                raise RuntimeError("chroma unreachable")

        backfilled = reconcile_collection_summaries(BrokenSamplerIngestor(), "coll")

        assert backfilled == 1
        docs = {d.file_name: d for d in get_available_documents("coll")}
        assert docs["weird.pdf"].summary == "Indexed document: weird.pdf"

    def test_list_files_exception_returns_zero(self, temp_db_url):
        from agent.knowledge import configure_summary_db
        from agent.knowledge.factory import reconcile_collection_summaries

        configure_summary_db(temp_db_url)

        class BrokenListFilesIngestor:
            def list_files(self, collection_name):
                raise RuntimeError("chroma down")

        assert reconcile_collection_summaries(BrokenListFilesIngestor(), "coll") == 0


class TestSummaryIntegration:
    @pytest.fixture
    def temp_db_url(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "integration_test.db"
            yield f"sqlite:///{db_path}"
            DocumentMetadataStore.dispose_engine(f"sqlite:///{db_path}")

    @pytest.fixture(autouse=True)
    def reset_store(self):
        from agent.knowledge import factory

        factory._document_metadata_store = None
        yield
        factory._document_metadata_store = None

    def test_full_workflow(self, temp_db_url):
        from agent.knowledge import configure_summary_db
        from agent.knowledge import get_available_documents
        from agent.knowledge.factory import clear_collection_summaries
        from agent.knowledge.factory import register_summary
        from agent.knowledge.factory import unregister_summary

        configure_summary_db(temp_db_url)

        collection = "session_12345"
        register_summary(collection, "report.pdf", "Annual financial report for 2024.")
        register_summary(collection, "data.csv", "Sales data spreadsheet.")
        register_summary(collection, "notes.txt", "Meeting notes from Q4 review.")

        docs = get_available_documents(collection)
        assert len(docs) == 3

        unregister_summary(collection, "notes.txt")
        docs = get_available_documents(collection)
        assert len(docs) == 2

        clear_collection_summaries(collection)
        docs = get_available_documents(collection)
        assert len(docs) == 0

    def test_multiple_collections_isolation(self, temp_db_url):
        from agent.knowledge import configure_summary_db
        from agent.knowledge import get_available_documents
        from agent.knowledge.factory import register_summary

        configure_summary_db(temp_db_url)

        session_a = "user_alice_session_001"
        session_b = "user_bob_session_002"

        register_summary(session_a, "alice_doc.pdf", "Alice's document")
        register_summary(session_b, "bob_doc.pdf", "Bob's document")
        register_summary(session_b, "bob_doc2.pdf", "Bob's second document")

        alice_docs = get_available_documents(session_a)
        bob_docs = get_available_documents(session_b)

        assert len(alice_docs) == 1
        assert alice_docs[0].file_name == "alice_doc.pdf"

        assert len(bob_docs) == 2
        assert {d.file_name for d in bob_docs} == {"bob_doc.pdf", "bob_doc2.pdf"}

    @pytest.mark.asyncio
    async def test_mixed_sync_async_operations(self, temp_db_url):
        from agent.knowledge import configure_summary_db
        from agent.knowledge.factory import get_available_documents_async
        from agent.knowledge.factory import register_summary

        configure_summary_db(temp_db_url)

        register_summary("mixed_test", "doc1.pdf", "Document 1 summary")
        register_summary("mixed_test", "doc2.pdf", "Document 2 summary")

        docs = await get_available_documents_async("mixed_test")

        assert len(docs) == 2
        assert all(doc.summary is not None for doc in docs)


class TestMigrationFailureNotCached:
    @staticmethod
    def _legacy_db(dir_path):
        from sqlalchemy import create_engine
        from sqlalchemy import text

        db_url = f"sqlite:///{dir_path / 'legacy.db'}"
        engine = create_engine(db_url)
        with engine.connect() as conn:
            conn.execute(
                text(
                    "CREATE TABLE summaries ("
                    "collection VARCHAR(256) NOT NULL, "
                    "filename VARCHAR(512) NOT NULL, "
                    "summary TEXT NOT NULL, "
                    "created_at DATETIME, "
                    "PRIMARY KEY (collection, filename))"
                )
            )
            conn.commit()
        return db_url, engine

    @staticmethod
    def _columns(engine):
        from sqlalchemy import inspect

        inspector = inspect(engine)
        table = "document_metadata" if inspector.has_table("document_metadata") else "summaries"
        return {c["name"] for c in inspector.get_columns(table)}

    @staticmethod
    def _flaky_add_column(calls):
        real = DocumentMetadataStore._add_column_if_missing

        def flaky(self, conn, column, ddl_type="TEXT"):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("simulated ALTER failure")
            return real(self, conn, column, ddl_type)

        return flaky

    def test_failed_sync_migration_not_cached_then_retried(self, monkeypatch):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_url, engine = self._legacy_db(Path(tmpdir))
            DocumentMetadataStore._tables_initialized.discard(db_url)
            try:
                calls = {"n": 0}
                monkeypatch.setattr(DocumentMetadataStore, "_add_column_if_missing", self._flaky_add_column(calls))

                DocumentMetadataStore(db_url)
                assert db_url not in DocumentMetadataStore._tables_initialized
                assert "tags" not in self._columns(engine)

                DocumentMetadataStore(db_url)
                assert db_url in DocumentMetadataStore._tables_initialized
                assert "tags" in self._columns(engine)
            finally:
                engine.dispose()
                DocumentMetadataStore.dispose_engine(db_url)
                DocumentMetadataStore._tables_initialized.discard(db_url)

    @pytest.mark.asyncio
    async def test_failed_async_migration_not_cached_then_retried(self, monkeypatch):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_url, engine = self._legacy_db(Path(tmpdir))
            DocumentMetadataStore._tables_initialized.discard(db_url)
            try:
                calls = {"n": 0}
                monkeypatch.setattr(DocumentMetadataStore, "_add_column_if_missing", self._flaky_add_column(calls))

                await DocumentMetadataStore._ensure_table_async(db_url)
                assert db_url not in DocumentMetadataStore._tables_initialized
                assert "tags" not in self._columns(engine)

                await DocumentMetadataStore._ensure_table_async(db_url)
                assert db_url in DocumentMetadataStore._tables_initialized
                assert "tags" in self._columns(engine)
            finally:
                engine.dispose()
                await DocumentMetadataStore.dispose_engine_async(db_url)
                DocumentMetadataStore._tables_initialized.discard(db_url)


class TestTopicsAndCapture:
    @pytest.fixture
    def temp_db(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_url = f"sqlite:///{Path(tmpdir) / 'topics.db'}"
            yield db_url
            DocumentMetadataStore.dispose_engine(db_url)

    @pytest.fixture
    def store(self, temp_db):
        return DocumentMetadataStore(temp_db)

    def test_register_with_topics_roundtrip(self, store):
        store.register("coll", "plan.pdf", "A plan.", tags=["Grundriss"], topics=["Attika", "Fluchtweg"])
        doc = store.get_all("coll")[0]
        assert doc.topics == ["Attika", "Fluchtweg"]
        assert doc.tags == ["Grundriss"]

    def test_register_without_topics_is_none_not_empty(self, store):
        store.register("coll", "plan.pdf", "A plan.")
        assert store.get_all("coll")[0].topics is None

    def test_the_reading_is_written_together_and_read_back(self, store):
        store.register("coll", "bsk.pdf", "Ein Brandschutzkonzept.")
        dossier = {"version": 1, "document_type": "fire_safety_concept", "facts": []}
        references = [{"kind": "norm", "key": "trvb 124 f", "label": "TRVB 124 F", "pages": [2]}]
        coverage = {"pages": 4, "not_read": 0, "reasons": {}}

        assert store.set_reading("coll", "bsk.pdf", dossier=dossier, references=references, coverage=coverage)
        doc = store.get_all("coll")[0]
        assert (doc.dossier, doc.doc_references, doc.coverage) == (dossier, references, coverage)

        store.set_reading("coll", "bsk.pdf", dossier=None, references=[], coverage=None)
        doc = store.get_all("coll")[0]
        assert (doc.dossier, doc.doc_references, doc.coverage) == (None, None, None)

    def test_a_reading_for_a_document_without_a_row_is_refused(self, store):
        assert store.set_reading("coll", "ghost.pdf", dossier={"version": 1}, references=None, coverage=None) is False

    async def test_get_all_async_decodes_topics_and_capture(self, store):
        store.register("acoll", "plan.pdf", "A plan.", topics=["Attika"])
        store.set_capture("acoll", "plan.pdf", {"captured_at": "2026-10-09T14:30:00", "camera": "Canon R5"})
        doc = (await store.get_all_async("acoll"))[0]
        assert doc.topics == ["Attika"]
        assert doc.capture == {"captured_at": "2026-10-09T14:30:00", "camera": "Canon R5"}

    def test_a_machine_re_register_refreshes_the_topics(self, store):
        store.register("coll", "plan.pdf", "First.", topics=["Attika"])
        store.register("coll", "plan.pdf", "Newer.", topics=["Holzrahmenbau"])
        assert store.get_all("coll")[0].topics == ["Holzrahmenbau"]

    def test_set_topics_by_person_roundtrip_and_missing_row(self, store):
        store.register("coll", "plan.pdf", "A plan.", topics=["Attika"])
        assert store.set_topics_by_person("coll", "plan.pdf", ["Fluchtweg"]) is True
        assert store.get_all("coll")[0].topics == ["Fluchtweg"]
        assert store.set_topics_by_person("coll", "ghost.pdf", ["Fluchtweg"]) is False
        assert [doc.file_name for doc in store.get_all("coll")] == ["plan.pdf"]  # no row created for the ghost

    def test_a_re_register_keeps_the_topics_a_person_set(self, store):
        store.register("coll", "plan.pdf", "First.", topics=["Attika"])
        store.set_topics_by_person("coll", "plan.pdf", ["Fluchtweg", "Brandschutz"])

        store.register("coll", "plan.pdf", "Newer.", topics=["Holzrahmenbau"])

        doc = store.get_all("coll")[0]
        assert doc.summary == "Newer."
        assert doc.topics == ["Fluchtweg", "Brandschutz"]

    def test_a_person_who_cleared_the_topics_is_not_refilled_by_register(self, store):
        store.register("coll", "plan.pdf", "A plan.", topics=["Attika"])
        store.set_topics_by_person("coll", "plan.pdf", [])

        store.register("coll", "plan.pdf", "A plan.", topics=["Holzrahmenbau"])

        assert store.get_all("coll")[0].topics is None

    def test_a_person_topic_edit_also_keeps_the_tags_across_a_re_read(self, store):
        store.register("coll", "plan.pdf", "A plan.", tags=["Grundriss"], topics=["Attika"])
        store.set_topics_by_person("coll", "plan.pdf", ["Fluchtweg"])

        store.register("coll", "plan.pdf", "A plan.", tags=["Schnitt"], topics=["Holzrahmenbau"])

        doc = store.get_all("coll")[0]
        assert doc.tags == ["Grundriss"]
        assert doc.topics == ["Fluchtweg"]

    def test_person_topics_batch_returns_only_rows_a_person_set(self, store):
        store.register("coll", "machine.pdf", "M.", topics=["Attika"])
        store.register("coll", "person.pdf", "P.", topics=["Attika"])
        store.register("coll", "cleared.pdf", "C.", topics=["Attika"])
        store.set_topics_by_person("coll", "person.pdf", ["Fluchtweg"])
        store.set_topics_by_person("coll", "cleared.pdf", [])

        result = store.get_person_topics_batch("coll", ["machine.pdf", "person.pdf", "cleared.pdf", "ghost.pdf"])

        assert result == {"person.pdf": ["Fluchtweg"], "cleared.pdf": []}
        assert store.get_person_topics_batch("coll", []) == {}
        assert store.get_person_topics_batch("other", ["person.pdf"]) == {}

    def test_the_tags_seams_answer_as_before_now_that_they_share_a_helper(self, store):
        store.register("coll", "plan.pdf", "A plan.", tags=["Grundriss"], topics=["Attika"])
        store.set_topics_by_person("coll", "plan.pdf", ["Fluchtweg"])
        assert store.get_person_tags_batch("coll", ["plan.pdf"]) == {"plan.pdf": ["Grundriss"]}
        store.set_tags_by_person("coll", "plan.pdf", ["Schnitt"])
        assert store.get_person_tags_batch("coll", ["plan.pdf"]) == {"plan.pdf": ["Schnitt"]}

    def test_vocabulary_orders_by_documents_then_alphabetically(self, store):
        store.register("coll", "a.pdf", "A.", topics=["Attika", "Fluchtweg"])
        store.register("coll", "b.pdf", "B.", topics=["attika", "Holz"])
        store.register("coll", "c.pdf", "C.", topics=["Attika", "Fluchtweg"])
        store.register("coll", "d.pdf", "D.", topics=["Stiege"])

        assert store.get_topic_vocabulary("coll") == ["Attika", "Fluchtweg", "Holz", "Stiege"]

    def test_vocabulary_keeps_the_most_frequent_spelling(self, store):
        store.register("coll", "a.pdf", "A.", topics=["attika"])
        store.register("coll", "b.pdf", "B.", topics=["Attika"])
        store.register("coll", "c.pdf", "C.", topics=["Attika"])

        assert store.get_topic_vocabulary("coll") == ["Attika"]

    def test_vocabulary_counts_a_topic_once_per_document_whatever_its_case(self, store):
        store.register("coll", "a.pdf", "A.", topics=["Attika", "attika"])
        store.register("coll", "b.pdf", "B.", topics=["Holz"])
        store.register("coll", "c.pdf", "C.", topics=["Holz"])

        assert store.get_topic_vocabulary("coll") == ["Holz", "Attika"]

    def test_vocabulary_is_per_collection_bounded_and_fail_open(self, store):
        store.register("coll", "a.pdf", "A.", topics=["Attika", "Fluchtweg", "Holz"])
        store.register("other", "b.pdf", "B.", topics=["Stiege"])
        store.register("coll", "c.pdf", "C.")

        assert store.get_topic_vocabulary("coll", limit=2) == ["Attika", "Fluchtweg"]
        assert store.get_topic_vocabulary("other") == ["Stiege"]
        assert store.get_topic_vocabulary("empty") == []

    def test_vocabulary_on_a_database_without_the_column_is_empty_not_an_error(self):
        from sqlalchemy import create_engine
        from sqlalchemy import text

        with tempfile.TemporaryDirectory() as tmpdir:
            db_url = f"sqlite:///{Path(tmpdir) / 'no_topics.db'}"
            engine = create_engine(db_url)
            with engine.connect() as conn:
                conn.execute(text("CREATE TABLE document_metadata (collection TEXT, filename TEXT, summary TEXT)"))
                conn.commit()
            engine.dispose()
            DocumentMetadataStore._tables_initialized.add(db_url)  # schema already "ready": no backfill here
            try:
                assert DocumentMetadataStore(db_url).get_topic_vocabulary("coll") == []
            finally:
                DocumentMetadataStore._tables_initialized.discard(db_url)
                DocumentMetadataStore.dispose_engine(db_url)

    def test_set_capture_roundtrip_keeps_the_coordinates_for_the_bff(self, store):
        store.register("coll", "foto.jpg", "Baustelle.")
        capture = {
            "captured_at": "2026-10-09T14:30:00+02:00",
            "latitude": 47.812345,
            "longitude": 13.045678,
            "camera": "DJI Mavic 3",
        }

        assert store.set_capture("coll", "foto.jpg", capture) is True

        assert store.get_all("coll")[0].capture == capture

    def test_set_capture_missing_row_returns_false_and_none_clears(self, store):
        assert store.set_capture("coll", "ghost.jpg", {"camera": "X"}) is False
        assert store.get_all("coll") == []

        store.register("coll", "foto.jpg", "Baustelle.")
        store.set_capture("coll", "foto.jpg", {"camera": "X"})
        assert store.set_capture("coll", "foto.jpg", None) is True
        assert store.get_all("coll")[0].capture is None

    def test_a_re_register_keeps_the_capture(self, store):
        store.register("coll", "foto.jpg", "First.")
        store.set_capture("coll", "foto.jpg", {"captured_at": "2026-10-09T14:30:00"})
        store.register("coll", "foto.jpg", "Newer.")
        assert store.get_all("coll")[0].capture == {"captured_at": "2026-10-09T14:30:00"}

    def test_the_decoder_drops_wrong_types_and_unknown_keys(self, store):
        store.register("coll", "foto.jpg", "Baustelle.")
        store.set_capture(
            "coll",
            "foto.jpg",
            {
                "captured_at": 20261009,  # not a string
                "latitude": "47.8",  # not a number
                "longitude": True,  # a flag is not a coordinate
                "camera": "Canon R5",
                "serial": "0123456",  # not a known key
            },
        )
        assert store.get_all("coll")[0].capture == {"camera": "Canon R5"}

    def test_the_decoder_refuses_what_is_not_an_object(self):
        assert DocumentMetadataStore._decode_object(None) is None
        assert DocumentMetadataStore._decode_object("not json") is None
        assert DocumentMetadataStore._decode_object("[1, 2]") is None
        assert DocumentMetadataStore._decode_object('{"serial": "x"}') is None
        assert DocumentMetadataStore._decode_object('{"latitude": 47.5, "longitude": 13}') == {
            "latitude": 47.5,
            "longitude": 13,
        }

    def test_fresh_table_has_topics_and_capture_columns(self, temp_db):
        from sqlalchemy import create_engine
        from sqlalchemy import inspect

        DocumentMetadataStore(temp_db)
        engine = create_engine(temp_db)
        columns = {c["name"] for c in inspect(engine).get_columns("document_metadata")}
        assert {"topics", "capture"} <= columns
        engine.dispose()

    def test_existing_table_without_topics_and_capture_is_migrated_and_keeps_its_rows(self):
        from sqlalchemy import create_engine
        from sqlalchemy import inspect
        from sqlalchemy import text

        with tempfile.TemporaryDirectory() as tmpdir:
            db_url = f"sqlite:///{Path(tmpdir) / 'before_topics.db'}"
            engine = create_engine(db_url)
            with engine.connect() as conn:
                conn.execute(
                    text(
                        "CREATE TABLE summaries ("
                        "collection VARCHAR(256) NOT NULL, "
                        "filename VARCHAR(512) NOT NULL, "
                        "summary TEXT NOT NULL, "
                        "tags TEXT, doc_class TEXT, display_title TEXT, folder_path TEXT, provenance TEXT, "
                        "doc_class_suggestion TEXT, tags_set_by TEXT, "
                        "created_at DATETIME, "
                        "PRIMARY KEY (collection, filename))"
                    )
                )
                conn.execute(
                    text(
                        "INSERT INTO summaries (collection, filename, summary, tags) "
                        "VALUES ('c', 'old.pdf', 'Alt.', '[\"Grundriss\"]')"
                    )
                )
                conn.commit()
            assert "topics" not in {c["name"] for c in inspect(engine).get_columns("summaries")}

            DocumentMetadataStore._tables_initialized.discard(db_url)
            store = DocumentMetadataStore(db_url)

            columns = {c["name"] for c in inspect(engine).get_columns("document_metadata")}
            assert {"topics", "capture"} <= columns
            old = store.get_all("c")[0]
            assert old.tags == ["Grundriss"]
            assert old.topics is None and old.capture is None

            assert store.set_capture("c", "old.pdf", {"camera": "X"}) is True
            assert store.get_all("c")[0].capture == {"camera": "X"}

            engine.dispose()
            DocumentMetadataStore.dispose_engine(db_url)


class TestTopicsAndCaptureThroughTheFactory:
    @pytest.fixture
    def db_url(self):
        from agent.knowledge import configure_summary_db
        from agent.knowledge import factory

        with tempfile.TemporaryDirectory() as tmpdir:
            url = f"sqlite:///{Path(tmpdir) / 'factory_topics.db'}"
            configure_summary_db(url)
            yield url
            factory._document_metadata_store = None
            DocumentMetadataStore.dispose_engine(url)

    def test_register_summary_carries_topics_and_the_person_seams_round_trip(self, db_url):
        from agent.knowledge import get_available_documents
        from agent.knowledge import get_document_person_topics
        from agent.knowledge import get_topic_vocabulary
        from agent.knowledge import register_summary
        from agent.knowledge import set_document_topics_by_person

        register_summary("coll", "plan.pdf", "A plan.", tags=["Grundriss"], topics=["Attika"])
        assert get_available_documents("coll")[0].topics == ["Attika"]
        assert get_topic_vocabulary("coll") == ["Attika"]

        assert set_document_topics_by_person("coll", "plan.pdf", ["Fluchtweg"]) is True
        assert get_document_person_topics("coll", ["plan.pdf"]) == {"plan.pdf": ["Fluchtweg"]}
        assert set_document_topics_by_person("coll", "ghost.pdf", ["Fluchtweg"]) is False

    def test_set_document_capture_is_visible_on_the_available_document(self, db_url):
        from agent.knowledge import get_available_documents
        from agent.knowledge import register_summary
        from agent.knowledge import set_document_capture

        register_summary("coll", "foto.jpg", "Baustelle.")
        capture = {"captured_at": "2026-10-09T14:30:00", "latitude": 47.8, "longitude": 13.0}
        assert set_document_capture("coll", "foto.jpg", capture) is True
        assert get_available_documents("coll")[0].capture == capture
        assert set_document_capture("coll", "ghost.jpg", capture) is False


class TestPageCount:
    @staticmethod
    def _legacy_db_without_page_count(dir_path):
        from sqlalchemy import create_engine
        from sqlalchemy import text

        db_url = f"sqlite:///{dir_path / 'legacy.db'}"
        engine = create_engine(db_url)
        with engine.connect() as conn:
            conn.execute(
                text(
                    "CREATE TABLE summaries ("
                    "collection VARCHAR(256) NOT NULL, "
                    "filename VARCHAR(512) NOT NULL, "
                    "summary TEXT NOT NULL, "
                    "created_at DATETIME, "
                    "PRIMARY KEY (collection, filename))"
                )
            )
            conn.execute(
                text("INSERT INTO summaries (collection, filename, summary) VALUES ('oib', 'old.pdf', 'Alt.')")
            )
            conn.commit()
        return db_url, engine

    @pytest.fixture
    def store(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_url = f"sqlite:///{Path(tmpdir) / 'page_counts.db'}"
            store = DocumentMetadataStore(db_url)
            yield store
            DocumentMetadataStore.dispose_engine(db_url)

    def test_migration_adds_an_integer_column_and_keeps_old_rows(self):
        from sqlalchemy import inspect

        with tempfile.TemporaryDirectory() as tmpdir:
            db_url, engine = self._legacy_db_without_page_count(Path(tmpdir))
            DocumentMetadataStore._tables_initialized.discard(db_url)
            try:
                store = DocumentMetadataStore(db_url)
                columns = {c["name"]: str(c["type"]) for c in inspect(engine).get_columns("document_metadata")}
                assert columns["page_count"].upper().startswith("INTEGER")
                (old,) = store.get_all("oib")
                assert old.file_name == "old.pdf"
                assert old.page_count is None
            finally:
                engine.dispose()
                DocumentMetadataStore.dispose_engine(db_url)
                DocumentMetadataStore._tables_initialized.discard(db_url)

    def test_set_and_read_back_through_the_listing(self, store):
        store.register("oib", "plan.pdf", "Grundriss.")
        assert store.set_page_count("oib", "plan.pdf", 14) is True
        assert store.get_page_count("oib", "plan.pdf") == 14
        (doc,) = store.get_all("oib")
        assert doc.page_count == 14
        (batch,) = store.get_many("oib", ["plan.pdf"])
        assert batch.page_count == 14

    def test_a_re_ingest_overwrites_with_the_newest_count(self, store):
        store.register("oib", "plan.pdf", "Grundriss.")
        store.set_page_count("oib", "plan.pdf", 4)
        store.register("oib", "plan.pdf", "Grundriss, neu gelesen.")
        assert store.get_page_count("oib", "plan.pdf") == 4
        store.set_page_count("oib", "plan.pdf", 6)
        assert store.get_page_count("oib", "plan.pdf") == 6

    def test_none_clears_the_count(self, store):
        store.register("oib", "plan.pdf", "Grundriss.")
        store.set_page_count("oib", "plan.pdf", 4)
        store.set_page_count("oib", "plan.pdf", None)
        assert store.get_page_count("oib", "plan.pdf") is None

    def test_a_text_file_has_no_count(self, store):
        store.register("oib", "notiz.txt", "Notiz.")
        assert store.set_page_count("oib", "notiz.txt", 0) is True
        assert store.get_page_count("oib", "notiz.txt") is None

    def test_set_is_update_only(self, store):
        assert store.set_page_count("oib", "missing.pdf", 3) is False
        assert store.get_page_count("oib", "missing.pdf") is None

    def test_invalid_values_are_not_stored(self, store):
        store.register("oib", "plan.pdf", "Grundriss.")
        for bad in (True, -2, "7"):
            store.set_page_count("oib", "plan.pdf", bad)
            assert store.get_page_count("oib", "plan.pdf") is None
