from __future__ import annotations

import threading

import pytest

from agent.knowledge import collection_version


class FakeSharedStore:
    def __init__(self) -> None:
        self.values: dict[str, int] = {}
        self.calls = 0
        self.answering = True
        self._lock = threading.Lock()

    def eval_script(self, script: str, keys: list[str], args: list[object]) -> int | None:
        with self._lock:
            self.calls += 1
            if not self.answering:
                return None
            key = keys[0]
            floor = int(args[0])  # type: ignore[arg-type]
            value = self.values.get(key, 0)
            if "INCR" in script:
                value += 1
            value = max(value, floor)
            self.values[key] = value
            return value


@pytest.fixture(autouse=True)
def _clean_versions(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    collection_version.reset_local_versions()
    yield
    collection_version.reset_local_versions()


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> FakeSharedStore:
    fake = FakeSharedStore()
    monkeypatch.setenv("REDIS_URL", "redis://dragonfly:6379/0")
    monkeypatch.setattr(collection_version.cache, "eval_script", fake.eval_script)
    return fake


def test_a_bump_is_visible_to_the_next_read_of_the_same_collection(store: FakeSharedStore) -> None:
    assert collection_version.current("oib_knowledge") == 0

    collection_version.bump("oib_knowledge")

    assert collection_version.current("oib_knowledge") == 1


def test_each_collection_carries_its_own_version(store: FakeSharedStore) -> None:
    collection_version.bump("oib_knowledge")
    collection_version.bump("oib_knowledge")

    assert collection_version.current("oib_knowledge") == 2
    assert collection_version.current("project_42") == 0


def test_a_second_replica_sees_the_first_replicas_bump(store: FakeSharedStore) -> None:
    collection_version.bump("oib_knowledge")
    seen_by_writer = collection_version.current("oib_knowledge")

    collection_version.reset_local_versions()

    assert collection_version.current("oib_knowledge") == seen_by_writer


def test_an_unresolvable_version_reads_as_unknown_rather_than_zero(store: FakeSharedStore) -> None:
    collection_version.bump("oib_knowledge")
    collection_version.reset_local_versions()  # a replica that has never resolved it
    store.answering = False

    assert collection_version.current("oib_knowledge") is None


def test_a_caller_skips_its_cache_entirely_when_the_version_is_unknown(store: FakeSharedStore) -> None:

    def cache_key(collection: str, query: str) -> tuple[str, int, str] | None:
        version = collection_version.current(collection)
        if version is None:
            return None
        return (collection, version, query)

    assert cache_key("oib_knowledge", "OIB 6") is not None

    collection_version.reset_local_versions()
    store.answering = False

    assert cache_key("oib_knowledge", "OIB 6") is None


def test_the_memo_spares_the_store_a_round_trip_per_query(store: FakeSharedStore) -> None:
    collection_version.current("oib_knowledge")
    calls_after_first = store.calls

    for _ in range(20):
        collection_version.current("oib_knowledge")

    assert store.calls == calls_after_first


def test_the_memo_expires_so_another_replicas_write_becomes_visible(
    monkeypatch: pytest.MonkeyPatch, store: FakeSharedStore
) -> None:
    monkeypatch.setattr(collection_version, "MEMO_TTL_SECONDS", 0.0)

    assert collection_version.current("oib_knowledge") == 0

    store.values["knowledge:collection-version:oib_knowledge"] = 9

    assert collection_version.current("oib_knowledge") == 9


def test_a_bump_refreshes_the_memo_immediately_on_the_writing_replica(store: FakeSharedStore) -> None:
    collection_version.current("oib_knowledge")  # warm the memo at 0

    collection_version.bump("oib_knowledge")

    assert collection_version.current("oib_knowledge") == 1


def test_concurrent_bumps_never_lose_an_increment(store: FakeSharedStore) -> None:
    threads = 8
    per_thread = 25

    def bump_many() -> None:
        for _ in range(per_thread):
            collection_version.bump("oib_knowledge")

    workers = [threading.Thread(target=bump_many) for _ in range(threads)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join()

    assert store.values["knowledge:collection-version:oib_knowledge"] == threads * per_thread
    assert collection_version.current("oib_knowledge") == threads * per_thread


def test_a_bump_lost_to_an_outage_is_applied_once_the_store_returns(store: FakeSharedStore) -> None:
    collection_version.bump("oib_knowledge")
    assert collection_version.current("oib_knowledge") == 1

    store.answering = False
    collection_version.bump("oib_knowledge")  # never reaches the store
    store.answering = True

    assert collection_version.current("oib_knowledge") == 2
    assert store.values["knowledge:collection-version:oib_knowledge"] == 2


def test_an_evicted_counter_is_lifted_back_instead_of_restarting_at_one(
    monkeypatch: pytest.MonkeyPatch, store: FakeSharedStore
) -> None:
    monkeypatch.setattr(collection_version, "MEMO_TTL_SECONDS", 0.0)
    for _ in range(5):
        collection_version.bump("oib_knowledge")
    assert collection_version.current("oib_knowledge") == 5

    store.values.clear()

    assert collection_version.current("oib_knowledge") == 5
    assert store.values["knowledge:collection-version:oib_knowledge"] == 5


def test_versions_never_go_backwards(store: FakeSharedStore) -> None:
    seen = []
    for _ in range(5):
        collection_version.bump("oib_knowledge")
        version = collection_version.current("oib_knowledge")
        assert version is not None
        seen.append(version)

    assert seen == sorted(seen)
    assert len(set(seen)) == len(seen)


def test_without_a_shared_store_the_in_process_counter_is_the_authority() -> None:
    assert collection_version.current("oib_knowledge") == 0

    collection_version.bump("oib_knowledge")
    collection_version.bump("oib_knowledge")

    assert collection_version.current("oib_knowledge") == 2


def test_a_bug_in_the_store_call_degrades_to_unknown_not_to_a_stale_hit(
    monkeypatch: pytest.MonkeyPatch, store: FakeSharedStore
) -> None:
    def boom(*_args: object, **_kwargs: object) -> int:
        raise RuntimeError("dragonfly client exploded")

    collection_version.bump("oib_knowledge")
    collection_version.reset_local_versions()
    monkeypatch.setattr(collection_version.cache, "eval_script", boom)

    assert collection_version.current("oib_knowledge") is None


def test_a_bump_that_cannot_reach_the_store_does_not_raise(store: FakeSharedStore) -> None:
    store.answering = False

    collection_version.bump("oib_knowledge")
