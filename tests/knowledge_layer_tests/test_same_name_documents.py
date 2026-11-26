from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from knowledge_layer.ingest import LlamaIndexIngestor
from knowledge_layer.ingest import collection_catalog
from knowledge_layer.ingest import stored_names
from knowledge_layer.read_passage import ORDER_FILTERS
from knowledge_layer.read_passage import PassageTarget
from knowledge_layer.read_passage import ReadCursor
from knowledge_layer.read_passage import _fetch_all
from knowledge_layer.read_passage import _resolve_targets
from knowledge_layer.read_passage import _whole_document_filters
from knowledge_layer.read_passage import decode_cursor
from knowledge_layer.read_passage import encode_cursor
from knowledge_layer.search import hit_metadata
from knowledge_layer.search import superseded
from knowledge_layer.vector_store import store as store_module
from knowledge_layer_testing.reingest import _wait_terminal
from knowledge_layer_testing.vector_store import FakeEmbedder
from knowledge_layer_testing.vector_store import record
from knowledge_layer_testing.vector_store import write
from knowledge_layer_testing.vector_store_fixtures import local_qdrant_store  # noqa: F401 - an in-process store

from agent.knowledge.schema import Chunk
from agent.knowledge.schema import ContentType

pytestmark = pytest.mark.filterwarnings("ignore:Payload indexes have no effect:UserWarning")

SCOPE = "proj_same_names"
PLAN = "Plan.txt"


@pytest.fixture()
def stores(tmp_path, local_qdrant_store):
    from agent.knowledge import configure_summary_db
    from agent.knowledge import factory

    factory._document_metadata_store = None
    configure_summary_db(f"sqlite:///{tmp_path / 'summaries.db'}")
    yield local_qdrant_store
    factory._document_metadata_store = None


@pytest.fixture()
def ingestor(stores):
    ing = LlamaIndexIngestor({"generate_summary": False, "summary_llm": MagicMock()})
    ing._embed_model = FakeEmbedder()
    ing._initialized = True
    return ing


def _ingest(ingestor, tmp_path, document_id: str, folder_path: str, text: str) -> None:
    upload = tmp_path / f"{document_id}-{len(text)}.txt"
    upload.write_text(text, encoding="utf-8")
    config = {"original_filenames": [PLAN], "document_id": document_id, "folder_path": folder_path}
    status = _wait_terminal(ingestor, ingestor.submit_job([str(upload)], SCOPE, config=config))
    assert status.file_details[0].status.value == "success", status.file_details[0].error_message


def _points(document_id: str | None = None) -> dict[str, dict]:
    filters = {"document_id": document_id} if document_id else None
    return {str(p.payload["chunk_id"]): dict(p.payload) for p in store_module.get_store().scroll(SCOPE, filters)}


def _texts(document_id: str) -> set[str]:
    return {payload["text"] for payload in _points(document_id).values()}


@pytest.fixture()
def two_plans(ingestor, tmp_path):
    _ingest(ingestor, tmp_path, "doc-eg", "Einreichung", "Grundriss Erdgeschoss mit Treppenhaus.")
    _ingest(ingestor, tmp_path, "doc-og", "Ausführung/OG", "Grundriss Obergeschoss mit Dachterrasse.")
    return ingestor


