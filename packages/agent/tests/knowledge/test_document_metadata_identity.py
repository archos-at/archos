from __future__ import annotations

import os
from pathlib import Path

import pytest
from sqlalchemy import text

from agent.common.bff_http import BffUnreachableError
from agent.knowledge import factory
from agent.knowledge.document_metadata_rekey import LiveDocuments
from agent.knowledge.document_metadata_rekey import collections_to_rekey
from agent.knowledge.document_metadata_rekey import rekey_document_ids
from agent.knowledge.document_metadata_schema import name_primary_keys
from agent.knowledge.document_metadata_store import DocumentMetadataStore
from agent.knowledge.document_metadata_store import LinkOutcome

_POSTGRES = os.environ.get("TEST_POSTGRES_URL")
_BACKENDS = [
    "sqlite",
    pytest.param("postgres", marks=pytest.mark.skipif(not _POSTGRES, reason="TEST_POSTGRES_URL not set")),
]
COLLECTION = "proj_identity"
EG, OG, ALT, NEU = (
    "0b7c6a3e-0000-4000-8000-00000000000a",
    "0b7c6a3e-0000-4000-8000-00000000000b",
    "0b7c6a3e-0000-4000-8000-00000000000c",
    "0b7c6a3e-0000-4000-8000-00000000000d",
)
LEGACY_TABLE = (
    "CREATE TABLE document_metadata (collection VARCHAR(256) NOT NULL, filename VARCHAR(512) NOT NULL, "
    "summary TEXT NOT NULL, tags TEXT, doc_class TEXT, display_title TEXT, folder_path TEXT, provenance TEXT, "
    "created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (collection, filename))"
)
LEGACY_RETAINED = (
    "CREATE TABLE document_revision_retained (collection VARCHAR(256) NOT NULL, filename VARCHAR(512) NOT NULL, "
    "superseded_by TEXT, revision_suggestion TEXT, change_summary TEXT, change_basis TEXT, "
    "PRIMARY KEY (collection, filename))"
)
OLD_WRITER_UPSERT = (
    "INSERT INTO document_metadata (collection, filename, summary) VALUES (:collection, :filename, :summary) "
    "ON CONFLICT (collection, filename) DO UPDATE SET summary = excluded.summary"
)


def _empty_database(backend: str, tmp_path: Path) -> str:
    if backend == "sqlite":
        return f"sqlite:///{tmp_path / 'identity.db'}"
    assert _POSTGRES
    with DocumentMetadataStore._get_or_create_sync_engine(_POSTGRES).begin() as conn:
        for table in ("document_metadata", "document_revision_retained", "document_fassung_retained", "summaries"):
            conn.execute(text(f"DROP TABLE IF EXISTS {table}"))
    DocumentMetadataStore._tables_initialized.discard(_POSTGRES)
    return _POSTGRES


@pytest.fixture(params=_BACKENDS)
def database_url(request, tmp_path):
    url = _empty_database(request.param, tmp_path)
    yield url
    DocumentMetadataStore._tables_initialized.discard(url)
    DocumentMetadataStore.dispose_engine(url)


@pytest.fixture
def store(database_url):
    return DocumentMetadataStore(database_url)


def _legacy_database(database_url: str) -> None:
    with DocumentMetadataStore._get_or_create_sync_engine(database_url).begin() as conn:
        conn.execute(text(LEGACY_TABLE))
        conn.execute(text(LEGACY_RETAINED))
        for filename, summary in (("a.pdf", "Alt A."), ("alt.pdf", "Ältere Fassung."), ("geloescht.pdf", "Weg.")):
            conn.execute(
                text("INSERT INTO document_metadata (collection, filename, summary) VALUES (:c, :f, :s)"),
                {"c": COLLECTION, "f": filename, "s": summary},
            )
        conn.execute(text("UPDATE document_metadata SET tags = :tags WHERE filename = 'a.pdf'"), {"tags": '["Statik"]'})
    DocumentMetadataStore._tables_initialized.discard(database_url)


def _by_id(store: DocumentMetadataStore, *ids: str):
    return {doc.document_id: doc for doc in store.get_many(COLLECTION, [], document_ids=list(ids))}


