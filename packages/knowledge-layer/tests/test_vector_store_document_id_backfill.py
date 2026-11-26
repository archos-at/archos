from __future__ import annotations

from knowledge_layer.vector_store import DOCUMENT_ID_FIELD
from knowledge_layer.vector_store import LEGACY_DOCUMENT_ID_FIELD
from knowledge_layer.vector_store import backfill_document_ids
from knowledge_layer.vector_store import document_id_mismatches
from knowledge_layer.vector_store import get_store
from knowledge_layer.vector_store import stamp_document_ids
from knowledge_layer_testing.vector_store import record
from knowledge_layer_testing.vector_store import write

from agent.knowledge.document_metadata_rekey import LiveDocuments

SCOPE = "proj_backfill"


def _point_ids(scope: str, file_name: str) -> list[object]:
    return [point.id for point in get_store().scroll(scope, {"file_name": file_name})]


def _written_before_deploy_1(file_name: str, document_id: str) -> None:
    write(SCOPE, [record(f"{file_name} {index}", file_name) for index in range(3)], {"document_id": document_id})
    store = get_store()
    store.client.delete_payload(
        store.alias(SCOPE), keys=[DOCUMENT_ID_FIELD], points=_point_ids(SCOPE, file_name), wait=True
    )


def _keys(file_name: str) -> list[tuple[object, object]]:
    return [
        ((point.payload or {}).get(DOCUMENT_ID_FIELD), (point.payload or {}).get(LEGACY_DOCUMENT_ID_FIELD))
        for point in get_store().scroll(SCOPE, {"file_name": file_name})
    ]


def test_a_dry_run_counts_the_points_and_writes_nothing(fresh_qdrant_store):
    _written_before_deploy_1("alt.pdf", "doc_old")
    write(SCOPE, [record("neu", "neu.pdf")], {"document_id": "doc_new"})
    collection = fresh_qdrant_store.alias(SCOPE)

    count = backfill_document_ids(fresh_qdrant_store.client, collection, apply=False, page_size=2)

    assert (count.before, count.written, count.after) == (3, 0, 3)
    assert _keys("alt.pdf") == [(None, "doc_old")] * 3


def test_apply_copies_the_old_key_and_a_second_run_changes_nothing(fresh_qdrant_store):
    _written_before_deploy_1("alt.pdf", "doc_old")
    _written_before_deploy_1("anders.pdf", "doc_other")
    write(SCOPE, [record("ohne", "import.pdf")])
    collection = fresh_qdrant_store.alias(SCOPE)

    count = backfill_document_ids(fresh_qdrant_store.client, collection, apply=True, page_size=2)
    again = backfill_document_ids(fresh_qdrant_store.client, collection, apply=True, page_size=2)

    assert (count.before, count.written, count.after) == (6, 6, 0)
    assert (again.before, again.written, again.after) == (0, 0, 0)
    assert _keys("alt.pdf") == [("doc_old", "doc_old")] * 3
    assert _keys("anders.pdf") == [("doc_other", "doc_other")] * 3
    assert _keys("import.pdf") == [(None, None)], "a point with neither key stays as it is"
    assert document_id_mismatches(fresh_qdrant_store.client, collection, page_size=2) == 0


def test_two_keys_that_disagree_are_counted(fresh_qdrant_store):
    write(SCOPE, [record("neu", "neu.pdf")], {"document_id": "doc_new"})
    store = fresh_qdrant_store
    store.client.set_payload(
        store.alias(SCOPE), payload={DOCUMENT_ID_FIELD: "doc_else"}, points=_point_ids(SCOPE, "neu.pdf"), wait=True
    )

    assert document_id_mismatches(store.client, store.alias(SCOPE), page_size=2) == 1


def _live(ids: dict[str, str], asked: list[str] | None = None):
    def fetch(collection: str) -> LiveDocuments:
        if asked is not None:
            asked.append(collection)
        return LiveDocuments.of(collection, [(document_id, name) for name, document_id in ids.items()])

    return fetch


def test_a_stamp_dry_run_counts_the_user_points_without_an_id_and_writes_nothing(fresh_qdrant_store):
    write(SCOPE, [record(f"alt {index}", "alt.pdf") for index in range(2)])
    write(SCOPE, [record("weg", "geloescht.pdf")])
    write(SCOPE, [record("neu", "neu.pdf")], {"document_id": "doc_new"})
    collection = fresh_qdrant_store.alias(SCOPE)

    count = stamp_document_ids(
        fresh_qdrant_store.client, collection, _live({"alt.pdf": "doc_alt"}), apply=False, page_size=2
    )

    assert (count.before, count.written, count.after, count.unmatched, count.scopes) == (2, 0, 2, 1, 1)
    assert _keys("alt.pdf") == [(None, None)] * 2


def test_a_stamp_gives_each_point_its_documents_id_once(fresh_qdrant_store):
    write(SCOPE, [record(f"alt {index}", "alt.pdf") for index in range(3)])
    write(SCOPE, [record("weg", "geloescht.pdf")])
    write(SCOPE, [record("neu", "neu.pdf")], {"document_id": "doc_new"})
    collection = fresh_qdrant_store.alias(SCOPE)
    live = _live({"alt.pdf": "doc_alt", "neu.pdf": "doc_new"})

    count = stamp_document_ids(fresh_qdrant_store.client, collection, live, apply=True, page_size=2)
    again = stamp_document_ids(fresh_qdrant_store.client, collection, live, apply=True, page_size=2)

    assert (count.before, count.written, count.after, count.unmatched) == (3, 3, 0, 1)
    assert (again.before, again.written, again.after) == (0, 0, 0)
    assert _keys("alt.pdf") == [("doc_alt", None)] * 3
    assert _keys("neu.pdf") == [("doc_new", "doc_new")]
    assert _keys("geloescht.pdf") == [(None, None)], "a point no live document holds stays as it is"


def test_the_base_corpus_is_never_asked_about(fresh_qdrant_store):
    write("base_corpus", [record("OIB", "OIB-RL 2.pdf")])
    asked: list[str] = []
    corpus = fresh_qdrant_store.alias("base_corpus")

    count = stamp_document_ids(fresh_qdrant_store.client, corpus, _live({}, asked), apply=True, page_size=2)

    assert (count.before, count.written, count.unmatched, asked) == (0, 0, 0, [])
    assert [(point.payload or {}).get(DOCUMENT_ID_FIELD) for point in get_store().scroll("base_corpus", None)] == [None]
