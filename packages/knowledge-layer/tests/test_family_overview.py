from __future__ import annotations

import importlib
import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from knowledge_layer import register as register_module
from knowledge_layer.register import KnowledgeRetrievalConfig
from knowledge_layer.register import knowledge_retrieval

from agent.common.grounding_block import begin_grounding_capture
from agent.common.grounding_block import end_grounding_capture
from agent.common.grounding_block import get_grounding_block
from agent.common.norm_registry import oib_families
from agent.knowledge.schema import Chunk
from agent.knowledge.schema import ContentType
from agent.knowledge.schema import RetrievalResult

rp = importlib.import_module("knowledge_layer.read_passage.tool")

BASE = "oib_knowledge"
MEMBERS = {
    "2": "oib-rl_2_ausgabe_mai_2023.pdf",
    "2.1": "oib-rl_2.1_ausgabe_mai_2023.pdf",
    "2.2": "oib-rl_2.2_ausgabe_mai_2023.pdf",
    "2.3": "oib-rl_2.3_ausgabe_mai_2023.pdf",
}
FAMILY_QUERY = "was weißt du über die OIB 2"
TOPIC_QUERY = "Fluchtweglänge GK 4 in der OIB 2"


def _clause_chunk(file_name: str, clause: str, depth: int, title: str, page: int, content: str = "") -> Chunk:
    return Chunk(
        chunk_id=f"{file_name}:{clause}",
        content=content or f"{clause} {title} — Text",
        score=0.71,
        file_name=file_name,
        page_number=page,
        display_citation=f"{file_name}, p.{page}",
        content_type=ContentType.TEXT,
        metadata={
            "chunking": "clause",
            "clause_id": clause,
            "clause_depth": depth,
            "clause_title": title,
            "page_label": str(page),
        },
    )


def _outline_of(number: str, file_name: str) -> list[Chunk]:
    return [
        _clause_chunk(file_name, "0", 1, "Vorbemerkungen", 2, content=f"Teil {number} gilt für …"),
        _clause_chunk(file_name, "1", 1, "Begriffsbestimmungen", 3),
        _clause_chunk(file_name, "2", 1, "Anforderungen", 4),
        _clause_chunk(file_name, "2.1", 2, "Abstände", 4),
    ]


def _ranked() -> list[Chunk]:
    return [
        _clause_chunk(MEMBERS["2"], "3.5.2", 3, "Fluchtwege", 12, content="Die Fluchtweglänge …"),
        _clause_chunk(MEMBERS["2.3"], "4.1", 2, "Hochhäuser", 5, content="Für Hochhäuser gilt …"),
    ]


def _outline_file(filters) -> str | None:
    clauses = (filters or {}).get("$and") or []
    names = [clause["file_name"]["$eq"] for clause in clauses if "file_name" in clause]
    depths = [clause for clause in clauses if "$or" in clause]
    return names[0] if names and depths else None


class _Store:
    backend_name = "fake"
    embed_model_name = "fake-embedder"

    def __init__(self, outlines: dict[str, list[Chunk]], ranked: list[Chunk]):
        self.outlines = outlines
        self.ranked = ranked
        self.calls: list[dict] = []
        self.search_error: str | None = None

    async def retrieve(self, query, collection_name, top_k, filters=None):
        self.calls.append({"query": query, "collection": collection_name, "filters": filters, "top_k": top_k})
        file_name = _outline_file(filters)
        if self.search_error and not file_name:
            raise RuntimeError(self.search_error)
        chunks = self.outlines.get(file_name, []) if file_name else self.ranked
        return RetrievalResult(
            chunks=[chunk.model_copy(deep=True) for chunk in chunks],
            query=query,
            backend="fake",
            success=True,
        )


