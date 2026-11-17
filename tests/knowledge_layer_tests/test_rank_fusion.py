from types import SimpleNamespace

import pytest
from knowledge_layer.search import apply_diversity_cap
from knowledge_layer.search import fuse_with_ranks
from knowledge_layer.search import merge_results

from agent.knowledge.schema import Chunk
from agent.knowledge.schema import ContentType
from agent.knowledge.schema import RetrievalResult


def _chunk(chunk_id: str, score: float, rank: int, file_name: str = "doc.pdf", collection: str | None = None) -> Chunk:
    return Chunk(
        chunk_id=chunk_id,
        content=f"content {chunk_id}",
        score=score,
        file_name=file_name,
        display_citation=file_name,
        content_type=ContentType.TEXT,
        retrieval_rank=rank,
        metadata={"collection": collection} if collection else {},
    )


def _result(chunks, backend: str = "llamaindex") -> RetrievalResult:
    return RetrievalResult(chunks=chunks, query="q", backend=backend, success=True)


def _ids(merged) -> list[str]:
    return [chunk.chunk_id for chunk in merged.chunks]


def test_a_chunk_found_by_both_channels_outranks_a_single_channel_one() -> None:
    vector = [SimpleNamespace(chunk_id="vector-only"), SimpleNamespace(chunk_id="both")]
    lexical = [SimpleNamespace(chunk_id="both")]
    fused = fuse_with_ranks([vector, lexical])
    assert [(chunk.chunk_id, rank) for chunk, rank, _score in fused] == [("both", 0), ("vector-only", 1)]


def test_a_lexical_only_hit_with_a_poor_cosine_survives_the_merge_into_the_top_k() -> None:
    collection = _result(
        [
            _chunk("lex-hit", 0.21, rank=0),
            _chunk("vec-1", 0.62, rank=1),
            _chunk("vec-2", 0.58, rank=2),
        ]
    )
    merged = merge_results([collection], query="q", top_k=2, backend_name="llamaindex", max_per_document=0)
    assert _ids(merged) == ["lex-hit", "vec-1"]


def test_a_session_hit_at_rank_zero_beats_a_corpus_hit_at_rank_five() -> None:
    corpus = _result([_chunk(f"corpus-{rank}", 0.70 - rank * 0.01, rank, "oib-rl2.pdf") for rank in range(6)])
    session = _result([_chunk("session-0", 0.45, rank=0, file_name="mein_projekt.pdf", collection="s_abc")])
    merged = merge_results([corpus, session], query="q", top_k=3, backend_name="llamaindex", max_per_document=0)
    assert _ids(merged) == ["corpus-0", "session-0", "corpus-1"]
    assert merged.chunks[1].score < merged.chunks[2].score, "it wins on rank while holding the worse similarity"


def test_the_base_corpus_wins_an_exact_tie_because_it_is_the_first_channel() -> None:
    corpus = _result([_chunk("corpus-0", 0.70, rank=0, collection="oib_knowledge")])
    session = _result([_chunk("session-0", 0.45, rank=0, file_name="mine.pdf", collection="s_abc")])
    merged = merge_results([corpus, session], query="q", top_k=2, backend_name="llamaindex", max_per_document=0)
    assert _ids(merged) == ["corpus-0", "session-0"]


def test_a_rank_gap_left_by_a_dropped_hit_does_not_promote_the_survivors() -> None:
    corpus = _result([_chunk("corpus-0", 0.70, rank=0), _chunk("corpus-5", 0.60, rank=5)])
    session = _result([_chunk("session-1", 0.40, rank=1, file_name="mine.pdf", collection="s_abc")])
    merged = merge_results([corpus, session], query="q", top_k=3, backend_name="llamaindex", max_per_document=0)
    assert _ids(merged) == ["corpus-0", "session-1", "corpus-5"]


def test_the_merge_never_raises_on_the_results_gather_hands_it() -> None:
    ok = _result([_chunk("corpus-0", 0.70, rank=0)])
    failed = RetrievalResult(chunks=[], query="q", backend="llamaindex", success=False, error_message="not found")
    merged = merge_results(
        [ok, failed, RuntimeError("boom"), object()],
        query="q",
        top_k=5,
        backend_name="llamaindex",
    )
    assert merged.success is True
    assert _ids(merged) == ["corpus-0"]


def test_the_diversity_cap_fill_pass_is_reachable() -> None:
    ordered = [
        _chunk("a-0", 0.90, 0, "a.pdf"),
        _chunk("a-1", 0.88, 1, "a.pdf"),
        _chunk("a-2", 0.86, 2, "a.pdf"),
        _chunk("b-0", 0.50, 3, "b.pdf"),
        _chunk("b-1", 0.48, 4, "b.pdf"),
        _chunk("b-2", 0.46, 5, "b.pdf"),
    ]
    capped = apply_diversity_cap(ordered, top_k=5, max_per_document=2)
    assert len(capped) == 5, "the cap must be exceeded rather than return fewer than top_k"
    assert [chunk.chunk_id for chunk in capped] == ["a-0", "a-1", "a-2", "b-0", "b-1"]


def test_the_diversity_cap_output_is_monotone_in_the_rank_it_selected_by() -> None:
    ordered = [_chunk(f"a-{rank}", 0.90 - rank / 100, rank, "a.pdf") for rank in range(4)]
    ordered += [_chunk(f"b-{rank}", 0.40 - rank / 100, 4 + rank, "b.pdf") for rank in range(4)]
    capped = apply_diversity_cap(ordered, top_k=6, max_per_document=2)
    positions = [ordered.index(chunk) for chunk in capped]
    assert positions == sorted(positions), "the returned slate must be a subsequence of the fused order"


def test_the_diversity_cap_never_returns_a_worse_slate_than_plain_top_k_when_documents_are_scarce() -> None:
    on_topic = [_chunk(f"a-{rank}", 0.82, rank, "a.pdf") for rank in range(8)]
    off_topic = [
        _chunk(f"{name}-{i}", 0.39, 8 + offset, f"{name}.pdf")
        for offset, (name, i) in enumerate([("b", 0), ("b", 1), ("c", 0), ("c", 1)])
    ]
    capped = apply_diversity_cap(on_topic + off_topic, top_k=12, max_per_document=2)
    assert [chunk.chunk_id for chunk in capped[:8]] == [chunk.chunk_id for chunk in on_topic]


def test_a_single_collection_with_the_cap_disabled_is_plain_top_k() -> None:
    chunks = [_chunk(f"a-{rank}", 0.90 - rank / 100, rank, "a.pdf") for rank in range(5)]
    merged = merge_results([_result(chunks)], query="q", top_k=3, backend_name="llamaindex", max_per_document=0)
    assert _ids(merged) == ["a-0", "a-1", "a-2"]


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
