from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from knowledge_layer.ingest import LlamaIndexIngestor
from knowledge_layer.ingest import collection_catalog
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
from knowledge_layer.vector_store import document_chunks
from knowledge_layer.vector_store import store as store_module
from knowledge_layer_testing.reingest import _wait_terminal
from knowledge_layer_testing.vector_store import FakeEmbedder
from knowledge_layer_testing.vector_store import local_store
from knowledge_layer_testing.vector_store import record
from knowledge_layer_testing.vector_store import write

from agent.knowledge.schema import Chunk
from agent.knowledge.schema import ContentType

pytestmark = pytest.mark.filterwarnings("ignore:Payload indexes have no effect:UserWarning")

SCOPE = "proj_same_names"
PLAN = "Plan.txt"


@pytest.fixture()
def stores(tmp_path, monkeypatch):
    from agent.knowledge import configure_summary_db
    from agent.knowledge import factory

    factory._document_metadata_store = None
    configure_summary_db(f"sqlite:///{tmp_path / 'summaries.db'}")
    yield from local_store(monkeypatch)
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


class TestADocumentHalfGivenItsId:
    def test_is_listed_once_under_its_id(self, ingestor):
        write(SCOPE, [record("EG", PLAN, chunk_id="eg-1")], {"document_id": "doc-eg"})
        write(SCOPE, [record("vor den Ids", PLAN, chunk_id="legacy-1")])

        (listed,) = ingestor.list_files(SCOPE)

        assert (listed.document_id, listed.chunk_count) == ("doc-eg", 2)

    def test_with_its_new_upload_in_flight_is_listed_once_under_its_id(self, ingestor, monkeypatch):
        from agent.knowledge.schema import FileInfo
        from agent.knowledge.schema import FileStatus
        from agent.knowledge.schema import stable_file_id

        write(SCOPE, [record("vor den Ids", PLAN, chunk_id="legacy-1")])
        uploading = FileInfo(
            file_id=stable_file_id(SCOPE, PLAN, "doc-eg"),
            file_name=PLAN,
            collection_name=SCOPE,
            document_id="doc-eg",
            status=FileStatus.INGESTING,
        )
        monkeypatch.setattr(ingestor, "_recorded_files", lambda collection: {"id:doc-eg": uploading})

        (listed,) = ingestor.list_files(SCOPE)

        assert (listed.file_id, listed.status, listed.chunk_count) == (uploading.file_id, FileStatus.INGESTING, 1)

    def test_with_a_job_record_from_before_ids_is_listed_once_under_its_id(self, ingestor, monkeypatch):
        from agent.knowledge.schema import FileInfo
        from agent.knowledge.schema import FileStatus
        from agent.knowledge.schema import stable_file_id

        write(SCOPE, [record("EG", PLAN, chunk_id="eg-1")], {"document_id": "doc-eg"})
        failed = FileInfo(
            file_id=stable_file_id(SCOPE, PLAN), file_name=PLAN, collection_name=SCOPE, status=FileStatus.FAILED
        )
        monkeypatch.setattr(ingestor, "_recorded_files", lambda collection: {PLAN: failed})

        (listed,) = ingestor.list_files(SCOPE)

        assert (listed.document_id, listed.file_id) == ("doc-eg", stable_file_id(SCOPE, PLAN, "doc-eg"))

    def test_beside_a_namesake_leaves_its_points_from_before_ids_to_neither(self, ingestor):
        write(SCOPE, [record("EG", PLAN, chunk_id="eg-1")], {"document_id": "doc-eg"})
        write(SCOPE, [record("OG", PLAN, chunk_id="og-1")], {"document_id": "doc-og"})
        write(SCOPE, [record("vor den Ids", PLAN, chunk_id="legacy-1")])

        assert sorted(str(info.document_id) for info in ingestor.list_files(SCOPE)) == ["None", "doc-eg", "doc-og"]


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

    def test_while_names_still_reach_identified_points_a_job_without_an_id_finds_every_point_of_its_name(
        self, seeded, monkeypatch
    ):
        from knowledge_layer.vector_store import name_scope

        monkeypatch.setattr(name_scope, "NAMES_SKIP_IDENTIFIED_POINTS", False)

        found = seeded._chunk_ids_of(SCOPE, [PLAN])

        assert sorted(chunk_id for chunk_id, _stored in found) == ["eg-1", "eg-2", "legacy-1", "og-1"]

    def test_a_delete_by_id_reads_only_the_names_of_points_without_an_id(self, seeded, monkeypatch):
        write(SCOPE, [record("hochgeladen", "tmpab12cd34_Plan.txt", chunk_id="tmp-1")])

        def every_name(self, scope):
            raise AssertionError("a delete by id lists only the names of points without an id")

        monkeypatch.setattr(store_module.QdrantStore, "file_counts", every_name)

        assert seeded.delete_document("doc-eg", PLAN, SCOPE) is True

        assert set(_points()) == {"og-1"}

    def test_a_new_document_beside_two_namesakes_has_no_previous_version(self, ingestor):
        write(SCOPE, [record("EG", PLAN, chunk_id="eg-1")], {"document_id": "doc-eg"})
        write(SCOPE, [record("OG", PLAN, chunk_id="og-1")], {"document_id": "doc-og"})

        assert ingestor._find_previous_version_of_document(SCOPE, PLAN, "doc-neu") is None

    def test_a_replacement_holds_its_documents_lock_and_the_one_its_name_was_locked_by(self, ingestor, monkeypatch):
        from contextlib import ExitStack
        from contextlib import nullcontext

        taken: list[str] = []
        monkeypatch.setattr("agent.knowledge.leader_lock.keyed_lock", lambda key: taken.append(key) or nullcontext())
        for document_id in ("doc-eg", "doc-og"):
            file = SimpleNamespace(file_name=PLAN, document_id=document_id, scope=ExitStack())
            run = SimpleNamespace(collection_name=SCOPE, config={})
            ingestor._take_previous_version(run, file)

        assert taken == [
            f"reingest:{SCOPE}:{PLAN}",
            f"reingest:{SCOPE}:id:doc-eg",
            f"reingest:{SCOPE}:{PLAN}",
            f"reingest:{SCOPE}:id:doc-og",
        ]