@pytest.fixture
def corpus(monkeypatch):

    def install(members: dict[str, str], ranked: list[Chunk] | None = None) -> _Store:
        store = _Store(
            {file_name: _outline_of(number, file_name) for number, file_name in members.items()}, ranked or _ranked()
        )

        async def _documents(collection: str):
            return [SimpleNamespace(file_name=name, display_title=None) for name in members.values()]

        monkeypatch.setattr(register_module, "_get_retriever", lambda config: store)
        monkeypatch.setattr(register_module, "_initialize_ingestor", lambda config, llm: None)
        monkeypatch.setattr("agent.knowledge.factory.get_active_retriever", lambda: store)
        monkeypatch.setattr("agent.knowledge.factory.get_available_documents_async", _documents)
        monkeypatch.setattr("agent.knowledge.factory.configure_summary_db", lambda url: None)
        monkeypatch.setattr("agent.knowledge.norm_store.configure_norm_store", lambda url: None)
        for name in ("get_document_doc_classes", "get_document_display_titles", "get_document_folder_paths"):
            monkeypatch.setattr(f"agent.knowledge.factory.{name}", lambda _c, _f: {})
        monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
        return store

    return install


def _config(**overrides) -> KnowledgeRetrievalConfig:
    return KnowledgeRetrievalConfig(
        collection_name=BASE,
        include_base_collection=True,
        include_session_collection=False,
        generate_summary=False,
        top_k=8,
        max_chunks_per_document=0,
        **overrides,
    )


async def _search(query: str = FAMILY_QUERY, **kwargs) -> str:
    async with knowledge_retrieval(_config(), MagicMock()) as info:
        return await info.single_fn(info.input_schema(query=query, **kwargs))


def _citations(out: str) -> list[str]:
    return [line.split("Citation: ", 1)[1] for line in out.splitlines() if line.startswith("Citation: ")]


def _lanes(out: str) -> dict:
    return json.loads(out.split("## Trace-Lanes\n", 1)[1].split("\n", 1)[0])


class TestTheFamilyIsTheAnswer:
    async def test_every_member_is_a_hit_before_the_ranked_passages(self, corpus):
        corpus(MEMBERS)

        out = await _search()

        assert _citations(out)[:4] == [f"{MEMBERS[number]}, p.2" for number in ("2", "2.1", "2.2", "2.3")]
        assert _citations(out)[4:] == [f"{MEMBERS['2']}, p.12", f"{MEMBERS['2.3']}, p.5"]

    async def test_a_member_hit_is_its_scope_passage(self, corpus):
        corpus(MEMBERS)

        out = await _search()

        assert "Teil 2.2 gilt für …" in out
        assert "Punkt: 0" in out

    async def test_the_preamble_names_the_family_and_counts_its_parts(self, corpus):
        corpus(MEMBERS)

        out = await _search()

        assert "OIB-Richtlinie 2: 4 parts in the corpus (2, 2.1, 2.2, 2.3)." in out
        assert "Results 1 to 4 are the Geltungsbereich of these parts" in out

    async def test_the_preamble_says_the_parts_are_open(self, corpus):
        corpus(MEMBERS)

        out = await _search()

        assert "These parts are therefore open at the level a read of one document opens it at" in out
        assert "deeper goes only a single Punkt from a Gliederung" in out

    async def test_a_part_the_corpus_lacks_is_never_claimed(self, corpus):
        corpus({"2": MEMBERS["2"], "2.1": MEMBERS["2.1"]})

        out = await _search()

        assert "OIB-Richtlinie 2: 2 parts in the corpus (2, 2.1)." in out
        assert _citations(out)[:2] == [f"{MEMBERS['2']}, p.2", f"{MEMBERS['2.1']}, p.2"]
        assert "## Gliederung OIB-Richtlinie 2.3" not in out

    async def test_a_member_the_store_cannot_read_drops_out(self, corpus):
        store = corpus(MEMBERS)
        store.outlines[MEMBERS["2.2"]] = []

        out = await _search()

        assert "OIB-Richtlinie 2: 3 parts in the corpus (2, 2.1, 2.3)." in out
        assert MEMBERS["2.2"] not in out


class TestTheMembersAreOpened:
    @staticmethod
    async def _captured(query: str) -> list[dict]:
        from agent.common.turn_status import begin_lane_capture
        from agent.common.turn_status import end_lane_capture
        from agent.common.turn_status import get_lane_captures

        token = begin_lane_capture()
        try:
            await _search(query)
            return get_lane_captures()
        finally:
            end_lane_capture(token)

    async def test_a_member_s_hits_carry_the_locator_stamp(self, corpus):
        corpus(MEMBERS)

        hits = await self._captured(FAMILY_QUERY)

        members = {name for name in MEMBERS.values()}
        stamped = {hit["name"]: hit.get("tool") for hit in hits if hit["name"] in members}
        assert stamped and set(stamped.values()) == {"read_passage"}

    async def test_an_ordinary_search_stamps_nothing_as_opened(self, corpus):
        corpus(MEMBERS)

        hits = await self._captured(TOPIC_QUERY)

        assert hits and {hit.get("tool") for hit in hits} == {"knowledge_search"}