def _two_plans(store: DocumentMetadataStore) -> None:
    store.register(COLLECTION, "Plan.pdf", "Erdgeschoss.", ["Grundriss"], document_id=EG)
    store.register(COLLECTION, "Plan.pdf", "Obergeschoss.", ["Schnitt"], document_id=OG)


class TestTwoDocumentsOfOneName:
    def test_each_keeps_its_own_summary_tags_title_and_folder(self, store):
        _two_plans(store)
        assert store.set_tags_by_person(COLLECTION, "Plan.pdf", ["EG"], document_id=EG)
        assert store.set_display_title(COLLECTION, "Plan.pdf", "Grundriss EG", document_id=EG)
        assert store.set_display_title(COLLECTION, "Plan.pdf", "Grundriss OG", document_id=OG)
        assert store.set_folder_path(COLLECTION, "Plan.pdf", "Einreichung/EG", document_id=EG)
        assert store.set_folder_path(COLLECTION, "Plan.pdf", "Einreichung/OG", document_id=OG)

        documents = _by_id(store, EG, OG)

        assert {key: doc.summary for key, doc in documents.items()} == {EG: "Erdgeschoss.", OG: "Obergeschoss."}
        assert {key: doc.tags for key, doc in documents.items()} == {EG: ["EG"], OG: ["Schnitt"]}
        assert {key: doc.display_title for key, doc in documents.items()} == {EG: "Grundriss EG", OG: "Grundriss OG"}
        assert store.get_folder_paths_batch(COLLECTION, [], document_ids=[EG, OG]) == {
            EG: "Einreichung/EG",
            OG: "Einreichung/OG",
        }
        assert store.get_person_tags_batch(COLLECTION, [], document_ids=[EG, OG]) == {EG: ["EG"]}
        assert store.get_display_title(COLLECTION, "Plan.pdf", document_id=OG) == "Grundriss OG"
        assert len(store.get_all(COLLECTION)) == 2

    def test_a_write_by_name_alone_never_reaches_a_document_with_an_id(self, store):
        _two_plans(store)

        assert store.set_display_title(COLLECTION, "Plan.pdf", "Geraten") is False
        store.register(COLLECTION, "Plan.pdf", "Ohne Kennung.")
        store.unregister(COLLECTION, "Plan.pdf")

        assert {doc.document_id: doc.summary for doc in store.get_all(COLLECTION)} == {
            EG: "Erdgeschoss.",
            OG: "Obergeschoss.",
        }

    def test_a_batch_read_by_name_never_returns_a_namesake_with_an_id(self, store):
        _two_plans(store)
        store.register(COLLECTION, "Plan.pdf", "Ohne Kennung.")
        for document_id, title in ((EG, "Grundriss EG"), (OG, "Grundriss OG"), (None, "Alt")):
            store.set_display_title(COLLECTION, "Plan.pdf", title, document_id=document_id)

        assert store.get_display_titles_batch(COLLECTION, ["Plan.pdf"]) == {"Plan.pdf": "Alt"}
        assert store.get_display_titles_batch(COLLECTION, ["Plan.pdf"], document_ids=[EG]) == {
            EG: "Grundriss EG",
            "Plan.pdf": "Alt",
        }
        assert [(doc.document_id, doc.summary) for doc in store.get_many(COLLECTION, ["Plan.pdf"])] == [
            (None, "Ohne Kennung.")
        ]

    def test_a_re_register_updates_only_its_own_row(self, store):
        _two_plans(store)
        store.register(COLLECTION, "Plan.pdf", "Erdgeschoss, neu gelesen.", document_id=EG)

        assert {key: doc.summary for key, doc in _by_id(store, EG, OG).items()} == {
            EG: "Erdgeschoss, neu gelesen.",
            OG: "Obergeschoss.",
        }

    def test_revision_links_name_the_document_not_the_name(self, store):
        _two_plans(store)
        store.register(COLLECTION, "Plan_alt.pdf", "Ältere Fassung.", document_id=ALT)

        assert store.link_revision(COLLECTION, "Plan_alt.pdf", "Plan.pdf", older_id=ALT, newer_id=OG) is (
            LinkOutcome.LINKED
        )

        documents = {doc.document_id: doc for doc in store.get_all(COLLECTION)}
        assert (documents[ALT].superseded_by, documents[ALT].superseded_by_id) == ("Plan.pdf", OG)
        assert documents[OG].supersedes == ["Plan_alt.pdf"]
        assert documents[EG].supersedes is None
        assert store.get_superseded_ids(COLLECTION) == {ALT: OG}
        assert store.get_superseded_files(COLLECTION) == {}
        assert [ref.document_id for ref in store.documents_linked_to(COLLECTION, "Plan.pdf", document_id=OG)] == [ALT]
        assert store.documents_linked_to(COLLECTION, "Plan.pdf", document_id=EG) == []
        assert _by_id(store, ALT)[ALT].superseded_by_id == OG

    def test_carrying_a_link_by_its_name_keeps_the_newer_documents_id(self, store):
        _two_plans(store)
        store.register(COLLECTION, "Plan_alt.pdf", "Ältere Fassung.", document_id=ALT)
        store.link_revision(COLLECTION, "Plan_alt.pdf", "Plan.pdf", older_id=ALT, newer_id=OG)

        assert store.set_superseded_by(COLLECTION, "Plan_alt.pdf", "Plan.pdf", document_id=ALT)
        assert _by_id(store, ALT)[ALT].superseded_by_id == OG
        assert store.set_superseded_by(COLLECTION, "Plan_alt.pdf", "Plan.pdf", document_id=ALT, newer_id=EG)
        assert _by_id(store, ALT)[ALT].superseded_by_id == EG
        assert store.set_superseded_by(COLLECTION, "Plan_alt.pdf", None, document_id=ALT)
        assert (_by_id(store, ALT)[ALT].superseded_by, _by_id(store, ALT)[ALT].superseded_by_id) == (None, None)

    def test_a_link_back_is_a_loop_only_for_the_same_document(self, store):
        _two_plans(store)
        store.register(COLLECTION, "Plan_alt.pdf", "Ältere Fassung.", document_id=ALT)
        store.link_revision(COLLECTION, "Plan_alt.pdf", "Plan.pdf", older_id=ALT, newer_id=OG)

        assert store.link_revision(COLLECTION, "Plan.pdf", "Plan_alt.pdf", older_id=OG, newer_id=ALT) is (
            LinkOutcome.LOOP
        )
        assert store.link_revision(COLLECTION, "Plan.pdf", "Plan_alt.pdf", older_id=EG, newer_id=ALT) is (
            LinkOutcome.LINKED
        )

    def test_a_dismissed_suggestion_remembers_the_older_document(self, store):
        _two_plans(store)
        suggestion = {"of": "Plan.pdf", "of_id": EG, "confidence": 0.8, "reason": "Gleicher Plan.", "basis": "name"}
        store.register(COLLECTION, "Plan_neu.pdf", "Neue Fassung.", document_id=NEU)
        assert store.set_revision_suggestion(COLLECTION, "Plan_neu.pdf", suggestion, document_id=NEU)

        assert store.dismiss_revision_suggestion(COLLECTION, "Plan_neu.pdf", "Plan.pdf", document_id=NEU, older_id=EG)

        stored = _by_id(store, NEU)[NEU].revision_suggestion
        assert (stored["dismissed"], stored["dismissed_of_ids"]) == (True, [EG])
        assert store.set_revision_suggestion(COLLECTION, "Plan_neu.pdf", {**suggestion, "of_id": OG}, document_id=NEU)
        assert _by_id(store, NEU)[NEU].revision_suggestion["dismissed"] is True, "the same name refused stays refused"

    def test_retained_facts_return_to_their_own_document(self, store):
        _two_plans(store)
        store.register(COLLECTION, "Plan_neu.pdf", "Neue Fassung.", document_id=NEU)
        store.link_revision(COLLECTION, "Plan.pdf", "Plan_neu.pdf", older_id=OG, newer_id=NEU)

        store.unregister(COLLECTION, "Plan.pdf", document_id=OG)
        assert list(_by_id(store, EG, OG)) == [EG]
        store.register(COLLECTION, "Plan.pdf", "Erdgeschoss.", document_id=EG)
        assert _by_id(store, EG)[EG].superseded_by_id is None
        store.register(COLLECTION, "Plan.pdf", "Obergeschoss.", document_id=OG)

        assert _by_id(store, OG)[OG].superseded_by_id == NEU

    def test_a_permanent_delete_forgets_only_links_to_that_document(self, store):
        _two_plans(store)
        store.register(COLLECTION, "a.pdf", "A.", document_id=ALT)
        store.register(COLLECTION, "b.pdf", "B.", document_id=NEU)
        store.link_revision(COLLECTION, "a.pdf", "Plan.pdf", older_id=ALT, newer_id=EG)
        store.link_revision(COLLECTION, "b.pdf", "Plan.pdf", older_id=NEU, newer_id=OG)

        store.unregister(COLLECTION, "Plan.pdf", permanent=True, document_id=EG)

        documents = _by_id(store, ALT, NEU, OG)
        assert (documents[ALT].superseded_by_id, documents[NEU].superseded_by_id) == (None, OG)

    def test_a_rename_moves_the_name_and_the_links_to_it(self, store):
        _two_plans(store)
        store.register(COLLECTION, "Plan_alt.pdf", "Ältere Fassung.", document_id=ALT)
        store.link_revision(COLLECTION, "Plan_alt.pdf", "Plan.pdf", older_id=ALT, newer_id=OG)

        assert store.set_file_name(COLLECTION, OG, "Plan 2.pdf")

        documents = _by_id(store, EG, OG, ALT)
        assert (documents[EG].file_name, documents[OG].file_name) == ("Plan.pdf", "Plan 2.pdf")
        assert documents[ALT].superseded_by == "Plan 2.pdf"