class TestTheChunksOfOneDocument:
    @pytest.fixture()
    def seeded(self, stores, monkeypatch):
        monkeypatch.setenv("QDRANT_URL", "http://qdrant.test:6333")
        write(SCOPE, [record("EG", PLAN, chunk_id="eg-1")], {"document_id": "doc-eg"})
        write(SCOPE, [record("OG", PLAN, chunk_id="og-1")], {"document_id": "doc-og"})
        write(SCOPE, [record("vor den Ids", PLAN, chunk_id="legacy-1")])
        return stores

    def test_are_its_own_and_those_from_before_documents_had_ids(self, seeded):
        found = {str(point.payload["chunk_id"]) for point in seeded.scroll(SCOPE, document_chunks(PLAN, "doc-eg"))}

        assert found == {"eg-1", "legacy-1"}

    def test_a_licensed_norm_from_before_documents_had_ids_stays_licensed_when_asked_by_id(self, seeded):
        from knowledge_layer.estate import document_licence

        write(SCOPE, [record("§ 4", "Norm.pdf", chunk_id="norm-1", licence_class="licensed")])

        terms = document_licence(SCOPE, "Norm.pdf", document_id="doc-norm")

        assert terms is not None and terms.licensed

    def test_while_names_still_reach_identified_points_the_facts_of_its_row_reach_them(self, seeded, monkeypatch):
        from knowledge_layer.vector_store import copy_facts
        from knowledge_layer.vector_store import name_scope

        monkeypatch.setattr(name_scope, "NAMES_SKIP_IDENTIFIED_POINTS", False)

        row = SimpleNamespace(document_id="doc-eg", file_name=PLAN, folder_path="Einreichung", superseded_by="B.txt")
        monkeypatch.setattr("agent.knowledge.get_documents", lambda scope, names, *, document_ids=None: [row])

        copy_facts(SCOPE, document_ids=["doc-eg"])

        assert {
            chunk_id: (payload.get("folder_path"), payload.get("superseded")) for chunk_id, payload in _points().items()
        } == {
            "eg-1": ("Einreichung", True),
            "og-1": (None, None),
            "legacy-1": ("Einreichung", True),
        }

    def test_while_names_still_reach_identified_points_a_rename_reaches_them(self, seeded, monkeypatch):
        from knowledge_layer.vector_store import name_scope

        monkeypatch.setattr(name_scope, "NAMES_SKIP_IDENTIFIED_POINTS", False)
        renamed = seeded.rewrite_file_name(SCOPE, "doc-eg", "Plan EG.txt", previous_name=PLAN)

        assert renamed == 2
        assert {chunk_id: payload["file_name"] for chunk_id, payload in _points().items()} == {
            "eg-1": "Plan EG.txt",
            "og-1": PLAN,
            "legacy-1": "Plan EG.txt",
        }