class TestWhereMembershipComesFrom:
    async def test_the_turn_s_own_family_list_answers_without_a_store_read(self, corpus, monkeypatch):
        from agent.knowledge.inventory import set_norm_families

        store = corpus(MEMBERS)

        async def _no_listing(collection: str):
            raise AssertionError("the bound family list already knows the members")

        monkeypatch.setattr("agent.knowledge.factory.get_available_documents_async", _no_listing)
        set_norm_families(oib_families(MEMBERS.values()))
        try:
            out = await _search()
        finally:
            set_norm_families(None)

        assert "OIB-Richtlinie 2: 4 parts in the corpus (2, 2.1, 2.2, 2.3)." in out
        assert len([call for call in store.calls if _outline_file(call["filters"])]) == 4


class TestTheOneTrailer:
    async def test_one_outline_per_member_under_its_own_title(self, corpus):
        corpus(MEMBERS)

        out = await _search()

        assert out.count("## Gliederung ") == 4
        assert "## Gliederung OIB-Richtlinie 2.3, Ausgabe Mai 2023" in out

    async def test_the_instruction_is_stated_once(self, corpus):
        corpus(MEMBERS)

        out = await _search()

        assert out.count(rp._OUTLINE_INSTRUCTION) == 1

    async def test_the_index_lists_chapters_and_not_sub_clauses(self, corpus):
        corpus(MEMBERS)

        out = await _search()
        index = out.split("## Gliederung ", 1)[1]

        assert "- Punkt 2: Anforderungen (p. 4)" in index
        assert "Punkt 2.1: Abstände" not in index

    async def test_the_trailer_follows_the_fan_out(self, corpus):
        corpus(MEMBERS)

        out = await _search()

        assert out.index("## Trace-Lanes") < out.index("## Gliederung ")


class TestTheBlockIsStillOneRecordSet:
    @pytest.fixture
    def capturing(self):
        token = begin_grounding_capture()
        yield
        end_grounding_capture(token)

    async def test_the_whole_block_is_found_by_its_own_bytes(self, corpus, capturing):
        corpus(MEMBERS)

        assert get_grounding_block(await _search()) is not None

    async def test_the_lane_fan_out_carries_every_member(self, corpus):
        corpus(MEMBERS)

        (lane,) = _lanes(await _search())["lanes"]

        assert [source["name"] for source in lane["sources"]][:4] == list(MEMBERS.values())
        assert [source["detail"] for source in lane["sources"]][:4] == ["Pkt. 0 p.2"] * 4

    async def test_a_clause_addressed_hit_is_listed_by_its_clause(self, corpus):
        corpus(MEMBERS)

        details = [source["detail"] for source in _lanes(await _search())["lanes"][0]["sources"]]

        assert details[4:] == ["Pkt. 3.5.2 p.12", "Pkt. 4.1 p.5"]


class TestTheOrdinarySearchIsUntouched:
    async def test_a_topic_question_gets_passages_and_no_family(self, corpus):
        store = corpus(MEMBERS)

        out = await _search(TOPIC_QUERY)

        assert "im Bestand" not in out
        assert "## Gliederung" not in out
        assert _citations(out) == [f"{MEMBERS['2']}, p.12", f"{MEMBERS['2.3']}, p.5"]
        assert [call for call in store.calls if _outline_file(call["filters"])] == []

    async def test_a_file_scoped_search_is_the_opposite_request(self, corpus):
        store = corpus(MEMBERS)

        out = await _search(FAMILY_QUERY, file_name=MEMBERS["2"])

        assert "im Bestand" not in out
        assert [call for call in store.calls if _outline_file(call["filters"])] == []

    async def test_a_folder_scoped_search_is_too(self, corpus):
        store = corpus(MEMBERS)

        await _search(FAMILY_QUERY, folder="Brandschutz")

        assert [call for call in store.calls if _outline_file(call["filters"])] == []

    async def test_a_failed_fan_out_is_reported_as_a_failure(self, corpus):
        store = corpus(MEMBERS)
        store.search_error = "Retrieval failed: Collection 'oib_knowledge' embedding mismatch: e5 vs nv-embed"

        out = await _search()

        assert out.startswith("Knowledge retrieval failed:")
        assert "im Bestand" not in out

    async def test_a_corpus_without_the_family_answers_as_it_always_did(self, corpus):
        store = corpus({"3": "oib-rl_3_ausgabe_mai_2023.pdf"})

        out = await _search()

        assert "im Bestand" not in out
        assert [call for call in store.calls if _outline_file(call["filters"])] == []


