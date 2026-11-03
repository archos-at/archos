"""A chunk's id is what it is, and its embedding is cached by what it says (``chunk_identity``).

Unit tests: the Qdrant suite that writes real points skips without
``QDRANT_TEST_URL`` (``task be:test:sources`` runs it with a server). What is
held here is the id function, the set arithmetic retirement and discard use,
and the cache, against an in-memory stand-in for Dragonfly.
"""

from __future__ import annotations

import uuid

import numpy as np
import pytest
from knowledge_layer.llamaindex import chunk_identity
from knowledge_layer.llamaindex.chunk_identity import ChunkVersion
from knowledge_layer.llamaindex.chunk_identity import chunk_id
from knowledge_layer.llamaindex.chunk_identity import embed_with_cache
from knowledge_layer.llamaindex.chunk_identity import ids_only_in

from .test_ingest_screen_before_tables import _ingest
from .test_ingest_screen_before_tables import _pdf
from .test_ingest_screen_before_tables import calls  # noqa: F401 - fixtures, shared with the harness
from .test_ingest_screen_before_tables import store  # noqa: F401
from .test_ingest_screen_before_tables import summary_db  # noqa: F401

V1 = ChunkVersion("proj_1", "doc-1", "a" * 64)


class TestChunkId:
    def test_the_same_chunk_of_the_same_version_has_the_same_id(self):
        assert chunk_id(V1, 3, "Brandabschnitt") == chunk_id(V1, 3, "Brandabschnitt")
        assert uuid.UUID(chunk_id(V1, 3, "Brandabschnitt")).version == 5

    @pytest.mark.parametrize(
        ("version", "ordinal", "text"),
        [
            (ChunkVersion("proj_2", "doc-1", "a" * 64), 3, "Brandabschnitt"),
            (ChunkVersion("proj_1", "doc-2", "a" * 64), 3, "Brandabschnitt"),
            (ChunkVersion("proj_1", "doc-1", "b" * 64), 3, "Brandabschnitt"),
            (V1, 4, "Brandabschnitt"),
            (V1, 3, "Brandabschnitte"),
        ],
    )
    def test_every_part_of_the_identity_changes_the_id(self, version, ordinal, text):
        assert chunk_id(version, ordinal, text) != chunk_id(V1, 3, "Brandabschnitt")

    def test_the_version_is_the_files_content_hash(self, tmp_path):
        one, two = tmp_path / "a.pdf", tmp_path / "b.pdf"
        one.write_bytes(b"%PDF-1.4 one")
        two.write_bytes(b"%PDF-1.4 one")
        assert chunk_identity.file_version(str(one)) == chunk_identity.file_version(str(two))
        two.write_bytes(b"%PDF-1.4 two")
        assert chunk_identity.file_version(str(one)) != chunk_identity.file_version(str(two))


class TestRetireAndDiscard:
    def test_retiring_a_re_read_of_the_same_bytes_deletes_none_of_the_new_chunks(self):
        previous = [chunk_id(V1, n, f"Seite {n}") for n in range(4)]
        written = [chunk_id(V1, n, f"Seite {n}") for n in range(3)] + [chunk_id(V1, 3, "Seite 3, neu gelesen")]

        assert ids_only_in(previous, written) == [previous[3]]

    def test_discarding_a_failed_attempt_never_deletes_the_kept_version(self):
        kept = [chunk_id(V1, n, f"Seite {n}") for n in range(2)]
        attempted = [*kept, chunk_id(V1, 2, "Seite 2")]

        assert ids_only_in(attempted, kept) == [attempted[2]]
        assert ids_only_in(attempted, None) == attempted


@pytest.fixture
def cache(monkeypatch):
    from agent.common import cache as cache_module

    held: dict[str, object] = {}
    monkeypatch.setattr(cache_module, "get_json", held.get)
    monkeypatch.setattr(cache_module, "set_json", lambda key, value, ttl: held.__setitem__(key, value))
    return held


