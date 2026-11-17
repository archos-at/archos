from __future__ import annotations

import threading
from types import SimpleNamespace
from typing import Any

import pytest

from agent.knowledge import document_classification

from .test_ingest_screen_before_tables import _ingest
from .test_ingest_screen_before_tables import _pdf
from .test_ingest_screen_before_tables import calls  # noqa: F401 - fixtures, shared with the harness
from .test_ingest_screen_before_tables import store  # noqa: F401
from .test_ingest_screen_before_tables import summary_db  # noqa: F401

_LINES = (
    "Baubeschreibung Wohnhausanlage Hubergasse 14",
    "Die Ausfuehrung erfolgt gem. Brandschutzkonzept und nach OENORM B 1600.",
)


class _SummaryModel:
    model_name = "fake/summary"

    def __init__(self, dossier: Any):
        self.dossier = dossier

    def bind(self, **kwargs: Any) -> Any:
        model = self

        class _Bound:
            def invoke(self, messages):
                if isinstance(model.dossier, Exception):
                    raise model.dossier
                return SimpleNamespace(content=model.dossier, usage_metadata={})

        return _Bound()

    def invoke(self, prompt):
        return SimpleNamespace(content="Ein Satz aus der ersten Seite.")


@pytest.fixture
def order(calls, monkeypatch):  # noqa: F811
    from knowledge_layer.vector_store import writes

    events: list[str] = []
    written = threading.Event()

    def write_chunks(*args, **kwargs):
        events.append("write")
        written.set()

    def tags(*args, **kwargs):
        assert written.wait(10), "the write waited for the tag call"
        events.append("tags")
        return ["Baubeschreibung"]

    monkeypatch.setattr(writes, "write_chunks", write_chunks)
    monkeypatch.setattr(writes, "refresh_facts", lambda scope, names=None, **k: events.append(f"facts:{names}"))
    monkeypatch.setattr(document_classification, "classify_document_tags", tags)
    monkeypatch.setattr(document_classification, "suggest_topics", lambda *a, **k: ["Wohnbau"])

    def _run(tmp_path, dossier: Any = "{}"):
        ingestor = calls["ingestor"]
        ingestor.generate_summary_enabled = True
        ingestor.summary_llm = _SummaryModel(dossier)
        detail = _ingest(calls, _pdf(tmp_path, *_LINES), "Baubeschreibung.pdf", None)
        from agent.knowledge import get_available_documents

        return detail, get_available_documents("proj_1")[0], events

    return _run


def test_the_chunks_are_written_before_the_tags_answer_and_the_tags_reach_the_points(tmp_path, order):
    detail, document, events = order(tmp_path)

    assert detail.status.value == "success"
    assert events.index("write") < events.index("tags")
    assert any(event.startswith("facts:") for event in events[events.index("tags") :])
    assert document.tags == ["Baubeschreibung"]
    assert document.topics == ["Wohnbau"]


def test_a_failed_dossier_does_not_fail_the_write(tmp_path, order):
    detail, document, events = order(tmp_path, dossier=RuntimeError("provider down"))

    assert detail.status.value == "success"
    assert "write" in events
    assert document.dossier is None
    assert document.summary == "Ein Satz aus der ersten Seite."
    assert document.tags == ["Baubeschreibung"]