class TestAnOverviewThatFailsSaysSo:
    @staticmethod
    def _broken(monkeypatch) -> None:
        async def _raise(entries, family_key):
            raise RuntimeError("outline store down")

        monkeypatch.setattr(rp, "family_overview", _raise)

    async def test_the_ranked_passages_still_answer(self, corpus, monkeypatch):
        corpus(MEMBERS)
        self._broken(monkeypatch)

        out = await _search()

        assert _citations(out) == [f"{MEMBERS['2']}, p.12", f"{MEMBERS['2.3']}, p.5"]
        assert "im Bestand" not in out
        assert "## Gliederung" not in out

    async def test_the_notice_says_the_overview_was_lost(self, corpus, monkeypatch):
        corpus(MEMBERS)
        self._broken(monkeypatch)

        out = await _search()

        assert out.startswith("Note: the overview of the parts of OIB-Richtlinie 2 could not be built")
        assert "each part opens on its own by its file name" in out

    async def test_a_search_that_names_no_family_carries_no_notice(self, corpus):
        corpus(MEMBERS)

        out = await _search(TOPIC_QUERY)

        assert "Hinweis:" not in out

    async def test_a_listed_family_with_no_readable_part_is_a_lost_overview(self, corpus):
        store = corpus(MEMBERS)
        for file_name in MEMBERS.values():
            store.outlines[file_name] = []

        out = await _search()

        assert out.startswith("Note: the overview of the parts of OIB-Richtlinie 2 could not be built")
        assert _citations(out) == [f"{MEMBERS['2']}, p.12", f"{MEMBERS['2.3']}, p.5"]


class TestOneRoundNotFive:
    async def test_the_members_are_read_in_one_gathered_round(self, corpus):
        store = corpus(MEMBERS)

        await _search()

        outline_calls = [call for call in store.calls if _outline_file(call["filters"])]
        assert sorted(_outline_file(call["filters"]) for call in outline_calls) == sorted(MEMBERS.values())
        assert all(call["top_k"] == rp._MAX_OUTLINE_CHUNKS for call in outline_calls)

    async def test_a_scope_passage_the_search_also_ranked_is_not_repeated(self, corpus):
        corpus(MEMBERS, ranked=[_clause_chunk(MEMBERS["2"], "0", 1, "Vorbemerkungen", 2, content="Teil 2 gilt für …")])

        out = await _search()

        assert _citations(out).count(f"{MEMBERS['2']}, p.2") == 1


def _ranked_many() -> list[Chunk]:
    return [
        _clause_chunk(MEMBERS["2"], f"3.{i}", 2, f"Abschnitt {i}", 10 + i, content=f"Passage {i} …")
        for i in range(1, 11)
    ]


