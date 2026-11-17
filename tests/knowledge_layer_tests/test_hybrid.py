from __future__ import annotations

from types import SimpleNamespace

from knowledge_layer.search import DEFAULT_DF_CEILING_MIN_TOTAL
from knowledge_layer.search import DEFAULT_DF_CEILING_RATIO
from knowledge_layer.search import RRF_K
from knowledge_layer.search import fuse_with_ranks
from knowledge_layer.search import reciprocal_rank_fusion
from knowledge_layer.search import selective_terms


def _chunk(chunk_id: str) -> SimpleNamespace:
    return SimpleNamespace(chunk_id=chunk_id)


def test_rrf_single_channel_preserves_order() -> None:
    channels = [[_chunk("a"), _chunk("b"), _chunk("c")]]
    fused = reciprocal_rank_fusion(channels)
    assert [c.chunk_id for c in fused] == ["a", "b", "c"]


def test_rrf_lexical_channel_boosts_exact_match() -> None:
    vector = [_chunk("b"), _chunk("a")]
    lexical = [_chunk("b")]
    fused = reciprocal_rank_fusion([vector, lexical])
    assert fused[0].chunk_id == "b"
    assert fused[1].chunk_id == "a"


def test_rrf_equal_score_tie_is_broken_toward_the_better_rank_not_the_first_channel() -> None:
    first = [_chunk("f0"), _chunk("f1"), _chunk("f2"), _chunk("deep-twice")]
    second = [_chunk("s0"), _chunk("shallow-once"), _chunk("s2"), _chunk("deep-twice")]
    fused = fuse_with_ranks([first, second], k=0)
    scored = {chunk.chunk_id: score for chunk, _rank, score in fused}
    assert scored["deep-twice"] == scored["shallow-once"], "the tie this test rests on must be exact"

    ids = [chunk.chunk_id for chunk, _rank, _score in fused]
    assert ids.index("shallow-once") < ids.index("deep-twice")


def test_rrf_channel_identity_decides_only_when_score_and_best_rank_are_equal() -> None:
    vector = [_chunk("x"), _chunk("y")]
    lexical = [_chunk("y"), _chunk("x")]
    fused = reciprocal_rank_fusion([vector, lexical])
    assert fused[0].chunk_id == "x"


def test_fuse_with_ranks_reports_dense_zero_based_ranks_and_descending_scores() -> None:
    vector = [_chunk("a"), _chunk("b"), _chunk("c")]
    lexical = [_chunk("c")]
    fused = fuse_with_ranks([vector, lexical])
    assert [(chunk.chunk_id, rank) for chunk, rank, _score in fused] == [("c", 0), ("a", 1), ("b", 2)]
    scores = [score for _chunk_obj, _rank, score in fused]
    assert scores == sorted(scores, reverse=True)


def test_fuse_with_ranks_renumbers_ranks_after_top_n_trim() -> None:
    fused = fuse_with_ranks([[_chunk("a"), _chunk("b"), _chunk("c")]], top_n=2)
    assert [(chunk.chunk_id, rank) for chunk, rank, _score in fused] == [("a", 0), ("b", 1)]


def test_fuse_with_ranks_treats_a_padded_slot_as_a_rank_gap() -> None:
    with_gap = fuse_with_ranks([[_chunk("a"), None, _chunk("c")]])
    without_gap = fuse_with_ranks([[_chunk("a"), _chunk("c")]])
    gap_score = {chunk.chunk_id: score for chunk, _rank, score in with_gap}["c"]
    dense_score = {chunk.chunk_id: score for chunk, _rank, score in without_gap}["c"]
    assert gap_score < dense_score


def test_rrf_top_n_trims() -> None:
    channels = [[_chunk("a"), _chunk("b"), _chunk("c")]]
    fused = reciprocal_rank_fusion(channels, top_n=2)
    assert [c.chunk_id for c in fused] == ["a", "b"]


def test_rrf_dedupes_by_chunk_id() -> None:
    vector = [_chunk("a"), _chunk("b")]
    lexical = [_chunk("b")]
    fused = reciprocal_rank_fusion([vector, lexical])
    ids = [c.chunk_id for c in fused]
    assert ids == ["b", "a"]


def test_rrf_empty_channels_returns_empty() -> None:
    assert reciprocal_rank_fusion([[], []]) == []


def test_rrf_k_default_is_60() -> None:
    assert RRF_K == 60


def test_rrf_chunk_without_id_is_skipped() -> None:
    plain = object()
    vector = [plain]
    fused = reciprocal_rank_fusion([vector])
    assert fused == []


def test_a_selective_term_survives_the_ceiling() -> None:
    assert selective_terms({"§ 3": 12}, 776) == ["§ 3"]


def test_a_ubiquitous_term_is_dropped() -> None:
    assert selective_terms({"OIB": 730}, 776) == []


def test_a_term_that_matches_nothing_is_dropped_before_it_costs_a_round_trip() -> None:
    assert selective_terms({"DIE": 0}, 776) == []


def test_the_ceiling_is_not_applied_to_a_collection_too_small_to_have_one() -> None:
    assert selective_terms({"Fluchtweg": 5}, 6) == ["Fluchtweg"]


def test_selective_terms_keeps_input_order_and_drops_only_the_noise() -> None:
    assert selective_terms({"OIB": 730, "§ 3": 12, "ÖNORM": 40}, 776) == ["§ 3", "ÖNORM"]


def test_the_ceiling_shares_german_texts_constants() -> None:
    from agent.common import german_text

    assert DEFAULT_DF_CEILING_RATIO == german_text.DEFAULT_DF_CEILING_RATIO
    assert DEFAULT_DF_CEILING_MIN_TOTAL == german_text.DEFAULT_DF_CEILING_MIN_TOTAL


def test_a_ubiquitous_term_is_an_echo_of_the_dense_channel() -> None:
    dense = [_chunk("dense-top"), _chunk("dense-second")]
    echo = [_chunk("dense-top"), _chunk("dense-second")]  # $contains removed nothing
    sparse_only = [_chunk("lexical-hit")]

    without_echo = reciprocal_rank_fusion([dense, sparse_only])
    assert [c.chunk_id for c in without_echo][:2] == ["dense-top", "lexical-hit"]

    with_echo = reciprocal_rank_fusion([dense, echo, sparse_only])
    assert [c.chunk_id for c in with_echo][:2] == ["dense-top", "dense-second"]
