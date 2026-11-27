from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from knowledge_layer.read_passage import ReadPassageConfig
from knowledge_layer.read_passage import read_passage
from knowledge_layer.register import KnowledgeRetrievalConfig

from agent.common.source_kinds import Shelf
from agent.knowledge.schema import Chunk
from agent.knowledge.schema import ContentType
from agent.knowledge.scoping import ScopedCollection

SCOPE = "proj_namesakes"
PLAN = "Plan.md"


def _document(document_id: str, folder_path: str) -> SimpleNamespace:
    return SimpleNamespace(
        file_name=PLAN, document_id=document_id, folder_path=folder_path, display_title=None, summary=None, tags=None
    )


def _chunk(document_id: str, text: str) -> Chunk:
    return Chunk(
        chunk_id=f"{document_id}-1",
        content=text,
        score=1.0,
        file_name=PLAN,
        page_number=1,
        display_citation=f"{PLAN}, p.1",
        content_type=ContentType.TEXT,
        metadata={"document_id": document_id, "page_label": "1", "chunk_ordinal": 0},
    )


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


class _Retriever:
    def __init__(self, chunks: list[Chunk]):
        self.chunks = chunks

    async def fetch(self, collection_name, filters, limit, order_by=None, start_from=None):
        return [chunk.model_copy(deep=True) for chunk in self.chunks if _admits(chunk, filters)][:limit]


@pytest.fixture
def two_plans(monkeypatch):
    documents = [_document("doc-a", "A"), _document("doc-b", "B")]
    retriever = _Retriever([_chunk("doc-a", "Inhalt von A"), _chunk("doc-b", "Inhalt von B")])

    async def available(collection: str):
        return list(documents)

    monkeypatch.setattr("agent.knowledge.factory.get_active_retriever", lambda: retriever)
    monkeypatch.setattr("agent.knowledge.factory.get_available_documents_async", available)
    monkeypatch.setattr(
        "agent.knowledge.scoping.get_scoped_collections_from_context",
        lambda: [ScopedCollection(SCOPE, Shelf.PROJECT)],
    )
    for name in ("get_document_doc_classes", "get_document_display_titles", "get_document_folder_paths"):
        monkeypatch.setattr(f"agent.knowledge.factory.{name}", lambda _c, _f, **_k: {})
    return documents


async def _read(**kwargs) -> str:
    builder = MagicMock()
    builder.get_function_config = MagicMock(return_value=KnowledgeRetrievalConfig(collection_name=SCOPE))
    async with read_passage(ReadPassageConfig(), builder) as info:
        return await info.single_fn(info.input_schema(**kwargs))


class TestReadingOneOfTwoDocumentsOfOneName:
    async def test_the_bare_name_is_refused_with_both_in_their_citation_form(self, two_plans):
        text = await _read(document=PLAN, page=1)

        assert "Inhalt von" not in text
        assert "names 2 different documents" in text
        assert "- A/Plan.md (Document-ID: doc-a)" in text
        assert "- B/Plan.md (Document-ID: doc-b)" in text

    async def test_the_outline_of_the_bare_name_is_refused_too(self, two_plans):
        text = await _read(document=PLAN)

        assert "Inhalt von" not in text
        assert "names 2 different documents" in text

    @pytest.mark.parametrize("document", ["A/Plan.md", "a/plan.md", "A/Plan.md, p.1"])
    async def test_the_citation_form_reads_that_document_only(self, two_plans, document):
        text = await _read(document=document, page=1)

        assert "Inhalt von A" in text
        assert "Inhalt von B" not in text

    @pytest.mark.parametrize("document", ["doc-b", "doc:id:doc-b"])
    async def test_the_document_id_reads_that_document_only(self, two_plans, document):
        text = await _read(document=document, page=1)

        assert "Inhalt von B" in text
        assert "Inhalt von A" not in text
        assert "doc:id" not in text.split("\n", 1)[0]

    async def test_a_folder_that_holds_no_such_name_is_refused_with_both_as_guesses(self, two_plans):
        text = await _read(document="C/Plan.md", page=1)

        assert "No document in scope is named 'C/Plan.md'" in text
        assert "- A/Plan.md" in text
        assert "- B/Plan.md" in text

    async def test_a_name_one_document_holds_still_reads_by_the_name_alone(self, two_plans):
        two_plans.pop()

        text = await _read(document=PLAN, page=1)

        assert "Inhalt von A" in text