def _embedder(batches: list[list[str]]):
    def embed(texts):
        batches.append(list(texts))
        return [[0.1 * (len(text) % 7) + 0.123456789, 1.0 / 3.0, -2.5] for text in texts]

    return embed


class TestEmbeddingCache:
    def test_a_second_embedding_of_the_same_texts_makes_no_call_and_writes_the_same_vectors(self, cache):
        batches: list[list[str]] = []
        first, hits_first = embed_with_cache(["a", "bb", "a"], _embedder(batches), fingerprint="fp")
        second, hits_second = embed_with_cache(["bb", "a"], _embedder(batches), fingerprint="fp")

        assert batches == [["a", "bb", "a"]]
        assert (hits_first, hits_second) == (0, 2)
        assert second == [first[1], first[0]]
        # As float32, the precision a Qdrant point stores, so cached and fresh vectors are one point.
        assert first[0][0] == np.float32(0.1 + 0.123456789).item()

    def test_only_the_missing_texts_are_embedded(self, cache):
        batches: list[list[str]] = []
        embed_with_cache(["a"], _embedder(batches), fingerprint="fp")
        vectors, hits = embed_with_cache(["a", "neu"], _embedder(batches), fingerprint="fp")

        assert batches == [["a"], ["neu"]] and hits == 1 and len(vectors) == 2

    def test_another_embedder_never_gets_these_vectors(self, cache):
        batches: list[list[str]] = []
        embed_with_cache(["a"], _embedder(batches), fingerprint="model-a@endpoint")
        embed_with_cache(["a"], _embedder(batches), fingerprint="model-b@endpoint")

        assert batches == [["a"], ["a"]]
        assert len(cache) == 2

    def test_a_cache_that_is_down_costs_the_hit_not_the_file(self, monkeypatch):
        from agent.common import cache as cache_module

        def down(*args, **kwargs):
            raise ConnectionError("dragonfly away")

        monkeypatch.setattr(cache_module, "get_json", down)
        monkeypatch.setattr(cache_module, "set_json", down)
        batches: list[list[str]] = []

        vectors, hits = embed_with_cache(["a", "b"], _embedder(batches), fingerprint="fp")

        assert len(vectors) == 2 and hits == 0 and batches == [["a", "b"]]

    def test_a_ttl_of_zero_turns_it_off(self, cache, monkeypatch):
        monkeypatch.setattr(chunk_identity, "EMBED_CACHE_TTL_SECONDS", 0)
        batches: list[list[str]] = []
        embed_with_cache(["a"], _embedder(batches), fingerprint="fp")
        embed_with_cache(["a"], _embedder(batches), fingerprint="fp")

        assert batches == [["a"], ["a"]] and cache == {}


class TestAnIngestWritesTheSameIdsTwice:
    """Through the real `_ingest_job`, on the offline harness: a retry overwrites, it does not duplicate."""

    def test_two_attempts_of_one_version_write_the_same_chunk_ids(self, tmp_path, calls, monkeypatch):  # noqa: F811
        from knowledge_layer.qdrant import writes

        written: list[list[str]] = []
        monkeypatch.setattr(
            writes, "write_chunks", lambda scope, name, records, **k: written.append([r.chunk_id for r in records])
        )
        path = _pdf(tmp_path, "Baubeschreibung Hubergasse 14", "Gebaeudeklasse 4, vier Geschosse")

        _ingest(calls, path, "Baubeschreibung.pdf", None, document_id="0b9c4f1e-1c1a-4f7e-9f55-1d2b3c4d5e6f")
        _ingest(calls, path, "Baubeschreibung.pdf", None, document_id="0b9c4f1e-1c1a-4f7e-9f55-1d2b3c4d5e6f")

        assert len(written) == 2 and written[0] and written[0] == written[1]
        assert all(uuid.UUID(chunk).version == 5 for chunk in written[0])
