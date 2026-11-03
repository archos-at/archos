"""A caller's `filters` reach the store only on fields it indexes.

Production (grid-aiq-agent, 2026-10-23): a model passed ``filters={"shelf": ...}``
to `knowledge_search`, and the Qdrant translator raised "Filter on 'shelf': not an
indexed payload field" as an exception. ``shelf`` is the argument that picks the
collections, so it is moved there; any other unindexed field is refused with a
sentence the model reads, before the search.
"""

from __future__ import annotations

import pytest
from knowledge_layer.knowledge_search import SearchArgs
from knowledge_layer.knowledge_search import parse_args
from knowledge_layer.knowledge_search import scoped_filters
from knowledge_layer.qdrant.scope import translate


def _parse(filters: dict | None, shelf: str | None = None) -> SearchArgs | str:
    return parse_args(
        query="Fluchtweglänge",
        filters=filters,
        doc_class=None,
        title_contains=None,
        file_name=None,
        folder=None,
        match="meaning",
        context=None,
        group_by=None,
        stemmed=False,
        shelf=shelf,
        document_type=None,
        refers_to=None,
    )


def test_a_shelf_filter_becomes_the_shelf_argument() -> None:
    args = _parse({"shelf": "project"})

    assert isinstance(args, SearchArgs)
    assert args.shelf == "project"
    assert args.filters is None


def test_a_shelf_filter_beside_a_real_one_keeps_the_real_one() -> None:
    args = _parse({"shelf": "office", "content_type": "text"})

    assert isinstance(args, SearchArgs)
    assert (args.shelf, args.filters) == ("office", {"content_type": "text"})


def test_an_explicit_shelf_argument_wins_over_the_filter() -> None:
    assert scoped_filters({"shelf": "office"}, "project") == (None, "project")


def test_a_shelf_filter_with_an_operator_is_refused_with_the_argument_to_use() -> None:
    refusal = _parse({"shelf": {"$eq": "project"}})

    assert isinstance(refusal, str)
    assert '`shelf="project"`' in refusal


@pytest.mark.parametrize(
    "filters",
    [{"author": "Huber"}, {"$and": [{"content_type": "text"}, {"author": "Huber"}]}],
)
def test_an_unindexed_field_is_refused_as_a_sentence_not_an_exception(filters: dict) -> None:
    refusal = _parse(filters)

    assert isinstance(refusal, str)
    assert "'author'" in refusal


def test_what_passes_the_check_is_what_the_store_can_translate() -> None:
    """The ratchet: a filter the check lets through never fails as unindexed in the store."""
    args = _parse({"$or": [{"content_type": "text"}, {"doc_class": {"$in": ["law", "oib_guideline"]}}]})

    assert isinstance(args, SearchArgs)
    translate(args.filters)