class TestSearchKeepsNamesakesApart:
    def test_each_namesake_has_its_own_share_of_the_slate(self):
        from knowledge_layer.search import apply_diversity_cap

        ordered = [_chunk("doc-eg", "EG", page) for page in (1, 2, 3)] + [
            _chunk("doc-og", "OG", page) for page in (1, 2)
        ]

        capped = apply_diversity_cap(ordered, top_k=4, max_per_document=2)

        assert [chunk.chunk_id for chunk in capped] == ["doc-eg-1", "doc-eg-2", "doc-og-1", "doc-og-2"]

    def test_focusing_one_namesake_keeps_it_and_its_chunks_from_before_documents_had_ids(self, monkeypatch):
        from knowledge_layer.search import merge_results

        from agent.common.focus_file import set_turn_intent
        from agent.knowledge.schema import RetrievalResult

        legacy = _chunk("doc-eg", "vor den Ids", 9)
        legacy.metadata.pop("document_id")
        chunks = [_chunk("doc-eg", "EG"), _chunk("doc-og", "OG"), legacy]
        set_turn_intent(file_name=PLAN, document_id="doc-og")
        try:
            merged = merge_results(
                [RetrievalResult(chunks=chunks, query="q", backend="fake", success=True)],
                query="q",
                top_k=5,
                backend_name="fake",
            )
        finally:
            set_turn_intent()

        assert [chunk.content for chunk in merged.chunks] == ["OG", "vor den Ids"]


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
    if "$and" in filters:
        return all(_admits(chunk, clause) for clause in filters["$and"])
    if "$or" in filters:
        return any(_admits(chunk, clause) for clause in filters["$or"])
    ((field, condition),) = filters.items()
    if field not in ("file_name", "document_id"):
        return True
    have = chunk.file_name if field == "file_name" else chunk.metadata.get(field)
    if "$exists" in condition:
        return (have is not None) is condition["$exists"]
    return have == condition["$eq"]


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
            document_chunks(PLAN, "doc-eg"),
            document_chunks(PLAN, "doc-og"),
        ]

    async def test_each_target_reads_only_its_own_chunks(self, listed, monkeypatch):
        retriever = _Retriever([_chunk("doc-eg", "Erdgeschoss"), _chunk("doc-og", "Obergeschoss")])
        monkeypatch.setattr("agent.knowledge.factory.get_active_retriever", lambda: retriever)
        targets = await _resolve_targets([SimpleNamespace(collection=SCOPE, shelf="project")], PLAN)

        fetched = await _fetch_all(targets, _whole_document_filters, PLAN, 10)

        assert sorted(chunk.content for chunk in fetched.chunks) == ["Erdgeschoss", "Obergeschoss"]
        assert retriever.calls == [document_chunks(PLAN, "doc-eg"), document_chunks(PLAN, "doc-og")]

    def test_a_target_without_an_id_is_read_by_name(self):
        target = PassageTarget(collection="base_corpus", file_name="oib-rl_2.pdf", shelf=None)
        assert target.selector == {"file_name": {"$eq": "oib-rl_2.pdf"}}

    async def test_the_older_namesake_points_at_its_own_newer_revision(self, monkeypatch):
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
        assert [ids for _names, ids in asked] == [["doc-eg", "doc-og"]]

    def test_while_names_still_reach_identified_points_a_hit_takes_its_unkeyed_rows_facts(self, monkeypatch):
        from knowledge_layer.vector_store import name_scope

        from agent.knowledge import factory

        monkeypatch.setattr(name_scope, "NAMES_SKIP_IDENTIFIED_POINTS", False)
        monkeypatch.setattr(
            factory, "get_document_folder_paths", lambda collection, filenames, *, document_ids=None: {PLAN: "Archiv"}
        )
        hits = [_chunk("doc-eg", "Erdgeschoss")]

        assert hit_metadata.hit_folder_path(hits[0], hit_metadata.resolve_folder_paths(hits)) == "Archiv"

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

    async def test_the_names_of_many_replaced_documents_are_read_in_bounded_batches(self, monkeypatch):
        from agent import knowledge

        replaced_ids = {f"alt-{index:04d}": f"neu-{index:04d}" for index in range(600)}
        asked: list[int] = []

        def documents(collection, filenames, *, document_ids=None):
            asked.append(len(document_ids))
            return [SimpleNamespace(document_id=value, file_name=f"{value}.pdf") for value in document_ids]

        monkeypatch.setattr(knowledge, "get_superseded_files", lambda collection: {})
        monkeypatch.setattr(knowledge, "get_superseded_ids", lambda collection: replaced_ids)
        monkeypatch.setattr(knowledge, "get_documents", documents)

        replaced = (await superseded.superseded_files([SCOPE]))[SCOPE]

        assert max(asked) <= 500 and sum(asked) == 1200
        assert len(replaced.older_names()) == 600

    def test_while_names_still_reach_identified_points_a_replaced_name_still_hides(self, monkeypatch):
        from knowledge_layer.vector_store import name_scope

        monkeypatch.setattr(name_scope, "NAMES_SKIP_IDENTIFIED_POINTS", False)
        replaced = superseded.Replaced(by_name={PLAN: "Plan Index B.txt"})

        assert superseded.without_replaced([_chunk("doc-eg", "alt")], replaced) == []
