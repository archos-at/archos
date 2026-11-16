from __future__ import annotations

from types import SimpleNamespace

import pytest
from knowledge_layer.embedding import embed_fingerprint
from knowledge_layer.embedding import embed_fingerprint_metadata
from knowledge_layer.ingest import EMBED_EXCLUDED_METADATA_KEYS
from knowledge_layer.ingest import apply_metadata_exclusions
from knowledge_layer.search import LlamaIndexRetriever
from knowledge_layer.search import unit_score
from knowledge_layer.vector_store import Hit
from knowledge_layer.vector_store import identity_mismatch


def _hit(chunk_id: str, cosine: float, text: str = "Fluchtwege sind so auszubilden…") -> Hit:
    payload = {"file_name": "oib-rl_2.pdf", "page_label": "13", "content_type": "text", "chunk_id": chunk_id}
    return Hit(chunk_id, text, payload, 0.0, cosine)


def _retriever() -> LlamaIndexRetriever:
    return LlamaIndexRetriever(config={"embed_model": "m", "embed_base_url": "https://host"})


def test_a_hits_score_is_its_true_cosine() -> None:
    retriever = _retriever()
    assert retriever._chunk_from_hit(_hit("a", 0.0)).score == pytest.approx(0.0, abs=1e-9)
    assert retriever._chunk_from_hit(_hit("a", 0.73)).score == pytest.approx(0.73, abs=1e-9)
    assert retriever._chunk_from_hit(_hit("a", -0.4)).score == 0.0  # contradictory, floored


def test_the_score_is_total_and_never_raises() -> None:
    for bad in (None, float("nan"), float("inf"), float("-inf"), -1.0, 0.0, 2.0, "", "abc", object()):
        value = unit_score(bad)
        assert isinstance(value, float)
        assert 0.0 <= value <= 1.0


def test_the_score_is_monotone_so_every_ordering_consumer_is_unaffected() -> None:
    cosines = [0.95, 0.8, 0.6, 0.4, 0.2, 0.05]
    assert [unit_score(c) for c in cosines] == cosines


def test_a_hit_keeps_the_stored_chunk_id() -> None:
    retriever = _retriever()
    first = retriever._chunk_from_hit(_hit("stored-id-42", 0.6))
    second = retriever._chunk_from_hit(_hit("stored-id-42", 0.6))
    assert first.chunk_id == second.chunk_id == "stored-id-42"


def test_two_rankings_agree_on_identity_so_rrf_can_fuse() -> None:
    from knowledge_layer.search import reciprocal_rank_fusion

    lexical = [_retriever()._chunk_from_hit(_hit("shared-id", 0.6))]
    vector = [SimpleNamespace(chunk_id="shared-id"), SimpleNamespace(chunk_id="other-id")]

    fused = reciprocal_rank_fusion([vector, lexical])
    ids = [c.chunk_id for c in fused]
    assert ids.count("shared-id") == 1, "the same passage must not appear twice"
    assert ids[0] == "shared-id", "a chunk found by both channels must outrank a single-channel one"


def test_noise_metadata_is_excluded_from_the_embedded_text() -> None:
    from llama_index.core import Document
    from llama_index.core.schema import MetadataMode

    doc = Document(
        text="Die nutzbare Breite von Fluchtwegen muss mindestens 1,20 m betragen.",
        metadata={
            "file_name": "oib-rl_2.pdf",
            "file_size": 1975942,
            "page_label": "13",
            "content_type": "text",
            "doc_class": "oib_guideline",
        },
    )
    apply_metadata_exclusions(doc)

    embedded = doc.get_content(metadata_mode=MetadataMode.EMBED)
    assert "1975942" not in embedded, "a byte count carries no retrieval signal"
    assert "oib-rl_2.pdf" in embedded, "the filename is what users actually query by"
    assert "oib_guideline" in embedded
    assert doc.metadata["file_size"] == 1975942


def test_exclusions_extend_rather_than_replace_existing_ones() -> None:
    doc = SimpleNamespace(
        excluded_embed_metadata_keys=["creation_date"],
        excluded_llm_metadata_keys=[],
        metadata={},
    )
    apply_metadata_exclusions(doc)
    assert "creation_date" in doc.excluded_embed_metadata_keys
    assert "file_size" in doc.excluded_embed_metadata_keys


def test_the_ingest_temp_path_is_never_embedded() -> None:
    assert "file_path" in EMBED_EXCLUDED_METADATA_KEYS


def test_exclusions_are_idempotent() -> None:
    doc = SimpleNamespace(excluded_embed_metadata_keys=[], excluded_llm_metadata_keys=[], metadata={})
    apply_metadata_exclusions(doc)
    apply_metadata_exclusions(doc)
    assert len(doc.excluded_embed_metadata_keys) == len(set(doc.excluded_embed_metadata_keys))


def test_a_malformed_reranker_env_var_does_not_break_the_import() -> None:
    import importlib
    import os

    from knowledge_layer.search import cross_encoder

    os.environ["RERANKER_TIMEOUT_SECONDS"] = "abc"
    os.environ["RERANKER_MAX_DOC_CHARS"] = "lots"
    try:
        reloaded = importlib.reload(cross_encoder)
        assert reloaded.DEFAULT_TIMEOUT_SECONDS == 3.0
        assert reloaded.DEFAULT_MAX_DOC_CHARS == 4000
    finally:
        del os.environ["RERANKER_TIMEOUT_SECONDS"]
        del os.environ["RERANKER_MAX_DOC_CHARS"]
        importlib.reload(cross_encoder)


def test_resolving_a_nonsense_provider_returns_none_rather_than_raising() -> None:
    from knowledge_layer.search import resolve_cross_encoder

    for hostile in (0, ["openrouter"], object(), "definitely-not-a-provider", "", "none"):
        assert resolve_cross_encoder(hostile) is None


def test_a_matching_fingerprint_passes_and_a_different_model_is_reported() -> None:
    stamped = embed_fingerprint_metadata("model-a", "https://host/v1")
    assert identity_mismatch(stamped, embed_fingerprint_metadata("model-a", "https://host/v1")) is None

    mismatch = identity_mismatch(stamped, embed_fingerprint_metadata("model-b", "https://host/v1"))
    assert mismatch and "model-b" in mismatch and "model-a" in mismatch


def test_the_same_model_on_a_different_host_is_a_different_vector_space() -> None:
    stamped = embed_fingerprint_metadata("text-embedding-3-large", "https://openrouter.ai/api/v1")
    other = embed_fingerprint_metadata("text-embedding-3-large", "https://embeddings.example.com/v1")
    assert identity_mismatch(stamped, other)


def test_a_trailing_slash_is_not_a_different_deployment() -> None:
    assert embed_fingerprint("m", "https://host/v1/") == embed_fingerprint("m", "https://host/v1")
