from __future__ import annotations

import builtins

import pytest
from knowledge_layer.dependencies import ensure_retrieval_dependencies
from knowledge_layer.dependencies import retrieval_dependency_error
from knowledge_layer.dependencies import retrieval_dependency_report

_BROKEN_CORE = ImportError("cannot import name 'core' from 'llama_index' (unknown location)")


@pytest.fixture
def break_import(monkeypatch):

    def _apply(target: str, error: BaseException):
        real = builtins.__import__

        def fake(name, *args, **kwargs):
            if name == target:
                raise error
            return real(name, *args, **kwargs)

        monkeypatch.setattr(builtins, "__import__", fake)

    return _apply


def test_healthy_environment_reports_nothing() -> None:
    assert retrieval_dependency_report() == []


def test_a_broken_install_is_not_reported_as_missing(break_import) -> None:
    break_import("llama_index.core", _BROKEN_CORE)

    findings = retrieval_dependency_report()

    assert findings, "a broken llama-index-core produced no finding"
    assert "llama-index-core: installed but broken" in findings[0]
    assert "cannot import name 'core'" in findings[0]
    assert "not installed" not in findings[0]


def test_a_genuinely_absent_module_is_reported_as_missing(break_import) -> None:
    break_import("qdrant_client", ModuleNotFoundError("No module named 'qdrant_client'", name="qdrant_client"))

    findings = retrieval_dependency_report()

    assert any(f.startswith("qdrant-client: not installed") for f in findings), findings


def test_a_missing_transitive_dependency_is_not_reported_as_missing(break_import) -> None:
    break_import(
        "llama_index.core",
        ModuleNotFoundError("No module named 'tenacity'", name="tenacity"),
    )

    findings = retrieval_dependency_report()

    assert findings
    assert "llama-index-core: installed but broken" in findings[0]
    assert "tenacity" in findings[0]
    assert "not installed" not in findings[0]


def test_the_preflight_raises_when_any_module_is_unusable(break_import) -> None:
    break_import("qdrant_client", _BROKEN_CORE)

    with pytest.raises(RuntimeError, match="qdrant-client: installed but broken"):
        ensure_retrieval_dependencies()


def test_the_preflight_is_silent_in_a_healthy_environment() -> None:
    ensure_retrieval_dependencies()


def test_the_error_carries_the_triggering_cause_and_the_module_status(break_import) -> None:
    break_import("llama_index.core", _BROKEN_CORE)

    message = str(retrieval_dependency_error(_BROKEN_CORE))

    assert "cannot import name 'core'" in message
    assert "llama-index-core: installed but broken" in message
    assert "uv sync --extra llamaindex" in message


def test_the_error_is_still_useful_when_no_module_faults(break_import) -> None:
    message = str(retrieval_dependency_error(ImportError("something else entirely")))

    assert "no per-module fault found" in message
    assert "something else entirely" in message


def test_the_retriever_raise_site_chains_the_original_import_error(break_import) -> None:
    from knowledge_layer.search import LlamaIndexRetriever

    break_import("llama_index.core", _BROKEN_CORE)

    retriever = LlamaIndexRetriever.__new__(LlamaIndexRetriever)

    with pytest.raises(RuntimeError) as exc_info:
        retriever._initialize_components()

    assert "llama-index-core: installed but broken" in str(exc_info.value)
    assert "uv sync --extra llamaindex" in str(exc_info.value)
    assert exc_info.value.__cause__ is _BROKEN_CORE


def test_the_ingestor_raise_site_preflights_the_same_way(break_import) -> None:
    from knowledge_layer.ingest import LlamaIndexIngestor

    break_import("qdrant_client", _BROKEN_CORE)

    ingestor = LlamaIndexIngestor.__new__(LlamaIndexIngestor)
    ingestor._initialized = False

    with pytest.raises(RuntimeError) as exc_info:
        ingestor._ensure_initialized()

    assert "qdrant-client: installed but broken" in str(exc_info.value)
    assert exc_info.value.__cause__ is _BROKEN_CORE
