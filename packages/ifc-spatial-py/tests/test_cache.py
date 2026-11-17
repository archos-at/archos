from __future__ import annotations

import threading
from pathlib import Path

import pytest
from ifc_spatial.cache import SpatialCache
from ifc_spatial.cache import hash_bytes
from ifc_spatial.cache import hash_file
from ifc_spatial.model import SpatialModel

FIXTURES = Path(__file__).resolve().parent / "fixtures"
SMALL = FIXTURES / "house-with-rooms.ifc"
OTHER = FIXTURES / "floor-slab-and-window.ifc"


def test_the_key_is_the_content_and_not_the_name(tmp_path: Path) -> None:
    original = SMALL.read_bytes()
    copy = tmp_path / "ganz-anders-benannt.ifc"
    copy.write_bytes(original)
    assert hash_file(SMALL) == hash_file(copy) == hash_bytes(original)

    cache = SpatialCache()
    first = cache.load(SMALL)
    second = cache.load(copy)
    assert first is second
    assert cache.stats["misses"] == 1


def test_an_edited_file_is_a_guaranteed_miss(tmp_path: Path) -> None:
    path = tmp_path / "modell.ifc"
    path.write_bytes(SMALL.read_bytes())
    cache = SpatialCache()
    before = cache.load(path)

    text = path.read_text(encoding="utf-8", errors="surrogateescape")
    path.write_text(text.replace("Wohnzimmer", "Wohnkueche", 1), encoding="utf-8", errors="surrogateescape")

    after = cache.load(path)
    assert after is not before
    assert cache.stats["misses"] == 2


def test_two_concurrent_opens_run_one_read() -> None:
    cache = SpatialCache()
    gate = threading.Barrier(4)
    results: list[SpatialModel] = []
    lock = threading.Lock()

    def worker() -> None:
        gate.wait(timeout=30)
        model = cache.load(SMALL)
        with lock:
            results.append(model)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)

    assert len(results) == 4
    assert all(model is results[0] for model in results)
    stats = cache.stats
    assert stats["misses"] == 1, "a second read started"
    assert stats["hits"] == 3, "the coalesced callers were not counted as hits"
    assert stats["entries"] == 1


def test_a_failed_read_does_not_poison_the_hash(tmp_path: Path) -> None:
    broken = tmp_path / "kaputt.ifc"
    broken.write_text("ISO-10303-21; das ist keine IFC-Datei", encoding="utf-8")
    cache = SpatialCache()
    with pytest.raises(Exception):
        cache.load(broken)
    with pytest.raises(Exception):
        cache.load(broken)
    assert cache.stats["entries"] == 0
    assert cache.load(SMALL) is not None


def test_the_lid_is_an_entry_count_and_evicts_oldest_first() -> None:
    cache = SpatialCache(max_entries=1)
    first = cache.load(SMALL)
    cache.load(OTHER)
    assert cache.stats["entries"] == 1
    assert cache.has(hash_file(SMALL)) is False
    assert cache.has(hash_file(OTHER)) is True

    again = cache.load(SMALL)
    assert again is not first
    assert cache.stats["misses"] == 3


def test_never_evicts_the_entry_it_just_admitted() -> None:
    cache = SpatialCache(max_entries=1)
    model = cache.load(SMALL)
    assert cache.get(hash_file(SMALL)) is model


def test_bytes_and_path_reach_the_same_model() -> None:
    cache = SpatialCache()
    from_path = cache.load(SMALL)
    from_bytes = cache.load_bytes(SMALL.read_bytes())
    assert from_path is from_bytes
    assert cache.stats["misses"] == 1


def test_a_handle_resolves_by_abbreviated_hash() -> None:
    cache = SpatialCache()
    model = cache.load(SMALL)
    digest = hash_file(SMALL)
    assert cache.resolve(digest[:12]) is model
    assert cache.resolve("ab") is None
    assert cache.resolve("f" * 40) is None


def test_asking_about_the_cache_does_not_change_what_it_evicts() -> None:
    cache = SpatialCache()
    cache.load(SMALL)
    before = cache.stats
    assert cache.has(hash_file(SMALL)) is True
    assert cache.stats == before, "has() was counted as a use"