class TestRowsWithoutAnId:
    def test_a_name_keyed_row_still_reads_and_writes_by_name(self, store):
        store.register(COLLECTION, "OIB-RL 2.pdf", "Brandschutz.")
        assert store.set_display_title(COLLECTION, "OIB-RL 2.pdf", "OIB-Richtlinie 2")

        [document] = store.get_many(COLLECTION, ["OIB-RL 2.pdf"])
        assert (document.document_id, document.display_title) == (None, "OIB-Richtlinie 2")
        assert store.get_display_titles_batch(COLLECTION, ["OIB-RL 2.pdf"]) == {"OIB-RL 2.pdf": "OIB-Richtlinie 2"}

    def test_a_write_by_id_never_reaches_a_row_without_one(self, store):
        store.register(COLLECTION, "a.pdf", "A.")

        assert store.set_display_title(COLLECTION, "a.pdf", "A", document_id=EG) is False

        assert [(doc.document_id, doc.display_title) for doc in store.get_all(COLLECTION)] == [(None, None)]

    def test_a_second_writer_of_the_name_never_adopts_a_legacy_row(self, store):
        store.register(COLLECTION, "a.pdf", "Alt.", ["Statik"])
        store.set_tags_by_person(COLLECTION, "a.pdf", ["Person"])

        store.register(COLLECTION, "a.pdf", "Erdgeschoss.", ["Grundriss"], document_id=EG)
        store.register(COLLECTION, "a.pdf", "Obergeschoss.", ["Schnitt"], document_id=OG)

        rows = {doc.document_id: (doc.summary, doc.tags) for doc in store.get_all(COLLECTION)}
        assert rows == {
            None: ("Alt.", ["Person"]),
            EG: ("Erdgeschoss.", ["Grundriss"]),
            OG: ("Obergeschoss.", ["Schnitt"]),
        }

    def test_a_rename_by_id_never_reaches_a_row_without_one(self, store):
        store.register(COLLECTION, "Plan.pdf", "EG.")

        assert store.set_file_name(COLLECTION, EG, "Plan 2.pdf", previous_file_name="Plan.pdf") is False

        assert [(doc.file_name, doc.document_id) for doc in store.get_all(COLLECTION)] == [("Plan.pdf", None)]

    def test_a_link_written_by_name_still_reads(self, store):
        store.register(COLLECTION, "alt.pdf", "Alt.")
        store.register(COLLECTION, "neu.pdf", "Neu.", document_id=NEU)
        assert store.set_superseded_by(COLLECTION, "alt.pdf", "neu.pdf")

        documents = {doc.file_name: doc for doc in store.get_all(COLLECTION)}
        assert (documents["alt.pdf"].superseded_by, documents["alt.pdf"].superseded_by_id) == ("neu.pdf", NEU)
        assert documents["neu.pdf"].supersedes == ["alt.pdf"]
        assert store.get_superseded_files(COLLECTION) == {"alt.pdf": "neu.pdf"}


