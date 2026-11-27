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
    assert _reasons(count) == {(SCOPE, "ambiguous"): 1, (SCOPE, "no_holder"): 1}
    assert _keys("Plan.pdf") == [(None, None)], "neither namesake can claim it"


def test_the_base_corpus_is_never_asked_about(fresh_qdrant_store):
    write("base_corpus", [record("OIB", "OIB-RL 2.pdf")])
    asked: list[str] = []
    corpus = fresh_qdrant_store.alias("base_corpus")

    count = stamp_document_ids(fresh_qdrant_store.client, corpus, _live({}, asked), apply=True, page_size=2)

    assert (count.before, count.written, count.unmatched, asked) == (0, 0, 0, [])
    assert [(point.payload or {}).get(DOCUMENT_ID_FIELD) for point in get_store().scroll("base_corpus", None)] == [None]


def _reasons(count) -> dict[tuple[str, str], int]:
    return {(unmatched.scope, unmatched.reason): unmatched.count for unmatched in count.unmatched_scopes}


def test_a_point_whose_name_differs_from_one_live_document_only_by_case_or_whitespace_takes_its_id(
    fresh_qdrant_store,
):
    write(SCOPE, [record(f"Grundriss {index}", " grundriss eg.PDF") for index in range(2)])
    collection = fresh_qdrant_store.alias(SCOPE)

    count = stamp_document_ids(
        fresh_qdrant_store.client, collection, _live({"Grundriss EG.pdf": "doc_eg"}), apply=True, page_size=2
    )

    assert (count.before, count.written, count.after, count.unmatched) == (2, 2, 0, 0)
    assert _keys(" grundriss eg.PDF") == [("doc_eg", None)] * 2


def test_a_drifted_name_two_live_documents_hold_by_the_match_key_is_ambiguous_but_never_held(fresh_qdrant_store):
    write(SCOPE, [record("vor den Ids", "PLAN.pdf")])
    collection = fresh_qdrant_store.alias(SCOPE)

    def live(scope: str) -> LiveDocuments:
        return LiveDocuments.of(scope, [("doc_eg", "Plan.pdf"), ("doc_og", "plan.pdf")])

    count = stamp_document_ids(fresh_qdrant_store.client, collection, live, apply=True, page_size=2)

    assert (count.written, count.unmatched, count.unmatched_held) == (0, 1, 0)
    assert _reasons(count) == {(SCOPE, "ambiguous"): 1}
    assert _keys("PLAN.pdf") == [(None, None)]


def test_the_exact_spelling_claims_the_document_before_a_drifted_one(fresh_qdrant_store):
    write(SCOPE, [record("aktuell", "Plan.pdf")])
    write(SCOPE, [record("alt", "plan.pdf ")])
    write(SCOPE, [record("Fassung mit Id", "PLAN.PDF")], {"document_id": "doc_schnitt"})
    write(SCOPE, [record("alt", "schnitt.pdf")])
    collection = fresh_qdrant_store.alias(SCOPE)
    live = _live({"Plan.pdf": "doc_plan", "Schnitt.pdf": "doc_schnitt"})

    count = stamp_document_ids(fresh_qdrant_store.client, collection, live, apply=True, page_size=2)

    assert (count.written, count.after, count.unmatched, count.unmatched_held) == (1, 0, 2, 0)
    assert _reasons(count) == {(SCOPE, "id_taken"): 2}
    assert _keys("plan.pdf ") == [(None, None)]
    assert _keys("schnitt.pdf") == [(None, None)], "the document already has points of its own"


def test_each_unmatched_point_is_counted_under_its_scope_and_why(fresh_qdrant_store):
    erased = "proj_stamp_erased"
    write(SCOPE, [record("weg", "geloescht.pdf")])
    write(SCOPE, [record("fast", "Grundriss_EG.pdf")])
    write(erased, [record(f"Gespräch {index}", "Notiz.pdf") for index in range(3)])
    collection = fresh_qdrant_store.alias(SCOPE)

    def live(scope: str) -> LiveDocuments:
        return LiveDocuments.of(scope, [("doc_eg", "Grundriss EG.pdf")] if scope == SCOPE else [])

    count = stamp_document_ids(fresh_qdrant_store.client, collection, live, apply=False, page_size=2)

    assert (count.unmatched, count.unmatched_held) == (5, 0)
    assert _reasons(count) == {
        (SCOPE, "near_name"): 1,
        (SCOPE, "no_holder"): 1,
        (erased, "no_documents_in_collection"): 3,
    }


def test_the_exact_spelling_is_stamped_though_two_drifted_spellings_point_at_its_document_too(fresh_qdrant_store):
    write(SCOPE, [record("aktuell", "Plan.pdf")])
    write(SCOPE, [record("alt", "plan.pdf ")])
    write(SCOPE, [record("älter", "PLAN.pdf")])
    collection = fresh_qdrant_store.alias(SCOPE)

    count = stamp_document_ids(
        fresh_qdrant_store.client, collection, _live({"Plan.pdf": "doc_plan"}), apply=True, page_size=2
    )

    assert (count.written, count.unmatched, count.unmatched_held) == (1, 2, 0)
    assert _reasons(count) == {(SCOPE, "id_taken"): 2}
    assert _keys("Plan.pdf") == [("doc_plan", None)]