class TestTwoDocumentsThatShareAName:
    def test_each_ingests_into_its_own_chunks(self, two_plans):
        assert any("Erdgeschoss" in text for text in _texts("doc-eg"))
        assert any("Obergeschoss" in text for text in _texts("doc-og"))
        assert not any("Obergeschoss" in text for text in _texts("doc-eg"))
        assert {payload["file_name"] for payload in _points().values()} == {PLAN}

    def test_each_has_its_own_metadata_row(self, two_plans):
        from agent.knowledge import get_documents

        rows = {row.document_id: row for row in get_documents(SCOPE, [], document_ids=["doc-eg", "doc-og"])}
        assert set(rows) == {"doc-eg", "doc-og"}
        assert rows["doc-eg"].folder_path == "Einreichung"
        assert rows["doc-og"].folder_path == "Ausführung/OG"

    def test_each_carries_its_own_folder_on_its_chunks(self, two_plans):
        assert {tuple(p["folder_ancestors"]) for p in _points("doc-eg").values()} == {("einreichung",)}
        assert {tuple(p["folder_ancestors"]) for p in _points("doc-og").values()} == {("ausführung", "ausführung/og")}

    def test_a_re_ingest_of_one_replaces_only_its_own_chunks(self, two_plans, tmp_path):
        before_og = set(_points("doc-og"))

        _ingest(two_plans, tmp_path, "doc-eg", "Einreichung", "Grundriss Erdgeschoss, Index B, mit Lift.")

        assert any("Index B" in text for text in _texts("doc-eg"))
        assert not any("Treppenhaus" in text for text in _texts("doc-eg"))
        assert set(_points("doc-og")) == before_og

    def test_deleting_one_leaves_the_other(self, two_plans):
        from agent.knowledge import get_documents

        before_og = set(_points("doc-og"))

        assert two_plans.delete_document("doc-eg", PLAN, SCOPE) is True

        assert _points("doc-eg") == {}
        assert set(_points("doc-og")) == before_og
        assert [row.document_id for row in get_documents(SCOPE, [], document_ids=["doc-eg", "doc-og"])] == ["doc-og"]

    def test_the_listing_shows_two_files(self, two_plans):
        listed = {info.document_id: info for info in two_plans.list_files(SCOPE)}
        assert set(listed) == {"doc-eg", "doc-og"}
        assert listed["doc-eg"].file_id != listed["doc-og"].file_id
        assert {info.file_name for info in listed.values()} == {PLAN}

    def test_deleting_by_a_listed_id_deletes_that_document_only(self, two_plans):
        (listed,) = [info for info in two_plans.list_files(SCOPE) if info.document_id == "doc-og"]

        assert two_plans.delete_file(listed.file_id, SCOPE) is True

        assert _points("doc-og") == {}
        assert _points("doc-eg")


class TestThePreviousVersionOfADocument:
    @pytest.fixture()
    def seeded(self, ingestor):
        write(
            SCOPE,
            [record("EG", PLAN, chunk_id="eg-1"), record("EG 2", PLAN, chunk_id="eg-2")],
            {"document_id": "doc-eg"},
        )
        write(SCOPE, [record("OG", PLAN, chunk_id="og-1")], {"document_id": "doc-og"})
        write(SCOPE, [record("vor den Ids", PLAN, chunk_id="legacy-1")])
        return ingestor

    def test_it_is_found_by_id_and_never_includes_a_namesake(self, seeded):
        found = seeded._find_previous_version_of_document(SCOPE, PLAN, "doc-eg")

        assert sorted(found.chunk_ids) == ["eg-1", "eg-2", "legacy-1"]
        assert found.unclaimed_names == [PLAN]
        assert found.document_id == "doc-eg"

    def test_the_lookup_asks_by_id_or_for_points_without_one(self, seeded, monkeypatch):
        asked: list = []
        real = store_module.QdrantStore.scroll

        def recording(self, scope, filters=None, *extra, **kwargs):
            asked.append(filters)
            return real(self, scope, filters, *extra, **kwargs)

        monkeypatch.setattr(store_module.QdrantStore, "scroll", recording)

        seeded._find_previous_version_of_document(SCOPE, PLAN, "doc-eg")

        (filters,) = asked
        by_id, unclaimed = filters["$or"]
        assert by_id == {"document_id": {"$eq": "doc-eg"}}
        assert unclaimed["$and"][1] == {"document_id": {"$exists": False}}
        assert PLAN in unclaimed["$and"][0]["file_name"]["$in"]

    def test_retiring_it_keeps_the_namesake(self, seeded, monkeypatch):
        monkeypatch.setattr(collection_catalog, "bump_collection_version", lambda name: None)
        previous = seeded._find_previous_version_of_document(SCOPE, PLAN, "doc-eg")

        seeded._retire_previous_version(SCOPE, PLAN, previous, written=[])

        assert set(_points()) == {"og-1"}

    def test_a_new_document_takes_over_only_the_points_from_before_documents_had_ids(self, seeded):
        found = seeded._find_previous_version_of_document(SCOPE, PLAN, "doc-neu")

        assert found.chunk_ids == ["legacy-1"]

    def test_a_new_document_beside_two_namesakes_has_no_previous_version(self, ingestor):
        write(SCOPE, [record("EG", PLAN, chunk_id="eg-1")], {"document_id": "doc-eg"})
        write(SCOPE, [record("OG", PLAN, chunk_id="og-1")], {"document_id": "doc-og"})

        assert ingestor._find_previous_version_of_document(SCOPE, PLAN, "doc-neu") is None

    def test_the_replacement_lock_is_the_documents_own(self):
        eg = stored_names._replacement_lock_key(SCOPE, PLAN, "doc-eg")
        og = stored_names._replacement_lock_key(SCOPE, PLAN, "doc-og")
        assert eg != og
        assert stored_names._replacement_lock_key(SCOPE, PLAN) == f"reingest:{SCOPE}:{PLAN}"