class TestTheOverviewIsNotBuriedInRankedHits:
    async def test_only_a_few_ranked_passages_ride_beside_the_overview(self, corpus):
        family = importlib.import_module("knowledge_layer.search.family_branch")
        corpus(MEMBERS, ranked=_ranked_many())

        out = await _search()

        citations = _citations(out)
        assert citations[:4] == [f"{MEMBERS[number]}, p.2" for number in ("2", "2.1", "2.2", "2.3")]
        assert len(citations) == 4 + family.FAMILY_RANKED_HITS

    async def test_the_ranked_passages_left_out_are_counted_on_the_span(self, corpus, monkeypatch):
        family = importlib.import_module("knowledge_layer.search.family_branch")
        corpus(MEMBERS, ranked=_ranked_many())
        span: dict = {}

        def _capture(*, tool_name, search_input, picks):
            span.update(search_input)

        monkeypatch.setattr("agent.observability.retrieval_trace.emit_retrieval_span", _capture)
        await _search()

        assert span["dropped_by_family"] == _config().top_k - family.FAMILY_RANKED_HITS

    async def test_the_span_says_how_the_members_were_read(self, corpus, monkeypatch):
        store = corpus(MEMBERS, ranked=_ranked_many())
        span: dict = {}

        def _capture(*, tool_name, search_input, picks):
            span.update(search_input)

        monkeypatch.setattr("agent.observability.retrieval_trace.emit_retrieval_span", _capture)
        await _search()
        assert span["family_read"] == "retrieve"

        async def _fetch(collection_name, filters, limit, order_by=None):
            return [chunk.model_copy(deep=True) for chunk in store.outlines.get(_outline_file(filters), [])]

        store.fetch = _fetch
        span.clear()
        out = await _search()
        assert span["family_read"] == "fetch"
        assert _citations(out)[:4] == [f"{MEMBERS[number]}, p.2" for number in ("2", "2.1", "2.2", "2.3")]

    async def test_an_ordinary_search_drops_nothing_for_a_family(self, corpus, monkeypatch):
        corpus(MEMBERS, ranked=_ranked_many())
        span: dict = {}

        def _capture(*, tool_name, search_input, picks):
            span.update(search_input)

        monkeypatch.setattr("agent.observability.retrieval_trace.emit_retrieval_span", _capture)
        await _search(query=TOPIC_QUERY)

        assert "dropped_by_family" not in span

    async def test_an_ordinary_search_keeps_its_full_budget(self, corpus):
        corpus(MEMBERS, ranked=_ranked_many())

        out = await _search(query=TOPIC_QUERY)

        assert len(_citations(out)) == 8


class TestAnOverviewQuestionIsNotJudged:
    async def test_the_requery_judge_never_runs_on_a_family_query(self, corpus, monkeypatch):
        corpus(MEMBERS)
        calls: list = []

        class _Judge:
            async def ainvoke(self, *args, **kwargs):
                calls.append(args)
                return SimpleNamespace(content='{"sufficient": false, "queries": ["andere Frage"]}')

        async def _resolve(_builder, _name):
            return _Judge()

        monkeypatch.setattr("agent.common.get_langchain_llm", _resolve)
        span: dict = {}

        def _capture(*, tool_name, search_input, picks):
            span.update(search_input)

        monkeypatch.setattr("agent.observability.retrieval_trace.emit_retrieval_span", _capture)
        async with knowledge_retrieval(_config(requery_llm="judge"), MagicMock()) as info:
            out = await info.single_fn(info.input_schema(query=FAMILY_QUERY))

        assert calls == []
        assert "Umformulierungen" not in out
        assert span["requery_skipped"] == "family"
        assert span["requery_fired"] is False

    @staticmethod
    def _judge(monkeypatch) -> list:
        calls: list = []

        class _Judge:
            async def ainvoke(self, *args, **kwargs):
                calls.append(args)
                return SimpleNamespace(content='{"sufficient": true, "queries": []}')

        async def _resolve(_builder, _name):
            return _Judge()

        monkeypatch.setattr("agent.common.get_langchain_llm", _resolve)
        return calls

    async def test_a_corpus_without_the_family_keeps_the_judge(self, corpus, monkeypatch):
        corpus({"3": "oib-rl_3_ausgabe_mai_2023.pdf"})
        calls = self._judge(monkeypatch)

        async with knowledge_retrieval(_config(requery_llm="judge"), MagicMock()) as info:
            await info.single_fn(info.input_schema(query=FAMILY_QUERY))

        assert len(calls) == 1

    async def test_an_overview_that_failed_open_keeps_the_judge(self, corpus, monkeypatch):
        corpus(MEMBERS)
        TestAnOverviewThatFailsSaysSo._broken(monkeypatch)
        calls = self._judge(monkeypatch)

        async with knowledge_retrieval(_config(requery_llm="judge"), MagicMock()) as info:
            await info.single_fn(info.input_schema(query=FAMILY_QUERY))

        assert len(calls) == 1