class TestTheSchemaMigration:
    def test_a_table_keyed_by_name_opens_with_its_rows_and_takes_ids(self, database_url):
        _legacy_database(database_url)

        store = DocumentMetadataStore(database_url)
        DocumentMetadataStore._tables_initialized.discard(database_url)
        DocumentMetadataStore(database_url)

        assert sorted(doc.file_name for doc in store.get_all(COLLECTION)) == ["a.pdf", "alt.pdf", "geloescht.pdf"]
        assert store.get_all(COLLECTION)[0].document_id is None
        store.register(COLLECTION, "Plan.pdf", "EG.", document_id=EG)
        assert store.set_display_title(COLLECTION, "Plan.pdf", "EG", document_id=EG)

    def test_sqlite_loses_the_name_key_on_open(self, tmp_path):
        url = _empty_database("sqlite", tmp_path)
        _legacy_database(url)

        store = DocumentMetadataStore(url)
        _two_plans(store)

        assert sorted(_by_id(store, EG, OG)) == [EG, OG]
        DocumentMetadataStore.dispose_engine(url)

    @pytest.mark.skipif(not _POSTGRES, reason="TEST_POSTGRES_URL not set")
    def test_postgres_keeps_the_name_key_for_old_writers_until_the_switch(self):
        url = _empty_database("postgres", Path())
        _legacy_database(url)
        store = DocumentMetadataStore(url)
        engine = DocumentMetadataStore._get_or_create_sync_engine(url)

        with engine.begin() as conn:
            conn.execute(text(OLD_WRITER_UPSERT), {"collection": COLLECTION, "filename": "a.pdf", "summary": "Alt."})
            assert set(name_primary_keys(conn)) == {"document_metadata", "document_revision_retained"}

        checked = rekey_document_ids(store, [], _live({}), apply=False)
        assert [(c.store, c.before, c.written, c.after) for c in checked] == [
            ("primary key (collection, filename)", 2, 0, 2)
        ], "the check fails while the key is there"

        def unreachable(collection: str) -> LiveDocuments:
            raise BffUnreachableError("/api/internal/document-ids could not be reached")

        with pytest.raises(BffUnreachableError):
            rekey_document_ids(store, [COLLECTION], unreachable, apply=True)

        with engine.connect() as conn:
            assert name_primary_keys(conn) == {}, "the key goes before any document is asked about"
        _two_plans(store)
        assert sorted(_by_id(store, EG, OG)) == [EG, OG]