def _document(document_id: str, folder_path: str, **fields) -> SimpleNamespace:
    return SimpleNamespace(
        file_name=PLAN, document_id=document_id, folder_path=folder_path, display_title=None, **fields
    )


def _chunk(document_id: str, text: str, page: int = 1) -> Chunk:
    return Chunk(
        chunk_id=f"{document_id}-{page}",
        content=text,
        score=1.0,
        file_name=PLAN,
        page_number=page,
        display_citation=f"{PLAN}, p.{page}",
        content_type=ContentType.TEXT,
        metadata={"document_id": document_id, "collection": SCOPE, "page_label": str(page), "chunk_ordinal": 0},
    )


class _Retriever:
    def __init__(self, chunks: list[Chunk]):
        self.chunks = chunks
        self.calls: list[dict] = []

    async def fetch(self, collection_name, filters, limit, order_by=None, start_from=None):
        self.calls.append(filters)
        return [chunk.model_copy(deep=True) for chunk in self.chunks if _admits(chunk, filters)][:limit]


def _admits(chunk: Chunk, filters: dict) -> bool:
    for clause in filters.get("$and", [filters]):
        ((field, condition),) = clause.items()
        have = chunk.file_name if field == "file_name" else chunk.metadata.get(field)
        if field in ("file_name", "document_id") and have != condition["$eq"]:
            return False
    return True


class TestReadingOneOfTwoNamesakes:
    @pytest.fixture()
    def listed(self, monkeypatch):
        documents = [_document("doc-eg", "Einreichung"), _document("doc-og", "Ausführung/OG")]

        async def available(collection):
            return list(documents)

        monkeypatch.setattr("agent.knowledge.factory.get_available_documents_async", available)
        return documents

    async def test_they_are_two_targets(self, listed):
        targets = await _resolve_targets([SimpleNamespace(collection=SCOPE, shelf="project")], PLAN)

        assert [target.document_id for target in targets] == ["doc-eg", "doc-og"]
        assert [target.selector for target in targets] == [
            {"document_id": {"$eq": "doc-eg"}},
            {"document_id": {"$eq": "doc-og"}},
        ]

    async def test_each_target_reads_only_its_own_chunks(self, listed, monkeypatch):
        retriever = _Retriever([_chunk("doc-eg", "Erdgeschoss"), _chunk("doc-og", "Obergeschoss")])
        monkeypatch.setattr("agent.knowledge.factory.get_active_retriever", lambda: retriever)
        targets = await _resolve_targets([SimpleNamespace(collection=SCOPE, shelf="project")], PLAN)

        fetched = await _fetch_all(targets, _whole_document_filters, PLAN, 10)

        assert sorted(chunk.content for chunk in fetched.chunks) == ["Erdgeschoss", "Obergeschoss"]
        assert retriever.calls == [{"document_id": {"$eq": "doc-eg"}}, {"document_id": {"$eq": "doc-og"}}]

    def test_a_target_without_an_id_is_read_by_name(self):
        target = PassageTarget(collection="base_corpus", file_name="oib-rl_2.pdf", shelf=None)
        assert target.selector == {"file_name": {"$eq": "oib-rl_2.pdf"}}

    async def test_the_older_namesake_points_at_its_own_newer_fassung(self, monkeypatch):
        documents = [
            _document("doc-eg", "Einreichung", superseded_by="Plan Index B.txt", superseded_by_id="doc-eg-b"),
            _document("doc-og", "Ausführung/OG", superseded_by=None, superseded_by_id=None),
            SimpleNamespace(
                file_name="Plan Index B.txt", document_id="doc-eg-b", display_title=None, superseded_by=None
            ),
        ]

        async def available(collection):
            return documents

        monkeypatch.setattr("agent.knowledge.factory.get_available_documents_async", available)

        targets = await _resolve_targets([SimpleNamespace(collection=SCOPE, shelf="project")], PLAN)

        assert {target.document_id: target.current for target in targets} == {
            "doc-eg": "Plan Index B.txt",
            "doc-og": None,
        }


