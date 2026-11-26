from __future__ import annotations

from knowledge_layer.vector_store import DOCUMENT_ID_FIELD
from knowledge_layer.vector_store import LEGACY_DOCUMENT_ID_FIELD
from knowledge_layer.vector_store import get_store
from knowledge_layer.vector_store import stamp_document_ids
from knowledge_layer_testing.vector_store import record
from knowledge_layer_testing.vector_store import write

from agent.knowledge.document_metadata_rekey import LiveDocuments

SCOPE = "proj_stamp"


def _keys(file_name: str) -> list[tuple[object, object]]:
    return [
        ((point.payload or {}).get(DOCUMENT_ID_FIELD), (point.payload or {}).get(LEGACY_DOCUMENT_ID_FIELD))
        for point in get_store().scroll(SCOPE, {"file_name": file_name})
    ]


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


def test_a_point_without_an_id_whose_name_two_live_documents_hold_is_counted_as_held(fresh_qdrant_store):
    write(SCOPE, [record("vor den Ids", "Plan.pdf")])
    write(SCOPE, [record("weg", "geloescht.pdf")])
    collection = fresh_qdrant_store.alias(SCOPE)

    def live(scope: str) -> LiveDocuments:
        return LiveDocuments.of(scope, [("doc_eg", "Plan.pdf"), ("doc_og", "Plan.pdf")])

    count = stamp_document_ids(fresh_qdrant_store.client, collection, live, apply=True, page_size=2)

    assert (count.written, count.after, count.unmatched, count.unmatched_held) == (0, 0, 2, 1)
    assert _keys("Plan.pdf") == [(None, None)], "neither namesake can claim it"


def test_the_base_corpus_is_never_asked_about(fresh_qdrant_store):
    write("base_corpus", [record("OIB", "OIB-RL 2.pdf")])
    asked: list[str] = []
    corpus = fresh_qdrant_store.alias("base_corpus")

    count = stamp_document_ids(fresh_qdrant_store.client, corpus, _live({}, asked), apply=True, page_size=2)

    assert (count.before, count.written, count.unmatched, asked) == (0, 0, 0, [])
    assert [(point.payload or {}).get(DOCUMENT_ID_FIELD) for point in get_store().scroll("base_corpus", None)] == [None]