def _live(ids_by_collection: dict[str, dict[str, str]]):
    def fetch(collection: str) -> LiveDocuments:
        return LiveDocuments.of(collection, [(i, name) for name, i in ids_by_collection.get(collection, {}).items()])

    return fetch


class TestTheRekey:
    LIVE = {COLLECTION: {"a.pdf": EG, "alt.pdf": ALT}}

    def _legacy_rows(self, database_url) -> DocumentMetadataStore:
        _legacy_database(database_url)
        store = DocumentMetadataStore(database_url)
        store.set_superseded_by(COLLECTION, "alt.pdf", "a.pdf")
        store.set_revision_suggestion(
            COLLECTION, "a.pdf", {"of": "alt.pdf", "confidence": 0.7, "reason": "Ähnlich.", "basis": "name"}
        )
        with DocumentMetadataStore._get_or_create_sync_engine(database_url).begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO document_revision_retained (collection, filename, superseded_by) VALUES (:c, :f, :s)"
                ),
                {"c": COLLECTION, "f": "alt.pdf", "s": "a.pdf"},
            )
        return store

    @staticmethod
    def _counts(counts) -> dict[str, tuple[int, int, int, int]]:
        return {c.store: (c.before, c.written, c.after, c.unmatched) for c in counts if c.before or c.unmatched}

    def test_a_dry_run_counts_and_writes_nothing(self, database_url):
        store = self._legacy_rows(database_url)

        counts = self._counts(rekey_document_ids(store, [COLLECTION], _live(self.LIVE), apply=False))

        assert counts["document_metadata.document_id"] == (2, 0, 2, 1)
        assert counts["document_metadata.superseded_by_id"] == (1, 0, 1, 0)
        assert counts["document_metadata.revision_suggestion"] == (1, 0, 1, 0)
        assert counts["document_revision_retained.document_id"] == (1, 0, 1, 0)
        assert counts["document_revision_retained.superseded_by_id"] == (1, 0, 1, 0)
        assert all(doc.document_id is None for doc in store.get_all(COLLECTION))

    def test_apply_keys_every_user_row_and_a_second_run_finds_nothing(self, database_url):
        store = self._legacy_rows(database_url)

        first = rekey_document_ids(store, [COLLECTION], _live(self.LIVE), apply=True)
        second = rekey_document_ids(store, collections_to_rekey(store), _live(self.LIVE), apply=True)

        assert all(c.after == 0 for c in first)
        assert sum(c.written for c in first if c.store.endswith((".document_id", ".superseded_by_id"))) == 5
        assert all(c.before == 0 and c.written == 0 for c in second)
        documents = {doc.file_name: doc for doc in store.get_all(COLLECTION)}
        assert {name: doc.document_id for name, doc in documents.items()} == {
            "a.pdf": EG,
            "alt.pdf": ALT,
            "geloescht.pdf": None,
        }
        assert documents["alt.pdf"].superseded_by_id == EG
        assert documents["a.pdf"].revision_suggestion["of_id"] == ALT
        assert documents["a.pdf"].tags == ["Statik"]
        assert self._counts(second) == {"document_metadata.document_id": (0, 0, 0, 1)}
        assert collections_to_rekey(store) == [COLLECTION], "the row no live document holds stays name-keyed"

    def test_two_rows_of_one_document_key_the_exact_name_and_report_the_other(self, store):
        for name in ("tmpAbCdEfGh_Plan.pdf", "Plan.pdf"):
            store.register(COLLECTION, name, f"Zusammenfassung {name}.")
        live = _live({COLLECTION: {"Plan.pdf": EG}})

        first = self._counts(rekey_document_ids(store, collections_to_rekey(store), live, apply=True))
        second = self._counts(rekey_document_ids(store, collections_to_rekey(store), live, apply=True))

        assert first["document_metadata.document_id"] == (1, 1, 0, 1)
        assert second == {"document_metadata.document_id": (0, 0, 0, 1)}
        assert {doc.file_name: doc.document_id for doc in store.get_all(COLLECTION)} == {
            "Plan.pdf": EG,
            "tmpAbCdEfGh_Plan.pdf": None,
        }

    def test_a_name_two_live_documents_hold_is_left_alone(self, database_url):
        store = self._legacy_rows(database_url)
        twice = LiveDocuments.of(COLLECTION, [(EG, "a.pdf"), (OG, "a.pdf"), (ALT, "alt.pdf")])

        rekey_document_ids(store, [COLLECTION], lambda _: twice, apply=True)

        assert {doc.file_name: doc.document_id for doc in store.get_all(COLLECTION)}["a.pdf"] is None

    def test_a_row_whose_name_differs_from_one_live_document_only_by_case_or_whitespace_takes_its_id(self, store):
        store.register(COLLECTION, " grundriss eg.PDF", "Grundriss.")
        live = _live({COLLECTION: {"Grundriss EG.pdf": EG}})

        counts = self._counts(rekey_document_ids(store, collections_to_rekey(store), live, apply=True))

        assert counts["document_metadata.document_id"] == (1, 1, 0, 0)
        assert [doc.document_id for doc in store.get_all(COLLECTION)] == [EG]

    def test_the_exact_spelling_claims_the_id_and_two_drifted_rows_are_never_guessed_between(self, store):
        for name in ("Plan.pdf", "plan.pdf "):
            store.register(COLLECTION, name, f"Plan {name}.")
        for name in ("SCHNITT.pdf", " schnitt.pdf"):
            store.register(COLLECTION, name, f"Schnitt {name}.")
        live = _live({COLLECTION: {"Plan.pdf": EG, "Schnitt.pdf": OG}})

        [count] = [
            c
            for c in rekey_document_ids(store, [COLLECTION], live, apply=True)
            if c.store == "document_metadata.document_id"
        ]

        assert (count.written, count.unmatched) == (1, 3)
        assert [(u.scope, u.reason, u.count) for u in count.unmatched_scopes] == [(COLLECTION, "id_taken", 3)]
        assert {doc.file_name: doc.document_id for doc in store.get_all(COLLECTION)} == {
            "Plan.pdf": EG,
            "plan.pdf ": None,
            "SCHNITT.pdf": None,
            " schnitt.pdf": None,
        }

    def test_the_exact_spelling_claims_the_id_though_two_drifted_rows_point_at_it_too(self, store):
        for name in ("Plan.pdf", "plan.pdf ", "PLAN.pdf"):
            store.register(COLLECTION, name, f"Plan {name}.")
        live = _live({COLLECTION: {"Plan.pdf": EG}})

        [count] = [
            c
            for c in rekey_document_ids(store, [COLLECTION], live, apply=True)
            if c.store == "document_metadata.document_id"
        ]

        assert (count.written, count.unmatched) == (1, 2)
        assert [(u.scope, u.reason, u.count) for u in count.unmatched_scopes] == [(COLLECTION, "id_taken", 2)]
        assert {doc.file_name: doc.document_id for doc in store.get_all(COLLECTION)} == {
            "Plan.pdf": EG,
            "plan.pdf ": None,
            "PLAN.pdf": None,
        }

    def test_each_unmatched_row_is_counted_under_its_collection_and_why(self, store):
        erased = "proj_identity_erased"
        for name in ("geloescht.pdf", "Grundriss_EG.pdf", "PLAN.pdf"):
            store.register(COLLECTION, name, f"{name}.")
        store.register(erased, "Notiz.pdf", "Notiz.")

        def live(collection: str) -> LiveDocuments:
            held = [(EG, "Grundriss EG.pdf"), (OG, "Plan.pdf"), (NEU, "plan.pdf")] if collection == COLLECTION else []
            return LiveDocuments.of(collection, held)

        counts = rekey_document_ids(store, sorted([COLLECTION, erased]), live, apply=False)
        [count] = [c for c in counts if c.store == "document_metadata.document_id"]

        assert sorted((u.scope, u.reason, u.count) for u in count.unmatched_scopes) == [
            (COLLECTION, "ambiguous", 1),
            (COLLECTION, "near_name", 1),
            (COLLECTION, "no_holder", 1),
            (erased, "no_documents_in_collection", 1),
        ]


class TestTheFacadeMirrorsById:
    @pytest.fixture
    def mirrored(self, store, monkeypatch):
        calls = []
        monkeypatch.setattr(factory, "_document_metadata_store", store)
        monkeypatch.setattr(
            factory,
            "_mirror_facts",
            lambda collection, file_names=(), *, document_ids=(), folders_only=False: calls.append(
                (sorted(file_names), sorted(document_ids))
            ),
        )
        return calls

    def test_a_document_with_an_id_is_mirrored_by_id(self, mirrored):
        factory.register_summary(COLLECTION, "Plan.pdf", "EG.", document_id=EG)
        factory.register_summary(COLLECTION, "Plan.pdf", "OG.", document_id=OG)
        factory.register_summary(COLLECTION, "OIB.pdf", "Basis.")
        factory.set_document_tags_by_person(COLLECTION, "Plan.pdf", ["EG"], document_id=EG)

        assert mirrored == [([], [EG]), ([], [OG]), (["OIB.pdf"], []), ([], [EG])]
        assert factory.get_document_person_tags(COLLECTION, [], document_ids=[EG, OG]) == {EG: ["EG"]}