class TestACursorKeepsItsDocument:
    def test_a_cursor_continues_only_the_document_it_was_issued_for(self):
        cursor = ReadCursor(PLAN, SCOPE, (2, 0, 0, 0, 0, 0, ""), None, ORDER_FILTERS, "doc-og")
        decoded = decode_cursor(encode_cursor(cursor))

        assert decoded == cursor
        assert decoded.continues(PassageTarget(SCOPE, PLAN, None, document_id="doc-og"))
        assert not decoded.continues(PassageTarget(SCOPE, PLAN, None, document_id="doc-eg"))

    def test_a_cursor_issued_before_documents_had_ids_still_reads(self):
        old = ReadCursor(PLAN, SCOPE, (2, 0, 0, 0, 0, 0, ""), None, ORDER_FILTERS)
        decoded = decode_cursor(encode_cursor(old))

        assert decoded is not None and decoded.document_id is None
        assert decoded.continues(PassageTarget(SCOPE, PLAN, None, document_id="doc-eg"))


class TestHitFactsOfNamesakes:
    def test_each_hit_takes_the_facts_of_its_own_document(self, monkeypatch):
        from agent.knowledge import factory

        asked: list = []

        def folder_paths(collection, filenames, *, document_ids=None):
            asked.append((list(filenames), list(document_ids or ())))
            return {"doc-eg": "Einreichung", "doc-og": "Ausführung/OG"}

        monkeypatch.setattr(factory, "get_document_folder_paths", folder_paths)
        hits = [_chunk("doc-eg", "Erdgeschoss"), _chunk("doc-og", "Obergeschoss")]

        resolved = hit_metadata.resolve_folder_paths(hits)

        assert [hit_metadata.hit_folder_path(hit, resolved) for hit in hits] == ["Einreichung", "Ausführung/OG"]
        assert asked == [([], ["doc-eg", "doc-og"])]

    def test_a_folder_filter_keeps_only_the_namesake_in_that_folder(self, monkeypatch):
        from agent.knowledge import factory

        monkeypatch.setattr(
            factory,
            "get_document_folder_paths",
            lambda collection, filenames, *, document_ids=None: {"doc-eg": "Einreichung", "doc-og": "Ausführung/OG"},
        )
        hits = [_chunk("doc-eg", "Erdgeschoss"), _chunk("doc-og", "Obergeschoss")]

        kept = hit_metadata.apply_agent_filters(hits, None, None, folder="Ausführung")

        assert [hit.content for hit in kept] == ["Obergeschoss"]


class TestAReplacedNamesake:
    async def test_only_the_replaced_document_is_left_out(self, monkeypatch):
        from agent import knowledge

        monkeypatch.setattr(knowledge, "get_superseded_files", lambda collection: {})
        monkeypatch.setattr(knowledge, "get_superseded_ids", lambda collection: {"doc-eg": "doc-eg-b"})
        monkeypatch.setattr(
            knowledge,
            "get_documents",
            lambda collection, filenames, *, document_ids=None: [
                SimpleNamespace(document_id="doc-eg", file_name=PLAN),
                SimpleNamespace(document_id="doc-eg-b", file_name="Plan Index B.txt"),
            ],
        )

        replaced = (await superseded.superseded_files([SCOPE]))[SCOPE]
        kept = superseded.without_replaced([_chunk("doc-eg", "alt"), _chunk("doc-og", "aktuell")], replaced)

        assert [chunk.content for chunk in kept] == ["aktuell"]
        assert superseded.hidden_revisions_notice({SCOPE: replaced}).startswith(f"Older Fassungen left out: {PLAN};")
