from typing import Any

import pytest

from agent.knowledge import factory
from agent.knowledge.base import BaseRetriever
from agent.knowledge.factory import clear_active_ingestor
from agent.knowledge.factory import clear_active_retriever
from agent.knowledge.factory import get_active_retriever
from agent.knowledge.factory import get_retriever
from agent.knowledge.factory import register_retriever
from agent.knowledge.factory import set_active_ingestor
from agent.knowledge.factory import set_active_retriever
from agent.knowledge.schema import Chunk
from agent.knowledge.schema import RetrievalResult


@register_retriever("fake_search_backend")
class _FakeRetriever(BaseRetriever):
    backend_name = "fake_search_backend"

    async def retrieve(self, query, collection_name, top_k=10, filters=None) -> RetrievalResult:
        return RetrievalResult(chunks=[], query=query, backend=self.backend_name)

    def normalize(self, raw_result: Any) -> Chunk:  # pragma: no cover - unused
        raise NotImplementedError


class _FakeIngestor:
    backend_name = "fake_search_backend"
    embed_base_url = "https://embed.example/v1"
    embed_model_name = "fake-embed-model"


@pytest.fixture(autouse=True)
def _reset_active():
    clear_active_ingestor()
    clear_active_retriever()
    yield
    clear_active_ingestor()
    clear_active_retriever()


def test_builds_from_active_ingestor_config_and_caches():
    set_active_ingestor(_FakeIngestor())

    retriever = get_active_retriever()

    assert retriever.backend_name == "fake_search_backend"
    assert retriever.config["embed_base_url"] == "https://embed.example/v1"
    assert retriever.config["embed_model"] == "fake-embed-model"

    assert get_active_retriever() is retriever


def test_set_active_retriever_overrides_lazy_build():
    injected = _FakeRetriever(config={"persist_dir": "/injected"})
    set_active_retriever(injected)

    assert get_active_retriever() is injected


def test_falls_back_to_default_backend_without_ingestor(monkeypatch):
    monkeypatch.setattr(factory, "DEFAULT_RETRIEVER_BACKEND", "fake_search_backend")
    retriever = get_active_retriever()
    assert isinstance(retriever, BaseRetriever)
    assert retriever.backend_name == "fake_search_backend"


def test_the_same_backend_and_config_gets_the_same_instance():
    config = {"persist_dir": "/data/x", "embed_model": "nv-embed"}

    first = get_retriever("fake_search_backend", config)
    second = get_retriever("fake_search_backend", dict(config))

    assert second is first


def test_a_different_config_gets_a_different_instance():
    first = get_retriever("fake_search_backend", {"persist_dir": "/data/a"})
    second = get_retriever("fake_search_backend", {"persist_dir": "/data/b"})

    assert second is not first
    assert second.config["persist_dir"] == "/data/b"


def test_an_omitted_config_is_its_own_identity():
    default = get_retriever("fake_search_backend")

    assert get_retriever("fake_search_backend", {}) is default
    assert get_retriever("fake_search_backend", {"persist_dir": "/elsewhere"}) is not default


def test_a_config_value_that_is_not_json_serializable_still_resolves():
    class _Opaque:
        pass

    opaque = _Opaque()

    first = get_retriever("fake_search_backend", {"client": opaque})
    assert get_retriever("fake_search_backend", {"client": opaque}) is first


def test_clear_active_retriever_drops_the_cached_instances():
    set_active_ingestor(_FakeIngestor())
    active = get_active_retriever()
    per_identity = get_retriever("fake_search_backend", {"persist_dir": "/data/x"})

    clear_active_retriever()

    assert get_active_retriever() is not active
    assert get_retriever("fake_search_backend", {"persist_dir": "/data/x"}) is not per_identity


def test_an_unknown_backend_is_still_rejected():
    with pytest.raises(ValueError):
        get_retriever("no_such_backend")
