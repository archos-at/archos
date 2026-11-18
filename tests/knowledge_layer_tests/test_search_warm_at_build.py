from __future__ import annotations

import sys
import threading

from knowledge_layer import register
from knowledge_layer.search import LlamaIndexRetriever


class _Retriever:
    def __init__(self, error: Exception | None = None) -> None:
        self.threads: list[threading.Thread] = []
        self.error = error

    def warm_components(self) -> None:
        self.threads.append(threading.current_thread())
        if self.error is not None:
            raise self.error


async def test_the_warm_up_initialises_the_retriever_off_the_loop():
    retriever = _Retriever()

    await register._warm_search_path(retriever)

    assert len(retriever.threads) == 1
    assert retriever.threads[0] is not threading.current_thread()


async def test_the_search_body_modules_are_imported_by_the_warm_up():
    await register._warm_search_path(_Retriever())

    for module in (
        "knowledge_layer.browse.tool",
        "knowledge_layer.search.folder_channel",
        "knowledge_layer.read_passage.tool",
        "knowledge_layer.search.requery",
        "agent.observability.retrieval_trace",
    ):
        assert module in sys.modules, module


async def test_a_failing_warm_up_never_fails_the_build(caplog):
    await register._warm_search_path(_Retriever(RuntimeError("retrieval stack broken")))

    assert "warm-up failed" in caplog.text


async def test_a_retriever_without_the_hook_is_left_alone():
    await register._warm_search_path(object())


def test_warm_components_leaves_the_retriever_initialised(monkeypatch):
    from knowledge_layer import dependencies
    from knowledge_layer import embedding

    built: list[str] = []
    monkeypatch.setattr(dependencies, "ensure_retrieval_dependencies", lambda: None)
    monkeypatch.setattr(embedding, "resolve_embed_api_key", lambda base_url, model: "key")
    monkeypatch.setattr(embedding, "make_embed_model", lambda **kwargs: built.append(kwargs["model"]) or object())
    retriever = LlamaIndexRetriever(config={})

    retriever.warm_components()
    retriever._ensure_initialized()

    assert built == [retriever.embed_model_name]
    assert retriever._initialized
